"""TTS provider abstraction — edge-tts (default) and silence (compatibility) backends."""

from __future__ import annotations

import asyncio
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .audio import synthesize_silence

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class VisemeEvent:
    """A single viseme event aligned to a point in the audio timeline."""

    viseme_id: str
    start_ms: float
    end_ms: float


@dataclass(slots=True)
class TtsResult:
    """Result from a TTS synthesis call."""

    wav_bytes: bytes
    sample_rate: int
    viseme_events: list[VisemeEvent] = field(default_factory=list)
    duration_ms: float = 0.0
    text: str = ""


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------


class TtsProvider:
    """Abstract base for TTS engines."""

    async def synthesize(self, text: str) -> TtsResult:
        """Synthesize *text* and return audio + viseme data."""
        raise NotImplementedError

    @property
    def name(self) -> str:
        return type(self).__name__.replace("Provider", "").lower()


# ---------------------------------------------------------------------------
# edge-tts provider
# ---------------------------------------------------------------------------

EDGE_TTS_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
EDGE_TTS_DEFAULT_RATE = "+0%"
EDGE_TTS_DEFAULT_VOLUME = "+0%"


class EdgeTtsProvider(TtsProvider):
    """TTS via Microsoft Edge's online TTS service (edge-tts).

    Generates high-quality Mandarin speech and produces phoneme-level
    timing data for viseme extraction.
    """

    def __init__(
        self,
        voice: str = EDGE_TTS_DEFAULT_VOICE,
        rate: str = EDGE_TTS_DEFAULT_RATE,
        volume: str = EDGE_TTS_DEFAULT_VOLUME,
    ) -> None:
        self.voice = voice
        self.rate = rate
        self.volume = volume

    async def synthesize(self, text: str) -> TtsResult:
        if not text.strip():
            pcm, wav_bytes, sample_rate = synthesize_silence("")
            return TtsResult(
                wav_bytes=wav_bytes,
                sample_rate=sample_rate,
                duration_ms=0.0,
                text=text,
            )

        text = text.strip()

        # edge-tts can generate a JSON word-boundary timeline alongside audio.
        # We use its "listen" output mode: stdout writes WAV while stderr
        # contains per-word metadata that we convert to viseme estimates.
        try:
            wav_bytes, word_timings = await self._run_edge_tts(text)
        except FileNotFoundError:
            # edge-tts CLI not installed — fall back to silence
            pcm, wav_bytes, sample_rate = synthesize_silence(text)
            return TtsResult(
                wav_bytes=wav_bytes,
                sample_rate=sample_rate,
                text=text,
            )

        sample_rate = 24_000  # edge-tts outputs 24 kHz by default
        duration_ms = _estimate_wav_duration_ms(wav_bytes, sample_rate)

        # Convert word timings to viseme events
        viseme_events = _word_timings_to_visemes(word_timings, duration_ms, text)

        return TtsResult(
            wav_bytes=wav_bytes,
            sample_rate=sample_rate,
            viseme_events=viseme_events,
            duration_ms=duration_ms,
            text=text,
        )

    async def _run_edge_tts(self, text: str) -> tuple[bytes, list[dict]]:
        """Call ``edge-tts`` as a subprocess and parse its output."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        try:
            proc = await asyncio.create_subprocess_exec(
                "edge-tts",
                "--voice", self.voice,
                "--rate", self.rate,
                "--volume", self.volume,
                "--text", text,
                "--write-media", str(tmp_path),
                "--write-subtitles", str(tmp_path.with_suffix(".json")),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()

            if proc.returncode != 0:
                stderr_text = stderr.decode("utf-8", errors="replace") if stderr else ""
                raise RuntimeError(
                    f"edge-tts failed (exit {proc.returncode}): {stderr_text}"
                )

            wav_bytes = tmp_path.read_bytes()

            # Parse subtitle JSON (word boundaries)
            sub_path = tmp_path.with_suffix(".json")
            word_timings: list[dict] = []
            if sub_path.exists():
                import json  # noqa: PLC0415 — imported lazily

                raw = sub_path.read_text(encoding="utf-8")
                if raw.strip():
                    try:
                        parsed = json.loads(raw)
                        if isinstance(parsed, list):
                            word_timings = parsed
                    except json.JSONDecodeError:
                        pass
                sub_path.unlink(missing_ok=True)

            return wav_bytes, word_timings
        finally:
            tmp_path.unlink(missing_ok=True)

    @property
    def name(self) -> str:
        return "edge-tts"


# ---------------------------------------------------------------------------
# Silence provider (compatibility)
# ---------------------------------------------------------------------------


class SilenceProvider(TtsProvider):
    """Returns silence WAV for every input — used when TTS is disabled."""

    async def synthesize(self, text: str) -> TtsResult:
        pcm, wav_bytes, sample_rate = synthesize_silence(text)
        return TtsResult(
            wav_bytes=wav_bytes,
            sample_rate=sample_rate,
            duration_ms=_estimate_wav_duration_ms(wav_bytes, sample_rate),
            text=text,
        )

    @property
    def name(self) -> str:
        return "silence"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _estimate_wav_duration_ms(wav_bytes: bytes, sample_rate: int) -> float:
    """Rough duration of a mono-16bit WAV in milliseconds."""
    if not wav_bytes or sample_rate <= 0:
        return 0.0
    # WAV header is 44 bytes; remaining is PCM data (2 bytes per sample)
    pcm_len = max(0, len(wav_bytes) - 44)
    samples = pcm_len // 2
    return (samples / sample_rate) * 1000.0


def _word_timings_to_visemes(
    word_timings: list[dict],
    duration_ms: float,
    text: str,
) -> list[VisemeEvent]:
    """Convert edge-tts word-boundary timings to viseme events.

    edge-tts subtitle JSON format per entry::
        {"text": "你好", "offset": 0.0, "duration": 0.32}

    We map each word to a heuristic viseme based on its initial phoneme
    (approximated from the text) and split into per-character estimates
    when possible.
    """
    if not word_timings:
        # No timing data — create a single viseme for the whole utterance
        return _fallback_visemes(duration_ms, text)

    events: list[VisemeEvent] = []
    for entry in word_timings:
        word = entry.get("text", "")
        offset_s = float(entry.get("offset", 0))
        dur_s = float(entry.get("duration", 0.1))
        if not word or dur_s <= 0:
            continue

        chars = list(word)
        char_dur = dur_s / max(len(chars), 1)
        for i, ch in enumerate(chars):
            viseme = _char_to_viseme(ch)
            start = (offset_s + i * char_dur) * 1000.0
            end = start + char_dur * 1000.0
            events.append(VisemeEvent(viseme_id=viseme, start_ms=start, end_ms=end))

    return events


def _fallback_visemes(duration_ms: float, text: str) -> list[VisemeEvent]:
    """Generate evenly-spaced visemes when no timing data is available."""
    if duration_ms <= 0 or not text.strip():
        return []

    # Rough guess: ~4 chars/second of speech
    total_chars = len(text.strip())
    estimated_duration = max(duration_ms, total_chars * 80.0)  # 80 ms per char

    events: list[VisemeEvent] = []
    for ch in text.strip():
        viseme = _char_to_viseme(ch)
        start = (len(events) * 80.0) % estimated_duration
        end = min(start + 80.0, estimated_duration)
        events.append(VisemeEvent(viseme_id=viseme, start_ms=start, end_ms=end))

    return events


# ---------------------------------------------------------------------------
# Viseme lookup (Chinese character → Oculus-style viseme)
# ---------------------------------------------------------------------------

_VISEME_MAP: dict[str, str] = {
    # 唇闭合 / 双唇音
    "b": "B", "p": "B", "m": "B",
    # 唇齿音
    "f": "F",
    # 舌尖音 / 齿音
    "d": "D", "t": "D", "n": "D", "l": "D",
    # 舌根音
    "g": "C", "k": "C", "h": "C",
    # 舌面音
    "j": "C", "q": "C", "x": "C",
    # 卷舌音
    "zh": "C", "ch": "C", "sh": "C", "r": "C",
    # 舌尖前音
    "z": "D", "c": "D", "s": "D",
    # 开元音
    "a": "A", "o": "O", "e": "E",
    # 闭元音 / 齐齿
    "i": "I", "u": "U", "ü": "U",
    # 鼻音尾
    "ng": "C",
}

# Common Chinese characters mapped to their approximate initial consonant
_INITIAL_CONSONANTS: dict[str, str] = {
    "b": "b", "p": "p", "m": "m", "f": "f",
    "d": "d", "t": "t", "n": "n", "l": "l",
    "g": "g", "k": "k", "h": "h",
    "j": "j", "q": "q", "x": "x",
    "zh": "zh", "ch": "ch", "sh": "sh", "r": "r",
    "z": "z", "c": "c", "s": "s",
    "y": "i", "w": "u",
}


def _char_to_viseme(ch: str) -> str:
    """Return the best-guess viseme ID for a single Chinese character.

    Uses the character's pinyin initial consonant if known, otherwise
    defaults to a neutral mouth shape ("A").
    """
    if not ch or ch.isspace():
        return "X"  # silence / rest

    # Try to get the rough pinyin initial from a small lookup
    unicode_val = ord(ch)
    initial = _unicode_to_pinyin_initial(unicode_val)
    if initial and initial in _VISEME_MAP:
        return _VISEME_MAP[initial]

    # Common finals
    if _is_vowel_like(unicode_val):
        return "A"
    if _is_consonant_like(unicode_val):
        return "D"
    # Punctuation / numbers → rest
    if ch in "，。！？、；：""''（）【】《》—…·,.!?;:()[]{}":
        return "X"
    return "A"


def _unicode_to_pinyin_initial(code: int) -> str | None:
    """Heuristic: a limited set of common Chinese chars → pinyin initial."""
    # This is a very rough mapping for demonstration.
    # A real implementation would use pypinyin or a dictionary.
    # For now we return None and let the general vowel/consonant logic apply.
    return None


def _is_vowel_like(code: int) -> bool:
    """Rough check: is this CJK character likely vowel-initial?"""
    # Very approximate — real logic requires pinyin database
    return False


def _is_consonant_like(code: int) -> bool:
    """Rough check: is this CJK character likely consonant-initial?"""
    return True  # default most CJK chars have initial consonants


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_tts_provider(kind: str = "edge-tts") -> TtsProvider:
    """Return a TTS provider by name.

    Supported values: ``"edge-tts"`` (default), ``"silence"``.
    Falls back to *silence* when *edge-tts* is unavailable.
    """
    kind = kind.strip().lower()
    if kind == "silence":
        return SilenceProvider()
    if kind in {"edge-tts", "edge_tts", "edge"}:
        try:
            return EdgeTtsProvider()
        except Exception:
            return SilenceProvider()
    return SilenceProvider()