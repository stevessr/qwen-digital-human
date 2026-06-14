from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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

    return Settings(
        repo_root=root,
        static_dir=_path_from_env("STATIC_DIR", "static", root),
        host=os.getenv("QDH_HOST", "127.0.0.1"),
        port=port,
        llm_provider=os.getenv("LLM_PROVIDER", "ollama").strip().lower() or "ollama",
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
        ollama_model=os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
        llm_base_url=os.getenv("LLM_BASE_URL", "").rstrip("/"),
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_model=os.getenv("LLM_MODEL", os.getenv("OLLAMA_MODEL", "qwen2.5:7b")),
        llm_timeout_seconds=timeout,
    )
