from __future__ import annotations

import struct

from fastapi.testclient import TestClient


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


def test_models_status_contract(client: TestClient) -> None:
    response = client.get("/api/models/status")
    assert response.status_code == 200
    models = response.json()
    assert len(models) == 7
    assert {
        "name",
        "description",
        "url",
        "size",
        "installed",
        "progress",
        "expected_sha256",
    } <= set(models[0])


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
