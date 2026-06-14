from __future__ import annotations

import struct
from collections.abc import Iterable

from .schemas import RenderFrame

STREAM_FRAME_STATUS = 1
STREAM_FRAME_ASR = 2
STREAM_FRAME_DELTA = 3
STREAM_FRAME_AUDIO = 4
STREAM_FRAME_DONE = 5
STREAM_FRAME_ERROR = 6

STREAM_STAGE_ASR = 1
STREAM_STAGE_RAG = 2
STREAM_STAGE_LLM = 3
STREAM_STAGE_TTS = 4
STREAM_STAGE_RENDER = 5

STREAM_HEADERS = {
    "X-Stream-Format": "qdh-binary-v2",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
}


def _u8(value: int) -> bytes:
    return struct.pack("<B", value)


def _u32(value: int) -> bytes:
    return struct.pack("<I", value)


def _f32(value: float) -> bytes:
    return struct.pack("<f", value)


def _bytes(value: bytes) -> bytes:
    return _u32(len(value)) + value


def _string(value: str) -> bytes:
    return _bytes(value.encode("utf-8"))


def encode_stream_frame(frame_type: int, payload: bytes) -> bytes:
    return _u8(frame_type) + _u32(len(payload)) + payload


def encode_text_frame(frame_type: int, text: str) -> bytes:
    return encode_stream_frame(frame_type, _string(text))


def encode_status_frame(stage: int, message: str) -> bytes:
    return encode_stream_frame(STREAM_FRAME_STATUS, _u8(stage) + _string(message))


def encode_audio_frame(sample_rate: int, audio_chunk: bytes) -> bytes:
    return encode_stream_frame(STREAM_FRAME_AUDIO, _u32(sample_rate) + audio_chunk)


def encode_render_frame_payload(render_frame: RenderFrame, audio_bytes: bytes) -> bytes:
    payload = bytearray()
    payload += _string(render_frame.audio_mime_type)
    payload += _f32(render_frame.expression.mouth_open)
    payload += _f32(render_frame.expression.smile)
    payload += _f32(render_frame.expression.blink)
    payload += _f32(render_frame.posture.head_pitch)
    payload += _f32(render_frame.posture.head_yaw)
    payload += _f32(render_frame.posture.head_roll)
    payload += _u32(len(render_frame.waveform))
    for value in render_frame.waveform:
        payload += _f32(value)
    payload += _bytes(audio_bytes)
    return bytes(payload)


def encode_done_frame(
    reply: str,
    transcription: str | None = None,
    render_frame: RenderFrame | None = None,
    audio_bytes: bytes = b"",
) -> bytes:
    flags = 0
    if transcription is not None:
        flags |= 0x01
    if render_frame is not None:
        flags |= 0x02

    payload = bytearray(_u8(flags))
    if transcription is not None:
        payload += _string(transcription)
    payload += _string(reply)
    if render_frame is not None:
        render_payload = encode_render_frame_payload(render_frame, audio_bytes)
        payload += _u32(len(render_payload))
        payload += render_payload
    return encode_stream_frame(STREAM_FRAME_DONE, bytes(payload))


def encode_error_frame(message: str) -> bytes:
    return encode_text_frame(STREAM_FRAME_ERROR, message)


def split_pcm_frames(pcm16le: bytes, sample_rate: int, chunk_ms: int = 40) -> Iterable[bytes]:
    if not pcm16le:
        return []
    bytes_per_sample = 2
    chunk_size = max(bytes_per_sample, int(sample_rate * chunk_ms / 1000) * bytes_per_sample)
    chunk_size -= chunk_size % bytes_per_sample
    return (
        encode_audio_frame(sample_rate, pcm16le[offset : offset + chunk_size])
        for offset in range(0, len(pcm16le), chunk_size)
    )
