from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from .settings import Settings


class ThinkFilter:
    OPEN_TAG = "<think>"
    CLOSE_TAG = "</think>"

    def __init__(self) -> None:
        self.buffer = ""
        self.in_think = False

    def push(self, chunk: str) -> str:
        self.buffer += chunk
        visible: list[str] = []
        while True:
            if self.in_think:
                end_idx = self.buffer.find(self.CLOSE_TAG)
                if end_idx >= 0:
                    self.buffer = self.buffer[end_idx + len(self.CLOSE_TAG) :]
                    self.in_think = False
                    continue
                keep = _suffix_prefix_len(self.buffer, self.CLOSE_TAG)
                if len(self.buffer) > keep:
                    self.buffer = self.buffer[len(self.buffer) - keep :]
                break

            start_idx = self.buffer.find(self.OPEN_TAG)
            if start_idx >= 0:
                visible.append(self.buffer[:start_idx])
                self.buffer = self.buffer[start_idx + len(self.OPEN_TAG) :]
                self.in_think = True
                continue

            keep = _suffix_prefix_len(self.buffer, self.OPEN_TAG)
            if len(self.buffer) > keep:
                emit_len = len(self.buffer) - keep
                visible.append(self.buffer[:emit_len])
                self.buffer = self.buffer[emit_len:]
            break

        return "".join(visible).replace(self.CLOSE_TAG, "")

    def finish(self) -> str:
        if self.in_think:
            self.buffer = ""
            self.in_think = False
            return ""
        keep = _suffix_prefix_len(self.buffer, self.OPEN_TAG)
        if keep > 0 and len(self.buffer) > keep:
            visible = self.buffer[: len(self.buffer) - keep]
        elif keep == len(self.buffer):
            visible = ""
        else:
            visible = self.buffer
        self.buffer = ""
        return visible


def _suffix_prefix_len(text: str, tag: str) -> int:
    max_len = min(len(text), max(0, len(tag) - 1))
    for length in range(max_len, 0, -1):
        if text[-length:] == tag[:length]:
            return length
    return 0


def compose_system_prompt(system_prompt: str, memory: str, context: str) -> str | None:
    sections: list[str] = []
    if system_prompt.strip():
        sections.append(system_prompt.strip())
    if memory.strip():
        sections.append(f"记忆:\n{memory.strip()}")
    if context.strip():
        sections.append(f"上下文:\n{context.strip()}")
    return "\n\n".join(sections) if sections else None


def _messages(message: str, system_prompt: str, memory: str, context: str) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    composed = compose_system_prompt(system_prompt, memory, context)
    if composed:
        messages.append({"role": "system", "content": composed})
    messages.append({"role": "user", "content": message})
    return messages


class LlmProvider:
    async def generate(self, message: str, system_prompt: str, memory: str, context: str) -> str:
        chunks = [
            chunk async for chunk in self.generate_stream(message, system_prompt, memory, context)
        ]
        return "".join(chunks)

    async def generate_stream(
        self,
        message: str,
        system_prompt: str,
        memory: str,
        context: str,
    ) -> AsyncIterator[str]:
        raise NotImplementedError


@dataclass(slots=True)
class OllamaProvider(LlmProvider):
    base_url: str
    model: str
    timeout: float

    async def generate(self, message: str, system_prompt: str, memory: str, context: str) -> str:
        payload = {
            "model": self.model,
            "messages": _messages(message, system_prompt, memory, context),
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(f"{self.base_url}/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()
        raw = str(data.get("message", {}).get("content") or data.get("response") or "")
        return _filter_full_text(raw)

    async def generate_stream(
        self,
        message: str,
        system_prompt: str,
        memory: str,
        context: str,
    ) -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "messages": _messages(message, system_prompt, memory, context),
            "stream": True,
        }
        think_filter = ThinkFilter()
        async with (
            httpx.AsyncClient(timeout=self.timeout) as client,
            client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                data = json.loads(line)
                content = str(data.get("message", {}).get("content") or data.get("response") or "")
                visible = think_filter.push(content)
                if visible:
                    yield visible
                if data.get("done"):
                    break
        tail = think_filter.finish()
        if tail:
            yield tail


@dataclass(slots=True)
class OpenAICompatibleProvider(LlmProvider):
    base_url: str
    api_key: str
    model: str
    timeout: float

    async def generate(self, message: str, system_prompt: str, memory: str, context: str) -> str:
        payload = {
            "model": self.model,
            "messages": _messages(message, system_prompt, memory, context),
            "stream": False,
        }
        headers = _auth_headers(self.api_key)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions", json=payload, headers=headers
            )
        response.raise_for_status()
        data = response.json()
        raw = str(data.get("choices", [{}])[0].get("message", {}).get("content") or "")
        return _filter_full_text(raw)

    async def generate_stream(
        self,
        message: str,
        system_prompt: str,
        memory: str,
        context: str,
    ) -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "messages": _messages(message, system_prompt, memory, context),
            "stream": True,
        }
        think_filter = ThinkFilter()
        headers = _auth_headers(self.api_key)
        async with (
            httpx.AsyncClient(timeout=self.timeout) as client,
            client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                line = line.strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                data = json.loads(line)
                content = str(data.get("choices", [{}])[0].get("delta", {}).get("content") or "")
                visible = think_filter.push(content)
                if visible:
                    yield visible
        tail = think_filter.finish()
        if tail:
            yield tail


@dataclass(slots=True)
class StubProvider(LlmProvider):
    async def generate_stream(
        self,
        message: str,
        system_prompt: str,
        memory: str,
        context: str,
    ) -> AsyncIterator[str]:
        del system_prompt, memory, context
        yield f"这是 Python 后端的测试回复：{message}"


def _auth_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def _filter_full_text(text: str) -> str:
    think_filter = ThinkFilter()
    return think_filter.push(text) + think_filter.finish()


class LlmService:
    def __init__(self, settings: Settings) -> None:
        self.provider = self._build_provider(settings)

    def configure(self, settings: Settings) -> None:
        self.provider = self._build_provider(settings)

    def _build_provider(self, settings: Settings) -> LlmProvider:
        if settings.llm_provider == "openai_compatible":
            if not settings.llm_base_url:
                raise ValueError("LLM_PROVIDER=openai_compatible 需要设置 LLM_BASE_URL")
            return OpenAICompatibleProvider(
                base_url=settings.llm_base_url,
                api_key=settings.llm_api_key,
                model=settings.llm_model,
                timeout=settings.llm_timeout_seconds,
            )
        if settings.llm_provider == "stub":
            return StubProvider()
        return OllamaProvider(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout=settings.llm_timeout_seconds,
        )

    async def generate(
        self,
        message: str,
        system_prompt: str = "",
        memory: str = "",
        context: str = "",
        fast_mode: bool = True,
    ) -> str:
        del fast_mode
        return await self.provider.generate(message, system_prompt, memory, context)

    async def generate_stream(
        self,
        message: str,
        system_prompt: str = "",
        memory: str = "",
        context: str = "",
        fast_mode: bool = True,
    ) -> AsyncIterator[str]:
        del fast_mode
        async for chunk in self.provider.generate_stream(message, system_prompt, memory, context):
            yield chunk
