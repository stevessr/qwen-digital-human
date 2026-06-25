from __future__ import annotations

import base64
from collections.abc import AsyncIterator
from contextlib import suppress

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..audio import synthesize_silence
from ..avatar import prepare_render_frame
from ..schemas import PipelineRequest, PipelineResponse
from ..state import get_app_state
from ..stream_protocol import (
    STREAM_FRAME_ASR,
    STREAM_FRAME_DELTA,
    STREAM_HEADERS,
    STREAM_STAGE_ASR,
    STREAM_STAGE_LLM,
    STREAM_STAGE_RAG,
    STREAM_STAGE_RENDER,
    STREAM_STAGE_TTS,
    encode_done_frame,
    encode_error_frame,
    encode_status_frame,
    encode_text_frame,
    split_pcm_frames,
)
from ..viseme_extractor import extract_visemes
from .ue5_ws import manager, send_reply_to_ue5

router = APIRouter()


@router.post("/api/pipeline")
async def pipeline_handler(payload: PipelineRequest, request: Request):
    if payload.stream:
        return StreamingResponse(
            _pipeline_stream(payload, request),
            media_type="application/octet-stream",
            headers=STREAM_HEADERS,
        )

    state = get_app_state(request)
    transcription = _resolve_transcription(payload)
    if not transcription:
        frame = prepare_render_frame(b"")
        return PipelineResponse(transcription="", llm_reply="", render_frame=frame)

    context = payload.context or await state.rag.retrieve(transcription, payload.rerank)
    try:
        reply = await state.llm.generate(
            transcription,
            payload.system_prompt,
            payload.memory,
            context,
            payload.fast_mode,
        )
    except Exception:
        reply = ""

    pcm, wav_bytes, _ = synthesize_silence(reply) if payload.tts_enabled else (b"", b"", 24_000)
    del pcm
    frame = prepare_render_frame(wav_bytes)
    return PipelineResponse(transcription=transcription, llm_reply=reply, render_frame=frame)


async def _pipeline_stream(payload: PipelineRequest, request: Request) -> AsyncIterator[bytes]:
    state = get_app_state(request)
    try:
        yield encode_status_frame(STREAM_STAGE_ASR, "Reusing realtime ASR transcript")
        transcription = _resolve_transcription(payload)
        yield encode_text_frame(STREAM_FRAME_ASR, transcription)

        yield encode_status_frame(STREAM_STAGE_RAG, "Retrieving context")
        context = payload.context or await state.rag.retrieve(transcription, payload.rerank)

        yield encode_status_frame(STREAM_STAGE_LLM, "Generating reply")
        reply_parts: list[str] = []
        if transcription:
            async for chunk in state.llm.generate_stream(
                transcription,
                payload.system_prompt,
                payload.memory,
                context,
                payload.fast_mode,
            ):
                reply_parts.append(chunk)
                yield encode_text_frame(STREAM_FRAME_DELTA, chunk)

                # Stream text chunks to UE5 for real-time subtitle display
                if chunk.strip() and manager.is_connected:
                    await manager.send_text_chunk(chunk)

        reply = "".join(reply_parts)

        # Signal text stream end to UE5
        if reply.strip() and manager.is_connected:
            await manager.send_text_chunk(reply, final=True)

        yield encode_status_frame(STREAM_STAGE_TTS, "Synthesizing local audio")
        pcm, wav_bytes, sample_rate = (
            synthesize_silence(reply) if payload.tts_enabled else (b"", b"", 24_000)
        )
        for frame in split_pcm_frames(pcm, sample_rate):
            yield frame

        yield encode_status_frame(STREAM_STAGE_RENDER, "Preparing avatar")
        render_frame = prepare_render_frame(wav_bytes)
        yield encode_done_frame(
            reply=reply,
            transcription=transcription,
            render_frame=render_frame,
            audio_bytes=wav_bytes,
        )

        # Send to UE5 if connected (fire-and-forget, after stream closed)
        if reply.strip() and payload.tts_enabled:
            viseme_frames = extract_visemes(wav_bytes, sample_rate)
            await send_reply_to_ue5(
                reply=reply,
                viseme_frames=viseme_frames,
                pcm_bytes=pcm,
                sample_rate=sample_rate,
            )
    except Exception as exc:  # noqa: BLE001
        yield encode_error_frame(str(exc))


def _resolve_transcription(payload: PipelineRequest) -> str:
    if payload.transcription and payload.transcription.strip():
        return payload.transcription.strip()
    # 第一阶段没有真实 ASR provider；保留协议并返回空转写。
    with suppress(Exception):
        base64.b64decode(payload.audio_base64 or "")
    return ""
