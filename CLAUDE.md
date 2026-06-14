# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
cargo run          # Build and start server at http://127.0.0.1:3000
cargo build        # Build only (debug)
cargo build --release  # Optimized build
```

Requires `DASHSCOPE_API_KEY` env var for cloud LLM/TTS features. A C++ compiler is required for `llama-cpp-2` (builds llama.cpp from source).

## Architecture

An Axum web server (`src/main.rs`) with a static WebGPU frontend (`static/`). The pipeline processes speech → LLM → TTS → avatar rendering:

- **`src/main.rs`** — Axum server, route definitions, `AppState` (shared engine instances)
- **`src/llm.rs`** — `LlmEngine`: local inference via llama-cpp-2 (Qwen3.5-0.8B GGUF) in fast mode; DashScope API (`qwen-max`) in slow/cloud mode
- **`src/rag.rs`** — `RagEngine`: in-memory document retrieval (stub implementation)
- **`src/mcp.rs`** — Model Context Protocol structures (empty placeholder)
- **`src/tts.rs`** — TTS via DashScope Sambert API (`sambert-zhichu-v1`)
- **`src/asr.rs`** — `SherpaAsrEngine`: offline + streaming ASR via Sherpa-MNN (stub)
- **`src/a2bs.rs`** — `A2bsEngine`: Audio-to-Body-Synthesis, extracts facial expression and posture from audio (stub)
- **`src/nnr.rs`** — `NnrEngine`: Neural Network Rendering, packages expression/posture/audio for WebGPU frontend
- **`src/model_manager.rs`** — `ModelManager`: model catalog (7 GGUF/MNN models from ModelScope), download with progress, SHA256 verification, wget fallback
- **`src/device.rs`** — GPU device selection: CUDA → Metal (macOS) → CPU

### API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat` | Chat with LLM (supports RAG context) |
| POST | `/api/tts` | Text-to-speech |
| POST | `/api/pipeline` | Full pipeline: ASR → RAG → LLM → TTS → A2BS → NNR |
| GET | `/api/ws/asr` | WebSocket for streaming ASR |
| GET | `/api/models/status` | Model library with install progress |
| POST | `/api/models/download` | Download model from URL |
| POST | `/api/models/delete` | Delete model file |
| POST | `/api/models/verify` | SHA256 model verification |

### Key Design Decisions

- **`/api/pipeline`** is the main endpoint combining all engines into one response (transcription, LLM reply, avatar render frame with base64 audio)
- Many engine implementations (ASR, RAG, A2BS, NNR, MCP) are stubs returning hardcoded data — the project scaffold is in place but most inference is not wired
- Model files are stored in `models/` directory, sourced from ModelScope, skipped if already present
- The llama-cpp-2 crate compiles llama.cpp C++ source natively; it requires CMake and a C++17 compiler
- Model download has a double fallback: native reqwest streaming → wget CLI
- GPU offloading uses `with_n_gpu_layers(100)` to push all layers to GPU when CUDA/Metal is available
