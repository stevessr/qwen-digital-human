# Qwen Digital Human (Python + WebGPU)

地图数字人项目：Python 后端提供同源 API 与静态资源服务，前端使用 WebGPU/Live2D 渲染数字人。LLM 默认通过本地 Ollama 调用 Ollama Cloud 托管模型，也可切换到本地模型或 OpenAI-compatible 外部 API。

## 当前状态

- **默认后端**：`backend/`，FastAPI + httpx + Ollama/OpenAI-compatible provider。
- **旧后端参考**：`src/`，原 Rust/Axum + llama-cpp-2/Candle 实现仍保留。
- **静态前端**：`static/`，由 Python 后端同源托管。
- **推理服务**：后端不再加载本地模型文件；LLM 优先使用 Ollama Cloud 托管模型，仍通过本地 Ollama HTTP API 调用；ASR/TTS 由浏览器提供。

## 功能

- Chat：`POST /api/chat`，支持非流式 JSON 和 `qdh-binary-v2` 二进制流式响应。
- Pipeline：`POST /api/pipeline`，保持 transcription、LLM reply、avatar render frame 契约。
- TTS：默认由浏览器 `SpeechSynthesis` 提供；`POST /api/tts` 仅保留兼容静音 WAV，不做模型推理。
- ASR：默认由浏览器 `SpeechRecognition` / `webkitSpeechRecognition` 提供；`GET /api/ws/asr` 仅保留兼容协议，不做模型推理。
- 推理服务状态：`/api/models/status` 展示当前 Ollama/OpenAI-compatible LLM 服务状态；`/api/models/select` 可在 Ollama Cloud 候选模型和已安装的本地模型之间切换聊天后端。
- 地图搜索：`POST /api/map/search` 调用 Nominatim。
- RAG 上下文：`POST /api/context/retrieve` 保留接口和 `top_k=0` 空上下文语义。

## 前置条件

- Python 3.11+
- `uv`
- Ollama（默认 LLM provider）

默认优先使用 Ollama Cloud 托管模型（例如 `gpt-oss:120b-cloud`）。首次使用前请确保本地 Ollama 已启动，并按需要 pull Cloud 模型：

```bash
ollama serve
ollama pull gpt-oss:120b-cloud
```

如需换模型，可打开 Vue 开发环境的 <http://localhost:5173/models> 在 Ollama Cloud 候选模型和本地模型之间切换；如需持久默认值，编辑 `backend/.env` 或设置环境变量：

```bash
OLLAMA_MODEL=your-model
OLLAMA_PREFER_CLOUD=true
OLLAMA_CLOUD_MODELS=gpt-oss:120b-cloud,gpt-oss:20b-cloud,qwen3-coder:480b-cloud
```

## 运行

```bash
cd backend
uv sync --extra dev
uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000
```

访问：<http://127.0.0.1:3000/>

## 外部 LLM API

设置 OpenAI-compatible provider：

```bash
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=qwen-max
```

## 验证

```bash
cd backend
uv run ruff check .
uv run pytest
```

## 旧 Rust 后端

原 Rust 后端仍在 `src/` 和 `Cargo.toml` 中，作为参考和回退路径。迁移后的默认开发入口是 `backend/`。
