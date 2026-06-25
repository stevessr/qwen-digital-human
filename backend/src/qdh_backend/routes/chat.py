from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..llm import build_fallback_reply
from ..schemas import ChatRequest, ChatResponse
from ..state import get_app_state
from ..stream_protocol import (
    STREAM_FRAME_DELTA,
    STREAM_HEADERS,
    STREAM_STAGE_LLM,
    STREAM_STAGE_TTS,
    encode_done_frame,
    encode_status_frame,
    encode_text_frame,
)
from ..tts_provider import create_tts_provider
from ..viseme_extractor import extract_visemes
from .ue5_ws import manager, send_reply_to_ue5

router = APIRouter()


@router.post("/api/chat")
async def chat_handler(payload: ChatRequest, request: Request):
    state = get_app_state(request)
    context = payload.context or await state.rag.retrieve(payload.message, payload.rerank)

    if payload.stream:
        return StreamingResponse(
            _chat_stream(payload, context, request),
            media_type="application/octet-stream",
            headers=STREAM_HEADERS,
        )

    try:
        reply = await state.llm.generate(
            payload.message,
            payload.system_prompt,
            payload.memory,
            context,
            payload.fast_mode,
        )
    except Exception as exc:  # noqa: BLE001 - 兼容旧接口，错误作为文本回传
        reply = build_fallback_reply(payload.message, context, exc)

    return ChatResponse(reply=reply)


async def _chat_stream(
    payload: ChatRequest,
    context: str,
    request: Request,
) -> AsyncIterator[bytes]:
    state = get_app_state(request)
    yield encode_status_frame(STREAM_STAGE_LLM, "Generating reply")
    if payload.tts_enabled:
        yield encode_status_frame(STREAM_STAGE_TTS, "TTS provider is in compatibility mode")

    reply_parts: list[str] = []
    try:
        async for chunk in state.llm.generate_stream(
            payload.message,
            payload.system_prompt,
            payload.memory,
            context,
            payload.fast_mode,
        ):
            reply_parts.append(chunk)
            yield encode_text_frame(STREAM_FRAME_DELTA, chunk)

            # Stream text chunks to UE5 for real-time subtitle display
            if chunk.strip():
                await manager.send_text_chunk(chunk)

        full_reply = "".join(reply_parts)
        yield encode_done_frame(reply=full_reply)

        # Signal text stream end to UE5
        if full_reply.strip() and manager.is_connected:
            await manager.send_text_chunk(full_reply, final=True)

        # After LLM completes, trigger TTS + send to UE5 (fire-and-forget)
        if payload.tts_enabled and full_reply.strip():
                tts_provider = create_tts_provider(state.settings.tts_provider)
                tts_result = await tts_provider.synthesize(full_reply)
                if tts_result.wav_bytes:
                    viseme_frames = extract_visemes(
                        tts_result.wav_bytes,
                        tts_result.sample_rate,
                    )
                    await send_reply_to_ue5(
                        reply=full_reply,
                        viseme_frames=viseme_frames,
                        pcm_bytes=tts_result.wav_bytes,
                        sample_rate=tts_result.sample_rate,
                    )
    except Exception as exc:  # noqa: BLE001
        fallback = build_fallback_reply(payload.message, context, exc)
        if not reply_parts:
            yield encode_text_frame(STREAM_FRAME_DELTA, fallback)
            yield encode_done_frame(reply=fallback)
            # Send fallback text to UE5
            if manager.is_connected:
                await manager.send_text_chunk(fallback, final=True)
            return
        partial = "".join(reply_parts)
        yield encode_done_frame(reply=f"{partial}\n\n（后端回复已中断：{exc}）")
        # Send partial text to UE5
        if manager.is_connected:
            await manager.send_text_chunk(partial, final=True)
