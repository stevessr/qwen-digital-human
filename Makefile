.PHONY: help backend backend-sync frontend frontend-install dev test lint

BACKEND_HOST ?= 127.0.0.1
BACKEND_PORT ?= 3000
FRONTEND_PM ?= pnpm

help:
	@printf '%s\n' '可用命令：'
	@printf '%s\n' '  make backend           启动 Python/FastAPI 后端：http://$(BACKEND_HOST):$(BACKEND_PORT)'
	@printf '%s\n' '  make frontend          启动前端开发服务器（frontend/）'
	@printf '%s\n' '  make dev               同时启动 Python 后端和前端开发服务器'
	@printf '%s\n' '  make backend-sync      同步 Python 后端依赖'
	@printf '%s\n' '  make frontend-install  安装前端依赖'
	@printf '%s\n' '  make lint              运行 Python 后端 Ruff 检查'
	@printf '%s\n' '  make test              运行 Python 后端测试'

backend-sync:
	uv --project backend sync --extra dev

backend:
	uv --project backend run uvicorn qdh_backend.main:app --host $(BACKEND_HOST) --port $(BACKEND_PORT)

frontend-install:
	cd frontend && $(FRONTEND_PM) install

frontend:
	cd frontend && $(FRONTEND_PM) dev

dev:
	$(MAKE) -j2 backend frontend

lint:
	uv --project backend run ruff check backend

test:
	uv --project backend run pytest
