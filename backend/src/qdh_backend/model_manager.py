from __future__ import annotations

import httpx

from .schemas import ModelInfo
from .settings import Settings


class ModelManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def get_model_library(self) -> list[ModelInfo]:
        if self.settings.llm_provider == "openai_compatible":
            return [self._external_api_info()]
        if self.settings.llm_provider == "stub":
            return [self._stub_info()]
        return [await self._ollama_info()]

    async def _ollama_info(self) -> ModelInfo:
        model_name = self.settings.ollama_model
        service_available = False
        model_available = False
        status_note = "Ollama 服务未连接，或尚未拉取指定模型。"

        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                response = await client.get(f"{self.settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            service_available = True
            data = response.json()
            names = {
                str(item.get("name") or item.get("model") or "")
                for item in data.get("models", [])
            }
            model_available = model_name in names
            if model_available:
                status_note = "Ollama 服务已连接，指定模型可用。"
            else:
                status_note = f"Ollama 服务已连接，但未发现模型 {model_name}。请运行 ollama pull {model_name}。"
        except Exception:  # noqa: BLE001 - status endpoint must not fail the page
            pass

        return ModelInfo(
            name=model_name,
            description=(
                "LLM 推理由本地 Ollama 服务提供；后端只调用 Ollama HTTP API，"
                f"不加载 GGUF/MNN 推理模型。{status_note}"
            ),
            url=self.settings.ollama_base_url,
            size="由 Ollama 管理",
            installed=service_available and model_available,
            progress=None,
            expected_sha256="",
            provider="Ollama",
            capability="LLM 推理",
            managed_by="ollama",
            downloadable=False,
            verifiable=False,
            deletable=False,
        )

    def _external_api_info(self) -> ModelInfo:
        configured = bool(self.settings.llm_base_url and self.settings.llm_model)
        return ModelInfo(
            name=self.settings.llm_model or "OpenAI-compatible model",
            description="LLM 推理由 OpenAI-compatible 外部服务提供；后端不加载本地推理模型。",
            url=self.settings.llm_base_url,
            size="由外部服务管理",
            installed=configured,
            progress=None,
            expected_sha256="",
            provider="OpenAI-compatible",
            capability="LLM 推理",
            managed_by="external",
            downloadable=False,
            verifiable=False,
            deletable=False,
        )

    def _stub_info(self) -> ModelInfo:
        return ModelInfo(
            name="stub-llm-provider",
            description="测试用 LLM provider；用于本地测试，不代表真实后端模型推理能力。",
            url="",
            size="无需模型文件",
            installed=True,
            progress=None,
            expected_sha256="",
            provider="Stub",
            capability="LLM 测试回复",
            managed_by="external",
            downloadable=False,
            verifiable=False,
            deletable=False,
        )

    async def download_model(self, name: str, url: str) -> None:
        del name, url
        raise RuntimeError("后端不再管理本地模型文件；请使用 Ollama 管理 LLM 模型，例如 ollama pull <model>。")

    async def delete_model(self, name: str) -> None:
        del name
        raise RuntimeError("后端不再删除本地模型文件；请使用 Ollama CLI 管理模型。")

    async def verify_model(self, name: str, expected_sha256: str) -> bool:
        del name, expected_sha256
        return False
