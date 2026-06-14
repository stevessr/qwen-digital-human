# Qwen Digital Human (Python + WebGPU)

地图数字人项目：Python 后端提供同源 API 与静态资源服务，前端使用 WebGPU/Live2D 渲染数字人。LLM 默认通过本地 Ollama 调用，也可切换到 OpenAI-compatible 外部 API。

## 当前状态

- **默认后端**：`backend/`，FastAPI + httpx + Ollama/OpenAI-compatible provider。
- **旧后端参考**：`src/`，原 Rust/Axum + llama-cpp-2/Candle 实现仍保留。
- **静态前端**：`static/`，由 Python 后端同源托管。
- **模型目录**：`models/`，仍用于模型管理页面和本地资产状态。

## 功能

- Chat：`POST /api/chat`，支持非流式 JSON 和 `qdh-binary-v2` 二进制流式响应。
- Pipeline：`POST /api/pipeline`，保持 transcription、LLM reply、avatar render frame 契约。
- TTS：`POST /api/tts` 返回 `audio/wav`；第一阶段为静音 WAV 兼容实现。
- ASR WebSocket：`GET /api/ws/asr` 保持连接/commit/reset 协议；第一阶段尚未接真实 ASR 模型。
- 模型管理：`/api/models/*` 保持 7 个模型项、下载、删除、校验接口。
- 地图搜索：`POST /api/map/search` 调用 Nominatim。
- RAG 上下文：`POST /api/context/retrieve` 保留接口和 `top_k=0` 空上下文语义。

## 前置条件

- Python 3.11+
- `uv`
- Ollama（默认 LLM provider）

默认模型示例：

```bash
ollama serve
ollama pull qwen2.5:7b
```

如需换模型，编辑 `backend/.env` 或设置环境变量：

```bash
OLLAMA_MODEL=your-local-model
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
