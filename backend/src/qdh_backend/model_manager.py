from __future__ import annotations

import hashlib
from pathlib import Path

import httpx

from .schemas import ModelInfo

MODEL_LIBRARY: tuple[dict[str, str], ...] = (
    {
        "name": "Qwen3.5-0.8B-Q4_K_M.gguf",
        "description": "LLM (Unsloth): Qwen 3.5 0.8B GGUF 极致优化版",
        "url": "https://www.modelscope.cn/models/unsloth/Qwen3.5-0.8B-GGUF/resolve/master/Qwen3.5-0.8B-Q4_K_M.gguf",
        "size": "0.53 GB",
        "expected_sha256": "bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517",
    },
    {
        "name": "Qwen3-ASR-0.6B-Q8_0.gguf",
        "description": "ASR: Qwen3 0.6B 官方原生语音识别模型 (GGUF 8-bit)",
        "url": "https://www.modelscope.cn/models/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/master/Qwen3-ASR-0.6B-Q8_0.gguf",
        "size": "805 MB",
        "expected_sha256": "",
    },
    {
        "name": "qwen3-reranker-0.6b-q8_0.gguf",
        "description": "Reranker: Qwen3 0.6B 官方重排序模型",
        "url": "https://www.modelscope.cn/models/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/master/qwen3-reranker-0.6b-q8_0.gguf",
        "size": "640 MB",
        "expected_sha256": "",
    },
    {
        "name": "Qwen3-Embedding-0.6B-Q8_0.gguf",
        "description": "Embedding: Qwen3 0.6B 官方原生向量模型",
        "url": "https://www.modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/master/Qwen3-Embedding-0.6B-Q8_0.gguf",
        "size": "620 MB",
        "expected_sha256": "",
    },
    {
        "name": "audio2verts.mnn",
        "description": "A2BS: 语音转顶点姿态模型 (UniTalker-MNN)",
        "url": "https://www.modelscope.cn/models/MNN/UniTalker-MNN/resolve/master/audio2verts.mnn",
        "size": "45 MB",
        "expected_sha256": "",
    },
    {
        "name": "render_full.nnr",
        "description": "NNR: 神经网络高清渲染模型 (TaoAvatar-NNR-MNN)",
        "url": "https://www.modelscope.cn/models/MNN/TaoAvatar-NNR-MNN/resolve/master/render_full.nnr",
        "size": "320 MB",
        "expected_sha256": "",
    },
    {
        "name": "chinese_bert.mnn",
        "description": "TTS: Qwen 官方推荐 Sambert 语音合成模型 (bert-vits2-MNN)",
        "url": "https://www.modelscope.cn/models/MNN/bert-vits2-MNN/resolve/master/common/mnn_models/chinese_bert.mnn",
        "size": "95 MB",
        "expected_sha256": "",
    },
)


class ModelManager:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._progress: dict[str, float] = {}

    def _safe_path(self, name: str) -> Path:
        if Path(name).name != name:
            raise ValueError("模型名称不能包含路径")
        return self.base_dir / name

    async def get_model_library(self) -> list[ModelInfo]:
        results: list[ModelInfo] = []
        for item in MODEL_LIBRARY:
            path = self._safe_path(item["name"])
            results.append(
                ModelInfo(
                    name=item["name"],
                    description=item["description"],
                    url=item["url"],
                    size=item["size"],
                    installed=path.exists(),
                    progress=self._progress.get(item["name"]),
                    expected_sha256=item["expected_sha256"],
                )
            )
        return results

    async def download_model(self, name: str, url: str) -> None:
        dest = self._safe_path(name)
        if dest.exists():
            return
        temp = dest.with_suffix(dest.suffix + ".part")
        self._progress[name] = 0.01
        try:
            async with (
                httpx.AsyncClient(
                    timeout=None,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                ) as client,
                client.stream("GET", url) as response,
            ):
                response.raise_for_status()
                total = int(response.headers.get("content-length") or 0)
                downloaded = 0
                with temp.open("wb") as file:
                    async for chunk in response.aiter_bytes():
                        if not chunk:
                            continue
                        file.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            self._progress[name] = min(99.9, downloaded / total * 100)
            temp.replace(dest)
        finally:
            temp.unlink(missing_ok=True)
            self._progress.pop(name, None)

    async def delete_model(self, name: str) -> None:
        self._safe_path(name).unlink(missing_ok=True)
        self._progress.pop(name, None)

    async def verify_model(self, name: str, expected_sha256: str) -> bool:
        if not expected_sha256:
            return True
        path = self._safe_path(name)
        if not path.exists():
            return False
        hasher = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest() == expected_sha256.lower()
