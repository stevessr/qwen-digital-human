"""Viseme / lip-sync parameter extractor from audio.

Analyzes raw PCM or WAV audio and produces a sequence of VisemeFrame
values suitable for driving a MetaHuman face rig.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass

from .audio import samples_from_audio

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

# Standard Oculus-style viseme set (13 visemes)
VISEME_A = "A"  # aa, ae, ah  — wide open
VISEME_B = "B"  # b, p, m     — lips closed
VISEME_C = "C"  # ch, j, sh   — teeth together, lip corners back
VISEME_D = "D"  # d, t, n, l  — tongue up, mouth slightly open
VISEME_E = "E"  # e           — smile
VISEME_F = "F"  # f, v        — upper teeth on lower lip
VISEME_G = "G"  # g, k, h     — back of tongue up
VISEME_H = "H"  # h           — mouth open, breathy
VISEME_I = "I"  # i           — teeth together, lips spread
VISEME_O = "O"  # o           — rounded
VISEME_U = "U"  # u           — pursed
VISEME_W = "W"  # w           — lips rounded
VISEME_X = "X"  # silence/rest — closed mouth

# Viseme → articulator parameters
_VISEME_PARAMS: dict[str, dict[str, float]] = {
    VISEME_A: {"mouth_open": 0.85, "jaw_open": 0.90, "lip_round": 0.0, "smile": 0.0},
    VISEME_B: {"mouth_open": 0.0, "jaw_open": 0.0, "lip_round": 0.0, "smile": -0.1},
    VISEME_C: {"mouth_open": 0.25, "jaw_open": 0.30, "lip_round": 0.0, "smile": 0.30},
    VISEME_D: {"mouth_open": 0.35, "jaw_open": 0.40, "lip_round": 0.0, "smile": 0.0},
    VISEME_E: {"mouth_open": 0.15, "jaw_open": 0.20, "lip_round": 0.0, "smile": 0.80},
    VISEME_F: {"mouth_open": 0.10, "jaw_open": 0.15, "lip_round": 0.0, "smile": -0.2},
    VISEME_G: {"mouth_open": 0.40, "jaw_open": 0.45, "lip_round": 0.0, "smile": 0.10},
    VISEME_H: {"mouth_open": 0.70, "jaw_open": 0.75, "lip_round": 0.0, "smile": 0.0},
    VISEME_I: {"mouth_open": 0.15, "jaw_open": 0.20, "lip_round": 0.0, "smile": 0.60},
    VISEME_O: {"mouth_open": 0.50, "jaw_open": 0.55, "lip_round": 1.0, "smile": -0.3},
    VISEME_U: {"mouth_open": 0.10, "jaw_open": 0.15, "lip_round": 0.80, "smile": -0.4},
    VISEME_W: {"mouth_open": 0.10, "jaw_open": 0.15, "lip_round": 0.90, "smile": -0.3},
    VISEME_X: {"mouth_open": 0.0, "jaw_open": 0.0, "lip_round": 0.0, "smile": 0.0},
}


@dataclass(slots=True)
class VisemeFrame:
    """Single frame of articulator parameters, aligned to a timestamp."""

    timestamp_ms: float
    mouth_open: float = 0.0
    jaw_open: float = 0.0
    lip_round: float = 0.0
    smile: float = 0.0
    viseme_id: str = VISEME_X
    tongue_visible: bool = False
    blink: float = 0.0
    energy: float = 0.0  # raw RMS energy for this frame


# ---------------------------------------------------------------------------
# RMS-based viseme extraction
# ---------------------------------------------------------------------------


def extract_visemes(
    audio_bytes: bytes,
    sample_rate: int = 24_000,
    frame_ms: float = 40.0,
    smooth_window: int = 3,
) -> list[VisemeFrame]:
    """Extract a sequence of VisemeFrame from raw PCM or WAV audio.

    Args:
        audio_bytes: Raw PCM16LE mono or WAV bytes.
        sample_rate: Sample rate of the audio (used only for raw PCM).
        frame_ms: Analysis window duration in milliseconds.
        smooth_window: Number of frames for temporal smoothing.

    Returns:
        List of VisemeFrame sorted by timestamp.
    """
    samples = samples_from_audio(audio_bytes)
    if not samples:
        return []

    # Determine actual sample rate from WAV header if possible
    actual_rate = _detect_sample_rate(audio_bytes) or sample_rate

    frame_samples = max(1, int(actual_rate * frame_ms / 1000.0))
    num_frames = max(1, len(samples) // frame_samples)

    # Step 1: per-frame energy analysis
    raw_frames: list[VisemeFrame] = []
    for i in range(num_frames):
        start = i * frame_samples
        end = min(len(samples), start + frame_samples)
        chunk = samples[start:end]
        if not chunk:
            continue

        energy = _rms(chunk)
        zcr = _zero_crossing_rate(chunk)
        spectral_tilt = _spectral_tilt_approx(chunk)

        # Heuristic viseme classification from acoustic features
        viseme_id, params = _classify_viseme(energy, zcr, spectral_tilt, chunk)

        timestamp_ms = (i * frame_samples) / actual_rate * 1000.0

        raw_frames.append(
            VisemeFrame(
                timestamp_ms=timestamp_ms,
                mouth_open=params["mouth_open"],
                jaw_open=params["jaw_open"],
                lip_round=params["lip_round"],
                smile=params["smile"],
                viseme_id=viseme_id,
                tongue_visible=viseme_id in (VISEME_D, VISEME_G, VISEME_C),
                energy=energy,
            )
        )

    if not raw_frames:
        return []

    # Step 2: temporal smoothing
    smoothed = _smooth_frames(raw_frames, smooth_window)

    # Step 3: add automatic blinks (every 4-6 seconds)
    blink_interval_ms = 4500.0
    blink_duration_ms = 150.0
    blink_frames = _generate_blinks(smoothed, blink_interval_ms, blink_duration_ms)

    # Merge blinks into frames
    blink_map = {int(bf.timestamp_ms): bf for bf in blink_frames}
    for frame in smoothed:
        key = int(frame.timestamp_ms)
        if key in blink_map:
            frame.blink = blink_map[key].blink

    return smoothed


# ---------------------------------------------------------------------------
# Acoustic analysis helpers
# ---------------------------------------------------------------------------


def _rms(samples: list[float]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def _zero_crossing_rate(samples: list[float]) -> float:
    if len(samples) < 2:
        return 0.0
    crossings = 0
    prev = samples[0]
    for curr in samples[1:]:
        if (prev >= 0 > curr) or (prev < 0 <= curr):
            crossings += 1
        prev = curr
    return crossings / (len(samples) - 1)


def _spectral_tilt_approx(samples: list[float]) -> float:
    """Rough spectral tilt estimate via adjacent-sample correlation.

    Positive = more low-frequency energy (softer sounds).
    Negative = more high-frequency energy (fricatives).
    """
    if len(samples) < 3:
        return 0.0
    n = len(samples) - 1
    correlation = sum(samples[i] * samples[i + 1] for i in range(n))
    denom = sum(s * s for s in samples) + 1e-8
    return correlation / denom


# ---------------------------------------------------------------------------
# Viseme classification
# ---------------------------------------------------------------------------

# Energy thresholds (normalized 0-1)
_SILENCE_THRESHOLD = 0.015
_LOW_ENERGY = 0.06
_MED_ENERGY = 0.18
_HIGH_ENERGY = 0.45


def _classify_viseme(
    energy: float,
    zcr: float,
    spectral_tilt: float,
    chunk: list[float],
) -> tuple[str, dict[str, float]]:
    """Classify a single audio frame into a viseme + articulator params."""
    if energy < _SILENCE_THRESHOLD:
        return VISEME_X, dict(_VISEME_PARAMS[VISEME_X])

    # High ZCR + negative tilt → fricative/unvoiced (F, H, C)
    if zcr > 0.25 and spectral_tilt < 0.2:
        if energy < _MED_ENERGY:
            return VISEME_F, dict(_VISEME_PARAMS[VISEME_F])
        return VISEME_H, dict(_VISEME_PARAMS[VISEME_H])

    # Low ZCR + high energy → vowel-like open sounds (A, O, E)
    if zcr < 0.12:
        if energy > _HIGH_ENERGY:
            # Full open
            mouth_open = min(1.0, energy * 2.0)
            smile = _estimate_smile_from_waveform(chunk)
            params = dict(_VISEME_PARAMS[VISEME_A])
            params["mouth_open"] = mouth_open
            params["jaw_open"] = mouth_open * 1.05
            params["smile"] = smile
            return VISEME_A, params
        if energy > _MED_ENERGY:
            # Mid open — could be rounded (O) or spread (E)
            smile = _estimate_smile_from_waveform(chunk)
            if smile > 0.3:
                return VISEME_E, dict(_VISEME_PARAMS[VISEME_E])
            # Check for rounded quality via spectral shape
            if spectral_tilt > 0.6:
                # Energized low-freq → rounded
                params = dict(_VISEME_PARAMS[VISEME_O])
                params["mouth_open"] = min(1.0, energy * 1.5)
                params["jaw_open"] = min(1.0, energy * 1.6)
                return VISEME_O, params
            return VISEME_D, dict(_VISEME_PARAMS[VISEME_D])
        # Low-mid energy
        return VISEME_D, dict(_VISEME_PARAMS[VISEME_D])

    # Medium ZCR → consonant-like (B, D, G)
    if energy < _LOW_ENERGY:
        # Devoiced/stop
        return VISEME_B, dict(_VISEME_PARAMS[VISEME_B])

    pulse = _detect_pulse(chunk)
    if pulse > 0.3:
        # Plosive release → C-like
        return VISEME_C, dict(_VISEME_PARAMS[VISEME_C])

    # Default mid-range
    return VISEME_D, dict(_VISEME_PARAMS[VISEME_D])


def _estimate_smile_from_waveform(samples: list[float]) -> float:
    """Rough smile estimation from waveform symmetry."""
    if len(samples) < 4:
        return 0.0
    positive = sum(s for s in samples if s > 0)
    negative = abs(sum(s for s in samples if s < 0))
    total = positive + negative
    if total < 1e-8:
        return 0.0
    asymmetry = abs(positive - negative) / total
    # More asymmetry → less smile-like
    return max(0.0, 1.0 - asymmetry * 2.0)


def _detect_pulse(samples: list[float]) -> float:
    """Detect a sharp transient (plosive burst) in the frame."""
    if len(samples) < 4:
        return 0.0
    diffs = [abs(samples[i + 1] - samples[i]) for i in range(len(samples) - 1)]
    max_diff = max(diffs)
    avg_diff = sum(diffs) / len(diffs)
    return max_diff / (avg_diff + 1e-8) if avg_diff > 1e-8 else 0.0


# ---------------------------------------------------------------------------
# Temporal smoothing & blink generation
# ---------------------------------------------------------------------------


def _smooth_frames(frames: list[VisemeFrame], window: int = 3) -> list[VisemeFrame]:
    """Apply moving-average smoothing to articulator parameters."""
    if not frames or window < 2:
        return frames

    smoothed: list[VisemeFrame] = []
    n = len(frames)

    for i in range(n):
        lo = max(0, i - window // 2)
        hi = min(n, i + window // 2 + 1)
        neighborhood = frames[lo:hi]

        avg_mouth = sum(f.mouth_open for f in neighborhood) / len(neighborhood)
        avg_jaw = sum(f.jaw_open for f in neighborhood) / len(neighborhood)
        avg_lip = sum(f.lip_round for f in neighborhood) / len(neighborhood)
        avg_smile = sum(f.smile for f in neighborhood) / len(neighborhood)

        # Pick the viseme ID of the frame with highest energy in the window
        dominant = max(neighborhood, key=lambda f: f.energy)

        smoothed.append(
            VisemeFrame(
                timestamp_ms=frames[i].timestamp_ms,
                mouth_open=avg_mouth,
                jaw_open=avg_jaw,
                lip_round=avg_lip,
                smile=avg_smile,
                viseme_id=dominant.viseme_id,
                tongue_visible=dominant.tongue_visible,
                energy=frames[i].energy,
            )
        )

    return smoothed


def _generate_blinks(
    frames: list[VisemeFrame],
    interval_ms: float = 4500.0,
    duration_ms: float = 150.0,
) -> list[VisemeFrame]:
    """Generate blink frames at regular intervals for natural appearance."""
    if not frames:
        return []

    blinks: list[VisemeFrame] = []
    total_ms = frames[-1].timestamp_ms + (frames[-1].timestamp_ms - frames[0].timestamp_ms if len(frames) > 1 else 100.0)
    sample_rate_ms = 1000.0 / 25  # ~40ms per frame

    blink_time = interval_ms
    while blink_time < total_ms:
        # Eyelid closure over ~75ms
        for t in range(0, int(duration_ms * 2), int(sample_rate_ms)):
            frac = t / duration_ms  # 0→1→0
            blink_value = frac if frac < 1.0 else 2.0 - frac
            blink_value = max(0.0, min(1.0, blink_value))
            blinks.append(
                VisemeFrame(
                    timestamp_ms=blink_time + t,
                    blink=blink_value,
                )
            )
        blink_time += interval_ms + duration_ms

    return blinks


# ---------------------------------------------------------------------------
# WAV header parsing
# ---------------------------------------------------------------------------


def _detect_sample_rate(audio_bytes: bytes) -> int | None:
    """Try to determine sample rate from WAV header."""
    if not audio_bytes or len(audio_bytes) < 44:
        return None
    if audio_bytes[:4] != b"RIFF":
        return None
    try:
        sample_rate = struct.unpack_from("<I", audio_bytes, 24)[0]
        return sample_rate if 8000 <= sample_rate <= 192_000 else None
    except struct.error:
        return None


# ---------------------------------------------------------------------------
# Merging viseme sequences with expression data
# ---------------------------------------------------------------------------


def merge_viseme_into_expression(
    viseme_frames: list[VisemeFrame],
    mouth_open: float = 0.0,
    smile: float = 0.0,
    blink: float = 0.0,
) -> list[dict]:
    """Convert VisemeFrame list to serializable expression dicts.

    Each dict is suitable for sending to UE5 as a WebSocket message.
    """
    result: list[dict] = []
    for frame in viseme_frames:
        result.append(
            {
                "timestamp_ms": frame.timestamp_ms,
                "mouth_open": max(mouth_open, frame.mouth_open),
                "jaw_open": frame.jaw_open,
                "lip_round": frame.lip_round,
                "smile": max(smile, frame.smile),
                "blink": max(blink, frame.blink),
                "viseme_id": frame.viseme_id,
                "tongue_visible": frame.tongue_visible,
            }
        )
    return result