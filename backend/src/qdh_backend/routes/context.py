from __future__ import annotations

from fastapi import APIRouter, Request

from ..schemas import ContextRequest, ContextResponse
from ..state import get_app_state

router = APIRouter()


@router.post("/api/context/retrieve")
async def context_retrieve_handler(payload: ContextRequest, request: Request) -> ContextResponse:
    state = get_app_state(request)
    return ContextResponse(context=await state.rag.retrieve(payload.query, payload.rerank))
