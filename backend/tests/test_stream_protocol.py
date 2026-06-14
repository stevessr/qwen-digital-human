from __future__ import annotations

import struct

from qdh_backend.schemas import ExpressionData, PostureData, RenderFrame
from qdh_backend.stream_protocol import encode_done_frame, encode_status_frame


def test_status_frame_layout() -> None:
    frame = encode_status_frame(3, "Generating reply")
    assert frame[0] == 1
    payload_len = struct.unpack_from("<I", frame, 1)[0]
    assert payload_len == len(frame) - 5
    payload = frame[5:]
    assert payload[0] == 3
    text_len = struct.unpack_from("<I", payload, 1)[0]
    assert payload[5 : 5 + text_len].decode() == "Generating reply"


def test_done_frame_with_render_payload() -> None:
    render = RenderFrame(
        expression=ExpressionData(mouth_open=0.1, smile=0.2, blink=0.3),
        posture=PostureData(head_pitch=0.0, head_yaw=0.1, head_roll=0.0),
        audio_base64="",
        audio_mime_type="audio/wav",
        waveform=[0.0] * 128,
    )
    frame = encode_done_frame("reply", transcription="asr", render_frame=render, audio_bytes=b"abc")
    assert frame[0] == 5
    payload = frame[5:]
    assert payload[0] == 0x03
