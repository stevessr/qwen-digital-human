from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from qdh_backend.main import create_app
from qdh_backend.settings import Settings


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    settings = Settings(
        repo_root=tmp_path,
        static_dir=tmp_path / "static",
        host="127.0.0.1",
        port=3000,
        llm_provider="stub",
        ollama_base_url="http://127.0.0.1:11434",
        ollama_model="qwen2.5:7b",
        llm_base_url="",
        llm_api_key="",
        llm_model="qwen2.5:7b",
        llm_timeout_seconds=5.0,
    )
    return TestClient(create_app(settings))
