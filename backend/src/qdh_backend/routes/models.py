from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Request, status
from fastapi.responses import JSONResponse

from ..schemas import DownloadRequest, ModelActionRequest
from ..state import get_app_state

router = APIRouter()


@router.get("/api/models/status")
async def model_status_handler(request: Request):
    state = get_app_state(request)
    return await state.model_manager.get_model_library()


@router.post("/api/models/download")
async def model_download_handler(
    payload: DownloadRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    state = get_app_state(request)
    background_tasks.add_task(state.model_manager.download_model, payload.name, payload.url)
    return {"status": "success", "message": "Download started"}


@router.post("/api/models/delete")
async def model_delete_handler(payload: ModelActionRequest, request: Request):
    state = get_app_state(request)
    await state.model_manager.delete_model(payload.name)
    return {"status": "success"}


@router.post("/api/models/verify")
async def model_verify_handler(payload: ModelActionRequest, request: Request):
    state = get_app_state(request)
    ok = await state.model_manager.verify_model(payload.name, payload.expected_sha256 or "")
    return {"status": "ok" if ok else "error"}


@router.post("/api/models/preload/asr")
async def model_preload_asr_handler():
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"status": "error", "message": "ASR provider 尚未接入真实模型"},
    )


@router.post("/api/models/preload/tts")
async def model_preload_tts_handler():
    return {"status": "success", "message": "TTS compatibility provider ready"}
