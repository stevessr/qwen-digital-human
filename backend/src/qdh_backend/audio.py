from __future__ import annotations

import io
import math
import wave

LOCAL_SAMPLE_RATE = 24_000


def pcm16le_silence(duration_seconds: float, sample_rate: int = LOCAL_SAMPLE_RATE) -> bytes:
    sample_count = max(0, int(duration_seconds * sample_rate))
    return b"\x00\x00" * sample_count


def wav_from_pcm16le(pcm16le: bytes, sample_rate: int = LOCAL_SAMPLE_RATE) -> bytes:
    if not pcm16le:
        return b""
    with io.BytesIO() as buffer:
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(pcm16le)
        return buffer.getvalue()


def synthesize_silence(text: str, sample_rate: int = LOCAL_SAMPLE_RATE) -> tuple[bytes, bytes, int]:
    if not text.strip():
        return b"", b"", sample_rate
    duration = min(4.0, max(0.35, len(text.strip()) / 12.0))
    pcm = pcm16le_silence(duration, sample_rate)
    return pcm, wav_from_pcm16le(pcm, sample_rate), sample_rate


def _samples_from_wav(audio_bytes: bytes) -> tuple[list[float], int]:
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frames = wav.readframes(wav.getnframes())
    except (EOFError, wave.Error):
        return [], LOCAL_SAMPLE_RATE

    if not frames or sample_width != 2:
        return [], sample_rate
    return _samples_from_pcm16le(frames, channels=max(1, channels)), sample_rate


def _samples_from_pcm16le(pcm16le: bytes, channels: int = 1) -> list[float]:
    frame_width = max(1, channels) * 2
    usable = len(pcm16le) - (len(pcm16le) % frame_width)
    if usable <= 0:
        return []
    samples: list[float] = []
    for frame_offset in range(0, usable, frame_width):
        total = 0.0
        for channel in range(channels):
            offset = frame_offset + channel * 2
            value = int.from_bytes(pcm16le[offset : offset + 2], "little", signed=True)
            total += value / 32768.0
        samples.append(max(-1.0, min(1.0, total / channels)))
    return samples


def samples_from_audio(audio_bytes: bytes) -> list[float]:
    if not audio_bytes:
        return []
    if audio_bytes[:4] == b"RIFF":
        samples, _ = _samples_from_wav(audio_bytes)
        return samples
    return _samples_from_pcm16le(audio_bytes)


def extract_waveform(audio_bytes: bytes, points: int = 128) -> list[float]:
    if points <= 0:
        return []
    samples = samples_from_audio(audio_bytes)
    if not samples:
        return [0.0] * points

    bucket_size = max(1, math.ceil(len(samples) / points))
    waveform: list[float] = []
    for index in range(points):
        start = index * bucket_size
        end = min(len(samples), start + bucket_size)
        if start >= end:
            waveform.append(0.0)
        else:
            waveform.append(min(1.0, max(abs(value) for value in samples[start:end])))

    peak = max(waveform, default=0.0)
    if peak > 0.01:
        waveform = [value / peak for value in waveform]
    return waveform


def rms(samples: list[float]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(value * value for value in samples) / len(samples))


def zero_crossing_rate(samples: list[float]) -> float:
    if len(samples) < 2:
        return 0.0
    crossings = 0
    previous = samples[0]
    for current in samples[1:]:
        if (previous >= 0 > current) or (previous < 0 <= current):
            crossings += 1
        previous = current
    return crossings / (len(samples) - 1)
