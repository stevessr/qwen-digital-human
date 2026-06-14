from __future__ import annotations

import base64

from .audio import extract_waveform, rms, samples_from_audio, zero_crossing_rate
from .schemas import ExpressionData, PostureData, RenderFrame


def synthesize_body_data(audio_bytes: bytes) -> tuple[ExpressionData, PostureData]:
    samples = samples_from_audio(audio_bytes)
    if not samples:
        return ExpressionData(), PostureData()

    energy = rms(samples)
    zcr = zero_crossing_rate(samples)
    mouth_open = max(0.0, min(1.0, energy * 6.0))
    smile = max(0.0, min(0.9, (zcr - 0.10) * 2.5))
    blink = 0.25 if len(samples) < 48_000 else 0.0
    head_pitch = max(0.0, min(0.15, energy * 5.0))
    head_yaw = max(-0.1, min(0.1, zcr - 0.15))

    return (
        ExpressionData(mouth_open=mouth_open, smile=smile, blink=blink),
        PostureData(head_pitch=head_pitch, head_yaw=head_yaw, head_roll=0.0),
    )


def prepare_render_frame(
    audio_bytes: bytes,
    audio_mime_type: str = "audio/wav",
    expression: ExpressionData | None = None,
    posture: PostureData | None = None,
) -> RenderFrame:
    if expression is None or posture is None:
        expression, posture = synthesize_body_data(audio_bytes)
    return RenderFrame(
        expression=expression,
        posture=posture,
        audio_base64=base64.b64encode(audio_bytes).decode("ascii") if audio_bytes else "",
        audio_mime_type=audio_mime_type,
        waveform=extract_waveform(audio_bytes),
    )
