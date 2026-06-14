from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CompatModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class RerankConfigPatch(CompatModel):
    candidate_pool: int | None = None
    similarity_threshold: float | None = None
    top_k: int | None = None
    instruction: str | None = None


class ChatRequest(CompatModel):
    message: str
    fast_mode: bool = True
    stream: bool = False
    tts_enabled: bool = True
    use_rag_context: bool = True
    system_prompt: str = ""
    memory: str = ""
    context: str = ""
    rerank: RerankConfigPatch = Field(default_factory=RerankConfigPatch)


class ChatResponse(CompatModel):
    reply: str


class PipelineRequest(CompatModel):
    audio_base64: str = ""
    fast_mode: bool = True
    stream: bool = False
    transcription: str | None = None
    audio_format: str = ""
    audio_sample_rate: int | None = None
    tts_enabled: bool = True
    use_rag_context: bool = True
    system_prompt: str = ""
    memory: str = ""
    context: str = ""
    rerank: RerankConfigPatch = Field(default_factory=RerankConfigPatch)


class ExpressionData(CompatModel):
    mouth_open: float = 0.0
    smile: float = 0.0
    blink: float = 0.0


class PostureData(CompatModel):
    head_pitch: float = 0.0
    head_yaw: float = 0.0
    head_roll: float = 0.0


class RenderFrame(CompatModel):
    expression: ExpressionData = Field(default_factory=ExpressionData)
    posture: PostureData = Field(default_factory=PostureData)
    audio_base64: str = ""
    audio_mime_type: str = "audio/wav"
    waveform: list[float] = Field(default_factory=lambda: [0.0] * 128)


class PipelineResponse(CompatModel):
    transcription: str
    llm_reply: str
    render_frame: RenderFrame


class TtsRequest(CompatModel):
    text: str = ""


class ContextRequest(CompatModel):
    query: str
    rerank: RerankConfigPatch = Field(default_factory=RerankConfigPatch)


class ContextResponse(CompatModel):
    context: str


class MapSearchRequest(CompatModel):
    query: str
    limit: int = 5


class MapBounds(CompatModel):
    south: float
    north: float
    west: float
    east: float


class MapPlace(CompatModel):
    place_id: int | None = None
    osm_type: str | None = None
    osm_id: int | None = None
    display_name: str
    lat: float
    lon: float
    bounds: MapBounds
    category: str | None = None
    kind: str | None = None
    importance: float | None = None
    map_url: str
    summary: str


class MapSearchResponse(CompatModel):
    query: str
    results: list[MapPlace]


class ModelInfo(CompatModel):
    name: str
    description: str
    url: str
    size: str
    installed: bool
    progress: float | None = None
    expected_sha256: str = ""


class DownloadRequest(CompatModel):
    name: str
    url: str


class ModelActionRequest(CompatModel):
    name: str
    expected_sha256: str | None = None


class StatusResponse(CompatModel):
    status: str
    message: str | None = None
