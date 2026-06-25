# Qwen Digital Human — 启动各个组件的 Makefile
#
# 可用目标:
#   make setup       — 安装所有依赖
#   make backend     — 启动 Python 后端 (http://127.0.0.1:3000)
#   make frontend    — 启动 Vue 前端开发服务器 (http://127.0.0.1:5173)
#   make ollama      — 启动本地 Ollama LLM 服务
#   make lint        — 运行代码检查 (ruff + vue-tsc)
#   make dist        — 构建前端生产包
#   make clean       — 清理构建产物
#   make help        — 显示此帮助
#
#   ⚠️  backend、frontend、ollama 均为前台进程，需要分别在不同终端中启动。
#      或使用 & 后台运行：make backend &

.PHONY: setup backend frontend ollama lint dist clean help

# ──── 颜色 (printf 兼容) ───────────────────────────────────────────────────
bold   := \033[1m
green  := \033[32m
yellow := \033[33m
cyan   := \033[36m
nc     := \033[0m

# ──── 帮助 ─────────────────────────────────────────────────────────────────
help:
	@printf "$(bold)Qwen Digital Human — 启动指南$(nc)\n"
	@printf "\n"
	@printf "  $(green)make setup$(nc)     安装所有依赖\n"
	@printf "  $(green)make backend$(nc)   启动 Python 后端 (http://127.0.0.1:3000)\n"
	@printf "  $(green)make frontend$(nc)  启动 Vue 前端 (http://127.0.0.1:5173)\n"
	@printf "  $(green)make ollama$(nc)    启动本地 Ollama LLM 服务\n"
	@printf "  $(green)make lint$(nc)      运行 ruff + vue-tsc 检查\n"
	@printf "  $(green)make dist$(nc)      构建前端生产包\n"
	@printf "  $(green)make clean$(nc)     清理构建产物\n"
	@printf "\n"
	@printf "  $(yellow)提示$(nc): 首次使用请先执行 $(cyan)make setup$(nc)\n"
	@printf "  backend/frontend/ollama 均为前台进程，需分开终端运行\n"

# ──── 依赖安装 ─────────────────────────────────────────────────────────────
setup:
	@printf "$(bold)>>> 安装后端依赖...$(nc)\n"
	cd backend && uv sync --extra dev
	@printf "$(bold)>>> 安装前端依赖...$(nc)\n"
	cd frontend && pnpm install
	@printf "$(green)✓ 依赖安装完成$(nc)\n"

# ──── 单个服务 ─────────────────────────────────────────────────────────────
ollama:
	@printf "$(bold)>>> 启动 Ollama LLM 服务...$(nc)\n"
	ollama serve

backend:
	@printf "$(bold)>>> 启动 Python 后端 (http://127.0.0.1:3000)...$(nc)\n"
	cd backend && uv run uvicorn qdh_backend.main:app \
		--host 127.0.0.1 --port 3000 --reload

frontend:
	@printf "$(bold)>>> 启动 Vue 前端开发服务器 (http://127.0.0.1:5173)...$(nc)\n"
	cd frontend && pnpm dev

# ──── 代码检查 ─────────────────────────────────────────────────────────────
lint:
	@printf "$(bold)>>> ruff 检查...$(nc)\n"
	cd backend && uv run ruff check .
	@printf "$(green)✓ ruff 通过$(nc)\n"
	@printf "$(bold)>>> TypeScript 检查...$(nc)\n"
	cd frontend && npx vue-tsc --noEmit
	@printf "$(green)✓ vue-tsc 通过$(nc)\n"

# ──── 前端构建 ─────────────────────────────────────────────────────────────
dist:
	@printf "$(bold)>>> 构建前端生产包...$(nc)\n"
	cd frontend && pnpm build
	@printf "$(green)✓ 构建完成: frontend/dist/$(nc)\n"

# ──── 清理 ─────────────────────────────────────────────────────────────────
clean:
	@printf "$(bold)>>> 清理...$(nc)\n"
	rm -rf backend/.venv/
	rm -rf backend/__pycache__/
	find backend/src -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/node_modules/
	rm -rf frontend/dist/
	rm -rf frontend/.vite/
	@printf "$(green)✓ 清理完成$(nc)\n"
