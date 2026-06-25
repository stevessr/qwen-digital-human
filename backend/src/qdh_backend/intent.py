"""Semantic intent detection for LLM replies — drives UE5 digital human animations.

Analyzes the LLM's reply text to detect emotional/gestural intents and maps
them to animation presets that the UE5 MetaHuman face rig can execute.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Animation preset data model
# ---------------------------------------------------------------------------

# Standard expression parameters sent to UE5
@dataclass(slots=True)
class ExpressionKeyframe:
    """A single keyframe in an animation sequence."""

    time_ms: float = 0.0  # offset from animation start (ms)
    duration_ms: float = 500.0  # how long to hold this keyframe
    mouth_open: float = 0.0
    jaw_open: float = 0.0
    lip_round: float = 0.0
    smile: float = 0.0
    head_yaw: float = 0.0
    head_pitch: float = 0.0
    head_roll: float = 0.0
    blink: float = 0.0
    emotion: str = "neutral"


@dataclass(slots=True)
class AnimationPreset:
    """A named animation preset composed of sequential expression keyframes."""

    name: str
    label: str = ""
    keyframes: list[ExpressionKeyframe] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Animation presets
# ---------------------------------------------------------------------------

ANIMATION_PRESETS: dict[str, AnimationPreset] = {
    "happy": AnimationPreset(
        name="happy",
        label="开心",
        keyframes=[
            ExpressionKeyframe(0, 1500, 0.25, 0.22, 0.0, 0.80, 0.0, 0.0, 0.0, 0.0, "happy"),
            ExpressionKeyframe(200, 600, 0.28, 0.25, 0.0, 0.72, 0.04, -0.06, 0.0, 0.0, "happy"),
        ],
    ),
    "thinking": AnimationPreset(
        name="thinking",
        label="思考",
        keyframes=[
            ExpressionKeyframe(0, 2000, 0.08, 0.10, 0.0, 0.15, 0.16, 0.22, 0.0, 0.12, "neutral"),
            ExpressionKeyframe(800, 400, 0.12, 0.15, 0.0, 0.10, 0.12, 0.28, 0.0, 0.08, "neutral"),
        ],
    ),
    "surprised": AnimationPreset(
        name="surprised",
        label="惊讶",
        keyframes=[
            ExpressionKeyframe(0, 500, 0.65, 0.70, 0.0, 0.08, 0.0, -0.12, 0.0, 0.0, "surprised"),
            ExpressionKeyframe(500, 500, 0.20, 0.22, 0.0, 0.15, 0.0, 0.0, 0.0, 0.0, "neutral"),
        ],
    ),
    "sad": AnimationPreset(
        name="sad",
        label="难过",
        keyframes=[
            ExpressionKeyframe(0, 1800, 0.10, 0.12, 0.0, -0.45, 0.0, 0.08, 0.04, 0.18, "sad"),
            ExpressionKeyframe(600, 800, 0.08, 0.10, 0.0, -0.38, -0.06, 0.12, 0.0, 0.15, "sad"),
        ],
    ),
    "angry": AnimationPreset(
        name="angry",
        label="生气",
        keyframes=[
            ExpressionKeyframe(0, 1500, 0.20, 0.25, 0.08, -0.74, 0.0, 0.0, 0.0, 0.08, "angry"),
            ExpressionKeyframe(300, 500, 0.15, 0.18, 0.12, -0.70, 0.04, -0.04, 0.0, 0.10, "angry"),
        ],
    ),
    "greet": AnimationPreset(
        name="greet",
        label="打招呼",
        keyframes=[
            ExpressionKeyframe(0, 2000, 0.18, 0.20, 0.0, 0.60, 0.0, 0.0, 0.0, 0.0, "happy"),
            ExpressionKeyframe(150, 350, 0.16, 0.18, 0.0, 0.55, 0.08, 0.0, 0.0, 0.0, "happy"),
            ExpressionKeyframe(500, 350, 0.20, 0.22, 0.0, 0.62, -0.06, 0.0, 0.0, 0.0, "happy"),
        ],
    ),
    "nod": AnimationPreset(
        name="nod",
        label="确认/点头",
        keyframes=[
            ExpressionKeyframe(0, 800, 0.08, 0.10, 0.0, 0.50, 0.0, 0.18, 0.0, 0.0, "neutral"),
            ExpressionKeyframe(200, 350, 0.10, 0.12, 0.0, 0.52, 0.0, 0.06, 0.0, 0.0, "neutral"),
            ExpressionKeyframe(550, 350, 0.10, 0.12, 0.0, 0.48, 0.0, 0.20, 0.0, 0.0, "neutral"),
        ],
    ),
    "idle_neutral": AnimationPreset(
        name="idle_neutral",
        label="待机中性",
        keyframes=[
            ExpressionKeyframe(0, 3000, 0.04, 0.04, 0.0, 0.08, 0.0, 0.0, 0.0, 0.0, "neutral"),
        ],
    ),
}

# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------

# Emotion keywords → animation name, weighted by strength
_EMOTION_PATTERNS: list[tuple[re.Pattern, str, int]] = [
    # Happy / positive (highest priority)
    (re.compile(r"(?:太|真|好)(?:棒了|开心|高兴|快乐|赞)"), "happy", 3),
    (re.compile(r"开心|高兴|快乐|好耶|太棒了|真棒|太好了|喜欢|鼓励"), "happy", 2),
    (re.compile(r"谢谢|感谢|谢谢你|非常感谢"), "happy", 2),
    (re.compile(r"(?:smile|happy|cheerful|great|awesome|wonderful|amazing)"), "happy", 1),

    # Thinking / reasoning
    (re.compile(r"让我想想|让我思考|考虑一下|分析.*一下|推理"), "thinking", 3),
    (re.compile(r"思考|考虑|想想|嗯.*让我|think|thinking|ponder"), "thinking", 2),
    (re.compile(r"(?:嗯|呃|emmm)"), "thinking", 1),

    # Surprised
    (re.compile(r"哇|诶.*真的|天啊|好神奇|居然|竟然"), "surprised", 2),
    (re.compile(r"惊讶|震惊|真的吗|wow|surpris"), "surprised", 2),

    # Sad / apologetic
    (re.compile(r"抱歉|不好意思|对不起|很遗憾|遗憾|可惜"), "sad", 2),
    (re.compile(r"难过|伤心|糟糕|sad|sorry|disappointed|unfortunately"), "sad", 2),

    # Angry
    (re.compile(r"生气|愤怒|气死|烦死|讨厌"), "angry", 2),
    (re.compile(r"angry|mad|annoyed|frustrated"), "angry", 2),
]

_GESTURE_PATTERNS: list[tuple[re.Pattern, str, int]] = [
    (re.compile(r"你好|欢迎|hello|hi|早上好|晚上好|大家好"), "greet", 2),
    (re.compile(r"你好啊|嗨|hey"), "greet", 1),
    (re.compile(r"好的|没问题|明白|收到|ok|okay|got it|roger|确认|是的|对的"), "nod", 2),
    (re.compile(r"点头|确认|同意|赞同|没错|当然"), "nod", 2),
    (re.compile(r"正是|没错|当然|肯定"), "nod", 1),
]


def detect_intent(text: str) -> str | None:
    """Detect the strongest animation intent from LLM reply text.

    Returns the animation preset name (e.g., ``"happy"``, ``"thinking"``)
    or ``None`` for neutral response.
    """
    if not text or not text.strip():
        return None

    compact = text.strip()
    lower = compact.lower()

    # Check emotion patterns (higher weight wins)
    best_emotion: str | None = None
    best_emotion_weight = 0
    for pat, anim, weight in _EMOTION_PATTERNS:
        if (pat.search(compact) or pat.search(lower)) and weight > best_emotion_weight:
            best_emotion = anim
            best_emotion_weight = weight

    # Check gesture patterns (if no strong emotion detected)
    best_gesture: str | None = None
    best_gesture_weight = 0
    for pat, anim, weight in _GESTURE_PATTERNS:
        if (pat.search(compact) or pat.search(lower)) and weight > best_gesture_weight:
            best_gesture = anim
            best_gesture_weight = weight

    # Emotion takes priority over gesture
    if best_emotion and best_emotion_weight >= 2:
        return best_emotion
    if best_gesture and best_gesture_weight >= 2:
        return best_gesture
    if best_emotion:
        return best_emotion
    if best_gesture:
        return best_gesture

    return None


def get_animation_for_intent(intent_name: str | None) -> AnimationPreset | None:
    """Return the AnimationPreset for a detected intent name.

    Returns ``None`` when *intent_name* is ``None`` or unknown.
    """
    if not intent_name:
        return None
    return ANIMATION_PRESETS.get(intent_name)


def get_animation_duration(preset: AnimationPreset) -> float:
    """Return the total duration of an animation preset in milliseconds."""
    if not preset.keyframes:
        return 0.0
    max_end = 0.0
    for kf in preset.keyframes:
        max_end = max(max_end, kf.time_ms + kf.duration_ms)
    return max_end
