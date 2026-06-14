from __future__ import annotations

import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from qdh_backend.llm import OllamaProvider
from qdh_backend.main import create_app
from qdh_backend.model_manager import ModelManager
from qdh_backend.settings import Settings


def _frames(body: bytes) -> list[tuple[int, bytes]]:
    offset = 0
    frames: list[tuple[int, bytes]] = []
    while offset + 5 <= len(body):
        frame_type = body[offset]
        payload_len = struct.unpack_from("<I", body, offset + 1)[0]
        offset += 5
        frames.append((frame_type, body[offset : offset + payload_len]))
        offset += payload_len
    return frames


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "backend": "python"}


def test_chat_non_stream_contract(client: TestClient) -> None:
    response = client.post("/api/chat", json={"message": "你好", "fast_mode": True})
    assert response.status_code == 200
    assert response.json()["reply"].startswith("这是 Python 后端的测试回复")


def test_chat_binary_stream_contract(client: TestClient) -> None:
    response = client.post(
        "/api/chat",
        json={"message": "你好", "fast_mode": True, "stream": True},
    )
    assert response.status_code == 200
    assert response.headers["x-stream-format"] == "qdh-binary-v2"
    frame_types = [frame_type for frame_type, _ in _frames(response.content)]
    assert 1 in frame_types
    assert 3 in frame_types
    assert frame_types[-1] == 5


def test_tts_returns_wav(client: TestClient) -> None:
    response = client.post("/api/tts", json={"text": "测试"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content[:4] == b"RIFF"


def test_pipeline_non_stream_contract(client: TestClient) -> None:
    response = client.post(
        "/api/pipeline",
        json={"audio_base64": "", "fast_mode": True, "transcription": "介绍北京"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["transcription"] == "介绍北京"
    assert "llm_reply" in data
    assert data["render_frame"]["audio_mime_type"] == "audio/wav"
    assert len(data["render_frame"]["waveform"]) == 128


def test_models_status_reports_external_llm_service_only(client: TestClient) -> None:
    response = client.get("/api/models/status")
    assert response.status_code == 200
    models = response.json()
    assert len(models) == 1
    assert models[0]["managed_by"] == "external"
    assert models[0]["capability"] == "LLM 测试回复"
    assert models[0]["downloadable"] is False
    assert "ASR" not in models[0]["name"]
    assert "TTS" not in models[0]["name"]


def test_ollama_status_lists_selectable_local_models(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def fake_fetch_ollama_tags(
        self: ModelManager,
    ) -> tuple[bool, list[dict[str, object]], str | None]:
        del self
        return (
            True,
            [
                {
                    "name": "llama3.2:latest",
                    "size": 2_000_000_000,
                    "digest": "llama-digest",
                    "details": {
                        "family": "llama",
                        "parameter_size": "3.2B",
                        "quantization_level": "Q4_K_M",
                    },
                },
                {
                    "name": "qwen2.5:7b",
                    "size": 4_700_000_000,
                    "digest": "qwen-digest",
                    "details": {"family": "qwen", "parameter_size": "7B"},
                },
            ],
            None,
        )

    monkeypatch.setattr(ModelManager, "_fetch_ollama_tags", fake_fetch_ollama_tags)
    test_client = TestClient(create_app(_settings(tmp_path, llm_provider="ollama")))

    response = test_client.get("/api/models/status")

    assert response.status_code == 200
    models = response.json()
    assert {model["name"] for model in models} == {"qwen2.5:7b", "llama3.2:latest"}
    selected = next(model for model in models if model["selected"])
    assert selected["name"] == "qwen2.5:7b"
    assert selected["service_available"] is True
    assert len(selected["options"]) == 2
    assert selected["options"][0]["name"] == "llama3.2:latest"


def test_select_ollama_model_reconfigures_chat_backend(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def fake_fetch_ollama_tags(
        self: ModelManager,
    ) -> tuple[bool, list[dict[str, object]], str | None]:
        del self
        return (
            True,
            [
                {"name": "qwen2.5:7b", "size": 4_700_000_000},
                {"name": "llama3.2:latest", "size": 2_000_000_000},
            ],
            None,
        )

    monkeypatch.setattr(ModelManager, "_fetch_ollama_tags", fake_fetch_ollama_tags)
    test_client = TestClient(create_app(_settings(tmp_path, llm_provider="ollama")))

    response = test_client.post("/api/models/select", json={"name": "llama3.2:latest"})

    assert response.status_code == 200
    assert response.json()["model"]["name"] == "llama3.2:latest"
    state = test_client.app.state.qdh
    assert state.settings.ollama_model == "llama3.2:latest"
    assert isinstance(state.llm.provider, OllamaProvider)
    assert state.llm.provider.model == "llama3.2:latest"


def test_context_top_k_zero_returns_empty(client: TestClient) -> None:
    response = client.post(
        "/api/context/retrieve",
        json={"query": "北京", "rerank": {"top_k": 0}},
    )
    assert response.status_code == 200
    assert response.json() == {"context": ""}


def test_map_empty_query_returns_error(client: TestClient) -> None:
    response = client.post("/api/map/search", json={"query": "", "limit": 5})
    assert response.status_code == 400
    assert "error" in response.json()


def _settings(tmp_path: Path, llm_provider: str) -> Settings:
    return Settings(
        repo_root=tmp_path,
        static_dir=tmp_path / "static",
        host="127.0.0.1",
        port=3000,
        llm_provider=llm_provider,
        ollama_base_url="http://127.0.0.1:11434",
        ollama_model="qwen2.5:7b",
        llm_base_url="",
        llm_api_key="",
        llm_model="qwen2.5:7b",
        llm_timeout_seconds=5.0,
    )
