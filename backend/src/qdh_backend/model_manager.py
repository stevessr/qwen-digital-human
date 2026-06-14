from __future__ import annotations

import httpx

from .schemas import ModelInfo, OllamaModelOption
from .settings import Settings


class OllamaServiceUnavailable(RuntimeError):
    """Raised when the local Ollama HTTP API cannot be reached."""


class OllamaModelNotFound(RuntimeError):
    """Raised when a requested Ollama model is not available or configured."""


class ModelManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def get_model_library(self) -> list[ModelInfo]:
        if self.settings.llm_provider == "openai_compatible":
            return [self._external_api_info()]
        if self.settings.llm_provider == "stub":
            return [self._stub_info()]
        return await self._ollama_library()

    async def select_ollama_model(self, name: str) -> ModelInfo:
        selected_name = name.strip()
        if not selected_name:
            raise ValueError("请选择一个 Ollama 模型。")

        service_available, tags, error = await self._fetch_ollama_tags()
        if not service_available:
            raise OllamaServiceUnavailable(
                f"Ollama 服务不可用：{error or '无法连接到本地 Ollama HTTP API'}"
            )

        options = self._ollama_options(tags)
        selected_option = self._find_option(selected_name, options)
        if not selected_option:
            available = "、".join(option.name for option in options) or "无"
            raise OllamaModelNotFound(
                f"Ollama 未发现或未配置模型 {selected_name}。当前可选模型：{available}"
            )

        self.settings.llm_provider = "ollama"
        self.settings.ollama_model = selected_option.name
        self.settings.llm_model = selected_option.name
        status_message = (
            f"已切换到 Ollama Cloud 托管模型 {selected_option.name}。"
            if selected_option.cloud_hosted
            else f"已切换到本地 Ollama 模型 {selected_option.name}。"
        )
        if selected_option.cloud_hosted and not selected_option.installed:
            status_message += f" 如首次使用，请先运行 ollama pull {selected_option.name}。"
        return self._ollama_model_info(
            option=selected_option,
            options=options,
            selected_name=selected_option.name,
            service_available=True,
            status_message=status_message,
        )

    async def _ollama_library(self) -> list[ModelInfo]:
        selected_name = self.settings.ollama_model
        service_available, tags, error = await self._fetch_ollama_tags()
        options = self._ollama_options(tags)

        if not service_available:
            status_note = (
                f"Ollama 服务未连接：{error}。请确认已运行 ollama serve。"
                if error
                else "Ollama 服务未连接。请确认已运行 ollama serve。"
            )
            return [
                self._configured_ollama_info(
                    selected_name=selected_name,
                    options=options,
                    service_available=False,
                    status_message=status_note,
                )
            ]

        if not options:
            status_note = (
                f"Ollama 服务已连接，但未发现本地模型。请运行 ollama pull {selected_name}。"
            )
            return [
                self._configured_ollama_info(
                    selected_name=selected_name,
                    options=[],
                    service_available=True,
                    status_message=status_note,
                )
            ]

        selected_option = self._find_option(selected_name, options)
        models: list[ModelInfo] = []
        if selected_option is None:
            models.append(
                self._configured_ollama_info(
                    selected_name=selected_name,
                    options=options,
                    service_available=True,
                    status_message=(
                        f"Ollama 服务已连接，但未发现当前配置模型 {selected_name}。"
                        f"请选择下方模型，或运行 ollama pull {selected_name}。"
                    ),
                )
            )

        models.extend(
            self._ollama_model_info(
                option=option,
                options=options,
                selected_name=selected_name,
                service_available=True,
                status_message=self._ollama_status_message(option, selected_name),
            )
            for option in options
        )
        return models

    async def _fetch_ollama_tags(self) -> tuple[bool, list[dict[str, object]], str | None]:
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                response = await client.get(f"{self.settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            raw_models = data.get("models", []) if isinstance(data, dict) else []
            tags = [item for item in raw_models if isinstance(item, dict)]
            return True, tags, None
        except Exception as exc:  # noqa: BLE001 - status endpoint must not fail the page
            return False, [], str(exc)

    def _configured_ollama_info(
        self,
        *,
        selected_name: str,
        options: list[OllamaModelOption],
        service_available: bool,
        status_message: str,
    ) -> ModelInfo:
        cloud_hosted = _is_cloud_model(selected_name)
        provider_label = "Ollama Cloud" if cloud_hosted else "Ollama"
        provider_desc = (
            "LLM 推理由 Ollama Cloud 托管模型提供；后端通过本地 Ollama HTTP API 调用，"
            if cloud_hosted
            else "LLM 推理由本地 Ollama 服务提供；后端只调用 Ollama HTTP API，"
        )
        return ModelInfo(
            name=selected_name,
            description=f"{provider_desc}不加载 GGUF/MNN 推理模型。{status_message}",
            url=self.settings.ollama_base_url,
            size="Ollama Cloud" if cloud_hosted else "由 Ollama 管理",
            installed=False,
            progress=None,
            expected_sha256="",
            provider=provider_label,
            capability="LLM 推理",
            managed_by="ollama",
            downloadable=False,
            verifiable=False,
            deletable=False,
            selected=True,
            cloud_hosted=cloud_hosted,
            service_available=service_available,
            status_message=status_message,
            options=options,
        )

    def _ollama_model_info(
        self,
        *,
        option: OllamaModelOption,
        options: list[OllamaModelOption],
        selected_name: str,
        service_available: bool,
        status_message: str,
    ) -> ModelInfo:
        selected = self._model_name_matches(selected_name, option.name)
        detail_parts = [
            part
            for part in [
                option.family,
                option.parameter_size,
                option.quantization_level,
            ]
            if part
        ]
        detail_text = f"（{' / '.join(detail_parts)}）" if detail_parts else ""
        provider_label = "Ollama Cloud" if option.cloud_hosted else "Ollama"
        return ModelInfo(
            name=option.name,
            description=(
                "LLM 推理由 Ollama Cloud 托管模型提供；后端通过本地 Ollama HTTP API 调用，"
                if option.cloud_hosted
                else "LLM 推理由本地 Ollama 服务提供；后端只调用 Ollama HTTP API，"
            )
            + (
                f"不加载 GGUF/MNN 推理模型。{status_message}{detail_text}"
            ),
            url=self.settings.ollama_base_url,
            size=option.size or ("Ollama Cloud" if option.cloud_hosted else "由 Ollama 管理"),
            installed=option.installed,
            progress=None,
            expected_sha256=option.digest,
            provider=provider_label,
            capability="LLM 推理",
            managed_by="ollama",
            downloadable=False,
            verifiable=False,
            deletable=False,
            selected=selected,
            cloud_hosted=option.cloud_hosted,
            service_available=service_available,
            status_message=status_message,
            options=options,
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
            selected=True,
            service_available=configured,
            status_message="外部 OpenAI-compatible 服务配置已填写。" if configured else "外部服务未配置。",
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
            selected=True,
            service_available=True,
            status_message="测试 provider 可用。",
        )

    async def download_model(self, name: str, url: str) -> None:
        del name, url
        raise RuntimeError(
            "后端不再管理本地模型文件；请使用 Ollama 管理 LLM 模型，例如 ollama pull <model>。"
        )

    async def delete_model(self, name: str) -> None:
        del name
        raise RuntimeError("后端不再删除本地模型文件；请使用 Ollama CLI 管理模型。")

    async def verify_model(self, name: str, expected_sha256: str) -> bool:
        del name, expected_sha256
        return False

    def _ollama_options(self, tags: list[dict[str, object]]) -> list[OllamaModelOption]:
        options_by_name = {option.name: option for option in self._tags_to_options(tags)}
        for name in self.settings.ollama_cloud_models:
            if name in options_by_name:
                installed = options_by_name[name]
                options_by_name[name] = installed.model_copy(
                    update={
                        "cloud_hosted": True,
                        "size": installed.size
                        if installed.size != "由 Ollama 管理"
                        else "Ollama Cloud",
                    }
                )
                continue
            options_by_name[name] = OllamaModelOption(
                name=name,
                size="Ollama Cloud",
                installed=False,
                cloud_hosted=True,
            )
        return sorted(options_by_name.values(), key=self._option_sort_key)

    def _tags_to_options(self, tags: list[dict[str, object]]) -> list[OllamaModelOption]:
        options: list[OllamaModelOption] = []
        for item in tags:
            name = str(item.get("name") or item.get("model") or "").strip()
            if not name:
                continue
            details = item.get("details")
            details_map = details if isinstance(details, dict) else {}
            size_bytes = self._safe_int(item.get("size"))
            options.append(
                OllamaModelOption(
                    name=name,
                    size=_format_size(size_bytes),
                    size_bytes=size_bytes,
                    installed=True,
                    cloud_hosted=_is_cloud_model(name),
                    digest=str(item.get("digest") or ""),
                    modified_at=str(item.get("modified_at") or ""),
                    family=str(details_map.get("family") or ""),
                    parameter_size=str(details_map.get("parameter_size") or ""),
                    quantization_level=str(details_map.get("quantization_level") or ""),
                )
            )
        return sorted(options, key=lambda option: option.name.lower())

    def _ollama_status_message(self, option: OllamaModelOption, selected_name: str) -> str:
        selected = self._model_name_matches(selected_name, option.name)
        if option.cloud_hosted:
            if selected and option.installed:
                return f"当前聊天后端优先使用 Ollama Cloud 托管模型 {option.name}。"
            if selected:
                return (
                    f"当前聊天后端已配置为 Ollama Cloud 托管模型 {option.name}；"
                    f"如首次使用，请先运行 ollama pull {option.name}。"
                )
            if option.installed:
                return "该 Ollama Cloud 托管模型已可用，可切换为当前聊天后端。"
            return f"Ollama Cloud 托管候选模型；首次使用前请运行 ollama pull {option.name}。"
        if selected:
            return f"当前聊天后端正在使用本地 Ollama 模型 {option.name}。"
        return "该本地模型已安装，可切换为当前聊天后端。"

    def _option_sort_key(self, option: OllamaModelOption) -> tuple[int, int, str]:
        cloud_rank = 0 if self.settings.ollama_prefer_cloud and option.cloud_hosted else 1
        installed_rank = 0 if option.installed else 1
        cloud_order = {
            name: index
            for index, name in enumerate(self.settings.ollama_cloud_models)
        }.get(option.name, len(self.settings.ollama_cloud_models))
        return cloud_rank, installed_rank if not option.cloud_hosted else cloud_order, option.name.lower()

    def _find_option(
        self, selected_name: str, options: list[OllamaModelOption]
    ) -> OllamaModelOption | None:
        for option in options:
            if self._model_name_matches(selected_name, option.name):
                return option
        return None

    @staticmethod
    def _model_name_matches(configured_name: str, installed_name: str) -> bool:
        configured = configured_name.strip()
        installed = installed_name.strip()
        if configured == installed:
            return True
        return ":" not in configured and f"{configured}:latest" == installed

    @staticmethod
    def _safe_int(value: object) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            try:
                return int(value)
            except ValueError:
                return None
        return None


def _format_size(size_bytes: int | None) -> str:
    if not size_bytes or size_bytes <= 0:
        return "由 Ollama 管理"
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(size_bytes)
    unit = units[0]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            break
        size /= 1024
    return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"


def _is_cloud_model(name: str) -> bool:
    normalized = name.strip().lower()
    return normalized.endswith("-cloud") or normalized.endswith(":cloud")
