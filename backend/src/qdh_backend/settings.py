from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_OLLAMA_CLOUD_MODELS = (
    "gpt-oss:120b-cloud",
    "gpt-oss:20b-cloud",
    "qwen3-coder:480b-cloud",
    "glm-4.7:cloud",
    "minimax-m2.1:cloud",
    "deepseek-v3.1:671b-cloud",
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _path_from_env(name: str, default: str, root: Path) -> Path:
    raw = os.getenv(name, default).strip() or default
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    return path


def _bool_from_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _csv_from_env(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name)
    if raw is None:
        return default
    values = tuple(part.strip() for part in raw.split(",") if part.strip())
    return values or default


@dataclass(slots=True)
class Settings:
    repo_root: Path
    static_dir: Path
    host: str
    port: int
    llm_provider: str
    ollama_base_url: str
    ollama_model: str
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    llm_timeout_seconds: float
    ollama_prefer_cloud: bool = True
    ollama_cloud_models: tuple[str, ...] = DEFAULT_OLLAMA_CLOUD_MODELS


def load_settings() -> Settings:
    root = _repo_root()
    _load_dotenv(root / ".env")
    _load_dotenv(root / "backend" / ".env")

    port_raw = os.getenv("QDH_PORT") or os.getenv("PORT") or "3000"
    try:
        port = int(port_raw)
    except ValueError:
        port = 3000

    timeout_raw = os.getenv("LLM_TIMEOUT_SECONDS", "120")
    try:
        timeout = float(timeout_raw)
    except ValueError:
        timeout = 120.0

    ollama_prefer_cloud = _bool_from_env("OLLAMA_PREFER_CLOUD", True)
    ollama_cloud_models = _csv_from_env("OLLAMA_CLOUD_MODELS", DEFAULT_OLLAMA_CLOUD_MODELS)
    default_ollama_model = (
        ollama_cloud_models[0] if ollama_prefer_cloud and ollama_cloud_models else "qwen2.5:7b"
    )
    ollama_model = os.getenv("OLLAMA_MODEL", default_ollama_model)

    return Settings(
        repo_root=root,
        static_dir=_path_from_env("STATIC_DIR", "static", root),
        host=os.getenv("QDH_HOST", "127.0.0.1"),
        port=port,
        llm_provider=os.getenv("LLM_PROVIDER", "ollama").strip().lower() or "ollama",
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
        ollama_model=ollama_model,
        llm_base_url=os.getenv("LLM_BASE_URL", "").rstrip("/"),
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_model=os.getenv("LLM_MODEL", ollama_model),
        llm_timeout_seconds=timeout,
        ollama_prefer_cloud=ollama_prefer_cloud,
        ollama_cloud_models=ollama_cloud_models,
    )
