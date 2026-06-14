# 🚀 Qwen Digital Human - 快速开始

## 项目结构

```text
qwen-digital-human/
├── backend/      # Python 后端（默认）
├── src/          # Rust 后端旧实现/参考
├── frontend/     # Vue3 前端工程
├── static/       # 当前同源静态前端
├── models/       # AI 模型文件
└── Cargo.toml    # Rust 旧后端配置
```

## 1. 准备 Ollama

默认 LLM provider 是本地 Ollama：

```bash
ollama serve
ollama pull qwen2.5:7b
```

如果你已有其他本地模型，可设置：

```bash
export OLLAMA_MODEL="your-model"
```

## 2. 启动 Python 后端

```bash
cd backend
uv sync --extra dev
uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000
```

后端将运行在：**http://127.0.0.1:3000**

Python 后端会同源托管 `static/`，所以可以直接访问：

- 主界面：<http://127.0.0.1:3000/>
- 模型页：<http://127.0.0.1:3000/models.html>
- 健康检查：<http://127.0.0.1:3000/health>

## 3. 可选：Vue 前端开发服务器

如需继续开发 `frontend/`：

```bash
cd frontend
pnpm install
pnpm dev
```

Vite 开发服务器仍可代理 `/api` 到 `http://127.0.0.1:3000`。

## 功能验证清单

### ✅ 基础功能
- [ ] 页面加载无报错
- [ ] Live2D 模型显示
- [ ] 数字人可拖拽
- [ ] 聊天输入框可用

### ✅ 后端 API
- [ ] `GET /health` 返回 `{ "status": "ok", "backend": "python" }`
- [ ] `POST /api/chat` 非流式返回 `{ reply }`
- [ ] `POST /api/chat` 流式响应包含 `X-Stream-Format: qdh-binary-v2`
- [ ] `POST /api/tts` 返回 `audio/wav`
- [ ] `GET /api/models/status` 返回模型列表

### ⏳ 第一阶段兼容实现
- [ ] ASR WebSocket 已保协议，尚未接真实识别模型
- [ ] TTS 当前返回静音 WAV，后续可替换真实 provider
- [ ] RAG 当前保接口，后续可接 embedding/reranker

## 开发命令

```bash
# Python 后端验证
cd backend && uv run ruff check .
cd backend && uv run pytest

# Python 后端启动
cd backend && uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000

# Vue 前端
cd frontend && pnpm dev
cd frontend && pnpm build
cd frontend && pnpm type-check

# Rust 旧后端（参考/回退）
cargo run
cargo build --release
```
