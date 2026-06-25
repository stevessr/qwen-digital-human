"""WebSocket endpoint for Unreal Engine 5 (MetaHuman) integration.

UE5 connects to ``/api/ws/ue5`` as a WebSocket client. The backend sends
expression commands, viseme sequences, raw PCM audio, and real-time text
chunks to drive the MetaHuman face rig and subtitle display.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import struct
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..intent import (
    AnimationPreset,
    detect_intent,
    get_animation_duration,
    get_animation_for_intent,
)
from ..viseme_extractor import VisemeFrame

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Text sanitization for UE5 display
# ---------------------------------------------------------------------------

# Patterns to strip from LLM output before sending to UE5
_UE5_STRIP_PATTERNS: list[re.Pattern] = [
    re.compile(r'```[\s\S]*?```'),       # code fences
    re.compile(r'<think>[\s\S]*?</think>'),  # think blocks
    re.compile(r'<\|im_end\|>'),          # chat template tokens
    re.compile(r'<\|im_start\|>(?:user|assistant|system)'),  # role markers
    re.compile(r'<\|.*?\|>'),             # other template tokens
    re.compile(r'`([^`]+)`'),             # inline code (keep content)
    re.compile(r'[#*_]{2,}'),            # excess markdown decoration
]


def sanitize_text_for_ue5(text: str) -> str:
    """Clean LLM output for UE5 subtitle/transcript display.

    Strips markdown, template tokens, and think blocks while preserving
    readable content. Returns a plain-text string suitable for UI display.
    """
    if not text:
        return ""

    result = text
    for pattern in _UE5_STRIP_PATTERNS:
        # For inline code backticks, keep the inner content
        if pattern.pattern.startswith('`('):
            result = pattern.sub(r'\1', result)
        else:
            result = pattern.sub(' ', result)

    # Collapse multiple spaces/newlines
    result = re.sub(r'\n{3,}', '\n\n', result)
    result = re.sub(r' {2,}', ' ', result)
    return result.strip()

# ---------------------------------------------------------------------------
# Connection manager
# ---------------------------------------------------------------------------


@dataclass
class Ue5Connection:
    """Represents a single UE5 client connection."""

    websocket: WebSocket
    connected_at: float = field(default_factory=time.time)
    last_heartbeat: float = field(default_factory=time.time)
    remote_address: str = ""
    closed: bool = False


class Ue5ConnectionManager:
    """Manages UE5 WebSocket connections with auto-reconnect handling."""

    def __init__(self) -> None:
        self._connections: list[Ue5Connection] = []
        self._lock = asyncio.Lock()

    @property
    def is_connected(self) -> bool:
        """At least one UE5 client is connected."""
        return any(not c.closed for c in self._connections)

    @property
    def active_connections(self) -> list[Ue5Connection]:
        return [c for c in self._connections if not c.closed]

    async def add(self, ws: WebSocket) -> Ue5Connection:
        conn = Ue5Connection(
            websocket=ws,
            connected_at=time.time(),
            remote_address=f"{ws.client.host}:{ws.client.port}" if ws.client else "unknown",
        )
        async with self._lock:
            # Prune stale connections
            self._connections = [c for c in self._connections if not c.closed]
            self._connections.append(conn)
        logger.info("UE5 client connected: %s (total: %d)", conn.remote_address, len(self._connections))
        return conn

    async def remove(self, conn: Ue5Connection) -> None:
        conn.closed = True
        async with self._lock:
            self._connections = [c for c in self._connections if not c.closed]
        logger.info("UE5 client disconnected: %s (remaining: %d)", conn.remote_address, len(self._connections))

    async def send_json(self, data: dict[str, Any]) -> int:
        """Send a JSON message to all connected UE5 clients.

        Returns the number of clients the message was sent to.
        """
        sent = 0
        for conn in self.active_connections:
            try:
                await conn.websocket.send_json(data)
                sent += 1
            except Exception as exc:
                logger.warning("Failed to send JSON to UE5 (%s): %s", conn.remote_address, exc)
                conn.closed = True
        # Clean up on failed sends
        if sent < len(self.active_connections):
            await self._prune()
        return sent

    async def send_bytes(self, data: bytes) -> int:
        """Send binary data to all connected UE5 clients.

        Binary frame format::

            [0xB2]          - 1 byte  frame type (audio)
            [sample_rate]   - 4 bytes uint32 LE
            [pcm_length]    - 4 bytes uint32 LE
            [pcm_data ...]  - N bytes PCM16LE mono

        Returns the number of clients the data was sent to.
        """
        sent = 0
        for conn in self.active_connections:
            try:
                await conn.websocket.send_bytes(data)
                sent += 1
            except Exception as exc:
                logger.warning("Failed to send binary to UE5 (%s): %s", conn.remote_address, exc)
                conn.closed = True
        if sent < len(self.active_connections):
            await self._prune()
        return sent

    async def send_audio_pcm(
        self,
        pcm_bytes: bytes,
        sample_rate: int,
    ) -> int:
        """Send raw PCM16LE audio to UE5 in the binary frame format."""
        if not pcm_bytes:
            return 0
        payload = bytearray()
        # Frame type marker (0xB2 = audio)
        payload.extend(struct.pack("<B", 0xB2))
        # Sample rate
        payload.extend(struct.pack("<I", sample_rate))
        # PCM data length
        payload.extend(struct.pack("<I", len(pcm_bytes)))
        # PCM data
        payload.extend(pcm_bytes)
        return await self.send_bytes(bytes(payload))

    async def send_expression(
        self,
        mouth_open: float = 0.0,
        jaw_open: float = 0.0,
        lip_round: float = 0.0,
        smile: float = 0.0,
        head_yaw: float = 0.0,
        head_pitch: float = 0.0,
        blink: float = 0.0,
        emotion: str = "neutral",
    ) -> int:
        """Send an expression frame to UE5."""
        return await self.send_json(
            {
                "type": "expression",
                "data": {
                    "mouth_open": max(0.0, min(1.0, mouth_open)),
                    "jaw_open": max(0.0, min(1.0, jaw_open)),
                    "lip_round": max(0.0, min(1.0, lip_round)),
                    "smile": max(-1.0, min(1.0, smile)),
                    "head_yaw": max(-1.0, min(1.0, head_yaw)),
                    "head_pitch": max(-1.0, min(1.0, head_pitch)),
                    "blink": max(0.0, min(1.0, blink)),
                    "emotion": emotion,
                },
            }
        )

    async def send_animation(self, preset: AnimationPreset) -> int:
        """Send an animation preset (timed expression sequence) to UE5.

        UE5 will play through the keyframes sequentially on its timeline.
        """
        duration = get_animation_duration(preset)
        keyframes_data = [
            {
                "time_ms": kf.time_ms,
                "duration_ms": kf.duration_ms,
                "mouth_open": max(0.0, min(1.0, kf.mouth_open)),
                "jaw_open": max(0.0, min(1.0, kf.jaw_open)),
                "lip_round": max(0.0, min(1.0, kf.lip_round)),
                "smile": max(-1.0, min(1.0, kf.smile)),
                "head_yaw": max(-1.0, min(1.0, kf.head_yaw)),
                "head_pitch": max(-1.0, min(1.0, kf.head_pitch)),
                "head_roll": max(-1.0, min(1.0, kf.head_roll)),
                "blink": max(0.0, min(1.0, kf.blink)),
                "emotion": kf.emotion,
            }
            for kf in preset.keyframes
        ]
        return await self.send_json(
            {
                "type": "animation",
                "data": {
                    "name": preset.name,
                    "label": preset.label,
                    "duration_ms": duration,
                    "keyframes": keyframes_data,
                },
            }
        )

    async def send_viseme_sequence(
        self,
        frames: list[VisemeFrame],
        text: str = "",
        duration_ms: float = 0.0,
    ) -> int:
        """Send a viseme sequence to UE5 for timeline-driven lip sync.

        Each frame includes ``start_ms`` and ``end_ms`` for precise timing.
        """
        viseme_data = []
        n = len(frames)
        for i, f in enumerate(frames):
            # Compute end_ms from next frame or estimate 40ms frame interval
            end_ms = frames[i + 1].timestamp_ms if i + 1 < n else f.timestamp_ms + 40.0
            viseme_data.append(
                {
                    "viseme": f.viseme_id,
                    "start_ms": f.timestamp_ms,
                    "end_ms": end_ms,
                    "mouth_open": f.mouth_open,
                    "jaw_open": f.jaw_open,
                    "lip_round": f.lip_round,
                    "smile": f.smile,
                    "blink": f.blink,
                }
            )

        return await self.send_json(
            {
                "type": "viseme_sequence",
                "data": viseme_data,
                "text": text,
                "duration_ms": duration_ms,
            }
        )

    async def send_tts_complete(
        self,
        text: str = "",
        duration_ms: float = 0.0,
    ) -> int:
        """Notify UE5 that TTS audio playback should begin."""
        return await self.send_json(
            {
                "type": "tts_complete",
                "text": text,
                "duration_ms": duration_ms,
            }
        )

    async def send_text_chunk(self, chunk: str, final: bool = False) -> int:
        """Send a real-time LLM text chunk to UE5 for subtitle display.

        Each chunk is a delta piece of the ongoing generation. When *final* is
        ``True``, the chunk is the last one (client may finalize the display).
        """
        if not chunk:
            return 0
        clean = sanitize_text_for_ue5(chunk)
        if not clean:
            return 0
        return await self.send_json(
            {
                "type": "text_chunk",
                "data": clean,
                "final": final,
            }
        )

    async def send_text(self, text: str) -> int:
        """Send the complete LLM reply text to UE5 (final transcript).

        The text is sanitized for display (markdown stripped). UE5 can show
        this as closed captions or a subtitle overlay.
        """
        clean = sanitize_text_for_ue5(text)
        return await self.send_json(
            {
                "type": "text",
                "data": clean,
            }
        )

    async def send_heartbeat(self) -> int:
        """Send a heartbeat ping to connected UE5 clients."""
        return await self.send_json({"type": "ping"})

    async def broadcast_status(self, status: str, message: str = "") -> int:
        """Send a status update to all connected UE5 clients."""
        return await self.send_json(
            {
                "type": "status",
                "status": status,
                "message": message,
            }
        )

    async def _prune(self) -> None:
        async with self._lock:
            self._connections = [c for c in self._connections if not c.closed]


# Global connection manager instance
manager = Ue5ConnectionManager()


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@router.websocket("/api/ws/ue5")
async def ue5_ws_handler(websocket: WebSocket) -> None:
    """WebSocket endpoint for UE5 MetaHuman integration.

    UE5 connects here and receives:
    - JSON messages (expression, viseme_sequence, tts_complete, ping)
    - Binary messages (PCM audio frames)

    UE5 can send:
    - ``{"type": "pong"}`` — heartbeat response
    - ``{"type": "ready"}`` — ready to receive data
    - ``{"type": "log", "message": "..."}`` — log messages from UE5
    """
    await websocket.accept()
    conn = await manager.add(websocket)

    # Send initial handshake
    try:
        await websocket.send_json(
            {
                "type": "handshake",
                "version": "1.0",
                "backend": "qdh-python",
                "protocol": "ue5-meta-human-bridge",
            }
        )
    except Exception:
        await manager.remove(conn)
        return

    # Message receive loop
    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            text = message.get("text")
            if text is not None:
                await _handle_ue5_message(conn, text)
                continue

            bytes_data = message.get("bytes")
            if bytes_data is not None:
                # UE5 shouldn't send binary; log if it does
                logger.debug("Received unexpected binary from UE5 (%d bytes)", len(bytes_data))
                continue

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("UE5 WebSocket error (%s): %s", conn.remote_address, exc)
    finally:
        await manager.remove(conn)


async def _handle_ue5_message(conn: Ue5Connection, text: str) -> None:
    """Process an incoming text message from UE5."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON from UE5 (%s): %s", conn.remote_address, text[:200])
        return

    msg_type = data.get("type", "")

    if msg_type == "pong":
        conn.last_heartbeat = time.time()
    elif msg_type == "ready":
        logger.info("UE5 client ready: %s", conn.remote_address)
        await conn.websocket.send_json({"type": "status", "status": "ready", "message": "Backend connected and ready"})
    elif msg_type == "log":
        level = data.get("level", "info")
        message = data.get("message", "")
        logger.info("UE5 log [%s] (%s): %s", level, conn.remote_address, message)
    elif msg_type == "error":
        message = data.get("message", "")
        logger.error("UE5 error (%s): %s", conn.remote_address, message)
    else:
        logger.debug("Unknown message type from UE5: %s", msg_type)


# ---------------------------------------------------------------------------
# Heartbeat background task
# ---------------------------------------------------------------------------


_HEARTBEAT_INTERVAL = 15.0  # seconds


async def heartbeat_loop() -> None:
    """Periodically ping connected UE5 clients to detect stale connections."""
    while True:
        await asyncio.sleep(_HEARTBEAT_INTERVAL)
        try:
            sent = await manager.send_heartbeat()
            if sent > 0:
                logger.debug("Heartbeat sent to %d UE5 client(s)", sent)
        except Exception as exc:
            logger.warning("Heartbeat error: %s", exc)


# ---------------------------------------------------------------------------
# Convenience: send expression for a text reply
# ---------------------------------------------------------------------------


async def send_reply_to_ue5(
    reply: str,
    viseme_frames: list[VisemeFrame],
    pcm_bytes: bytes,
    sample_rate: int = 24_000,
) -> None:
    """Send a complete reply (expression + visemes + audio + text) to UE5.

    This is the main entry point called from chat/pipeline handlers.
    The reply text is sent as a final transcript for subtitle display.
    An animation preset is chosen automatically based on reply sentiment.
    """
    if not manager.is_connected:
        logger.debug("No UE5 client connected — skipping send_reply_to_ue5")
        return

    # 0. Detect semantic intent from the reply text
    intent_name = detect_intent(reply)
    intent_preset = get_animation_for_intent(intent_name)
    if intent_preset:
        logger.debug("Sending animation '%s' to UE5 (detected from reply)", intent_preset.name)
        await manager.send_animation(intent_preset)
    else:
        # Fallback: send neutral expression
        await manager.send_expression(mouth_open=0.0, smile=0.1, blink=0.0)

    # 1. Send final cleaned text transcript for subtitles
    if reply.strip():
        await manager.send_text(reply)

    # 2. Send viseme sequence for timeline-driven lip sync
    if viseme_frames:
        text = reply
        duration_ms = viseme_frames[-1].timestamp_ms + 100.0 if viseme_frames else 0.0
        await manager.send_viseme_sequence(viseme_frames, text=text, duration_ms=duration_ms)

    # 3. Send PCM audio
    if pcm_bytes:
        await manager.send_audio_pcm(pcm_bytes, sample_rate)

    # 4. Notify UE5 that the complete payload has been sent
    await manager.send_tts_complete(text=reply)


# ---------------------------------------------------------------------------
# Startup / shutdown hooks (registered in main.py)
# ---------------------------------------------------------------------------

_heartbeat_task: asyncio.Task | None = None


def start_heartbeat() -> None:
    global _heartbeat_task
    if _heartbeat_task is None or _heartbeat_task.done():
        _heartbeat_task = asyncio.create_task(heartbeat_loop())


def stop_heartbeat() -> None:
    global _heartbeat_task
    if _heartbeat_task and not _heartbeat_task.done():
        _heartbeat_task.cancel()
        _heartbeat_task = None