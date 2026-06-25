from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .llm import LlmService
from .model_manager import ModelManager
from .rag import RagService
from .routes import asr_ws, chat, context, map, models, pipeline, tts, ue5_ws
from .routes.ue5_ws import start_heartbeat, stop_heartbeat
from .settings import Settings, load_settings
from .state import AppState


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(title="Qwen Digital Human Python Backend")
    app.state.qdh = AppState(
        settings=settings,
        llm=LlmService(settings),
        rag=RagService(),
        model_manager=ModelManager(settings),
    )

    app.include_router(chat.router)
    app.include_router(tts.router)
    app.include_router(pipeline.router)
    app.include_router(context.router)
    app.include_router(map.router)
    app.include_router(models.router)
    app.include_router(asr_ws.router)
    app.include_router(ue5_ws.router)

    @app.on_event("startup")
    async def on_startup() -> None:
        start_heartbeat()

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        stop_heartbeat()

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "backend": "python"}

    if settings.static_dir.exists():
        index_path = settings.static_dir / "index.html"

        @app.get("/")
        async def index() -> FileResponse:
            return FileResponse(index_path)

        app.mount(
            "/",
            StaticFiles(directory=settings.static_dir, html=True),
            name="static",
        )

    return app


app = create_app()
