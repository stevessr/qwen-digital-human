from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/api/ws/asr")
async def asr_ws_handler(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json({"type": "status", "message": "Python ASR 兼容层已连接"})
    buffered = bytearray()
    try:
        while True:
            message = await websocket.receive()
            if message.get("bytes") is not None:
                buffered.extend(message["bytes"] or b"")
                if buffered:
                    await websocket.send_json(
                        {
                            "type": "partial",
                            "text": "",
                            "preview": "",
                            "language": "zh",
                        }
                    )
                continue

            text = message.get("text")
            if text is None:
                continue
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                payload = {}
            kind = payload.get("type")
            if kind == "commit":
                await websocket.send_json({"type": "final", "text": "", "language": "zh"})
                buffered.clear()
            elif kind == "reset":
                buffered.clear()
                await websocket.send_json({"type": "status", "message": "ASR session reset"})
            else:
                await websocket.send_json(
                    {"type": "status", "message": "ASR control message ignored"}
                )
    except WebSocketDisconnect:
        return
