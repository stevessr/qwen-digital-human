# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

Default backend is now Python/FastAPI:

```bash
cd backend
uv sync --extra dev
uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000
uv run ruff check .
uv run pytest
```

The server serves the existing static frontend at http://127.0.0.1:3000.

Default LLM provider is local Ollama:

```bash
ollama serve
ollama pull qwen2.5:7b
```

Useful environment variables:

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=qwen-max
```

The old Rust backend remains available as a reference/fallback:

```bash
cargo run
cargo build --release
```

## Architecture

The primary backend is a FastAPI app in `backend/src/qdh_backend/` with a static WebGPU frontend in `static/`. The first migration phase preserves the existing browser API contracts while moving LLM calls to external providers, defaulting to local Ollama.

- **`backend/src/qdh_backend/main.py`** — FastAPI app factory, route registration, static file mount
- **`backend/src/qdh_backend/settings.py`** — environment settings and repo/static path resolution
- **`backend/src/qdh_backend/llm.py`** — Ollama/OpenAI-compatible providers, prompt composition, `<think>` filtering
- **`backend/src/qdh_backend/stream_protocol.py`** — `qdh-binary-v2` binary stream encoder compatible with `static/main.js`
- **`backend/src/qdh_backend/routes/chat.py`** — `/api/chat` JSON and binary streaming chat
- **`backend/src/qdh_backend/routes/pipeline.py`** — `/api/pipeline` browser transcript → RAG → Ollama-backed LLM → avatar frame compatibility pipeline
- **`backend/src/qdh_backend/routes/tts.py`** — `/api/tts`, compatibility-only silence WAV; browser SpeechSynthesis is the real TTS path
- **`backend/src/qdh_backend/routes/asr_ws.py`** — `/api/ws/asr` compatibility layer; browser SpeechRecognition is the real ASR path
- **`backend/src/qdh_backend/model_manager.py`** — reports Ollama/OpenAI-compatible LLM service status; no local model download/load management
- **`backend/src/qdh_backend/map_search.py`** — Nominatim/OpenStreetMap search wrapper
- **`backend/src/qdh_backend/rag.py`** — lightweight RAG compatibility service
- **`backend/src/qdh_backend/avatar.py`** — A2BS/NNR-compatible render frame preparation
- **`src/`** — old Rust/Axum implementation retained for reference and rollback

### API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Python backend health check |
| POST | `/api/chat` | Chat with LLM; JSON or `qdh-binary-v2` stream |
| POST | `/api/tts` | Compatibility endpoint returning silence `audio/wav`; browser SpeechSynthesis is preferred |
| POST | `/api/pipeline` | Browser transcript/RAG → Ollama-backed LLM → avatar frame |
| GET | `/api/ws/asr` | Compatibility endpoint; browser SpeechRecognition is preferred |
| GET | `/api/models/status` | Ollama/OpenAI-compatible LLM service status |
| POST | `/api/models/download` | Compatibility endpoint; returns unsupported because Ollama manages models |
| POST | `/api/models/delete` | Compatibility endpoint; returns unsupported because Ollama manages models |
| POST | `/api/models/verify` | Compatibility endpoint; returns unsupported because backend has no local model files |
| POST | `/api/models/preload/asr` | Compatibility endpoint; ASR is browser-provided |
| POST | `/api/models/preload/tts` | Compatibility endpoint; TTS is browser-provided |
| POST | `/api/map/search` | Nominatim map search |
| POST | `/api/context/retrieve` | RAG context retrieval compatibility endpoint |

### Key Design Decisions

- Keep `static/` unchanged and serve it from the Python backend on the same origin.
- Preserve `qdh-binary-v2` (`application/octet-stream`, `X-Stream-Format: qdh-binary-v2`) because `static/main.js` decodes binary frames directly.
- Keep the old `fast_mode` request field for compatibility, but provider selection now comes from environment variables.
- Default LLM is local Ollama; `openai_compatible` supports external APIs with `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`.
- Backend no longer loads local inference models; Ollama is the local model inference service for LLM.
- ASR and TTS are browser-provided through Web Speech APIs; backend ASR/TTS endpoints are compatibility-only and must not grow local model inference.
- `/models` should present browser ASR/TTS capabilities and Ollama service status, not legacy GGUF/MNN download management.
