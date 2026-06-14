# Qwen Digital Human Python Backend

这是项目的新 Python 后端，目标是替换原 Rust/Axum 服务端，并保持现有 `static/` 前端 API 契约兼容。

## 默认 LLM：Ollama Cloud 优先

默认配置：

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_PREFER_CLOUD=true
OLLAMA_CLOUD_MODELS=gpt-oss:120b-cloud,gpt-oss:20b-cloud,qwen3-coder:480b-cloud,glm-4.7:cloud,minimax-m2.1:cloud,deepseek-v3.1:671b-cloud
```

运行前请确保本地 Ollama 已启动。首次使用某个 Cloud 托管模型时，先执行 pull，让本地 Ollama 记录该模型：

```bash
ollama serve
ollama pull gpt-oss:120b-cloud
```

如需强制使用本地模型，再设置 `OLLAMA_MODEL=qwen2.5:7b` 或在 <http://localhost:5173/models> 切换。

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
- `GET /api/models/status`（展示 Ollama/OpenAI-compatible LLM 服务状态，Cloud 候选模型优先）
- `POST /api/models/select`（切换当前聊天后端使用的 Ollama Cloud/本地模型）
- `POST /api/models/download`（兼容端点，返回“不再由后端管理模型”）
- `POST /api/models/delete`（兼容端点，返回“不再由后端管理模型”）
- `POST /api/models/verify`（兼容端点，返回“不再由后端管理模型”）
- `POST /api/models/preload/asr`（兼容端点，ASR 由浏览器提供）
- `POST /api/models/preload/tts`（兼容端点，TTS 由浏览器提供）
- `POST /api/map/search`
- `POST /api/context/retrieve`

`/api/chat` 和 `/api/pipeline` 的流式响应保持 `application/octet-stream` + `X-Stream-Format: qdh-binary-v2`，以兼容 `static/main.js` 的二进制帧解析器。

## 第一阶段限制

- LLM 已接 Ollama/OpenAI-compatible provider；默认通过本地 Ollama HTTP API 优先调用 Ollama Cloud 托管模型。
- ASR 由浏览器 SpeechRecognition / webkitSpeechRecognition 提供，后端只保留 WebSocket 兼容协议，不做语音模型推理。
- TTS 由浏览器 SpeechSynthesis 提供，后端 `/api/tts` 只保留静音 WAV 兼容响应，不做语音模型推理。
- RAG 先保留接口和 `top_k=0` 语义，未接本地 embedding/reranker 模型。
- Rust `src/` 仍保留为旧实现参考和回退路径。

## 验证

```bash
cd backend
uv run ruff check .
uv run pytest
```
