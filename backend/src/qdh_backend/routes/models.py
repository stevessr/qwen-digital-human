from __future__ import annotations

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from ..schemas import DownloadRequest, ModelActionRequest
from ..state import get_app_state

router = APIRouter()


def _unsupported(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST, content={"status": "error", "message": message}
    )


@router.get("/api/models/status")
async def model_status_handler(request: Request):
    state = get_app_state(request)
    return await state.model_manager.get_model_library()


@router.post("/api/models/download")
async def model_download_handler(payload: DownloadRequest):
    del payload
    return _unsupported(
        "后端不再下载本地模型文件；请使用 Ollama 管理 LLM 模型，例如 ollama pull <model>。"
    )


@router.post("/api/models/delete")
async def model_delete_handler(payload: ModelActionRequest):
    del payload
    return _unsupported("后端不再删除本地模型文件；请使用 Ollama CLI 管理模型。")


@router.post("/api/models/verify")
async def model_verify_handler(payload: ModelActionRequest):
    del payload
    return _unsupported("后端不再校验本地推理模型文件；当前推理由 Ollama 服务管理。")


@router.post("/api/models/preload/asr")
async def model_preload_asr_handler():
    return _unsupported(
        "ASR 由浏览器 SpeechRecognition / webkitSpeechRecognition 提供，无需后端预热。"
    )


@router.post("/api/models/preload/tts")
async def model_preload_tts_handler():
    return _unsupported("TTS 由浏览器 SpeechSynthesis 提供，无需后端预热。")
