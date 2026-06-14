from __future__ import annotations

from .schemas import RerankConfigPatch


class RagService:
    def __init__(self) -> None:
        self._documents: list[str] = []

    async def retrieve(self, query: str, rerank: RerankConfigPatch | None = None) -> str:
        query = query.strip()
        config = rerank or RerankConfigPatch()
        if not query or config.top_k == 0:
            return ""
        if not self._documents:
            return ""

        top_k = config.top_k if config.top_k is not None else 3
        terms = [term for term in query.lower().split() if term]
        scored: list[tuple[int, str]] = []
        for document in self._documents:
            lowered = document.lower()
            score = sum(1 for term in terms if term in lowered)
            if score > 0:
                scored.append((score, document))
        scored.sort(key=lambda item: item[0], reverse=True)
        return "\n\n".join(document for _, document in scored[:top_k])
