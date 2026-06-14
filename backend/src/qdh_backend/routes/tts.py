from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from ..audio import synthesize_silence
from ..schemas import TtsRequest

router = APIRouter()


@router.post("/api/tts")
async def tts_handler(payload: TtsRequest) -> Response:
    _, wav_bytes, _ = synthesize_silence(payload.text)
    return Response(content=wav_bytes, media_type="audio/wav")
