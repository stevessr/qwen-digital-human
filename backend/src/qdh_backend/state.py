from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from .llm import LlmService
from .model_manager import ModelManager
from .rag import RagService
from .settings import Settings


@dataclass(slots=True)
class AppState:
    settings: Settings
    llm: LlmService
    rag: RagService
    model_manager: ModelManager


def get_app_state(request: Request) -> AppState:
    return request.app.state.qdh
