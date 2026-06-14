# Qwen Digital Human Python Backend

这是项目的新 Python 后端，目标是替换原 Rust/Axum 服务端，并保持现有 `static/` 前端 API 契约兼容。

## 默认 LLM：本地 Ollama

默认配置：

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

运行前请确保 Ollama 已启动并已拉取模型：

```bash
ollama serve
ollama pull qwen2.5:7b
```

如需使用 OpenAI-compatible 外部 API，可在 `backend/.env` 中设置：

```bash
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=qwen-max
```

## 安装与运行

```bash
cd backend
uv sync --extra dev
uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000
```

然后打开：

- 主页面：<http://127.0.0.1:3000/>
- 健康检查：<http://127.0.0.1:3000/health>
- 模型/能力页：<http://127.0.0.1:3000/models.html>（静态前端）或 Vue 开发环境的 <http://localhost:5173/models>

## 已兼容的 API

- `POST /api/chat`
- `POST /api/tts`
- `POST /api/pipeline`
- `GET /api/ws/asr`
- `GET /api/models/status`（展示 Ollama/OpenAI-compatible LLM 服务状态）
- `POST /api/models/download`（兼容端点，返回“不再由后端管理模型”）
- `POST /api/models/delete`（兼容端点，返回“不再由后端管理模型”）
- `POST /api/models/verify`（兼容端点，返回“不再由后端管理模型”）
- `POST /api/models/preload/asr`（兼容端点，ASR 由浏览器提供）
- `POST /api/models/preload/tts`（兼容端点，TTS 由浏览器提供）
- `POST /api/map/search`
- `POST /api/context/retrieve`

`/api/chat` 和 `/api/pipeline` 的流式响应保持 `application/octet-stream` + `X-Stream-Format: qdh-binary-v2`，以兼容 `static/main.js` 的二进制帧解析器。

## 第一阶段限制

- LLM 已接 Ollama/OpenAI-compatible provider。
- ASR 是 WebSocket 协议兼容层，尚未接真实识别模型。
- TTS 返回合法静音 WAV，用于保持前端链路和 avatar frame 结构；后续可替换为真实 TTS provider。
- RAG 先保留接口和 `top_k=0` 语义，未接 embedding/reranker。
- Rust `src/` 仍保留为旧实现参考和回退路径。

## 验证

```bash
cd backend
uv run ruff check .
uv run pytest
```
