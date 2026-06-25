// ============================================================
// Qwen Digital Human — Online 3D Avatar + Visualizer
// ============================================================

let avatarState = {
    expression: { mouth_open: 0.0, smile: 0.0, blink: 0.0 },
    posture: { head_pitch: 0.0, head_yaw: 0.0, head_roll: 0.0 },
    faceTracking: {
        enabled: false,
        autoStart: true,
        cameraActive: false,
        calibrated: false,
        active: false,
        confidence: 0,
        pose: { head_pitch: 0.0, head_yaw: 0.0, head_roll: 0.0 },
        calibration: null,
        lastFace: null,
        lastSeenAt: 0,
        signals: { eye_open: 1.0, left_eye_open: 1.0, right_eye_open: 1.0, mouth_open: 0.0, smile: 0.0, blink: 0.0, roll: 0.0, confidence: 0.0 },
        blend: 0.85,
        mirror: true,
    },
    waveform: new Array(128).fill(0),
    startTime: performance.now(),
    persona: 'guide',
};
let waveformLoopStarted = false;
const AVATAR_FLOAT_POSITION_STORAGE_KEY = 'qdh.avatarFloatPosition';
const AVATAR_FLOAT_DEFAULT_POSITION = { left: 18, top: 18 };
let avatarFloatDragState = null;

function loadAvatarFloatPosition() {
    const fallback = { ...AVATAR_FLOAT_DEFAULT_POSITION };
    const raw = localStorage.getItem(AVATAR_FLOAT_POSITION_STORAGE_KEY);
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw);
        const left = Number(parsed.left);
        const top = Number(parsed.top);
        return {
            left: Number.isFinite(left) ? left : fallback.left,
            top: Number.isFinite(top) ? top : fallback.top,
        };
    } catch {
        return fallback;
    }
}

function persistAvatarFloatPosition(position) {
    localStorage.setItem(AVATAR_FLOAT_POSITION_STORAGE_KEY, JSON.stringify({
        left: Math.round(position.left),
        top: Math.round(position.top),
    }));
}

function clampAvatarFloatPosition(left, top, stage) {
    const leftPane = document.getElementById('left-pane');
    const bounds = leftPane?.getBoundingClientRect();
    const rect = stage?.getBoundingClientRect();
    if (!bounds || !rect) {
        return {
            left: Math.max(8, left),
            top: Math.max(8, top),
        };
    }

    const maxLeft = Math.max(8, bounds.width - rect.width - 8);
    const maxTop = Math.max(8, bounds.height - rect.height - 8);
    return {
        left: clampNumber(left, 8, maxLeft, AVATAR_FLOAT_DEFAULT_POSITION.left),
        top: clampNumber(top, 8, maxTop, AVATAR_FLOAT_DEFAULT_POSITION.top),
    };
}

function applyAvatarFloatPosition(stage = document.getElementById('avatar-stage')) {
    if (!stage) return;
    const position = clampAvatarFloatPosition(
        loadAvatarFloatPosition().left,
        loadAvatarFloatPosition().top,
        stage
    );
    stage.style.left = `${Math.round(position.left)}px`;
    stage.style.top = `${Math.round(position.top)}px`;
}

function initAvatarFloatDrag() {
    const stage = document.getElementById('avatar-stage');
    if (!stage) return;

    const onPointerMove = (event) => {
        if (!avatarFloatDragState || event.pointerId !== avatarFloatDragState.pointerId) return;
        event.preventDefault();
        const nextLeft = avatarFloatDragState.startLeft + (event.clientX - avatarFloatDragState.startX);
        const nextTop = avatarFloatDragState.startTop + (event.clientY - avatarFloatDragState.startY);
        const clamped = clampAvatarFloatPosition(nextLeft, nextTop, stage);
        stage.style.left = `${Math.round(clamped.left)}px`;
        stage.style.top = `${Math.round(clamped.top)}px`;
    };

    const endDrag = (event) => {
        if (!avatarFloatDragState || event.pointerId !== avatarFloatDragState.pointerId) return;
        const left = Number.parseFloat(stage.style.left) || stage.offsetLeft || AVATAR_FLOAT_DEFAULT_POSITION.left;
        const top = Number.parseFloat(stage.style.top) || stage.offsetTop || AVATAR_FLOAT_DEFAULT_POSITION.top;
        persistAvatarFloatPosition(clampAvatarFloatPosition(left, top, stage));
        avatarFloatDragState = null;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', endDrag);
        document.removeEventListener('pointercancel', endDrag);
        stage.classList.remove('dragging');
    };

    stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const rect = stage.getBoundingClientRect();
        avatarFloatDragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: stage.offsetLeft || rect.left,
            startTop: stage.offsetTop || rect.top,
        };
        stage.classList.add('dragging');
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('pointercancel', endDrag);
    });

    window.addEventListener('resize', () => {
        applyAvatarFloatPosition(stage);
    });
}

// Exported for external updates (from pipeline responses)
window.updateAvatarState = function(newState) {
    if (newState.expression) avatarState.expression = newState.expression;
    if (newState.posture) avatarState.posture = newState.posture;
    if (newState.faceTracking) {
        avatarState.faceTracking = {
            ...avatarState.faceTracking,
            ...newState.faceTracking,
            pose: {
                ...(avatarState.faceTracking.pose || {}),
                ...(newState.faceTracking.pose || {}),
            },
            signals: {
                ...(avatarState.faceTracking.signals || {}),
                ...(newState.faceTracking.signals || {}),
            },
            calibration: newState.faceTracking.calibration ?? avatarState.faceTracking.calibration,
            lastFace: newState.faceTracking.lastFace ?? avatarState.faceTracking.lastFace,
        };
    }
    if (newState.waveform) avatarState.waveform = newState.waveform;
    refreshAvatarRendererState();
};

const ASSISTANT_LABEL = '地图数字人';
const DEFAULT_SYSTEM_PROMPT = '你是地图数字人讲解员，专注介绍地点、地标、路线、周边设施和到达方式。请优先用中文回答，语气自然、清晰、简洁；如果上下文提供了地图信息，请优先围绕当前地点讲解。';
const DEFAULT_MEMORY = '你是地图讲解型数字人。回答时优先说明地点位置、周边地标、交通方式、适合人群与游览建议，并保持解释简洁自然。';
const DEFAULT_RERANK_CANDIDATE_POOL = 8;
const DEFAULT_RERANK_SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_RERANK_TOP_K = 3;
const DEFAULT_RERANK_INSTRUCTION = 'Given a web search query, retrieve relevant passages that answer the query';
const PROMPT_STORAGE_KEYS = {
    systemPrompt: 'qdh.systemPrompt',
    memory: 'qdh.memory',
    context: 'qdh.context',
    useRagContext: 'qdh.useRagContext',
    ttsMode: 'qdh.ttsMode',
    browserAsrMode: 'qdh.browserAsrMode',
    browserTtsMode: 'qdh.browserTtsMode',
    collapseThink: 'qdh.collapseThink',
    rerankCandidatePool: 'qdh.rerankCandidatePool',
    rerankSimilarityThreshold: 'qdh.rerankSimilarityThreshold',
    rerankTopK: 'qdh.rerankTopK',
    rerankInstruction: 'qdh.rerankInstruction',
};

function sanitizeAssistantText(text, collapseThink = true) {
    if (!collapseThink) return text;
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '');
}

function concatUint8Arrays(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

function float32ToPcm16Bytes(samples) {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i] || 0));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return bytes;
}

function resampleLinearFloat32(samples, inputSampleRate, outputSampleRate) {
    if (
        !samples ||
        samples.length === 0 ||
        !Number.isFinite(inputSampleRate) ||
        !Number.isFinite(outputSampleRate) ||
        inputSampleRate <= 0 ||
        outputSampleRate <= 0 ||
        inputSampleRate === outputSampleRate
    ) {
        return samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    }

    const ratio = outputSampleRate / inputSampleRate;
    const outputLength = Math.max(1, Math.round(samples.length * ratio));
    const resampled = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
        const sourcePosition = i / ratio;
        const left = Math.floor(sourcePosition);
        const frac = sourcePosition - left;
        const s0 = samples[Math.min(left, samples.length - 1)] ?? 0;
        const s1 = samples[Math.min(left + 1, samples.length - 1)] ?? s0;
        resampled[i] = s0 + (s1 - s0) * frac;
    }

    return resampled;
}

function pcm16leBytesToFloat32(bytes) {
    const sampleCount = Math.floor((bytes?.length || 0) / 2);
    if (sampleCount === 0) return new Float32Array(0);

    const samples = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
        samples[i] = view.getInt16(i * 2, true) / 32768;
    }
    return samples;
}

function mixBufferToMono(inputBuffer) {
    const channels = inputBuffer.numberOfChannels;
    const frameCount = inputBuffer.length;
    if (frameCount === 0) return new Float32Array(0);

    const mono = new Float32Array(frameCount);
    for (let ch = 0; ch < channels; ch++) {
        const channelData = inputBuffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
            mono[i] += channelData[i];
        }
    }

    if (channels > 1) {
        for (let i = 0; i < frameCount; i++) {
            mono[i] /= channels;
        }
    }

    return mono;
}

function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

async function waitForCanvasReady(canvas, minSize = 8, maxFrames = 120) {
    for (let i = 0; i < maxFrames; i++) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width >= minSize && rect.height >= minSize) {
            return rect;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return canvas.getBoundingClientRect();
}

function lerpNumber(from, to, amount) {
    const t = clampNumber(amount, 0, 1, 0);
    return from + (to - from) * t;
}

function rectArea(rect) {
    if (!rect) return 0;
    return Math.max(0, rect.width || 0) * Math.max(0, rect.height || 0);
}

function rectCenter(rect) {
    return {
        x: (rect.x || 0) + Math.max(0, rect.width || 0) / 2,
        y: (rect.y || 0) + Math.max(0, rect.height || 0) / 2,
    };
}

function rectIoU(a, b) {
    if (!a || !b) return 0;
    const ax1 = a.x || 0;
    const ay1 = a.y || 0;
    const ax2 = ax1 + Math.max(0, a.width || 0);
    const ay2 = ay1 + Math.max(0, a.height || 0);
    const bx1 = b.x || 0;
    const by1 = b.y || 0;
    const bx2 = bx1 + Math.max(0, b.width || 0);
    const by2 = by1 + Math.max(0, b.height || 0);
    const ix1 = Math.max(ax1, bx1);
    const iy1 = Math.max(ay1, by1);
    const ix2 = Math.min(ax2, bx2);
    const iy2 = Math.min(ay2, by2);
    const interWidth = Math.max(0, ix2 - ix1);
    const interHeight = Math.max(0, iy2 - iy1);
    const interArea = interWidth * interHeight;
    const unionArea = rectArea(a) + rectArea(b) - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
}

function dedupeRectangles(rects, overlapThreshold = 0.35) {
    const selected = [];
    const sorted = [...rects].sort((left, right) => rectArea(right) - rectArea(left));
    for (const rect of sorted) {
        if (selected.some((other) => rectIoU(rect, other) > overlapThreshold)) {
            continue;
        }
        selected.push(rect);
    }
    return selected;
}

function pickBestEyeSet(rects, faceRect) {
    const candidates = dedupeRectangles(rects, 0.28).sort((left, right) => rectArea(right) - rectArea(left));
    if (candidates.length <= 2) {
        return candidates.sort((left, right) => rectCenter(left).x - rectCenter(right).x);
    }

    let bestPair = candidates.slice(0, 2);
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const left = candidates[i];
            const right = candidates[j];
            const centerLeft = rectCenter(left);
            const centerRight = rectCenter(right);
            const horizontalGap = Math.abs(centerRight.x - centerLeft.x) / Math.max(1, faceRect.width);
            const verticalGap = Math.abs(centerRight.y - centerLeft.y) / Math.max(1, faceRect.height);
            const balance = 1 - clampNumber(verticalGap * 8, 0, 1, 0);
            const areaScore = (rectArea(left) + rectArea(right)) / Math.max(1, faceRect.width * faceRect.height);
            const score = horizontalGap * 2.4 + balance * 1.8 + areaScore * 4.5;
            if (score > bestScore) {
                bestScore = score;
                bestPair = [left, right];
            }
        }
    }
    return bestPair.sort((left, right) => rectCenter(left).x - rectCenter(right).x);
}

function estimateEyeSignals(faceRect, eyeRects) {
    const faceWidth = Math.max(1, faceRect.width || 1);
    const faceHeight = Math.max(1, faceRect.height || 1);
    if (!eyeRects.length) {
        return {
            eye_open: 0.28,
            left_eye_open: 0.28,
            right_eye_open: 0.28,
            blink: 0.72,
            roll: 0,
            confidence: 0.08,
        };
    }

    const openness = eyeRects.map((eye) => {
        const widthRatio = (eye.width || 0) / faceWidth;
        const heightRatio = (eye.height || 0) / faceHeight;
        const aspectRatio = (eye.height || 0) / Math.max(1, eye.width || 1);
        const widthScore = clampNumber((widthRatio - 0.05) / 0.08, 0, 1, 0);
        const heightScore = clampNumber((heightRatio - 0.025) / 0.055, 0, 1, 0);
        const aspectScore = clampNumber((aspectRatio - 0.12) / 0.24, 0, 1, 0);
        return clampNumber(widthScore * 0.26 + heightScore * 0.22 + aspectScore * 0.52, 0, 1, 0);
    });

    const leftEye = eyeRects[0];
    const rightEye = eyeRects[1] ?? eyeRects[0];
    const eyeOpen = openness.reduce((sum, value) => sum + value, 0) / openness.length;
    const blink = clampNumber(1 - eyeOpen, 0, 1, 0);
    const centerLeft = rectCenter(leftEye);
    const centerRight = rectCenter(rightEye);
    const roll = eyeRects.length >= 2
        ? clampNumber(
            Math.atan2(centerRight.y - centerLeft.y, centerRight.x - centerLeft.x) / (Math.PI / 8),
            -1,
            1,
            0
        )
        : 0;
    const pairQuality = eyeRects.length >= 2
        ? clampNumber(1 - Math.abs((centerRight.y - centerLeft.y) / faceHeight) * 7, 0, 1, 0)
        : 0.35;

    return {
        eye_open: eyeOpen,
        left_eye_open: openness[0] ?? eyeOpen,
        right_eye_open: openness[1] ?? openness[0] ?? eyeOpen,
        blink,
        roll,
        confidence: clampNumber(0.18 + eyeRects.length * 0.18 + pairQuality * 0.36, 0, 1, 0),
    };
}

function estimateMouthSignals(faceRect, mouthRect, smileRect) {
    const faceWidth = Math.max(1, faceRect.width || 1);
    const faceHeight = Math.max(1, faceRect.height || 1);
    if (!mouthRect && !smileRect) {
        return {
            mouth_open: 0.04,
            smile: 0,
            confidence: 0.05,
        };
    }

    const activeRect = mouthRect || smileRect;
    const mouthWidthRatio = (activeRect?.width || 0) / faceWidth;
    const mouthHeightRatio = (activeRect?.height || 0) / faceHeight;
    const mouthOpen = clampNumber((mouthHeightRatio - 0.022) / 0.07, 0, 1, 0);
    const widthSmile = clampNumber((mouthWidthRatio - 0.18) / 0.2, 0, 1, 0);
    const smileWidth = smileRect ? (smileRect.width || 0) / faceWidth : mouthWidthRatio;
    const smileHeight = smileRect ? (smileRect.height || 0) / faceHeight : mouthHeightRatio;
    const smileByCascade = clampNumber((smileWidth - 0.18) / 0.18, 0, 1, 0);
    const smileByShape = clampNumber((smileWidth - smileHeight * 0.75 - 0.12) / 0.22, 0, 1, 0);
    const smile = clampNumber(Math.max(smileByCascade, smileByShape, widthSmile * 0.7) * (1 - mouthOpen * 0.4), 0, 1, 0);

    return {
        mouth_open: mouthOpen,
        smile,
        confidence: clampNumber(0.16 + (mouthRect ? 0.22 : 0) + (smileRect ? 0.24 : 0), 0, 1, 0),
    };
}

function detectCascadeRects(cv, gray, detector, roiRect, { scaleFactor = 1.12, minNeighbors = 3 } = {}) {
    if (!cv || !gray || !detector || !roiRect || roiRect.width <= 0 || roiRect.height <= 0) {
        return [];
    }

    let cvRoiRect = null;
    let roi = null;
    let rects = null;
    try {
        cvRoiRect = new cv.Rect(
            Math.max(0, Math.floor(roiRect.x || 0)),
            Math.max(0, Math.floor(roiRect.y || 0)),
            Math.max(1, Math.floor(roiRect.width || 1)),
            Math.max(1, Math.floor(roiRect.height || 1))
        );
        roi = gray.roi(cvRoiRect);
        rects = new cv.RectVector();
        detector.detectMultiScale(roi, rects, scaleFactor, minNeighbors, 0);
        const results = [];
        for (let i = 0; i < rects.size(); i++) {
            const rect = rects.get(i);
            results.push({
                x: rect.x + cvRoiRect.x,
                y: rect.y + cvRoiRect.y,
                width: rect.width,
                height: rect.height,
            });
        }
        return results;
    } catch (err) {
        console.warn('OpenCV cascade detection failed:', err);
        return [];
    } finally {
        if (rects) rects.delete();
        if (roi) roi.delete();
        if (cvRoiRect) cvRoiRect.delete();
    }
}

function buildFaceTrackingAnalysis(faceRect, eyeRects, mouthRect, smileRect) {
    const eyeSignals = estimateEyeSignals(faceRect, eyeRects);
    const mouthSignals = estimateMouthSignals(faceRect, mouthRect, smileRect);
    const eyeCenter = eyeRects.length
        ? {
            x: eyeRects.reduce((sum, eye) => sum + rectCenter(eye).x, 0) / eyeRects.length,
            y: eyeRects.reduce((sum, eye) => sum + rectCenter(eye).y, 0) / eyeRects.length,
        }
        : {
            x: faceRect.x + faceRect.width / 2,
            y: faceRect.y + faceRect.height * 0.35,
        };
    const confidence = clampNumber(
        0.45 * eyeSignals.confidence +
        0.35 * mouthSignals.confidence +
        0.2,
        0,
        1,
        0
    );

    return {
        rawRect: faceRect,
        faceRect,
        eyes: eyeRects,
        mouth: mouthRect,
        smileRect,
        eyeCenter,
        signals: {
            eye_open: eyeSignals.eye_open,
            left_eye_open: eyeSignals.left_eye_open,
            right_eye_open: eyeSignals.right_eye_open,
            mouth_open: mouthSignals.mouth_open,
            smile: mouthSignals.smile,
            blink: eyeSignals.blink,
            roll: eyeSignals.roll,
            confidence,
        },
        confidence,
    };
}

function getBlendedAvatarState() {
    const baseExpression = avatarState.expression || {};
    const basePosture = avatarState.posture || {};
    const tracking = avatarState.faceTracking || {};
    const trackingPose = tracking.enabled && tracking.cameraActive && tracking.active ? (tracking.pose || {}) : null;
    const trackingBlend = trackingPose
        ? clampNumber(tracking.blend ?? 0.85, 0, 1, 0.85) * clampNumber(tracking.confidence ?? 1, 0, 1, 1)
        : 0;
    const trackingSignals = tracking.enabled && tracking.cameraActive && tracking.active ? (tracking.signals || faceTrackingRuntime.currentSignals || {}) : null;
    const trackingExpression = trackingSignals
        ? {
            mouth_open: clampNumber(trackingSignals.mouth_open ?? 0, 0, 1, 0),
            smile: clampNumber(trackingSignals.smile ?? 0, -1, 1, 0),
            blink: clampNumber(trackingSignals.blink ?? 0, 0, 1, 0),
        }
        : null;
    const trackingExpressionBlend = trackingExpression ? trackingBlend * 0.72 : 0;

    const baseYaw = clampNumber(basePosture.head_yaw ?? 0, -1, 1, 0);
    const basePitch = clampNumber(basePosture.head_pitch ?? 0, -1, 1, 0);
    const baseRoll = clampNumber(basePosture.head_roll ?? 0, -1, 1, 0);
    const trackYaw = clampNumber(trackingPose?.head_yaw ?? 0, -1, 1, 0);
    const trackPitch = clampNumber(trackingPose?.head_pitch ?? 0, -1, 1, 0);
    const trackRoll = clampNumber(trackingPose?.head_roll ?? 0, -1, 1, 0);

    return {
        expression: {
            mouth_open: clampNumber(
                Math.max(
                    baseExpression.mouth_open ?? 0,
                    trackingExpression ? lerpNumber(baseExpression.mouth_open ?? 0, trackingExpression.mouth_open, trackingExpressionBlend) : 0
                ),
                0,
                1,
                0
            ),
            smile: clampNumber(
                lerpNumber(baseExpression.smile ?? 0, trackingExpression ? trackingExpression.smile : 0, trackingExpressionBlend),
                -1,
                1,
                0
            ),
            blink: clampNumber(
                Math.max(
                    baseExpression.blink ?? 0,
                    trackingExpression ? lerpNumber(baseExpression.blink ?? 0, trackingExpression.blink, trackingExpressionBlend) : 0
                ),
                0,
                1,
                0
            ),
        },
        posture: {
            head_yaw: lerpNumber(baseYaw, trackYaw, trackingBlend),
            head_pitch: lerpNumber(basePitch, trackPitch, trackingBlend),
            head_roll: lerpNumber(baseRoll, trackRoll, trackingBlend),
        },
        tracking,
    };
}

const FACE_TRACKING_SCRIPT_URL = '/vendor/opencv.js';
const FACE_TRACKING_CASCADE_URL = '/vendor/haarcascade_frontalface_default.xml';
const FACE_TRACKING_EYE_CASCADE_URL = '/vendor/haarcascade_eye.xml';
const FACE_TRACKING_EYE_TREE_CASCADE_URL = '/vendor/haarcascade_eye_tree_eyeglasses.xml';
const FACE_TRACKING_MOUTH_CASCADE_URL = '/vendor/haarcascade_mcs_mouth.xml';
const FACE_TRACKING_SMILE_CASCADE_URL = '/vendor/haarcascade_smile.xml';
const FACE_TRACKING_FRAME_INTERVAL_MS = 60;
const FACE_TRACKING_CONTROL_CHANNEL_NAME = 'qdh-opencv-control';
const FACE_TRACKING_LEGACY_STORAGE_KEYS = {
    enabled: 'qdh.faceTracking.enabled',
    mirror: 'qdh.faceTracking.mirror',
    smooth: 'qdh.faceTracking.smooth',
    yawGain: 'qdh.faceTracking.yawGain',
    pitchGain: 'qdh.faceTracking.pitchGain',
    blend: 'qdh.faceTracking.blend',
    calibration: 'qdh.faceTracking.calibration',
    autoStart: 'qdh.faceTracking.autoStart',
};
const FACE_TRACKING_STORAGE_KEYS = {
    enabled: 'qdh.opencv.enabled',
    mirror: 'qdh.opencv.mirror',
    smooth: 'qdh.opencv.smooth',
    yawGain: 'qdh.opencv.yawGain',
    pitchGain: 'qdh.opencv.pitchGain',
    blend: 'qdh.opencv.blend',
    calibration: 'qdh.opencv.calibration',
    autoStart: 'qdh.opencv.autoStart',
};
const FACE_TRACKING_DEFAULTS = {
    enabled: false,
    autoStart: true,
    mirror: true,
    smooth: 0.72,
    yawGain: 1.8,
    pitchGain: 1.6,
    blend: 0.85,
};
let openCvLoadPromise = null;
let openCvRuntimeReadyPromise = null;
const faceTrackingRuntime = {
    stream: null,
    running: false,
    loopId: 0,
    lastFrameAt: 0,
    classifier: null,
    detectors: null,
    surfaceRoot: null,
    starting: false,
    startRequestId: 0,
    analysisCanvas: null,
    analysisCtx: null,
    overlayCanvas: null,
    overlayCtx: null,
    videoEl: null,
    previewCtx: null,
    calibration: null,
    lastDetection: null,
    lastStatusMessage: '',
    lastStatusAt: 0,
    currentSignals: { eye_open: 1.0, left_eye_open: 1.0, right_eye_open: 1.0, mouth_open: 0.0, smile: 0.0, blink: 0.0, roll: 0.0, confidence: 0.0 },
    settings: { ...FACE_TRACKING_DEFAULTS },
    currentPose: { head_pitch: 0, head_yaw: 0, head_roll: 0 },
};
let faceTrackingControlChannel = null;

const DIGITAL_HUMAN_PERSONAS = {
    guide: {
        label: '地图讲解员',
        modelUrl: 'https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb',
        cameraOrbit: '0deg 68deg 2.35m',
        fieldOfView: '26deg',
        jacket: ['#2e3b59', '#1e2638', '#141925'],
        hair: ['#1b120f', '#231812', '#0d0908'],
        iris: '#2d3d58',
    },
    professional: {
        label: '专业导览员',
        modelUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
        cameraOrbit: '-8deg 66deg 2.55m',
        fieldOfView: '25deg',
        jacket: ['#273a65', '#17233f', '#0d1324'],
        hair: ['#172033', '#101827', '#05070d'],
        iris: '#315aa0',
    },
    energetic: {
        label: '元气助手',
        modelUrl: 'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb',
        cameraOrbit: '8deg 68deg 2.25m',
        fieldOfView: '28deg',
        jacket: ['#248b79', '#123f4f', '#0a2634'],
        hair: ['#263d50', '#132431', '#07111a'],
        iris: '#0f9075',
    },
};
const DIGITAL_HUMAN_PERSONA_SEQUENCE = ['guide', 'professional', 'energetic'];
const DIGITAL_HUMAN_PERSONA_STORAGE_KEY = 'qdh.digitalHumanPersona';
let selectedDigitalHumanPersonaKey = DIGITAL_HUMAN_PERSONAS[localStorage.getItem(DIGITAL_HUMAN_PERSONA_STORAGE_KEY)]
    ? localStorage.getItem(DIGITAL_HUMAN_PERSONA_STORAGE_KEY)
    : 'guide';
let avatarInteractionLockUntil = 0;

function refreshAvatarRendererState() {
    const modelViewer = document.getElementById('avatar-model-viewer');
    const modelFrame = document.getElementById('avatar-model-frame');
    const aura = document.getElementById('avatar-aura');
    const spec = getDigitalHumanPersonaSpec(avatarState.persona);
    const renderedState = getBlendedAvatarState();
    const posture = renderedState.posture || {};
    const expression = renderedState.expression || {};
    const energy = Math.max(0, Math.min(1, expression.mouth_open || 0));

    if (modelViewer) {
        if (modelViewer.getAttribute('src') !== spec.modelUrl) {
            modelViewer.setAttribute('src', spec.modelUrl);
        }
        modelViewer.setAttribute('camera-orbit', spec.cameraOrbit);
        modelViewer.setAttribute('field-of-view', spec.fieldOfView);
        modelViewer.setAttribute('alt', `${spec.label} 3D 数字人模型`);
    }

    if (modelFrame) {
        modelFrame.style.transform = [
            `translateY(${(Math.sin((performance.now() - avatarState.startTime) / 740) * -4).toFixed(2)}px)`,
            `rotateZ(${((posture.head_roll || 0) * 5).toFixed(2)}deg)`,
            `rotateY(${((posture.head_yaw || 0) * 8).toFixed(2)}deg)`,
            `rotateX(${((posture.head_pitch || 0) * -5).toFixed(2)}deg)`,
        ].join(' ');
    }

    if (aura) {
        aura.style.opacity = String(0.38 + energy * 0.32);
        aura.style.transform = `scale(${1 + energy * 0.08})`;
    }
}

function getDigitalHumanPersonaKey(key = selectedDigitalHumanPersonaKey) {
    return DIGITAL_HUMAN_PERSONAS[key] ? key : 'guide';
}

function getDigitalHumanPersonaSpec(key = selectedDigitalHumanPersonaKey) {
    return DIGITAL_HUMAN_PERSONAS[getDigitalHumanPersonaKey(key)];
}

function persistDigitalHumanPersonaKey(key) {
    selectedDigitalHumanPersonaKey = getDigitalHumanPersonaKey(key);
    avatarState.persona = selectedDigitalHumanPersonaKey;
    localStorage.setItem(DIGITAL_HUMAN_PERSONA_STORAGE_KEY, selectedDigitalHumanPersonaKey);
    return selectedDigitalHumanPersonaKey;
}

function setDigitalHumanIntentStatus(message) {
    const intentStatus = document.getElementById('intent-status');
    if (intentStatus) {
        intentStatus.textContent = message;
    }
}

function normalizeIntentText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
}

function detectAvatarIntents(text) {
    const normalized = normalizeIntentText(text);
    if (!normalized) return [];

    const compact = normalized.replace(/\s+/g, '');
    const lower = normalized.toLowerCase();
    const intents = [];

    if (/切换.*形象|换.*形象|形象.*切换|切换头像|换头像|切换角色|换角色|下一个形象|换一个|切到下一个/.test(compact)) {
        intents.push({ kind: 'switch_persona_cycle', label: '切换形象' });
    }

    if (/专业|稳重|讲解|导览|地图讲解|professional/.test(compact) || /professional/.test(lower)) {
        intents.push({ kind: 'switch_persona', personaKey: 'professional', label: '专业导览员' });
    } else if (/活泼|元气|俏皮|灵动|元气满满|energetic/.test(compact) || /energetic/.test(lower)) {
        intents.push({ kind: 'switch_persona', personaKey: 'energetic', label: '元气助手' });
    } else if (/亲和|默认|地图助手|清新|自然|guide/.test(compact) || /default|guide/.test(lower)) {
        intents.push({ kind: 'switch_persona', personaKey: 'guide', label: '地图讲解员' });
    }

    if (/开心|高兴|快乐|太好了|真棒|赞|喜欢|谢谢|鼓励|好耶|smile|happy|cheerful/.test(compact) || /\b(?:smile|happy|cheerful)\b/.test(lower)) {
        intents.push({ kind: 'expression', expression: 'happy', motion: 'tap_body', label: '开心' });
    }
    if (/思考|考虑|想想|分析|推理|让我想想|嗯嗯?|think|thinking|ponder/.test(compact) || /\bthink(ing)?\b/.test(lower)) {
        intents.push({ kind: 'expression', expression: 'thinking', motion: 'idle', label: '思考' });
    }
    if (/惊讶|震惊|哇|诶|真的吗|居然|天啊|好神奇|wow|surprised|surprise/.test(compact) || /\bsurpris(ed|e)?\b/.test(lower)) {
        intents.push({ kind: 'expression', expression: 'surprised', motion: 'flick_head', label: '惊讶' });
    }
    if (/难过|伤心|抱歉|糟糕|遗憾|可惜|sad|sorry|disappointed/.test(compact) || /\bsad\b/.test(lower)) {
        intents.push({ kind: 'expression', expression: 'sad', motion: 'pinch_in', label: '难过' });
    }
    if (/生气|讨厌|烦|气死|愤怒|angry|mad|annoyed/.test(compact) || /\b(?:angry|mad|annoyed)\b/.test(lower)) {
        intents.push({ kind: 'expression', expression: 'angry', motion: 'shake', label: '生气' });
    }
    if (/你好|hello|hi|欢迎|早上好|晚上好|打招呼/.test(lower)) {
        intents.push({ kind: 'motion', motion: 'flick_head', label: '打招呼' });
    }
    if (/点头|明白|收到|ok|好的|没问题|nod|gotit|roger/.test(compact) || /\bok\b/.test(lower)) {
        intents.push({ kind: 'motion', motion: 'tap_body', label: '确认' });
    }

    return intents;
}

function isAvatarInteractionLocked() {
    return performance.now() < avatarInteractionLockUntil;
}

function lockAvatarInteraction(durationMs = 280) {
    avatarInteractionLockUntil = Math.max(avatarInteractionLockUntil, performance.now() + durationMs);
}

function applyDigitalHumanExpression(intentName) {
    const presets = {
        happy: { mouth_open: 0.24, smile: 0.72, blink: 0.0 },
        thinking: { mouth_open: 0.06, smile: 0.12, blink: 0.12 },
        surprised: { mouth_open: 0.64, smile: 0.08, blink: 0.0 },
        sad: { mouth_open: 0.08, smile: -0.42, blink: 0.18 },
        angry: { mouth_open: 0.18, smile: -0.72, blink: 0.08 },
    };
    avatarState.expression = {
        ...avatarState.expression,
        ...(presets[intentName] || presets.happy),
    };
    refreshAvatarRendererState();
    return true;
}

async function triggerDigitalHumanMotion(motionName) {
    if (!motionName || isAvatarInteractionLocked()) return false;
    lockAvatarInteraction();

    const originalPosture = { ...avatarState.posture };
    const applyPosture = (posture) => {
        avatarState.posture = { ...avatarState.posture, ...posture };
        refreshAvatarRendererState();
    };

    if (motionName === 'flick_head') {
        applyPosture({ head_yaw: 0.28, head_roll: -0.10 });
        window.setTimeout(() => applyPosture({ head_yaw: -0.16, head_roll: 0.06 }), 180);
    } else if (motionName === 'tap_body') {
        applyPosture({ head_pitch: 0.16 });
        window.setTimeout(() => applyPosture({ head_pitch: -0.06 }), 180);
    } else if (motionName === 'pinch_in') {
        applyPosture({ head_pitch: 0.14, head_yaw: -0.08 });
    } else if (motionName === 'shake') {
        applyPosture({ head_yaw: -0.22, head_roll: 0.10 });
        window.setTimeout(() => applyPosture({ head_yaw: 0.22, head_roll: -0.10 }), 160);
        window.setTimeout(() => applyPosture({ head_yaw: -0.12, head_roll: 0.06 }), 320);
    }

    window.setTimeout(() => {
        avatarState.posture = originalPosture;
        refreshAvatarRendererState();
    }, 620);
    return true;
}

async function switchDigitalHumanPersona(personaKey, reason = 'manual') {
    const nextKey = persistDigitalHumanPersonaKey(personaKey);
    const spec = getDigitalHumanPersonaSpec(nextKey);
    setDigitalHumanIntentStatus(`意图：切换形象 → ${spec.label}${reason ? `（${reason}）` : ''}`);
    refreshAvatarRendererState();
    return true;
}

async function triggerAvatarIntent(intent, context = {}) {
    if (!intent) return false;

    switch (intent.kind) {
        case 'switch_persona_cycle': {
            const currentIndex = DIGITAL_HUMAN_PERSONA_SEQUENCE.indexOf(selectedDigitalHumanPersonaKey);
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % DIGITAL_HUMAN_PERSONA_SEQUENCE.length : 0;
            return await switchDigitalHumanPersona(DIGITAL_HUMAN_PERSONA_SEQUENCE[nextIndex], intent.label || context.source || 'manual');
        }
        case 'switch_persona':
            return await switchDigitalHumanPersona(intent.personaKey, intent.label || context.source || 'manual');
        case 'expression':
            setDigitalHumanIntentStatus(`意图：${intent.label || intent.expression}`);
            applyDigitalHumanExpression(intent.expression);
            if (intent.motion) await triggerDigitalHumanMotion(intent.motion);
            return true;
        case 'motion':
            setDigitalHumanIntentStatus(`意图：${intent.label || intent.motion}`);
            return await triggerDigitalHumanMotion(intent.motion);
        default:
            return false;
    }
}

async function probeAvatarIntent(text, context = {}) {
    const intents = detectAvatarIntents(text);
    if (!intents.length) {
        return false;
    }

    let handled = false;
    for (const intent of intents) {
        handled = (await triggerAvatarIntent(intent, context)) || handled;
    }
    return handled;
}

function loadFaceTrackingBooleanSetting(key, fallback, legacyKey = null) {
    const raw = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (raw === null) return fallback;
    return raw !== 'false';
}

function loadFaceTrackingNumberSetting(key, fallback, min, max, legacyKey = null) {
    const raw = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return clampNumber(value, min, max, fallback);
}

function loadFaceTrackingCalibrationSetting() {
    const raw = localStorage.getItem(FACE_TRACKING_STORAGE_KEYS.calibration) ?? localStorage.getItem(FACE_TRACKING_LEGACY_STORAGE_KEYS.calibration);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const coordinateSpace = parsed.coordinateSpace || 'legacy-display';
        const centerXRatio = coordinateSpace === 'raw'
            ? parsed.centerXRatio
            : 1 - Number(parsed.centerXRatio);
        return {
            centerXRatio: clampNumber(centerXRatio, 0, 1, 0.5),
            centerYRatio: clampNumber(parsed.centerYRatio, 0, 1, 0.5),
            faceWidthRatio: clampNumber(parsed.faceWidthRatio, 0.05, 1, 0.28),
            faceHeightRatio: clampNumber(parsed.faceHeightRatio, 0.05, 1, 0.38),
            coordinateSpace: 'raw',
            createdAt: Number(parsed.createdAt) || Date.now(),
        };
    } catch {
        return null;
    }
}

function persistFaceTrackingPreferences() {
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.enabled, String(avatarState.faceTracking.enabled));
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.autoStart, String(avatarState.faceTracking.autoStart ?? FACE_TRACKING_DEFAULTS.autoStart));
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.mirror, String(avatarState.faceTracking.mirror));
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.smooth, String(avatarState.faceTracking.smooth ?? FACE_TRACKING_DEFAULTS.smooth));
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.yawGain, String(avatarState.faceTracking.yawGain ?? FACE_TRACKING_DEFAULTS.yawGain));
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.pitchGain, String(avatarState.faceTracking.pitchGain ?? FACE_TRACKING_DEFAULTS.pitchGain));
    localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.blend, String(avatarState.faceTracking.blend ?? FACE_TRACKING_DEFAULTS.blend));
    if (avatarState.faceTracking.calibration) {
        localStorage.setItem(FACE_TRACKING_STORAGE_KEYS.calibration, JSON.stringify(avatarState.faceTracking.calibration));
    } else {
        localStorage.removeItem(FACE_TRACKING_STORAGE_KEYS.calibration);
    }
}

function applyFaceTrackingPreferences() {
    avatarState.faceTracking = {
        ...avatarState.faceTracking,
        enabled: loadFaceTrackingBooleanSetting(FACE_TRACKING_STORAGE_KEYS.enabled, FACE_TRACKING_DEFAULTS.enabled, FACE_TRACKING_LEGACY_STORAGE_KEYS.enabled),
        autoStart: loadFaceTrackingBooleanSetting(FACE_TRACKING_STORAGE_KEYS.autoStart, FACE_TRACKING_DEFAULTS.autoStart, FACE_TRACKING_LEGACY_STORAGE_KEYS.autoStart),
        mirror: loadFaceTrackingBooleanSetting(FACE_TRACKING_STORAGE_KEYS.mirror, FACE_TRACKING_DEFAULTS.mirror, FACE_TRACKING_LEGACY_STORAGE_KEYS.mirror),
        smooth: loadFaceTrackingNumberSetting(FACE_TRACKING_STORAGE_KEYS.smooth, FACE_TRACKING_DEFAULTS.smooth, 0.05, 0.98, FACE_TRACKING_LEGACY_STORAGE_KEYS.smooth),
        yawGain: loadFaceTrackingNumberSetting(FACE_TRACKING_STORAGE_KEYS.yawGain, FACE_TRACKING_DEFAULTS.yawGain, 0.1, 4.0, FACE_TRACKING_LEGACY_STORAGE_KEYS.yawGain),
        pitchGain: loadFaceTrackingNumberSetting(FACE_TRACKING_STORAGE_KEYS.pitchGain, FACE_TRACKING_DEFAULTS.pitchGain, 0.1, 4.0, FACE_TRACKING_LEGACY_STORAGE_KEYS.pitchGain),
        blend: loadFaceTrackingNumberSetting(FACE_TRACKING_STORAGE_KEYS.blend, FACE_TRACKING_DEFAULTS.blend, 0, 1, FACE_TRACKING_LEGACY_STORAGE_KEYS.blend),
        calibrated: !!avatarState.faceTracking.calibration,
    };
    const calibration = loadFaceTrackingCalibrationSetting();
    if (calibration) {
        avatarState.faceTracking.calibration = calibration;
        avatarState.faceTracking.calibrated = true;
    }
    faceTrackingRuntime.settings = {
        ...faceTrackingRuntime.settings,
        enabled: avatarState.faceTracking.enabled,
        autoStart: avatarState.faceTracking.autoStart,
        mirror: avatarState.faceTracking.mirror,
        smooth: avatarState.faceTracking.smooth,
        yawGain: avatarState.faceTracking.yawGain,
        pitchGain: avatarState.faceTracking.pitchGain,
        blend: avatarState.faceTracking.blend,
    };
    updateFaceTrackingPreviewMirror();
}

function setFaceTrackingStatus(message) {
    const now = performance.now();
    if (message === faceTrackingRuntime.lastStatusMessage) {
        return;
    }
    if (now - faceTrackingRuntime.lastStatusAt < 250) {
        faceTrackingRuntime.lastStatusMessage = message;
        return;
    }
    faceTrackingRuntime.lastStatusMessage = message;
    faceTrackingRuntime.lastStatusAt = now;
    const status = document.getElementById('face-tracking-status');
    if (status) {
        status.textContent = message;
    }
    try {
        faceTrackingControlChannel?.postMessage({ type: 'status', message });
    } catch {
        // ignore cross-tab status failures
    }
}

function updateFaceTrackingUi() {
    const enabledCheckbox = document.getElementById('face-tracking-enabled');
    const mirrorCheckbox = document.getElementById('face-tracking-mirror');
    const startButton = document.getElementById('face-tracking-start-btn');
    if (enabledCheckbox) enabledCheckbox.checked = !!avatarState.faceTracking.enabled;
    if (mirrorCheckbox) mirrorCheckbox.checked = !!avatarState.faceTracking.mirror;
    if (startButton) {
        startButton.textContent = faceTrackingRuntime.running ? '停止摄像头' : '启动摄像头';
    }
}

function updateFaceTrackingPreviewMirror() {
    const preview = document.getElementById('face-tracking-preview');
    if (!preview) return;
    preview.classList.toggle('mirrored', !!avatarState.faceTracking.mirror);
}

function setFaceTrackingEnabled(enabled) {
    avatarState.faceTracking.enabled = !!enabled;
    faceTrackingRuntime.settings.enabled = avatarState.faceTracking.enabled;
    if (!avatarState.faceTracking.enabled) {
        avatarState.faceTracking.active = false;
        avatarState.faceTracking.confidence = 0;
    }
    persistFaceTrackingPreferences();
    updateFaceTrackingUi();
    setFaceTrackingStatus(
        avatarState.faceTracking.enabled
            ? (faceTrackingRuntime.running ? 'OpenCV 眼部追踪模式运行中。' : 'OpenCV 眼部追踪模式已启用，等待摄像头启动。')
            : 'OpenCV 眼部追踪模式已关闭。'
    );
    refreshAvatarRendererState();
}

function setFaceTrackingMirror(enabled) {
    avatarState.faceTracking.mirror = !!enabled;
    faceTrackingRuntime.settings.mirror = avatarState.faceTracking.mirror;
    updateFaceTrackingPreviewMirror();
    persistFaceTrackingPreferences();
    setFaceTrackingStatus(
        avatarState.faceTracking.mirror
            ? '摄像头方向同步已开启。'
            : '摄像头方向同步已关闭。'
    );
}

function setFaceTrackingAutoStart(enabled) {
    avatarState.faceTracking.autoStart = !!enabled;
    faceTrackingRuntime.settings.autoStart = avatarState.faceTracking.autoStart;
    persistFaceTrackingPreferences();
}

function clearFaceTrackingPose({ resetCalibration = false } = {}) {
    avatarState.faceTracking.active = false;
    avatarState.faceTracking.cameraActive = false;
    avatarState.faceTracking.confidence = 0;
    faceTrackingRuntime.currentPose = { head_pitch: 0, head_yaw: 0, head_roll: 0 };
    faceTrackingRuntime.currentSignals = {
        eye_open: 1.0,
        left_eye_open: 1.0,
        right_eye_open: 1.0,
        mouth_open: 0.0,
        smile: 0.0,
        blink: 0.0,
        roll: 0.0,
        confidence: 0.0,
    };
    avatarState.faceTracking.pose = { ...faceTrackingRuntime.currentPose };
    avatarState.faceTracking.signals = { ...faceTrackingRuntime.currentSignals };
    if (resetCalibration) {
        avatarState.faceTracking.calibration = null;
        avatarState.faceTracking.calibrated = false;
        persistFaceTrackingPreferences();
    }
}

function drawFaceTrackingOverlay(analysis, frameWidth, frameHeight) {
    const overlayCanvas = faceTrackingRuntime.overlayCanvas;
    const overlayCtx = faceTrackingRuntime.overlayCtx;
    if (!overlayCanvas || !overlayCtx) return;

    const width = Math.max(1, Math.floor(frameWidth));
    const height = Math.max(1, Math.floor(frameHeight));
    if (overlayCanvas.width !== width) overlayCanvas.width = width;
    if (overlayCanvas.height !== height) overlayCanvas.height = height;

    overlayCtx.clearRect(0, 0, width, height);

    const faceRect = analysis?.faceRect || analysis?.rawRect || null;
    const eyes = analysis?.eyes || [];
    const mouthRect = analysis?.mouth || null;
    const smileRect = analysis?.smileRect || null;

    if (!faceRect) {
        if (avatarState.faceTracking.calibration) {
            const calibration = avatarState.faceTracking.calibration;
            const centerX = calibration.centerXRatio * width;
            const centerY = calibration.centerYRatio * height;
            overlayCtx.save();
            overlayCtx.strokeStyle = 'rgba(120, 220, 255, 0.45)';
            overlayCtx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.008));
            overlayCtx.setLineDash([8, 6]);
            overlayCtx.beginPath();
            overlayCtx.arc(centerX, centerY, Math.min(width, height) * 0.12, 0, Math.PI * 2);
            overlayCtx.stroke();
            overlayCtx.restore();
        }
        return;
    }

    const centerX = faceRect.x + faceRect.width / 2;
    const centerY = faceRect.y + faceRect.height / 2;
    const calibration = avatarState.faceTracking.calibration;
    const calibCenterX = calibration ? calibration.centerXRatio * width : width / 2;
    const calibCenterY = calibration ? calibration.centerYRatio * height : height / 2;

    overlayCtx.save();
    overlayCtx.strokeStyle = avatarState.faceTracking.calibrated ? 'rgba(74, 222, 128, 0.92)' : 'rgba(255, 196, 61, 0.92)';
    overlayCtx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.008));
    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    overlayCtx.strokeRect(faceRect.x, faceRect.y, faceRect.width, faceRect.height);
    overlayCtx.beginPath();
    overlayCtx.arc(centerX, centerY, Math.max(4, Math.round(Math.min(width, height) * 0.01)), 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.stroke();

    if (eyes.length) {
        overlayCtx.strokeStyle = 'rgba(96, 165, 250, 0.9)';
        overlayCtx.fillStyle = 'rgba(96, 165, 250, 0.72)';
        for (const eye of eyes) {
            overlayCtx.strokeRect(eye.x, eye.y, eye.width, eye.height);
            overlayCtx.beginPath();
            overlayCtx.arc(eye.x + eye.width / 2, eye.y + eye.height / 2, Math.max(2, Math.min(eye.width, eye.height) * 0.14), 0, Math.PI * 2);
            overlayCtx.fill();
        }
        if (eyes.length >= 2) {
            const leftEye = eyes[0];
            const rightEye = eyes[1];
            const leftCenter = rectCenter(leftEye);
            const rightCenter = rectCenter(rightEye);
            overlayCtx.save();
            overlayCtx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            overlayCtx.setLineDash([5, 4]);
            overlayCtx.beginPath();
            overlayCtx.moveTo(leftCenter.x, leftCenter.y);
            overlayCtx.lineTo(rightCenter.x, rightCenter.y);
            overlayCtx.stroke();
            overlayCtx.restore();
        }
    }

    if (mouthRect) {
        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
        overlayCtx.fillStyle = 'rgba(251, 146, 60, 0.18)';
        overlayCtx.strokeRect(mouthRect.x, mouthRect.y, mouthRect.width, mouthRect.height);
        overlayCtx.fillRect(mouthRect.x, mouthRect.y, mouthRect.width, mouthRect.height);
        overlayCtx.restore();
    }

    if (smileRect) {
        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(244, 114, 182, 0.9)';
        overlayCtx.setLineDash([4, 4]);
        overlayCtx.strokeRect(smileRect.x, smileRect.y, smileRect.width, smileRect.height);
        overlayCtx.restore();
    }

    if (analysis?.eyeCenter) {
        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(34, 211, 238, 0.95)';
        overlayCtx.fillStyle = 'rgba(34, 211, 238, 0.95)';
        overlayCtx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.006));
        overlayCtx.beginPath();
        overlayCtx.arc(analysis.eyeCenter.x, analysis.eyeCenter.y, Math.max(3, Math.round(Math.min(width, height) * 0.007)), 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.beginPath();
        overlayCtx.moveTo(analysis.eyeCenter.x - 12, analysis.eyeCenter.y);
        overlayCtx.lineTo(analysis.eyeCenter.x + 12, analysis.eyeCenter.y);
        overlayCtx.moveTo(analysis.eyeCenter.x, analysis.eyeCenter.y - 12);
        overlayCtx.lineTo(analysis.eyeCenter.x, analysis.eyeCenter.y + 12);
        overlayCtx.stroke();
        overlayCtx.restore();
    }

    overlayCtx.strokeStyle = 'rgba(120, 220, 255, 0.50)';
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.beginPath();
    overlayCtx.moveTo(calibCenterX - 16, calibCenterY);
    overlayCtx.lineTo(calibCenterX + 16, calibCenterY);
    overlayCtx.moveTo(calibCenterX, calibCenterY - 16);
    overlayCtx.lineTo(calibCenterX, calibCenterY + 16);
    overlayCtx.stroke();
    overlayCtx.restore();
}

function updateFaceTrackingAvatarPose(faceRect, analysis, frameWidth, frameHeight) {
    const settings = faceTrackingRuntime.settings;
    const now = performance.now();
    const anchorCenter = analysis?.eyeCenter || {
        x: faceRect.x + faceRect.width / 2,
        y: faceRect.y + faceRect.height / 2,
    };
    const rawCenterX = anchorCenter.x;
    const rawCenterY = anchorCenter.y;
    const calibration = avatarState.faceTracking.calibration;
    const calibCenterX = calibration ? calibration.centerXRatio * frameWidth : frameWidth / 2;
    const calibCenterY = calibration ? calibration.centerYRatio * frameHeight : frameHeight / 2;
    const calibWidth = calibration ? calibration.faceWidthRatio * frameWidth : frameWidth * 0.28;
    const calibHeight = calibration ? calibration.faceHeightRatio * frameHeight : frameHeight * 0.38;
    const yawRange = Math.max(40, calibWidth * 1.15);
    const pitchRange = Math.max(40, calibHeight * 1.15);

    const mirrorMultiplier = settings.mirror ? -1 : 1;
    const targetYaw = clampNumber((((rawCenterX - calibCenterX) / yawRange) * settings.yawGain) * mirrorMultiplier, -1, 1, 0);
    const targetPitch = clampNumber((-(rawCenterY - calibCenterY) / pitchRange) * settings.pitchGain, -1, 1, 0);
    const featureSignals = analysis?.signals || {};
    const targetRoll = clampNumber((featureSignals.roll ?? 0) * 0.92, -1, 1, 0);
    const smooth = clampNumber(settings.smooth, 0.05, 0.98, FACE_TRACKING_DEFAULTS.smooth);
    const featureBlend = 1 - smooth;
    const targetSignals = {
        eye_open: clampNumber(featureSignals.eye_open ?? 1, 0, 1, 1),
        left_eye_open: clampNumber(featureSignals.left_eye_open ?? featureSignals.eye_open ?? 1, 0, 1, 1),
        right_eye_open: clampNumber(featureSignals.right_eye_open ?? featureSignals.eye_open ?? 1, 0, 1, 1),
        mouth_open: clampNumber(featureSignals.mouth_open ?? 0, 0, 1, 0),
        smile: clampNumber(featureSignals.smile ?? 0, -1, 1, 0),
        blink: clampNumber(featureSignals.blink ?? 0, 0, 1, 0),
        roll: targetRoll,
        confidence: clampNumber(analysis?.confidence ?? 1, 0, 1, 1),
    };

    faceTrackingRuntime.currentPose.head_yaw = lerpNumber(faceTrackingRuntime.currentPose.head_yaw, targetYaw, 1 - smooth);
    faceTrackingRuntime.currentPose.head_pitch = lerpNumber(faceTrackingRuntime.currentPose.head_pitch, targetPitch, 1 - smooth);
    faceTrackingRuntime.currentPose.head_roll = lerpNumber(faceTrackingRuntime.currentPose.head_roll, targetRoll, 1 - smooth);
    faceTrackingRuntime.currentSignals = {
        eye_open: lerpNumber(faceTrackingRuntime.currentSignals.eye_open ?? 1, targetSignals.eye_open, featureBlend),
        left_eye_open: lerpNumber(faceTrackingRuntime.currentSignals.left_eye_open ?? 1, targetSignals.left_eye_open, featureBlend),
        right_eye_open: lerpNumber(faceTrackingRuntime.currentSignals.right_eye_open ?? 1, targetSignals.right_eye_open, featureBlend),
        mouth_open: lerpNumber(faceTrackingRuntime.currentSignals.mouth_open ?? 0, targetSignals.mouth_open, featureBlend),
        smile: lerpNumber(faceTrackingRuntime.currentSignals.smile ?? 0, targetSignals.smile, featureBlend),
        blink: lerpNumber(faceTrackingRuntime.currentSignals.blink ?? 0, targetSignals.blink, featureBlend),
        roll: lerpNumber(faceTrackingRuntime.currentSignals.roll ?? 0, targetSignals.roll, featureBlend),
        confidence: lerpNumber(faceTrackingRuntime.currentSignals.confidence ?? 0, targetSignals.confidence, featureBlend),
    };
    faceTrackingRuntime.lastDetection = {
        ...analysis,
        rawRect: faceRect,
        faceRect,
        anchorCenter,
        centerX: rawCenterX,
        centerY: rawCenterY,
        frameWidth,
        frameHeight,
        confidence: targetSignals.confidence,
        at: now,
    };

    avatarState.faceTracking = {
        ...avatarState.faceTracking,
        active: true,
        cameraActive: true,
        confidence: targetSignals.confidence,
        pose: { ...faceTrackingRuntime.currentPose },
        signals: { ...faceTrackingRuntime.currentSignals },
        lastFace: faceTrackingRuntime.lastDetection,
        lastSeenAt: now,
        calibrated: !!avatarState.faceTracking.calibration,
    };

    setFaceTrackingStatus(
        `${avatarState.faceTracking.calibrated ? '已校准' : '未校准'}｜追踪中｜眼部锚点 ${rawCenterX.toFixed(0)},${rawCenterY.toFixed(0)}｜偏航 ${faceTrackingRuntime.currentPose.head_yaw.toFixed(2)}｜俯仰 ${faceTrackingRuntime.currentPose.head_pitch.toFixed(2)}｜眨眼 ${faceTrackingRuntime.currentSignals.blink.toFixed(2)}｜张嘴 ${faceTrackingRuntime.currentSignals.mouth_open.toFixed(2)}｜微笑 ${faceTrackingRuntime.currentSignals.smile.toFixed(2)}`
    );
    refreshAvatarRendererState();
}

function handleFaceTrackingLost() {
    const now = performance.now();
    const elapsed = now - (avatarState.faceTracking.lastSeenAt || 0);
    if (elapsed > 1200) {
        avatarState.faceTracking.active = false;
        avatarState.faceTracking.confidence = 0;
        faceTrackingRuntime.currentSignals = {
            eye_open: lerpNumber(faceTrackingRuntime.currentSignals.eye_open ?? 1, 1, 0.08),
            left_eye_open: lerpNumber(faceTrackingRuntime.currentSignals.left_eye_open ?? 1, 1, 0.08),
            right_eye_open: lerpNumber(faceTrackingRuntime.currentSignals.right_eye_open ?? 1, 1, 0.08),
            mouth_open: lerpNumber(faceTrackingRuntime.currentSignals.mouth_open ?? 0, 0, 0.08),
            smile: lerpNumber(faceTrackingRuntime.currentSignals.smile ?? 0, 0, 0.08),
            blink: lerpNumber(faceTrackingRuntime.currentSignals.blink ?? 0, 0, 0.08),
            roll: lerpNumber(faceTrackingRuntime.currentSignals.roll ?? 0, 0, 0.08),
            confidence: lerpNumber(faceTrackingRuntime.currentSignals.confidence ?? 0, 0, 0.08),
        };
        avatarState.faceTracking.signals = { ...faceTrackingRuntime.currentSignals };
        if (avatarState.faceTracking.enabled && faceTrackingRuntime.running) {
            setFaceTrackingStatus('未检测到人脸，请正对摄像头后再试。');
        }
    } else {
        const fade = clampNumber(1 - elapsed / 1200, 0, 1, 0);
        avatarState.faceTracking.active = true;
        avatarState.faceTracking.confidence = fade;
        faceTrackingRuntime.currentPose.head_yaw *= 0.94;
        faceTrackingRuntime.currentPose.head_pitch *= 0.94;
        faceTrackingRuntime.currentPose.head_roll *= 0.94;
        avatarState.faceTracking.pose = { ...faceTrackingRuntime.currentPose };
        faceTrackingRuntime.currentSignals = {
            eye_open: lerpNumber(faceTrackingRuntime.currentSignals.eye_open ?? 1, 1, 0.06),
            left_eye_open: lerpNumber(faceTrackingRuntime.currentSignals.left_eye_open ?? 1, 1, 0.06),
            right_eye_open: lerpNumber(faceTrackingRuntime.currentSignals.right_eye_open ?? 1, 1, 0.06),
            mouth_open: lerpNumber(faceTrackingRuntime.currentSignals.mouth_open ?? 0, 0, 0.06),
            smile: lerpNumber(faceTrackingRuntime.currentSignals.smile ?? 0, 0, 0.06),
            blink: lerpNumber(faceTrackingRuntime.currentSignals.blink ?? 0, 0, 0.06),
            roll: lerpNumber(faceTrackingRuntime.currentSignals.roll ?? 0, 0, 0.06),
            confidence: fade,
        };
        avatarState.faceTracking.signals = { ...faceTrackingRuntime.currentSignals };
    }
}

function scheduleFaceTrackingFrame() {
    if (!faceTrackingRuntime.running) return;
    faceTrackingRuntime.loopId = requestAnimationFrame(processFaceTrackingFrame);
}

function processFaceTrackingFrame() {
    if (!faceTrackingRuntime.running) return;
    const video = faceTrackingRuntime.videoEl;
    const overlayCanvas = faceTrackingRuntime.overlayCanvas;
    const analysisCanvas = faceTrackingRuntime.analysisCanvas;
    const analysisCtx = faceTrackingRuntime.analysisCtx;
    const detectors = faceTrackingRuntime.detectors;
    const cv = window.cv;
    const faceClassifier = detectors?.face || faceTrackingRuntime.classifier;

    if (!video || !analysisCanvas || !analysisCtx || !faceClassifier || !cv || typeof cv.Mat !== 'function') {
        scheduleFaceTrackingFrame();
        return;
    }

    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        drawFaceTrackingOverlay(null, analysisCanvas.width || 1, analysisCanvas.height || 1);
        handleFaceTrackingLost();
        scheduleFaceTrackingFrame();
        return;
    }

    const now = performance.now();
    if (now - faceTrackingRuntime.lastFrameAt < FACE_TRACKING_FRAME_INTERVAL_MS) {
        scheduleFaceTrackingFrame();
        return;
    }
    faceTrackingRuntime.lastFrameAt = now;

    const frameWidth = video.videoWidth;
    const frameHeight = video.videoHeight;
    if (analysisCanvas.width !== frameWidth) analysisCanvas.width = frameWidth;
    if (analysisCanvas.height !== frameHeight) analysisCanvas.height = frameHeight;
    if (overlayCanvas && overlayCanvas.width !== frameWidth) overlayCanvas.width = frameWidth;
    if (overlayCanvas && overlayCanvas.height !== frameHeight) overlayCanvas.height = frameHeight;

    analysisCtx.save();
    analysisCtx.setTransform(1, 0, 0, 1, 0, 0);
    analysisCtx.clearRect(0, 0, frameWidth, frameHeight);
    analysisCtx.drawImage(video, 0, 0, frameWidth, frameHeight);
    analysisCtx.restore();

    let src = null;
    let gray = null;
    let faces = null;
    try {
        src = cv.imread(analysisCanvas);
        gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.equalizeHist(gray, gray);

        faces = new cv.RectVector();
        faceClassifier.detectMultiScale(gray, faces, 1.12, 3, 0);

        let bestFace = null;
        let bestArea = 0;
        for (let i = 0; i < faces.size(); i++) {
            const rect = faces.get(i);
            const area = rect.width * rect.height;
            if (area > bestArea) {
                bestArea = area;
                bestFace = {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                };
            }
        }

        const minArea = frameWidth * frameHeight * 0.018;
        if (bestFace && bestArea >= minArea) {
            const faceDetectionRect = {
                x: Math.max(0, Math.floor(bestFace.x)),
                y: Math.max(0, Math.floor(bestFace.y)),
                width: Math.max(1, Math.floor(bestFace.width)),
                height: Math.max(1, Math.floor(bestFace.height)),
            };
            const eyeTopRect = {
                x: faceDetectionRect.x + Math.round(faceDetectionRect.width * 0.05),
                y: faceDetectionRect.y + Math.round(faceDetectionRect.height * 0.08),
                width: Math.max(1, Math.round(faceDetectionRect.width * 0.9)),
                height: Math.max(1, Math.round(faceDetectionRect.height * 0.45)),
            };
            const mouthBottomRect = {
                x: faceDetectionRect.x + Math.round(faceDetectionRect.width * 0.12),
                y: faceDetectionRect.y + Math.round(faceDetectionRect.height * 0.38),
                width: Math.max(1, Math.round(faceDetectionRect.width * 0.76)),
                height: Math.max(1, Math.round(faceDetectionRect.height * 0.54)),
            };
            let eyeRects = [];
            let smileRects = [];
            if (detectors?.eyeTree) {
                eyeRects = eyeRects.concat(detectCascadeRects(cv, gray, detectors.eyeTree, eyeTopRect, { scaleFactor: 1.08, minNeighbors: 4 }));
            }
            if (detectors?.eye) {
                eyeRects = eyeRects.concat(detectCascadeRects(cv, gray, detectors.eye, eyeTopRect, { scaleFactor: 1.08, minNeighbors: 5 }));
            }
            eyeRects = pickBestEyeSet(eyeRects, faceDetectionRect);

            if (detectors?.smile) {
                smileRects = smileRects.concat(detectCascadeRects(cv, gray, detectors.smile, mouthBottomRect, { scaleFactor: 1.12, minNeighbors: 14 }));
            }
            smileRects = dedupeRectangles(smileRects, 0.32);
            let mouthRects = [];
            if (detectors?.mouth) {
                mouthRects = mouthRects.concat(detectCascadeRects(cv, gray, detectors.mouth, mouthBottomRect, { scaleFactor: 1.10, minNeighbors: 8 }));
            }
            if (detectors?.smile) {
                mouthRects = mouthRects.concat(detectCascadeRects(cv, gray, detectors.smile, mouthBottomRect, { scaleFactor: 1.12, minNeighbors: 10 }));
            }
            mouthRects = dedupeRectangles(mouthRects, 0.3);
            const mouthRect = dedupeRectangles(mouthRects, 0.30).sort((left, right) => rectArea(right) - rectArea(left))[0] || null;
            const smileRect = smileRects.sort((left, right) => rectArea(right) - rectArea(left))[0] || null;
            const analysis = buildFaceTrackingAnalysis(faceDetectionRect, eyeRects, mouthRect, smileRect);
            updateFaceTrackingAvatarPose(faceDetectionRect, analysis, frameWidth, frameHeight);
            drawFaceTrackingOverlay(analysis, frameWidth, frameHeight);
        } else {
            drawFaceTrackingOverlay(null, frameWidth, frameHeight);
            handleFaceTrackingLost();
            refreshAvatarRendererState();
        }
    } catch (err) {
        console.warn('OpenCV face tracking frame failed:', err);
        setFaceTrackingStatus(`OpenCV 面部追踪失败：${err.message || err}`);
        clearFaceTrackingPose();
        drawFaceTrackingOverlay(null, frameWidth, frameHeight);
    } finally {
        if (src) src.delete();
        if (gray) gray.delete();
        if (faces) faces.delete();
    }

    scheduleFaceTrackingFrame();
}

async function ensureOpenCvRuntime() {
    if (window.cv && typeof window.cv.Mat === 'function' && typeof window.cv.CascadeClassifier === 'function') {
        return window.cv;
    }
    if (openCvLoadPromise) {
        return openCvLoadPromise;
    }

    openCvLoadPromise = new Promise((resolve, reject) => {
        const module = window.cv && typeof window.cv === 'object' ? window.cv : {};
        const previousRuntimeInit = module.onRuntimeInitialized;
        module.onRuntimeInitialized = () => {
            try {
                if (typeof previousRuntimeInit === 'function') {
                    previousRuntimeInit();
                }
            } catch (err) {
                console.warn('Previous OpenCV onRuntimeInitialized handler failed:', err);
            }
            resolve(window.cv);
        };
        module.onAbort = (reason) => {
            reject(new Error(`OpenCV runtime aborted: ${reason || 'unknown reason'}`));
        };
        window.cv = module;

        const existing = Array.from(document.querySelectorAll('script[data-opencv-src]'))
            .find((script) => script.dataset.opencvSrc === FACE_TRACKING_SCRIPT_URL);
        if (existing) {
            if (existing.dataset.opencvLoaded === 'true' && window.cv && typeof window.cv.Mat === 'function') {
                resolve(window.cv);
            }
            return;
        }

        const script = document.createElement('script');
        script.src = FACE_TRACKING_SCRIPT_URL;
        script.async = true;
        script.dataset.opencvSrc = FACE_TRACKING_SCRIPT_URL;
        script.addEventListener('load', () => {
            script.dataset.opencvLoaded = 'true';
        }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Failed to load ${FACE_TRACKING_SCRIPT_URL}`)), { once: true });
        document.head.appendChild(script);
    }).catch((err) => {
        openCvLoadPromise = null;
        throw err;
    });

    return openCvLoadPromise;
}

async function loadCascadeIntoOpenCvFs(cv, url, fileName, { required = true } = {}) {
    let response;
    try {
        response = await fetch(url, { cache: 'no-cache' });
    } catch (err) {
        if (required) throw err;
        console.warn(`OpenCV cascade unavailable: ${fileName}`, err);
        return null;
    }

    if (!response.ok) {
        if (required) {
            throw new Error(`Failed to load ${fileName}: HTTP ${response.status}`);
        }
        console.warn(`OpenCV cascade unavailable: ${fileName} (HTTP ${response.status})`);
        return null;
    }

    const text = await response.text();
    const fsPath = `/${fileName}`;

    try {
        if (cv.FS_analyzePath && cv.FS_analyzePath(fsPath).exists) {
            cv.FS_unlink(fsPath);
        }
    } catch {
        // Ignore stale file cleanup issues.
    }

    if (typeof cv.FS_createDataFile === 'function') {
        const bytes = new TextEncoder().encode(text);
        cv.FS_createDataFile('/', fileName, bytes, true, false, false);
    } else if (typeof cv.FS_writeFile === 'function') {
        cv.FS_writeFile(fsPath, text);
    } else {
        throw new Error('OpenCV FS helpers are unavailable.');
    }

    return fsPath;
}

async function ensureFaceTrackingClassifier() {
    const cv = await ensureOpenCvRuntime();
    if (faceTrackingRuntime.detectors?.face) {
        return faceTrackingRuntime.detectors;
    }

    const detectors = {
        face: null,
        eye: null,
        eyeTree: null,
        mouth: null,
        smile: null,
    };

    const facePath = await loadCascadeIntoOpenCvFs(cv, FACE_TRACKING_CASCADE_URL, 'haarcascade_frontalface_default.xml', { required: true });
    const faceClassifier = new cv.CascadeClassifier();
    if (!faceClassifier.load(facePath)) {
        throw new Error('Failed to initialize face Haar cascade classifier.');
    }

    detectors.face = faceClassifier;

    const optionalCascades = [
        ['eye', FACE_TRACKING_EYE_CASCADE_URL, 'haarcascade_eye.xml'],
        ['eyeTree', FACE_TRACKING_EYE_TREE_CASCADE_URL, 'haarcascade_eye_tree_eyeglasses.xml'],
        ['mouth', FACE_TRACKING_MOUTH_CASCADE_URL, 'haarcascade_mcs_mouth.xml'],
        ['smile', FACE_TRACKING_SMILE_CASCADE_URL, 'haarcascade_smile.xml'],
    ];

    for (const [key, url, fileName] of optionalCascades) {
        try {
            const path = await loadCascadeIntoOpenCvFs(cv, url, fileName, { required: false });
            if (!path) continue;
            const classifier = new cv.CascadeClassifier();
            if (!classifier.load(path)) {
                console.warn(`OpenCV optional cascade failed to initialize: ${fileName}`);
                continue;
            }
            detectors[key] = classifier;
        } catch (err) {
            console.warn(`OpenCV optional cascade failed to load: ${fileName}`, err);
        }
    }

    faceTrackingRuntime.classifier = faceClassifier;
    faceTrackingRuntime.detectors = detectors;
    return detectors;
}

function ensureFaceTrackingSurface() {
    let root = faceTrackingRuntime.surfaceRoot || document.getElementById('face-tracking-surface-root');
    let video = document.getElementById('face-tracking-video');
    let overlayCanvas = document.getElementById('face-tracking-overlay');
    let analysisCanvas = document.getElementById('face-tracking-analysis');

    if (!root) {
        root = document.createElement('div');
        root.id = 'face-tracking-surface-root';
        root.style.position = 'fixed';
        root.style.left = '-99999px';
        root.style.top = '0';
        root.style.width = '1px';
        root.style.height = '1px';
        root.style.overflow = 'hidden';
        root.style.opacity = '0';
        root.style.pointerEvents = 'none';
        document.body.appendChild(root);
    }

    if (!video) {
        video = document.createElement('video');
        video.id = 'face-tracking-video';
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        root.appendChild(video);
    }

    if (!overlayCanvas) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.id = 'face-tracking-overlay';
        root.appendChild(overlayCanvas);
    }

    if (!analysisCanvas) {
        analysisCanvas = document.createElement('canvas');
        analysisCanvas.id = 'face-tracking-analysis';
        analysisCanvas.style.display = 'none';
        root.appendChild(analysisCanvas);
    }

    faceTrackingRuntime.surfaceRoot = root;
    return { root, video, overlayCanvas, analysisCanvas };
}

async function startFaceTrackingCamera() {
    if (faceTrackingRuntime.running && faceTrackingRuntime.stream) {
        updateFaceTrackingUi();
        setFaceTrackingStatus('OpenCV 眼部追踪摄像头已在运行中。');
        return true;
    }
    if (faceTrackingRuntime.starting) {
        return true;
    }
    const requestId = ++faceTrackingRuntime.startRequestId;
    faceTrackingRuntime.starting = true;
    const { video, overlayCanvas, analysisCanvas } = ensureFaceTrackingSurface();

    try {
        await ensureFaceTrackingClassifier();
    } catch (err) {
        console.error(err);
        setFaceTrackingStatus(`OpenCV 初始化失败：${err.message || err}`);
        return false;
    }

    if (faceTrackingRuntime.running && faceTrackingRuntime.stream) {
        updateFaceTrackingUi();
        setFaceTrackingStatus('摄像头已在运行中。');
        return true;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 },
            },
        });

        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();

        if (requestId !== faceTrackingRuntime.startRequestId) {
            for (const track of stream.getTracks()) {
                track.stop();
            }
            return false;
        }

        faceTrackingRuntime.stream = stream;
        faceTrackingRuntime.running = true;
        faceTrackingRuntime.videoEl = video;
        faceTrackingRuntime.overlayCanvas = overlayCanvas;
        faceTrackingRuntime.overlayCtx = overlayCanvas.getContext('2d');
        faceTrackingRuntime.analysisCanvas = analysisCanvas;
        faceTrackingRuntime.analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
        faceTrackingRuntime.lastFrameAt = 0;
        faceTrackingRuntime.lastDetection = null;

        const storedCalibration = avatarState.faceTracking.calibration;
        if (storedCalibration) {
            avatarState.faceTracking.calibrated = true;
        }
        avatarState.faceTracking.cameraActive = true;

        setFaceTrackingStatus(
            avatarState.faceTracking.enabled
                ? '摄像头已启动，等待人脸出现或点击“校准”。'
                : '摄像头已启动，但追踪未启用。'
        );
        updateFaceTrackingUi();
        scheduleFaceTrackingFrame();
        return true;
    } catch (err) {
        console.error('Face tracking camera error:', err);
        setFaceTrackingStatus(`摄像头启动失败：${err.message || err}`);
        faceTrackingRuntime.running = false;
        return false;
    } finally {
        faceTrackingRuntime.starting = false;
    }
}

function stopFaceTrackingCamera() {
    faceTrackingRuntime.running = false;
    faceTrackingRuntime.starting = false;
    faceTrackingRuntime.startRequestId += 1;
    if (faceTrackingRuntime.loopId) {
        cancelAnimationFrame(faceTrackingRuntime.loopId);
        faceTrackingRuntime.loopId = 0;
    }

    if (faceTrackingRuntime.stream) {
        for (const track of faceTrackingRuntime.stream.getTracks()) {
            track.stop();
        }
    }
    faceTrackingRuntime.stream = null;
    if (faceTrackingRuntime.videoEl) {
        faceTrackingRuntime.videoEl.srcObject = null;
    }
    faceTrackingRuntime.lastDetection = null;
    faceTrackingRuntime.currentPose = { head_pitch: 0, head_yaw: 0, head_roll: 0 };
    faceTrackingRuntime.currentSignals = {
        eye_open: 1.0,
        left_eye_open: 1.0,
        right_eye_open: 1.0,
        mouth_open: 0.0,
        smile: 0.0,
        blink: 0.0,
        roll: 0.0,
        confidence: 0.0,
    };
    avatarState.faceTracking.cameraActive = false;
    avatarState.faceTracking.pose = { ...faceTrackingRuntime.currentPose };
    avatarState.faceTracking.signals = { ...faceTrackingRuntime.currentSignals };
    clearFaceTrackingPose();
    updateFaceTrackingUi();
    setFaceTrackingStatus('OpenCV 眼部追踪摄像头已停止。');
    drawFaceTrackingOverlay(null, faceTrackingRuntime.analysisCanvas?.width || 1, faceTrackingRuntime.analysisCanvas?.height || 1);
    refreshAvatarRendererState();
}

function calibrateFaceTracking() {
    const lastDetection = faceTrackingRuntime.lastDetection;
    const analysisCanvas = faceTrackingRuntime.analysisCanvas;
    if (!lastDetection || !analysisCanvas) {
        setFaceTrackingStatus('请先把脸对准摄像头，再点击“校准”。');
        return false;
    }

    const width = analysisCanvas.width || lastDetection.frameWidth || 1;
    const height = analysisCanvas.height || lastDetection.frameHeight || 1;
    avatarState.faceTracking.calibration = {
        centerXRatio: clampNumber(lastDetection.centerX / width, 0, 1, 0.5),
        centerYRatio: clampNumber(lastDetection.centerY / height, 0, 1, 0.5),
        faceWidthRatio: clampNumber(lastDetection.rawRect.width / width, 0.05, 1, 0.28),
        faceHeightRatio: clampNumber(lastDetection.rawRect.height / height, 0.05, 1, 0.38),
        coordinateSpace: 'raw',
        createdAt: Date.now(),
    };
    avatarState.faceTracking.calibrated = true;
    faceTrackingRuntime.currentPose = { head_pitch: 0, head_yaw: 0, head_roll: 0 };
    persistFaceTrackingPreferences();
    updateFaceTrackingUi();
    setFaceTrackingStatus('面部追踪已校准。请尽量正对摄像头。');
    refreshAvatarRendererState();
    return true;
}

function resetFaceTrackingCalibration() {
    avatarState.faceTracking.calibration = null;
    avatarState.faceTracking.calibrated = false;
    faceTrackingRuntime.currentPose = { head_pitch: 0, head_yaw: 0, head_roll: 0 };
    persistFaceTrackingPreferences();
    updateFaceTrackingUi();
    setFaceTrackingStatus('面部追踪校准已清空。');
}

async function handleFaceTrackingControlMessage(message = {}) {
    const type = message?.type;
    switch (type) {
        case 'set-enabled': {
            setFaceTrackingEnabled(!!message.enabled);
            if (message.enabled && avatarState.faceTracking.autoStart !== false && !faceTrackingRuntime.running) {
                await startFaceTrackingCamera();
            }
            if (!message.enabled) {
                stopFaceTrackingCamera();
            }
            break;
        }
        case 'set-auto-start':
            setFaceTrackingAutoStart(message.enabled !== false);
            break;
        case 'set-mirror':
            setFaceTrackingMirror(!!message.enabled);
            break;
        case 'start-camera':
            if (!avatarState.faceTracking.enabled) {
                setFaceTrackingEnabled(true);
            }
            await startFaceTrackingCamera();
            break;
        case 'stop-camera':
            stopFaceTrackingCamera();
            break;
        case 'calibrate': {
            const ok = calibrateFaceTracking();
            if (ok && !avatarState.faceTracking.enabled) {
                setFaceTrackingEnabled(true);
            }
            break;
        }
        case 'reset-calibration':
            resetFaceTrackingCalibration();
            break;
        case 'apply-settings':
            applyFaceTrackingPreferences();
            updateFaceTrackingUi();
            if (message.enabled !== undefined) {
                setFaceTrackingEnabled(!!message.enabled);
            }
            if (message.autoStart !== undefined) {
                setFaceTrackingAutoStart(!!message.autoStart);
            }
            if (message.mirror !== undefined) {
                setFaceTrackingMirror(!!message.mirror);
            }
            if (message.enabled === false && faceTrackingRuntime.running) {
                stopFaceTrackingCamera();
            }
            if (message.enabled !== false && message.start && avatarState.faceTracking.autoStart !== false && !faceTrackingRuntime.running) {
                await startFaceTrackingCamera();
            }
            break;
        default:
            break;
    }
}

function startWaveformLoop() {
    if (waveformLoopStarted) return;
    waveformLoopStarted = true;

    const frame = () => {
        refreshAvatarRendererState();
        drawWaveform();
        requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
}

// ============================================================
// UE5 Pixel Streaming Integration
// ============================================================

const ue5State = {
    connected: false,
    streamActive: false,
    signallingUrl: 'ws://127.0.0.1:8888',
    playerUrl: 'http://localhost:8888',
    iframe: null,
    statusText: null,
    overlay: null,
    autoConnect: true,
    reconnectTimer: null,
    pixelStreamingMode: localStorage.getItem('qdh.ue5Mode') !== 'disabled',
    fallbackAvatar: true, // show model-viewer when UE5 is not connected
};

function initUe5StreamElements() {
    ue5State.iframe = document.getElementById('ue5-stream-container');
    ue5State.statusText = document.getElementById('ue5-status-text');
    ue5State.overlay = document.getElementById('ue5-connection-overlay');
}

function switchToUe5Stream() {
    const container = ue5State.iframe;
    const fallback = document.getElementById('avatar-model-frame');
    const aura = document.getElementById('avatar-aura');
    const ring = document.getElementById('avatar-ring');
    const waveform = document.getElementById('waveform-overlay');
    if (container) container.style.display = 'block';
    if (fallback) fallback.style.display = 'none';
    if (aura) aura.style.display = 'none';
    if (ring) ring.style.display = 'none';
    if (waveform) waveform.style.display = 'none';
    ue5State.streamActive = true;
    ue5State.fallbackAvatar = false;
}

function switchToFallbackAvatar() {
    const container = ue5State.iframe;
    const fallback = document.getElementById('avatar-model-frame');
    const aura = document.getElementById('avatar-aura');
    const ring = document.getElementById('avatar-ring');
    const waveform = document.getElementById('waveform-overlay');
    if (container) container.style.display = 'none';
    if (fallback) fallback.style.display = 'block';
    if (aura) aura.style.display = 'block';
    if (ring) ring.style.display = 'block';
    if (waveform) waveform.style.display = 'block';
    ue5State.streamActive = false;
    ue5State.fallbackAvatar = true;
}

function updateUe5ConnectionStatus(connected, message) {
    ue5State.connected = connected;
    if (ue5State.statusText) {
        ue5State.statusText.textContent = message || (connected ? 'UE5 已连接' : 'UE5 未连接');
    }
    if (ue5State.overlay) {
        ue5State.overlay.style.color = connected ? '#34d399' : '#8ac2ff';
    }
}

function startUe5Stream(pixelStreamingUrl) {
    if (!ue5State.pixelStreamingMode) return;
    const iframeEl = document.getElementById('ue5-stream-iframe');
    if (!iframeEl) return;

    const url = pixelStreamingUrl || ue5State.playerUrl;
    if (iframeEl.src !== url) {
        iframeEl.src = url;
    }

    updateUe5ConnectionStatus(true, '正在连接 Pixel Streaming…');
    switchToUe5Stream();

    // Auto-detect connection: listen for iframe load
    iframeEl.addEventListener('load', () => {
        updateUe5ConnectionStatus(true, 'UE5 流已连接');
    }, { once: true });

    // Fallback: if connection fails within 10 seconds, show fallback
    setTimeout(() => {
        if (!ue5State.connected && ue5State.fallbackAvatar) {
            switchToFallbackAvatar();
            updateUe5ConnectionStatus(false, 'UE5 连接超时');
        }
    }, 10000);
}

function stopUe5Stream() {
    const iframeEl = document.getElementById('ue5-stream-iframe');
    if (iframeEl) {
        iframeEl.src = '';
    }
    updateUe5ConnectionStatus(false, 'UE5 已断开');
    if (ue5State.fallbackAvatar) {
        switchToFallbackAvatar();
    }
}

function toggleUe5Mode(enabled) {
    ue5State.pixelStreamingMode = enabled;
    localStorage.setItem('qdh.ue5Mode', enabled ? 'enabled' : 'disabled');
    if (enabled) {
        startUe5Stream();
    } else {
        stopUe5Stream();
        switchToFallbackAvatar();
    }
}

async function initWebGPU() {
    const canvas = document.getElementById('webgpu-canvas');
    if (!navigator.gpu) {
        throw new Error('WebGPU not supported on this browser.');
    }

    await waitForCanvasReady(canvas);

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    // ============================================================
    // WGSL Shader: SDF-based procedural face
    // ============================================================
    const wgsl = /* wgsl */ `
        struct Uniforms {
            time: f32,
            mouth_open: f32,
            smile: f32,
            blink: f32,
            head_pitch: f32,
            head_yaw: f32,
            head_roll: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexOutput {
            @builtin(position) position: vec4<f32>,
            @location(0) uv: vec2<f32>,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
            var pos = array<vec2<f32>, 6>(
                vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0),
                vec2(-1.0, -1.0), vec2( 1.0,  1.0), vec2(-1.0,  1.0),
            );
            var out: VertexOutput;
            out.position = vec4(pos[idx], 0.0, 1.0);
            out.uv = pos[idx];
            return out;
        };

        // Rotate a 2D point
        fn rot2d(p: vec2<f32>, angle: f32) -> vec2<f32> {
            let c = cos(angle);
            let s = sin(angle);
            return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        }

        // Smooth union
        fn smin(a: f32, b: f32, k: f32) -> f32 {
            let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
            return mix(b, a, h) - k * h * (1.0 - h);
        }

        // Vertical ellipse SDF (aspect < 1 = taller than wide)
        fn ellipse_sdf(p: vec2<f32>, center: vec2<f32>, rx: f32, ry: f32) -> f32 {
            let q = (p - center) / vec2(rx, ry);
            return length(q) - 1.0;
        }

        @fragment
        fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
            var uv = in.uv;

            // Apply head rotation (simplified 2D projection)
            let yaw = uniforms.head_yaw * 0.5;
            let pitch = uniforms.head_pitch * 0.3;
            let roll = uniforms.head_roll;
            uv = rot2d(uv, roll);
            uv.x += yaw;
            uv.y += pitch;

            // Face colors
            let skin_color = vec3(0.96, 0.86, 0.75);
            let skin_shadow = vec3(0.82, 0.70, 0.60);
            let eye_white = vec3(0.98, 0.98, 0.98);
            let iris_color = vec3(0.2, 0.3, 0.55);
            let pupil_color = vec3(0.05, 0.05, 0.08);
            let mouth_inner = vec3(0.6, 0.2, 0.2);
            let hair_color = vec3(0.15, 0.12, 0.10);
            let bg_color = vec3(0.04, 0.04, 0.06);

            // Head ellipse
            let head_d = ellipse_sdf(uv, vec2(0.0, 0.0), 0.42, 0.55);

            var color = bg_color;

            if head_d < 0.0 {
                // Inside head
                color = skin_color;

                // Subtle shadow on the left side of the face
                if uv.x < -0.05 {
                    color = mix(color, skin_shadow, 0.15);
                }

                // --- Eyes ---
                let blink_h = uniforms.blink * 0.85; // how much eyes close
                let eye_y = 0.12;
                let eye_rx = 0.08;
                let eye_ry = max(0.01, 0.09 * (1.0 - blink_h));

                let left_eye_d = ellipse_sdf(uv, vec2(-0.13, eye_y), eye_rx, eye_ry);
                let right_eye_d = ellipse_sdf(uv, vec2(0.13, eye_y), eye_rx, eye_ry);

                // Eye whites
                if left_eye_d < 0.0 || right_eye_d < 0.0 {
                    color = eye_white;
                }

                // Irises
                let iris_rx = 0.035;
                let iris_ry = max(0.01, 0.04 * (1.0 - blink_h));
                let left_iris_d = ellipse_sdf(uv, vec2(-0.13, eye_y), iris_rx, iris_ry);
                let right_iris_d = ellipse_sdf(uv, vec2(0.13, eye_y), iris_rx, iris_ry);

                if left_iris_d < -0.005 || right_iris_d < -0.005 {
                    color = iris_color;
                }

                // Pupils
                let pupil_rx = 0.018;
                let pupil_ry = max(0.005, 0.02 * (1.0 - blink_h));
                let left_pupil_d = ellipse_sdf(uv, vec2(-0.13, eye_y), pupil_rx, pupil_ry);
                let right_pupil_d = ellipse_sdf(uv, vec2(0.13, eye_y), pupil_rx, pupil_ry);

                if left_pupil_d < -0.002 || right_pupil_d < -0.002 {
                    color = pupil_color;
                }

                // Eye shine
                let shine_d = ellipse_sdf(uv, vec2(-0.135, eye_y + 0.018), 0.01, 0.012);
                let shine2_d = ellipse_sdf(uv, vec2(0.125, eye_y + 0.018), 0.01, 0.012);
                if shine_d < 0.0 || shine2_d < 0.0 {
                    color = vec3(1.0);
                }

                // --- Eyebrows ---
                let brow_smile = uniforms.smile * 0.02;
                let brow_y = eye_y + 0.12 + blink_h * 0.02;
                let left_brow_d = ellipse_sdf(uv, vec2(-0.13 + brow_smile, brow_y), 0.07, 0.015);
                let right_brow_d = ellipse_sdf(uv, vec2(0.13 - brow_smile, brow_y), 0.07, 0.015);
                if left_brow_d < 0.0 || right_brow_d < 0.0 {
                    color = mix(color, vec3(0.25, 0.18, 0.12), 0.8);
                }

                // --- Mouth ---
                let mouth_y = -0.22;
                let mouth_h = uniforms.mouth_open * 0.12;
                let mouth_w = 0.13 + uniforms.smile * 0.04;

                // Mouth outer
                let mouth_outer = ellipse_sdf(uv, vec2(0.0, mouth_y), mouth_w, max(0.01, mouth_h + 0.015));
                if mouth_outer < 0.0 {
                    color = mouth_inner;
                }

                // Teeth/tongue inside mouth when open
                if mouth_h > 0.03 {
                    let teeth_d = ellipse_sdf(uv, vec2(0.0, mouth_y - 0.005), mouth_w * 0.85, mouth_h * 0.5);
                    if teeth_d < 0.0 {
                        color = vec3(0.95, 0.95, 0.9);
                    }
                }

                // Lip line (upper lip curve)
                let lip_y = mouth_y + mouth_h;
                let lip_curve = uv.y - lip_y + 0.02 * (uv.x * uv.x) / (0.01 + mouth_w * mouth_w);
                if abs(lip_curve) < 0.008 && abs(uv.x) < mouth_w * 1.1 {
                    color = mix(color, vec3(0.7, 0.4, 0.35), 0.5);
                }

                // --- Nose (simple triangle shadow) ---
                let nose_y = -0.04;
                let nose_shadow = smoothstep(0.04, 0.0, abs(uv.x)) *
                                  smoothstep(0.06, 0.0, abs(uv.y - nose_y + 0.02));
                color = mix(color, skin_shadow, nose_shadow * 0.12);

                // --- Hair ---
                let hair_top = ellipse_sdf(uv, vec2(0.0, 0.0), 0.44, 0.57);
                if hair_top > 0.0 && uv.y > -0.35 {
                    // Hair fringe at top
                    let fringe = uv.y - 0.35 - 0.03 * sin(uv.x * 12.0);
                    if fringe > 0.0 && ellipse_sdf(uv, vec2(0.0, -0.05), 0.43, 0.52) < 0.0 {
                        color = hair_color;
                    }
                }
                // Side hair
                if head_d > -0.03 && uv.y > -0.15 {
                    if abs(uv.x) > 0.35 && ellipse_sdf(uv, vec2(0.0, 0.0), 0.42, 0.55) < 0.01 {
                        color = hair_color;
                    }
                }

                // --- Cheek blush ---
                let blush_r = 0.04 + uniforms.smile * 0.01;
                let left_blush_d = ellipse_sdf(uv, vec2(-0.22, -0.0), blush_r, blush_r * 0.7);
                let right_blush_d = ellipse_sdf(uv, vec2(0.22, -0.0), blush_r, blush_r * 0.7);
                let blush_factor = smoothstep(0.0, blush_r, -left_blush_d) +
                                   smoothstep(0.0, blush_r, -right_blush_d);
                color = mix(color, vec3(1.0, 0.6, 0.6), blush_factor * 0.15);
            }

            // Subtle vignette
            let vignette = 1.0 - length(in.uv) * 0.4;
            color *= vignette;

            return vec4(color, 1.0);
        }
    `;

    const module = device.createShaderModule({ code: wgsl });

    // Uniform buffer
    const uniformSize = 7 * 4; // 7 f32s
    const uniformBuffer = device.createBuffer({
        size: uniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Bind group
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });

    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // ============================================================
    // Render Loop
    // ============================================================
    function frame() {
        const time = (performance.now() - avatarState.startTime) / 1000.0;
        const renderedState = getBlendedAvatarState();

        // Auto-blink every 3-5 seconds
        const blinkCycle = Math.sin(time * 2.3) * 0.5 + 0.5;
        const autoBlink = blinkCycle > 0.98 ? (blinkCycle - 0.98) * 50.0 : 0.0;
        const blinkVal = Math.max(renderedState.expression?.blink ?? 0, autoBlink);

        // Build uniform data
        const uniforms = new Float32Array([
            time,
            renderedState.expression?.mouth_open ?? 0,
            renderedState.expression?.smile ?? 0,
            blinkVal,
            renderedState.posture.head_pitch,
            renderedState.posture.head_yaw + Math.sin(time * 0.7) * 0.02, // subtle idle sway
            renderedState.posture.head_roll,
        ]);

        device.queue.writeBuffer(uniformBuffer, 0, uniforms);

        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(6, 1, 0, 0);
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

async function initOnline3DAvatar() {
    persistDigitalHumanPersonaKey(selectedDigitalHumanPersonaKey);
    refreshAvatarRendererState();

    const modelViewer = document.getElementById('avatar-model-viewer');
    if (!modelViewer) {
        throw new Error('3D model viewer element not found.');
    }

    modelViewer.addEventListener('load', () => {
        const spec = getDigitalHumanPersonaSpec(avatarState.persona);
        setDigitalHumanIntentStatus(`形象：${spec.label}｜在线 3D 模型已加载`);
    });
}

async function initFallbackAvatar() {
    let canvas = document.getElementById('webgpu-canvas');
    if (!canvas) return;


    let ctx = canvas.getContext('2d');
    if (!ctx) {
        const stage = document.getElementById('avatar-stage');
        if (!stage) {
            console.error('2D canvas is not supported.');
            return;
        }

        const replacement = document.createElement('canvas');
        replacement.id = 'webgpu-canvas';
        replacement.style.width = '100%';
        replacement.style.height = '100%';
        replacement.style.display = 'block';
        replacement.width = canvas.width || 1;
        replacement.height = canvas.height || 1;
        canvas.replaceWith(replacement);
        canvas = replacement;
        ctx = canvas.getContext('2d');
    }

    if (!ctx) {
        console.error('2D canvas is not supported.');
        return;
    }

    await waitForCanvasReady(canvas);

    const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const drawBody = (w, h, time) => {
        ctx.clearRect(0, 0, w, h);
        const renderedState = getBlendedAvatarState();
        const expression = renderedState.expression || {};
        const posture = renderedState.posture || {};
        const persona = getDigitalHumanPersonaSpec(avatarState.persona);

        const cx = w * 0.5;
        const cy = h * 0.5;
        const breathe = Math.sin(time * 1.1) * 4.0;
        const sway = posture.head_yaw * 0.22 + Math.sin(time * 0.7) * 0.02;
        const pitch = posture.head_pitch * 0.16;
        const roll = posture.head_roll * 0.35;
        const smile = expression.smile;
        const mouthOpen = expression.mouth_open;
        const blink = Math.min(
            1,
            Math.max(0, (expression.blink ?? 0) + (Math.sin(time * 2.2) > 0.985 ? 1 : 0))
        );

        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#070b12');
        bg.addColorStop(0.55, '#090d15');
        bg.addColorStop(1, '#05070b');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // soft ambient lights and map-themed rings
        ctx.save();
        ctx.globalAlpha = 0.8;
        const glow = ctx.createRadialGradient(cx, h * 0.28, Math.min(w, h) * 0.08, cx, h * 0.28, Math.max(w, h) * 0.38);
        glow.addColorStop(0, 'rgba(40, 180, 220, 0.18)');
        glow.addColorStop(0.55, 'rgba(40, 180, 220, 0.06)');
        glow.addColorStop(1, 'rgba(40, 180, 220, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, h * 0.28, Math.max(w, h) * 0.28, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(100, 200, 255, 0.09)';
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.002);
        ctx.beginPath();
        ctx.arc(cx, h * 0.30, Math.min(w, h) * 0.19, Math.PI * 0.14, Math.PI * 1.82);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, h * 0.30, Math.min(w, h) * 0.23, Math.PI * 0.02, Math.PI * 1.08);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(cx, cy + h * 0.10 + breathe);
        ctx.rotate(roll);
        ctx.translate(sway * w * 0.06, pitch * h * 0.08);

        // body shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.ellipse(0, h * 0.18, w * 0.25, h * 0.055, 0, 0, Math.PI * 2);
        ctx.fill();

        // jacket
        const jacket = ctx.createLinearGradient(0, -h * 0.02, 0, h * 0.34);
        jacket.addColorStop(0, persona.jacket[0]);
        jacket.addColorStop(0.52, persona.jacket[1]);
        jacket.addColorStop(1, persona.jacket[2]);
        ctx.fillStyle = jacket;
        ctx.beginPath();
        ctx.moveTo(-w * 0.34, h * 0.25);
        ctx.bezierCurveTo(-w * 0.28, h * 0.08, -w * 0.16, -h * 0.01, -w * 0.07, -h * 0.01);
        ctx.bezierCurveTo(-w * 0.03, -h * 0.05, -w * 0.015, -h * 0.06, 0, -h * 0.06);
        ctx.bezierCurveTo(w * 0.015, -h * 0.06, w * 0.03, -h * 0.05, w * 0.07, -h * 0.01);
        ctx.bezierCurveTo(w * 0.16, -h * 0.01, w * 0.28, h * 0.08, w * 0.34, h * 0.25);
        ctx.quadraticCurveTo(0, h * 0.39, -w * 0.34, h * 0.25);
        ctx.closePath();
        ctx.fill();

        // shirt / collar
        ctx.fillStyle = '#dfe5ee';
        ctx.beginPath();
        ctx.moveTo(-w * 0.12, h * 0.02);
        ctx.lineTo(-w * 0.04, h * 0.13);
        ctx.lineTo(0, h * 0.06);
        ctx.lineTo(w * 0.04, h * 0.13);
        ctx.lineTo(w * 0.12, h * 0.02);
        ctx.lineTo(w * 0.08, -h * 0.01);
        ctx.lineTo(0, h * 0.05);
        ctx.lineTo(-w * 0.08, -h * 0.01);
        ctx.closePath();
        ctx.fill();

        // neck
        const neckGrad = ctx.createLinearGradient(0, -h * 0.06, 0, h * 0.08);
        neckGrad.addColorStop(0, '#f3cfab');
        neckGrad.addColorStop(1, '#c7946f');
        ctx.fillStyle = neckGrad;
        ctx.fillRect(-w * 0.05, -h * 0.04, w * 0.10, h * 0.10);

        // face base
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-w * 0.10, -h * 0.15);
        ctx.bezierCurveTo(-w * 0.16, -h * 0.05, -w * 0.16, h * 0.08, -w * 0.10, h * 0.15);
        ctx.bezierCurveTo(-w * 0.05, h * 0.23, w * 0.05, h * 0.23, w * 0.10, h * 0.15);
        ctx.bezierCurveTo(w * 0.16, h * 0.08, w * 0.16, -h * 0.05, w * 0.10, -h * 0.15);
        ctx.bezierCurveTo(w * 0.05, -h * 0.22, -w * 0.05, -h * 0.22, -w * 0.10, -h * 0.15);
        ctx.closePath();
        ctx.clip();

        const faceGrad = ctx.createRadialGradient(-w * 0.03, -h * 0.10, w * 0.03, 0, -h * 0.02, w * 0.16);
        faceGrad.addColorStop(0, '#f7dcc0');
        faceGrad.addColorStop(0.55, '#efc89e');
        faceGrad.addColorStop(1, '#d59e72');
        ctx.fillStyle = faceGrad;
        ctx.fillRect(-w * 0.2, -h * 0.24, w * 0.4, h * 0.44);

        // face shading
        const leftShade = ctx.createLinearGradient(-w * 0.12, 0, -w * 0.02, 0);
        leftShade.addColorStop(0, 'rgba(0, 0, 0, 0.14)');
        leftShade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = leftShade;
        ctx.fillRect(-w * 0.12, -h * 0.16, w * 0.10, h * 0.28);

        const rightGlow = ctx.createLinearGradient(w * 0.02, 0, w * 0.12, 0);
        rightGlow.addColorStop(0, 'rgba(255, 255, 255, 0)');
        rightGlow.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
        ctx.fillStyle = rightGlow;
        ctx.fillRect(w * 0.02, -h * 0.16, w * 0.12, h * 0.28);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(-w * 0.04, -h * 0.16, w * 0.06, h * 0.08);
        ctx.restore();

        // ears
        ctx.fillStyle = '#d7a67a';
        ctx.beginPath();
        ctx.ellipse(-w * 0.135, -h * 0.08, w * 0.020, h * 0.046, -0.08, 0, Math.PI * 2);
        ctx.ellipse(w * 0.135, -h * 0.08, w * 0.020, h * 0.046, 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 70, 40, 0.18)';
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0016);
        ctx.beginPath();
        ctx.arc(-w * 0.135, -h * 0.08, w * 0.010, Math.PI * 1.05, Math.PI * 1.82);
        ctx.arc(w * 0.135, -h * 0.08, w * 0.010, Math.PI * 1.28, Math.PI * 1.97);
        ctx.stroke();

        // hair back / top
        const hairGrad = ctx.createLinearGradient(0, -h * 0.18, 0, h * 0.05);
        hairGrad.addColorStop(0, persona.hair[0]);
        hairGrad.addColorStop(0.45, persona.hair[1]);
        hairGrad.addColorStop(1, persona.hair[2]);
        ctx.fillStyle = hairGrad;

        // back hair silhouette
        ctx.beginPath();
        ctx.moveTo(-w * 0.15, -h * 0.16);
        ctx.bezierCurveTo(-w * 0.19, -h * 0.04, -w * 0.18, h * 0.05, -w * 0.13, h * 0.10);
        ctx.bezierCurveTo(-w * 0.08, h * 0.15, w * 0.08, h * 0.15, w * 0.13, h * 0.10);
        ctx.bezierCurveTo(w * 0.18, h * 0.05, w * 0.19, -h * 0.04, w * 0.15, -h * 0.16);
        ctx.bezierCurveTo(w * 0.11, -h * 0.22, -w * 0.11, -h * 0.22, -w * 0.15, -h * 0.16);
        ctx.closePath();
        ctx.fill();

        // top hair cap
        ctx.beginPath();
        ctx.moveTo(-w * 0.13, -h * 0.12);
        ctx.bezierCurveTo(-w * 0.12, -h * 0.22, -w * 0.05, -h * 0.26, 0, -h * 0.26);
        ctx.bezierCurveTo(w * 0.05, -h * 0.26, w * 0.12, -h * 0.22, w * 0.13, -h * 0.12);
        ctx.bezierCurveTo(w * 0.10, -h * 0.08, w * 0.05, -h * 0.06, 0, -h * 0.07);
        ctx.bezierCurveTo(-w * 0.05, -h * 0.06, -w * 0.10, -h * 0.08, -w * 0.13, -h * 0.12);
        ctx.closePath();
        ctx.fill();

        // fringe
        ctx.beginPath();
        ctx.moveTo(-w * 0.12, -h * 0.10);
        ctx.bezierCurveTo(-w * 0.10, -h * 0.20, -w * 0.05, -h * 0.16, -w * 0.02, -h * 0.13);
        ctx.bezierCurveTo(0, -h * 0.11, w * 0.03, -h * 0.17, w * 0.07, -h * 0.18);
        ctx.bezierCurveTo(w * 0.12, -h * 0.19, w * 0.13, -h * 0.10, w * 0.10, -h * 0.05);
        ctx.bezierCurveTo(w * 0.04, -h * 0.01, -w * 0.04, -h * 0.01, -w * 0.12, -h * 0.05);
        ctx.closePath();
        ctx.fill();

        // side locks
        ctx.beginPath();
        ctx.ellipse(-w * 0.16, -h * 0.04, w * 0.03, h * 0.08, -0.15, 0, Math.PI * 2);
        ctx.ellipse(w * 0.16, -h * 0.04, w * 0.03, h * 0.08, 0.15, 0, Math.PI * 2);
        ctx.fill();

        // face features
        const eyeY = -h * 0.04;
        const eyeOffset = w * 0.05;
        const eyeW = w * 0.029;
        const eyeH = h * 0.019 * Math.max(0.18, 1 - blink * 0.88);
        const eyeTilt = smile * 0.08;

        // eye whites
        ctx.fillStyle = '#f7f8fb';
        ctx.beginPath();
        ctx.ellipse(-eyeOffset, eyeY, eyeW * 1.45, eyeH * 1.65, eyeTilt, 0, Math.PI * 2);
        ctx.ellipse(eyeOffset, eyeY, eyeW * 1.45, eyeH * 1.65, -eyeTilt, 0, Math.PI * 2);
        ctx.fill();

        // irises
        ctx.fillStyle = persona.iris;
        ctx.beginPath();
        ctx.ellipse(-eyeOffset, eyeY + h * 0.002, eyeW * 0.74, eyeH * 0.78, 0, 0, Math.PI * 2);
        ctx.ellipse(eyeOffset, eyeY + h * 0.002, eyeW * 0.74, eyeH * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();

        // pupils
        ctx.fillStyle = '#10151f';
        ctx.beginPath();
        ctx.ellipse(-eyeOffset, eyeY + h * 0.003, eyeW * 0.35, eyeH * 0.44, 0, 0, Math.PI * 2);
        ctx.ellipse(eyeOffset, eyeY + h * 0.003, eyeW * 0.35, eyeH * 0.44, 0, 0, Math.PI * 2);
        ctx.fill();

        // eye highlights
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.beginPath();
        ctx.ellipse(-eyeOffset + w * 0.007, eyeY - h * 0.004, eyeW * 0.16, eyeH * 0.16, 0, 0, Math.PI * 2);
        ctx.ellipse(eyeOffset + w * 0.007, eyeY - h * 0.004, eyeW * 0.16, eyeH * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();

        // brows
        ctx.strokeStyle = '#24160f';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.003);
        const browY = eyeY - h * 0.035;
        ctx.beginPath();
        ctx.moveTo(-eyeOffset - w * 0.028, browY + smile * h * 0.007);
        ctx.quadraticCurveTo(-eyeOffset, browY - h * 0.008, -eyeOffset + w * 0.032, browY + smile * h * 0.004);
        ctx.moveTo(eyeOffset - w * 0.032, browY + smile * h * 0.004);
        ctx.quadraticCurveTo(eyeOffset, browY - h * 0.008, eyeOffset + w * 0.028, browY + smile * h * 0.007);
        ctx.stroke();

        // nose
        ctx.strokeStyle = 'rgba(120, 70, 48, 0.40)';
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0018);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.03);
        ctx.quadraticCurveTo(w * 0.01, h * 0.01, -w * 0.004, h * 0.03);
        ctx.stroke();

        // mouth
        const mouthY = h * 0.055 + mouthOpen * h * 0.008;
        ctx.strokeStyle = '#7d2b2a';
        ctx.lineWidth = Math.max(1.2, Math.min(w, h) * 0.0024);
        ctx.beginPath();
        ctx.moveTo(-w * 0.036, mouthY);
        ctx.quadraticCurveTo(0, mouthY + smile * h * 0.024, w * 0.036, mouthY);
        ctx.stroke();
        if (mouthOpen > 0.10) {
            ctx.fillStyle = '#61212b';
            ctx.beginPath();
            ctx.ellipse(0, mouthY + h * 0.012, w * 0.014, h * (0.009 + mouthOpen * 0.025), 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // cheeks / complexion
        ctx.fillStyle = 'rgba(255, 190, 185, 0.14)';
        ctx.beginPath();
        ctx.ellipse(-w * 0.07, -h * 0.005, w * 0.025, h * 0.018, 0, 0, Math.PI * 2);
        ctx.ellipse(w * 0.07, -h * 0.005, w * 0.025, h * 0.018, 0, 0, Math.PI * 2);
        ctx.fill();

        // subtle face highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.beginPath();
        ctx.ellipse(-w * 0.02, -h * 0.12, w * 0.025, h * 0.055, -0.25, 0, Math.PI * 2);
        ctx.fill();

        // jaw / chin shadow
        ctx.strokeStyle = 'rgba(110, 70, 45, 0.14)';
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0015);
        ctx.beginPath();
        ctx.arc(0, h * 0.01, w * 0.07, Math.PI * 0.10, Math.PI * 0.90);
        ctx.stroke();

        ctx.restore();

        // foreground glow and vignette
        const faceGlow = ctx.createRadialGradient(cx, cy * 0.95, Math.min(w, h) * 0.08, cx, cy * 0.95, Math.max(w, h) * 0.55);
        faceGlow.addColorStop(0, 'rgba(255, 255, 255, 0.00)');
        faceGlow.addColorStop(0.75, 'rgba(255, 255, 255, 0.02)');
        faceGlow.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
        ctx.fillStyle = faceGlow;
        ctx.fillRect(0, 0, w, h);
    };

    const frame = () => {
        const time = (performance.now() - avatarState.startTime) / 1000.0;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        drawBody(w, h, time);
        requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
}

async function initAvatarRenderer() {
    try {
        await initOnline3DAvatar();
    } catch (err) {
        console.warn('Online 3D avatar renderer failed, falling back to local 2D renderer:', err);
        await initFallbackAvatar();
    }
}

// ============================================================
// Waveform visualization on 2D canvas overlay
// ============================================================
function drawWaveform() {
    const canvas = document.getElementById('waveform-overlay');
    if (!canvas) return;

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const data = avatarState.waveform;
    if (!data || data.length === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const centerY = h / 2;
    const barWidth = w / data.length;

    ctx.fillStyle = 'rgba(0, 180, 255, 0.7)';

    for (let i = 0; i < data.length; i++) {
        const barHeight = data[i] * (h / 2) * 0.9;
        ctx.fillRect(i * barWidth, centerY - barHeight / 2, barWidth - 1, Math.max(1, barHeight));
    }
}

// ============================================================
// Main Application Logic
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    startWaveformLoop();
    initUe5StreamElements();

    // Auto-start Pixel Streaming if enabled
    if (ue5State.pixelStreamingMode) {
        startUe5Stream();
    }

    void initAvatarRenderer();

    const chatHistory = document.getElementById('chat-history');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const fastModeCheckbox = document.getElementById('fast-mode');
    const voiceBtn = document.getElementById('voice-btn');
    const modelList = document.getElementById('model-list');
    const streamText = document.getElementById('stream-text');
    const systemPromptInput = document.getElementById('system-prompt');
    const memoryInput = document.getElementById('memory-input');
    const contextInput = document.getElementById('context-input');
    const useRagContextCheckbox = document.getElementById('use-rag-context');
    const ttsModeCheckbox = document.getElementById('tts-mode');
    const browserAsrModeCheckbox = document.getElementById('browser-asr-mode');
    const browserTtsModeCheckbox = document.getElementById('browser-tts-mode');
    const collapseThinkCheckbox = document.getElementById('collapse-think');
    const rerankCandidatePoolInput = document.getElementById('rerank-candidate-pool');
    const rerankThresholdInput = document.getElementById('rerank-threshold');
    const rerankTopKInput = document.getElementById('rerank-topk');
    const rerankInstructionInput = document.getElementById('rerank-instruction');
    const refreshContextBtn = document.getElementById('refresh-context-btn');
    const clearContextBtn = document.getElementById('clear-context-btn');
    const mapStatus = document.getElementById('map-status');
    const mapSummary = document.getElementById('map-summary');
    const mapResults = document.getElementById('map-results');
    const mapFrame = document.getElementById('map-frame');
    const mapSearchInput = document.getElementById('map-search-input');
    const mapSearchBtn = document.getElementById('map-search-btn');
    const applyMapContextBtn = document.getElementById('apply-map-context-btn');
    const clearMapBtn = document.getElementById('clear-map-btn');
    const digitalHumanCyclePersonaBtn = document.getElementById('digital-human-cycle-persona-btn');
    const digitalHumanHappyBtn = document.getElementById('digital-human-happy-btn');
    const digitalHumanThinkingBtn = document.getElementById('digital-human-thinking-btn');
    const digitalHumanSurprisedBtn = document.getElementById('digital-human-surprised-btn');
    const digitalHumanSadBtn = document.getElementById('digital-human-sad-btn');
    const digitalHumanAngryBtn = document.getElementById('digital-human-angry-btn');
    const faceTrackingEnabledCheckbox = document.getElementById('face-tracking-enabled');
    const faceTrackingMirrorCheckbox = document.getElementById('face-tracking-mirror');
    const faceTrackingStartBtn = document.getElementById('face-tracking-start-btn');
    const faceTrackingCalibrateBtn = document.getElementById('face-tracking-calibrate-btn');
    const faceTrackingResetBtn = document.getElementById('face-tracking-reset-btn');
    const asrLiveState = document.getElementById('asr-live-state');
    const asrLiveText = document.getElementById('asr-live-text');

    const loadPromptSetting = (key, fallback = '') => localStorage.getItem(key) ?? fallback;
    const savePromptSetting = (key, value) => localStorage.setItem(key, value);
    const normalizeStoredPrompt = (value) => (value === legacySystemPrompt ? DEFAULT_SYSTEM_PROMPT : value);
    const readTextSetting = (input, key, fallback) => {
        if (input) return input.value;
        return normalizeStoredPrompt(loadPromptSetting(key, fallback));
    };
    const readBooleanSetting = (input, key, fallback) => {
        if (input) return input.checked;
        return loadBooleanSetting(key, fallback);
    };
    const readRerankSettings = () => ({
        candidate_pool: Math.max(1, Math.round(clampNumber(
            rerankCandidatePoolInput?.value ?? loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankCandidatePool, DEFAULT_RERANK_CANDIDATE_POOL),
            1,
            64,
            DEFAULT_RERANK_CANDIDATE_POOL,
        ))),
        similarity_threshold: clampNumber(
            rerankThresholdInput?.value ?? loadNumberSetting(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, DEFAULT_RERANK_SIMILARITY_THRESHOLD),
            0,
            1,
            DEFAULT_RERANK_SIMILARITY_THRESHOLD,
        ),
        top_k: Math.max(0, Math.round(clampNumber(
            rerankTopKInput?.value ?? loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankTopK, DEFAULT_RERANK_TOP_K),
            0,
            32,
            DEFAULT_RERANK_TOP_K,
        ))),
        instruction: normalizeStoredPrompt(
            rerankInstructionInput?.value ?? loadPromptSetting(PROMPT_STORAGE_KEYS.rerankInstruction, DEFAULT_RERANK_INSTRUCTION)
        ).trim() || DEFAULT_RERANK_INSTRUCTION,
    });
    const getPromptSettings = () => ({
        system_prompt: normalizeStoredPrompt(readTextSetting(systemPromptInput, PROMPT_STORAGE_KEYS.systemPrompt, DEFAULT_SYSTEM_PROMPT)).trim() || DEFAULT_SYSTEM_PROMPT,
        memory: readTextSetting(memoryInput, PROMPT_STORAGE_KEYS.memory, DEFAULT_MEMORY).trim(),
        context: readTextSetting(contextInput, PROMPT_STORAGE_KEYS.context, '').trim(),
        use_rag_context: readBooleanSetting(useRagContextCheckbox, PROMPT_STORAGE_KEYS.useRagContext, true),
        tts_enabled: readBooleanSetting(ttsModeCheckbox, PROMPT_STORAGE_KEYS.ttsMode, true),
        browser_asr_enabled: readBooleanSetting(browserAsrModeCheckbox, PROMPT_STORAGE_KEYS.browserAsrMode, false),
        browser_tts_enabled: readBooleanSetting(browserTtsModeCheckbox, PROMPT_STORAGE_KEYS.browserTtsMode, false),
        collapse_think: readBooleanSetting(collapseThinkCheckbox, PROMPT_STORAGE_KEYS.collapseThink, true),
        rerank: readRerankSettings(),
    });
    const loadNumberSetting = (key, fallback) => {
        const raw = localStorage.getItem(key);
        if (raw === null || raw.trim() === '') return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    };
    const loadIntegerSetting = (key, fallback) => {
        const raw = localStorage.getItem(key);
        if (raw === null || raw.trim() === '') return fallback;
        const value = Number.parseInt(raw, 10);
        return Number.isFinite(value) ? value : fallback;
    };
    const getRerankSettings = () => ({
        candidate_pool: Math.max(1, Math.round(clampNumber(rerankCandidatePoolInput?.value ?? DEFAULT_RERANK_CANDIDATE_POOL, 1, 64, DEFAULT_RERANK_CANDIDATE_POOL))),
        similarity_threshold: clampNumber(rerankThresholdInput?.value ?? DEFAULT_RERANK_SIMILARITY_THRESHOLD, 0, 1, DEFAULT_RERANK_SIMILARITY_THRESHOLD),
        top_k: Math.max(0, Math.round(clampNumber(rerankTopKInput?.value ?? DEFAULT_RERANK_TOP_K, 0, 32, DEFAULT_RERANK_TOP_K))),
        instruction: rerankInstructionInput?.value ?? DEFAULT_RERANK_INSTRUCTION,
    });
    const persistPromptSettings = () => {
        if (systemPromptInput) savePromptSetting(PROMPT_STORAGE_KEYS.systemPrompt, systemPromptInput.value);
        if (memoryInput) savePromptSetting(PROMPT_STORAGE_KEYS.memory, memoryInput.value);
        if (contextInput) savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        if (useRagContextCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.useRagContext, String(useRagContextCheckbox.checked));
        if (ttsModeCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.ttsMode, String(ttsModeCheckbox.checked));
        if (browserAsrModeCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.browserAsrMode, String(browserAsrModeCheckbox.checked));
        if (browserTtsModeCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.browserTtsMode, String(browserTtsModeCheckbox.checked));
        if (collapseThinkCheckbox) savePromptSetting(PROMPT_STORAGE_KEYS.collapseThink, String(collapseThinkCheckbox.checked));
        if (rerankCandidatePoolInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankCandidatePool, rerankCandidatePoolInput.value);
        if (rerankThresholdInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, rerankThresholdInput.value);
        if (rerankTopKInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankTopK, rerankTopKInput.value);
        if (rerankInstructionInput) savePromptSetting(PROMPT_STORAGE_KEYS.rerankInstruction, rerankInstructionInput.value);
    };
    const loadBooleanSetting = (key, fallback = true) => {
        const value = localStorage.getItem(key);
        if (value === null) return fallback;
        return value !== 'false';
    };

    const legacySystemPrompt = '你是 Qwen Digital Human，一个简洁、友好、会结合上下文回答的数字人助手。请优先用中文回答，除非用户明确要求其他语言。';
    if (systemPromptInput) {
        const stored = loadPromptSetting(PROMPT_STORAGE_KEYS.systemPrompt, DEFAULT_SYSTEM_PROMPT);
        systemPromptInput.value = stored === legacySystemPrompt ? DEFAULT_SYSTEM_PROMPT : stored;
    }
    if (memoryInput) {
        const stored = loadPromptSetting(PROMPT_STORAGE_KEYS.memory, DEFAULT_MEMORY);
        memoryInput.value = stored.trim() ? stored : DEFAULT_MEMORY;
    }
    if (contextInput) contextInput.value = loadPromptSetting(PROMPT_STORAGE_KEYS.context, '');
    if (useRagContextCheckbox) useRagContextCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.useRagContext, true);
    if (ttsModeCheckbox) ttsModeCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.ttsMode, true);
    if (browserAsrModeCheckbox) browserAsrModeCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.browserAsrMode, false);
    if (browserTtsModeCheckbox) browserTtsModeCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.browserTtsMode, false);
    if (collapseThinkCheckbox) collapseThinkCheckbox.checked = loadBooleanSetting(PROMPT_STORAGE_KEYS.collapseThink, true);
    if (rerankCandidatePoolInput) {
        rerankCandidatePoolInput.value = String(loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankCandidatePool, DEFAULT_RERANK_CANDIDATE_POOL));
    }
    if (rerankThresholdInput) {
        rerankThresholdInput.value = String(loadNumberSetting(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, DEFAULT_RERANK_SIMILARITY_THRESHOLD));
    }
    if (rerankTopKInput) {
        rerankTopKInput.value = String(loadIntegerSetting(PROMPT_STORAGE_KEYS.rerankTopK, DEFAULT_RERANK_TOP_K));
    }
    if (rerankInstructionInput) {
        const stored = loadPromptSetting(PROMPT_STORAGE_KEYS.rerankInstruction, DEFAULT_RERANK_INSTRUCTION);
        rerankInstructionInput.value = stored.trim() ? stored : DEFAULT_RERANK_INSTRUCTION;
    }
    persistPromptSettings();

    applyFaceTrackingPreferences();
    updateFaceTrackingUi();
    setFaceTrackingStatus(
        avatarState.faceTracking.enabled
            ? 'OpenCV 眼部追踪模式已启用，主页面将使用摄像头跟踪人眼。'
            : 'OpenCV 眼部追踪模式已关闭。'
    );

    if (typeof BroadcastChannel !== 'undefined') {
        faceTrackingControlChannel = new BroadcastChannel(FACE_TRACKING_CONTROL_CHANNEL_NAME);
        faceTrackingControlChannel.addEventListener('message', (event) => {
            void handleFaceTrackingControlMessage(event.data || {});
        });
    }

    window.addEventListener('storage', (event) => {
        if (!event.key) return;
        const watchedKeys = new Set([
            FACE_TRACKING_STORAGE_KEYS.enabled,
            FACE_TRACKING_STORAGE_KEYS.autoStart,
            FACE_TRACKING_STORAGE_KEYS.mirror,
            FACE_TRACKING_STORAGE_KEYS.smooth,
            FACE_TRACKING_STORAGE_KEYS.yawGain,
            FACE_TRACKING_STORAGE_KEYS.pitchGain,
            FACE_TRACKING_STORAGE_KEYS.blend,
            FACE_TRACKING_STORAGE_KEYS.calibration,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.enabled,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.autoStart,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.mirror,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.smooth,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.yawGain,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.pitchGain,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.blend,
            FACE_TRACKING_LEGACY_STORAGE_KEYS.calibration,
        ]);
        if (!watchedKeys.has(event.key)) return;
        applyFaceTrackingPreferences();
        updateFaceTrackingUi();
        if (!avatarState.faceTracking.enabled && faceTrackingRuntime.running) {
            stopFaceTrackingCamera();
            return;
        }
        if (avatarState.faceTracking.enabled && avatarState.faceTracking.autoStart && !faceTrackingRuntime.running) {
            void startFaceTrackingCamera();
        }
    });

    if (avatarState.faceTracking.enabled && avatarState.faceTracking.autoStart) {
        queueMicrotask(() => {
            void startFaceTrackingCamera();
        });
    }

    const sanitizeReply = (text) => sanitizeAssistantText(text, collapseThinkCheckbox?.checked ?? true);
    const assistantName = ASSISTANT_LABEL;

    // Model Management
    async function updateModelStatus() {
        const res = await fetch('/api/models/status');
        const models = await res.json();
        modelList.innerHTML = models.map(m => {
            const name = m.name;
            const installed = m.installed;
            return `<span title="${installed ? 'Downloaded' : 'Missing'}">${name}: ${installed ? 'OK' : 'NO'}</span>`;
        }).join(' | ');
    }
    updateModelStatus();

    const DEFAULT_MAP_PLACE = {
        display_name: '北京天安门广场（默认讲解中心）',
        lat: 39.9087,
        lon: 116.3975,
        bounds: { south: 39.8937, north: 39.9237, west: 116.3775, east: 116.4175 },
        category: 'tourist_attraction',
        kind: 'default',
        importance: 1.0,
        map_url: 'https://www.openstreetmap.org/export/embed.html?bbox=116.3775%2C39.8937%2C116.4175%2C39.9237&layer=mapnik&marker=39.9087%2C116.3975',
        summary: '北京天安门广场（默认讲解中心）\n坐标：39.908700, 116.397500\n类型：default',
    };
    const MAP_CONTEXT_MARKER = '【地图讲解上下文】';
    let selectedMapPlace = DEFAULT_MAP_PLACE;
    let currentMapResults = [DEFAULT_MAP_PLACE];

    const mapContextText = (place) => [
        MAP_CONTEXT_MARKER,
        `地点：${place.display_name}`,
        `坐标：${Number(place.lat).toFixed(6)}, ${Number(place.lon).toFixed(6)}`,
        `类型：${place.kind || 'unknown'}`,
        `分类：${place.category || 'unknown'}`,
        `讲解要求：请以地图数字人讲解员的口吻，优先说明该地点的地理位置、周边地标、交通到达方式、适合人群与游览建议；语言简洁、自然、专业。`,
        `如果用户继续追问，请围绕当前地点继续讲解，不要偏离地图主题。`,
    ].join('\n');

    const mapFrameUrl = (place) => {
        if (place?.map_url) return place.map_url;
        const lat = Number(place?.lat ?? 39.9087);
        const lon = Number(place?.lon ?? 116.3975);
        const bounds = place?.bounds || {};
        const south = Number(bounds.south ?? lat - 0.01);
        const north = Number(bounds.north ?? lat + 0.01);
        const west = Number(bounds.west ?? lon - 0.01);
        const east = Number(bounds.east ?? lon + 0.01);
        return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${lat}%2C${lon}`;
    };

    const setMapStatus = (message) => {
        if (mapStatus) {
            mapStatus.textContent = message;
        }
    };

    const renderMapSummary = (place) => {
        if (mapSummary) {
            mapSummary.textContent = place?.summary || mapContextText(place);
        }
    };

    const renderMapResults = (results) => {
        if (!mapResults) return;

        mapResults.innerHTML = '';
        if (!results || !results.length) {
            const empty = document.createElement('div');
            empty.className = 'map-result';
            empty.style.cursor = 'default';
            empty.textContent = '暂无结果，请输入地点后搜索。';
            mapResults.appendChild(empty);
            return;
        }

        results.forEach((place, index) => {
            const card = document.createElement('div');
            card.className = `map-result${selectedMapPlace?.display_name === place.display_name && selectedMapPlace?.lat === place.lat && selectedMapPlace?.lon === place.lon ? ' selected' : ''}`;
            const title = document.createElement('div');
            const strong = document.createElement('strong');
            strong.textContent = place.display_name;
            title.appendChild(strong);
            const small = document.createElement('small');
            small.textContent = place.summary || `坐标：${Number(place.lat).toFixed(4)}, ${Number(place.lon).toFixed(4)}`;
            card.appendChild(title);
            card.appendChild(small);
            card.addEventListener('click', () => {
                selectMapPlace(place, { announce: true });
            });
            mapResults.appendChild(card);

            if (index === 0 && results.length === 1) {
                card.classList.add('selected');
            }
        });
    };

    function writeMapContext(place) {
        if (!contextInput) return;

        const existing = contextInput.value.trim();
        const cleaned = existing
            .replace(/(?:^|\n\n)【地图讲解上下文】[\s\S]*?(?=\n\n|$)/g, '')
            .trim();

        const block = mapContextText(place);
        contextInput.value = cleaned ? `${block}\n\n${cleaned}` : block;
        savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        setMapStatus(`已写入上下文：${place.display_name}`);
    }

    function selectMapPlace(place, { announce = false } = {}) {
        selectedMapPlace = place;
        if (mapFrame) {
            mapFrame.src = mapFrameUrl(place);
        }
        renderMapSummary(place);
        renderMapResults(currentMapResults);
        if (announce) {
            setMapStatus(`已选中：${place.display_name}`);
        }
    }

    function resetMapPanel() {
        selectedMapPlace = DEFAULT_MAP_PLACE;
        currentMapResults = [DEFAULT_MAP_PLACE];
        if (mapSearchInput) {
            mapSearchInput.value = '';
        }
        if (mapFrame) {
            mapFrame.src = mapFrameUrl(DEFAULT_MAP_PLACE);
        }
        renderMapSummary(DEFAULT_MAP_PLACE);
        renderMapResults(currentMapResults);
        setMapStatus('默认定位：北京天安门广场。可搜索地点并写入上下文。');
    }

    async function searchMapPlaces() {
        const query = mapSearchInput?.value.trim() || '';
        if (!query) {
            setMapStatus('请输入地点名称后再搜索。');
            return;
        }

        setMapStatus(`正在搜索：${query} ...`);
        try {
            const res = await fetch('/api/map/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, limit: 5 }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }

            currentMapResults = Array.isArray(data.results) && data.results.length
                ? data.results
                : [DEFAULT_MAP_PLACE];
            selectedMapPlace = currentMapResults[0];
            selectMapPlace(selectedMapPlace, { announce: false });
            setMapStatus(`搜索完成：${query}（${currentMapResults.length} 个结果）`);
        } catch (err) {
            console.error(err);
            setMapStatus(`地图搜索失败：${err.message || err}`);
        }
    }

    resetMapPanel();

    const refreshContextFromRag = async () => {
        const lastUserMessage = Array.from(chatHistory.querySelectorAll('.user-message')).pop()?.textContent || '';
        const query = chatInput.value.trim() || lastUserMessage.replace(/^You:\s*/, '').trim();
        if (!query) {
            streamText.textContent = '请先输入一段问题再刷新上下文';
            return;
        }

        const res = await fetch('/api/context/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                rerank: getRerankSettings(),
            }),
        });
        const data = await res.json();
        if (contextInput) {
            contextInput.value = data.context || '';
            savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        }
        streamText.textContent = data.context ? '上下文已刷新' : '上下文为空';
    };

    const clearContextDraft = () => {
        if (contextInput) contextInput.value = '';
        if (useRagContextCheckbox) useRagContextCheckbox.checked = false;
        savePromptSetting(PROMPT_STORAGE_KEYS.context, '');
        savePromptSetting(PROMPT_STORAGE_KEYS.useRagContext, 'false');
        streamText.textContent = '上下文已清空';
    };

    if (systemPromptInput) systemPromptInput.addEventListener('input', persistPromptSettings);
    if (memoryInput) memoryInput.addEventListener('input', persistPromptSettings);
    if (contextInput) contextInput.addEventListener('input', persistPromptSettings);
    if (useRagContextCheckbox) useRagContextCheckbox.addEventListener('change', persistPromptSettings);
    if (ttsModeCheckbox) ttsModeCheckbox.addEventListener('change', persistPromptSettings);
    if (browserTtsModeCheckbox) browserTtsModeCheckbox.addEventListener('change', persistPromptSettings);
    if (collapseThinkCheckbox) collapseThinkCheckbox.addEventListener('change', persistPromptSettings);
    if (rerankCandidatePoolInput) rerankCandidatePoolInput.addEventListener('input', persistPromptSettings);
    if (rerankThresholdInput) rerankThresholdInput.addEventListener('input', persistPromptSettings);
    if (rerankTopKInput) rerankTopKInput.addEventListener('input', persistPromptSettings);
    if (rerankInstructionInput) rerankInstructionInput.addEventListener('input', persistPromptSettings);
    if (refreshContextBtn) refreshContextBtn.addEventListener('click', () => void refreshContextFromRag());
    if (clearContextBtn) clearContextBtn.addEventListener('click', clearContextDraft);
    if (mapSearchBtn) mapSearchBtn.addEventListener('click', () => void searchMapPlaces());
    if (mapSearchInput) {
        mapSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void searchMapPlaces();
            }
        });
    }
    if (applyMapContextBtn) applyMapContextBtn.addEventListener('click', () => writeMapContext(selectedMapPlace));
    if (clearMapBtn) clearMapBtn.addEventListener('click', () => {
        if (contextInput) {
            const cleaned = contextInput.value
                .replace(/(?:^|\n\n)【地图讲解上下文】[\s\S]*?(?=\n\n|$)/g, '')
                .trim();
            contextInput.value = cleaned;
            savePromptSetting(PROMPT_STORAGE_KEYS.context, contextInput.value);
        }
        resetMapPanel();
        setMapStatus('地图已清空，恢复默认定位。');
    });

    const bindDigitalHumanAction = (button, intent) => {
        if (!button) return;
        button.addEventListener('click', () => {
            void triggerAvatarIntent(intent, { source: 'button' });
        });
    };

    bindDigitalHumanAction(digitalHumanCyclePersonaBtn, { kind: 'switch_persona_cycle', label: '切换形象' });
    bindDigitalHumanAction(digitalHumanHappyBtn, { kind: 'expression', expression: 'happy', motion: 'tap_body', label: '开心' });
    bindDigitalHumanAction(digitalHumanThinkingBtn, { kind: 'expression', expression: 'thinking', motion: 'idle', label: '思考' });
    bindDigitalHumanAction(digitalHumanSurprisedBtn, { kind: 'expression', expression: 'surprised', motion: 'flick_head', label: '惊讶' });
    bindDigitalHumanAction(digitalHumanSadBtn, { kind: 'expression', expression: 'sad', motion: 'pinch_in', label: '难过' });
    bindDigitalHumanAction(digitalHumanAngryBtn, { kind: 'expression', expression: 'angry', motion: 'shake', label: '生气' });

    if (faceTrackingEnabledCheckbox) {
        faceTrackingEnabledCheckbox.addEventListener('change', () => {
            setFaceTrackingEnabled(faceTrackingEnabledCheckbox.checked);
        });
    }
    if (faceTrackingMirrorCheckbox) {
        faceTrackingMirrorCheckbox.addEventListener('change', () => {
            setFaceTrackingMirror(faceTrackingMirrorCheckbox.checked);
        });
    }
    if (faceTrackingStartBtn) {
        faceTrackingStartBtn.addEventListener('click', async () => {
            if (faceTrackingRuntime.running) {
                stopFaceTrackingCamera();
                return;
            }
            const started = await startFaceTrackingCamera();
            if (started && !avatarState.faceTracking.enabled) {
                setFaceTrackingEnabled(true);
            }
        });
    }
    if (faceTrackingCalibrateBtn) {
        faceTrackingCalibrateBtn.addEventListener('click', () => {
            const ok = calibrateFaceTracking();
            if (ok && !avatarState.faceTracking.enabled) {
                setFaceTrackingEnabled(true);
            }
        });
    }
    if (faceTrackingResetBtn) {
        faceTrackingResetBtn.addEventListener('click', () => {
            resetFaceTrackingCalibration();
        });
    }
    window.addEventListener('beforeunload', () => {
        stopFaceTrackingCamera();
        try {
            faceTrackingControlChannel?.close();
        } catch {
            // ignore channel teardown issues
        }
    });

    // WebSocket ASR Streaming
    let asrWs;
    let latestRealtimeAsrText = '';
    let latestRealtimeAsrFinal = false;
    let awaitingRealtimeAsrFinal = false;
    let activeAsrMode = 'local';
    let realtimeAsrBubble = null;
    let realtimeAsrWaitResolve = null;
    let realtimeAsrWaitTimer = null;
    const BrowserSpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    let browserAsrRecognition = null;
    let browserAsrRunning = false;
    let browserAsrStopRequested = false;
    let browserAsrRestartTimer = null;
    let browserAsrFinalTranscript = '';
    let browserAsrInterimTranscript = '';

    function setAsrLivePanel(state, text, tone = 'idle') {
        if (asrLiveState) {
            asrLiveState.textContent = state;
            asrLiveState.dataset.tone = tone;
        }
        if (asrLiveText) {
            asrLiveText.textContent = text;
            asrLiveText.dataset.tone = tone;
        }
    }

    function ensureAsrLiveBubble(initialText = '监听中…') {
        if (!realtimeAsrBubble) {
            realtimeAsrBubble = addMessage('ASR', initialText, true);
            realtimeAsrBubble.classList.add('asr-live-message');
            realtimeAsrBubble.dataset.tone = 'listening';
        }
        return realtimeAsrBubble;
    }

    function updateAsrLiveBubble(text, tone = 'listening') {
        const bubble = ensureAsrLiveBubble(text || '...');
        bubble.textContent = text ? `ASR: ${text}` : 'ASR: ...';
        bubble.dataset.tone = tone;
        bubble.classList.add('asr-live-message');
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return bubble;
    }

    function clearRealtimeAsrWait() {
        if (realtimeAsrWaitTimer) {
            clearTimeout(realtimeAsrWaitTimer);
            realtimeAsrWaitTimer = null;
        }
        realtimeAsrWaitResolve = null;
    }

    function resetRealtimeAsrCapture() {
        latestRealtimeAsrText = '';
        latestRealtimeAsrFinal = false;
        awaitingRealtimeAsrFinal = false;
        clearRealtimeAsrWait();
        browserAsrFinalTranscript = '';
        browserAsrInterimTranscript = '';
        browserAsrStopRequested = false;
        if (browserAsrRestartTimer) {
            clearTimeout(browserAsrRestartTimer);
            browserAsrRestartTimer = null;
        }
    }

    function resolveRealtimeAsrWait(text) {
        if (realtimeAsrWaitResolve) {
            const resolve = realtimeAsrWaitResolve;
            clearRealtimeAsrWait();
            awaitingRealtimeAsrFinal = false;
            resolve(text);
        }
    }

    function waitForRealtimeAsrFinal(timeoutMs = 1200) {
        if (!awaitingRealtimeAsrFinal) {
            return Promise.resolve('');
        }
        if (latestRealtimeAsrFinal) {
            awaitingRealtimeAsrFinal = false;
            return Promise.resolve(latestRealtimeAsrText.trim());
        }

        clearRealtimeAsrWait();
        return new Promise((resolve) => {
            realtimeAsrWaitResolve = resolve;
            realtimeAsrWaitTimer = setTimeout(() => {
                const text = latestRealtimeAsrFinal ? latestRealtimeAsrText.trim() : '';
                clearRealtimeAsrWait();
                awaitingRealtimeAsrFinal = false;
                resolve(text);
            }, timeoutMs);
        });
    }

    function isBrowserAsrPreferred() {
        return loadBooleanSetting(PROMPT_STORAGE_KEYS.browserAsrMode, false);
    }

    function ensureBrowserAsrRecognition() {
        if (!BrowserSpeechRecognitionCtor) return null;
        if (browserAsrRecognition) return browserAsrRecognition;

        const recognition = new BrowserSpeechRecognitionCtor();
        recognition.lang = 'zh-CN';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            browserAsrRunning = true;
            setAsrLivePanel('浏览器 ASR 启动', '正在实时识别你的语音…', 'listening');
            updateAsrLiveBubble('正在实时识别你的语音…', 'listening');
            streamText.textContent = '浏览器 ASR：监听中…';
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0]?.transcript?.trim() || '';
                if (!transcript) continue;
                if (result.isFinal) {
                    browserAsrFinalTranscript = [browserAsrFinalTranscript, transcript]
                        .filter(Boolean)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                } else {
                    interimTranscript = transcript;
                }
            }

            browserAsrInterimTranscript = interimTranscript;
            const combined = [browserAsrFinalTranscript, browserAsrInterimTranscript]
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (!combined && !captureRequested) {
                return;
            }

            latestRealtimeAsrText = combined;
            latestRealtimeAsrFinal = false;

            const tone = browserAsrStopRequested ? 'processing' : 'listening';
            setAsrLivePanel(
                browserAsrStopRequested ? '浏览器 ASR 收口中' : '识别中',
                combined || '正在等待更多语音…',
                tone
            );
            updateAsrLiveBubble(combined || '正在等待更多语音…', tone);
            streamText.textContent = `浏览器 ASR：${combined || '...'}`;
        };

        recognition.onerror = (event) => {
            browserAsrRunning = false;
            const message = event?.error || 'unknown error';
            browserAsrStopRequested = true;
            activeAsrMode = 'local';
            setAsrLivePanel('浏览器 ASR 错误', `${message}，已切换本地 ASR 备用。`, 'error');
            streamText.textContent = `浏览器 ASR error: ${message}，已切换本地 ASR 备用。`;
        };

        recognition.onend = () => {
            browserAsrRunning = false;
            const combined = [browserAsrFinalTranscript, browserAsrInterimTranscript]
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            browserAsrInterimTranscript = '';
            browserAsrFinalTranscript = combined;
            latestRealtimeAsrText = combined;

            if (awaitingRealtimeAsrFinal) {
                latestRealtimeAsrFinal = true;
                resolveRealtimeAsrWait(combined);
            }

            if (captureRequested && !browserAsrStopRequested) {
                setAsrLivePanel('浏览器 ASR 续听', combined || '正在继续识别…', combined ? 'processing' : 'listening');
                updateAsrLiveBubble(combined || '正在继续识别…', combined ? 'processing' : 'listening');
                browserAsrRestartTimer = setTimeout(() => {
                    if (!captureRequested || browserAsrStopRequested) return;
                    try {
                        browserAsrRecognition?.start();
                    } catch (err) {
                        console.warn('Browser ASR restart failed:', err);
                    }
                }, 120);
                return;
            }

            const tone = combined ? 'final' : 'idle';
            setAsrLivePanel('识别完成', combined || '本轮未识别到可用文本', tone);
            updateAsrLiveBubble(combined || '本轮未识别到可用文本', tone);
            streamText.textContent = combined ? `最终 ASR：${combined}` : '浏览器 ASR 已结束';
            browserAsrStopRequested = false;
        };

        browserAsrRecognition = recognition;
        return browserAsrRecognition;
    }

    function startBrowserAsrCapture() {
        if (!BrowserSpeechRecognitionCtor) return false;
        const recognition = ensureBrowserAsrRecognition();
        if (!recognition || browserAsrRunning) {
            return Boolean(recognition);
        }

        browserAsrStopRequested = false;
        if (browserAsrRestartTimer) {
            clearTimeout(browserAsrRestartTimer);
            browserAsrRestartTimer = null;
        }
        browserAsrFinalTranscript = '';
        browserAsrInterimTranscript = '';
        latestRealtimeAsrText = '';
        latestRealtimeAsrFinal = false;

        try {
            recognition.start();
            browserAsrRunning = true;
            activeAsrMode = 'browser';
            setAsrLivePanel('浏览器 ASR 准备中', '正在启动浏览器实时识别…', 'listening');
            updateAsrLiveBubble('正在启动浏览器实时识别…', 'listening');
            return true;
        } catch (err) {
            console.warn('Browser ASR start failed, falling back to local ASR:', err);
            activeAsrMode = 'local';
            browserAsrRunning = false;
            return false;
        }
    }

    function stopBrowserAsrCapture() {
        if (!browserAsrRecognition) return;
        browserAsrStopRequested = true;
        if (browserAsrRestartTimer) {
            clearTimeout(browserAsrRestartTimer);
            browserAsrRestartTimer = null;
        }
        if (browserAsrRunning) {
            try {
                browserAsrRecognition.stop();
            } catch (err) {
                console.warn('Browser ASR stop failed:', err);
            }
        }
    }

    function initAsrWs() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        asrWs = new WebSocket(`${protocol}//${window.location.host}/api/ws/asr`);
        asrWs.onmessage = (e) => {
            let payload = e.data;
            try {
                payload = JSON.parse(e.data);
            } catch (_) {}

            if (payload && typeof payload === 'object') {
                if (isBrowserAsrPreferred() && activeAsrMode === 'browser') {
                    return;
                }
                if (isBrowserAsrPreferred() && !captureRequested) {
                    return;
                }
                if (payload.type === 'partial') {
                    if (isBrowserAsrPreferred() && activeAsrMode === 'browser') {
                        return;
                    }
                    if (!captureRequested && !awaitingRealtimeAsrFinal) {
                        return;
                    }
                    const preview = payload.preview || [payload.text, payload.stash].filter(Boolean).join('');
                    latestRealtimeAsrText = preview || payload.text || payload.stash || '';
                    latestRealtimeAsrFinal = false;
                    setAsrLivePanel('识别中', preview || '正在等待更多语音…', 'listening');
                    updateAsrLiveBubble(preview || '正在等待更多语音…', 'listening');
                    streamText.textContent = `实时 ASR：${preview || '...'}`;
                } else if (payload.type === 'final') {
                    if (isBrowserAsrPreferred() && activeAsrMode === 'browser') {
                        return;
                    }
                    if (!awaitingRealtimeAsrFinal) {
                        return;
                    }
                    latestRealtimeAsrText = payload.text || '';
                    latestRealtimeAsrFinal = true;
                    setAsrLivePanel('识别完成', latestRealtimeAsrText || '本轮未识别到可用文本', 'final');
                    updateAsrLiveBubble(latestRealtimeAsrText || '（空）', 'final');
                    resolveRealtimeAsrWait(latestRealtimeAsrText);
                    streamText.textContent = `最终 ASR：${payload.text || ''}`;
                } else if (payload.type === 'status') {
                    const statusMessage =
                        payload.message ||
                        (isBrowserAsrPreferred()
                            ? '后端 ASR 兼容层已连接（浏览器 ASR 优先）'
                            : 'ASR ready');
                    setAsrLivePanel(
                        isBrowserAsrPreferred() ? 'ASR 兼容层' : 'ASR 就绪',
                        statusMessage,
                        'idle'
                    );
                    streamText.textContent = statusMessage;
                } else if (payload.type === 'error') {
                    setAsrLivePanel('ASR 错误', payload.message || 'unknown error', 'error');
                    streamText.textContent = `ASR error: ${payload.message || 'unknown error'}`;
                } else {
                    const fallbackText = payload.preview || payload.text || payload.message || '';
                    if (fallbackText) {
                        setAsrLivePanel('ASR 处理中', fallbackText, 'processing');
                    }
                    streamText.textContent = `Streaming: ${fallbackText}`;
                }
            } else {
                streamText.textContent = `Streaming: ${payload}`;
            }
        };
        asrWs.onclose = () => setTimeout(initAsrWs, 2000);
    }
    if (isBrowserAsrPreferred()) {
        setAsrLivePanel(
            '浏览器 ASR 待命',
            BrowserSpeechRecognitionCtor
                ? '浏览器实时识别已启用，按住说话即可转写。'
                : '当前浏览器不支持 SpeechRecognition；后端仅保留 ASR 兼容协议，不提供本地语音模型。',
            BrowserSpeechRecognitionCtor ? 'idle' : 'error'
        );
    } else {
        setAsrLivePanel('连接中', '正在建立本地 ASR 连接…', 'idle');
    }
    initAsrWs();

    // Microphone / voice pipeline
    let captureRequested = false;

    function createMicPcmRecorder(onChunk) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('Browser does not support microphone capture');
        }

        let mediaStream = null;
        let audioContext = null;
        let sourceNode = null;
        let processorNode = null;
        let zeroGainNode = null;
        let recording = false;
        let sampleRate = 48_000;
        let chunks = [];

        const cleanup = () => {
            try {
                if (processorNode) processorNode.disconnect();
            } catch (_) {}
            try {
                if (sourceNode) sourceNode.disconnect();
            } catch (_) {}
            try {
                if (zeroGainNode) zeroGainNode.disconnect();
            } catch (_) {}
            if (mediaStream) {
                for (const track of mediaStream.getTracks()) {
                    track.stop();
                }
            }
            if (audioContext) {
                audioContext.close().catch(() => {});
            }
            mediaStream = null;
            audioContext = null;
            sourceNode = null;
            processorNode = null;
            zeroGainNode = null;
        };

        return {
            get sampleRate() {
                return sampleRate;
            },
            get recording() {
                return recording;
            },
            async start() {
                if (recording) return true;

                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
                await audioContext.resume();
                sampleRate = audioContext.sampleRate || 48_000;
                chunks = [];

                sourceNode = audioContext.createMediaStreamSource(mediaStream);
                processorNode = audioContext.createScriptProcessor(4096, 1, 1);
                zeroGainNode = audioContext.createGain();
                zeroGainNode.gain.value = 0;

                processorNode.onaudioprocess = (event) => {
                    if (!recording) return;
                    const mono = mixBufferToMono(event.inputBuffer);
                    const pcmBytes = float32ToPcm16Bytes(mono);
                    if (!pcmBytes.length) return;
                    chunks.push(pcmBytes);
                    if (typeof onChunk === 'function') {
                        onChunk(pcmBytes, sampleRate);
                    }
                };

                sourceNode.connect(processorNode);
                processorNode.connect(zeroGainNode);
                zeroGainNode.connect(audioContext.destination);
                recording = true;
                return true;
            },
            stop() {
                const wasRecording = recording;
                recording = false;
                const bytes = concatUint8Arrays(chunks);
                const rate = sampleRate;
                chunks = [];
                cleanup();
                return {
                    bytes: wasRecording ? bytes : new Uint8Array(0),
                    sampleRate: rate,
                };
            },
        };
    }

    const micRecorder = createMicPcmRecorder((pcmBytes, sampleRate) => {
        if (activeAsrMode === 'local' && asrWs && asrWs.readyState === WebSocket.OPEN) {
            const asrSamples = resampleLinearFloat32(
                pcm16leBytesToFloat32(pcmBytes),
                sampleRate || 48_000,
                16_000
            );
            const asrBytes = float32ToPcm16Bytes(asrSamples);
            asrWs.send(asrBytes);
        }
    });

    const submitPipelineAudio = async (base64Audio, audioSampleRate, realtimeTranscription = '') => {
        const promptSettings = getPromptSettings();
        const pipelineStatusMsg = addMessage('System', 'Processing Voice via Pipeline...');
        const transcriptionMsg = realtimeAsrBubble || ensureAsrLiveBubble('等待识别结果…');
        const assistantMsg = addMessage(assistantName, '');
        realtimeAudioPlayer.reset();
        const useBrowserTts = promptSettings.tts_enabled && promptSettings.browser_tts_enabled;
        if (promptSettings.tts_enabled && !useBrowserTts) {
            void realtimeAudioPlayer.ensureRunning();
        }
        setAsrLivePanel('管线处理中', latestRealtimeAsrText || realtimeTranscription || '等待识别结果…', 'processing');
        updateAsrLiveBubble(latestRealtimeAsrText || realtimeTranscription || '等待识别结果…', 'processing');
        streamText.textContent = latestRealtimeAsrText || realtimeTranscription
            ? `实时 ASR：${latestRealtimeAsrText || realtimeTranscription}`
            : '实时 ASR：等待识别结果…';
        let transcription = realtimeTranscription || '';
        let reply = '';
        let streamedAudio = false;

        try {
            const requestBody = {
                audio_base64: base64Audio,
                audio_format: 'pcm16le',
                audio_sample_rate: audioSampleRate,
                fast_mode: fastModeCheckbox.checked,
                stream: true,
                tts_enabled: promptSettings.tts_enabled && !promptSettings.browser_tts_enabled,
                use_rag_context: promptSettings.use_rag_context,
                system_prompt: promptSettings.system_prompt,
                memory: promptSettings.memory,
                context: promptSettings.context,
                rerank: promptSettings.rerank,
                browser_tts_enabled: promptSettings.browser_tts_enabled,
            };
            if (realtimeTranscription && realtimeTranscription.trim()) {
                requestBody.transcription = realtimeTranscription.trim();
            }

            const res = await fetch('/api/pipeline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const result = await readStreamingResponse(res, (event) => {
                if (event.type === 'status') {
                    pipelineStatusMsg.textContent = `System: ${event.message || event.stage || 'Processing...'}`;
                    streamText.textContent = event.message || event.stage || 'Processing...';
                } else if (event.type === 'asr') {
                    transcription = event.text || '';
                    transcriptionMsg.textContent = `ASR: ${transcription}`;
                    transcriptionMsg.dataset.tone = transcription ? 'final' : 'idle';
                    pipelineStatusMsg.textContent = 'System: Speech recognized';
                    setAsrLivePanel('识别完成', transcription || '本轮未识别到可用文本', transcription ? 'final' : 'idle');
                    updateAsrLiveBubble(transcription || '本轮未识别到可用文本', transcription ? 'final' : 'idle');
                    streamText.textContent = `最终 ASR：${transcription}`;
                    void probeAvatarIntent(transcription, { source: 'voice' });
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } else if (event.type === 'delta') {
                    reply += event.text || '';
                    const visibleReply = sanitizeReply(reply);
                    assistantMsg.textContent = `${assistantName}: ${visibleReply}`;
                    streamText.textContent = `Streaming: ${visibleReply}`;
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } else if (event.type === 'audio.delta') {
                    if (event.audio_bytes) {
                        streamedAudio = realtimeAudioPlayer.enqueuePcm16leBytes(
                            event.audio_bytes,
                            event.sample_rate || 24000
                        ) || streamedAudio;
                    } else {
                        streamedAudio = realtimeAudioPlayer.enqueueBase64(
                            event.audio_base64 || '',
                            event.sample_rate || 24000
                        ) || streamedAudio;
                    }
                } else if (event.type === 'error') {
                    throw new Error(event.message || 'Pipeline stream error');
                }
            });

            if (result.streamed) {
                const finalEvent = result.finalEvent || {};
                transcription = finalEvent.transcription || transcription;
                reply = finalEvent.reply || reply;
                const visibleReply = sanitizeReply(reply);
                if (transcription) {
                    void probeAvatarIntent(transcription, { source: 'voice' });
                }
                if (transcription) {
                    transcriptionMsg.textContent = `ASR: ${transcription}`;
                    transcriptionMsg.dataset.tone = 'final';
                    setAsrLivePanel('识别完成', transcription, 'final');
                    updateAsrLiveBubble(transcription, 'final');
                }
                assistantMsg.textContent = `${assistantName}: ${visibleReply}`;
                pipelineStatusMsg.textContent = 'System: Pipeline complete';
                streamText.textContent = transcription ? `最终 ASR：${transcription}` : '';
                chatHistory.scrollTop = chatHistory.scrollHeight;

                if (finalEvent.render_frame) {
                    if (window.updateAvatarState) {
                        window.updateAvatarState({
                            expression: finalEvent.render_frame.expression,
                            posture: finalEvent.render_frame.posture,
                            waveform: finalEvent.render_frame.waveform,
                        });
                    }

                    if (promptSettings.tts_enabled) {
                        if (useBrowserTts) {
                            const browserOk = await playBrowserTTS(visibleReply);
                            if (!browserOk && !streamedAudio) {
                                if (finalEvent.render_frame.audio_bytes) {
                                    playAudioFromBytes(
                                        finalEvent.render_frame.audio_bytes,
                                        finalEvent.render_frame.audio_mime_type || 'audio/wav'
                                    );
                                } else if (finalEvent.render_frame.audio_base64) {
                                    playAudioFromBase64(
                                        finalEvent.render_frame.audio_base64,
                                        finalEvent.render_frame.audio_mime_type || 'audio/wav'
                                    );
                                }
                            }
                        } else if (!streamedAudio) {
                            if (finalEvent.render_frame.audio_bytes) {
                                playAudioFromBytes(
                                    finalEvent.render_frame.audio_bytes,
                                    finalEvent.render_frame.audio_mime_type || 'audio/wav'
                                );
                            } else if (finalEvent.render_frame.audio_base64) {
                                playAudioFromBase64(
                                    finalEvent.render_frame.audio_base64,
                                    finalEvent.render_frame.audio_mime_type || 'audio/wav'
                                );
                            }
                        }
                    }
                }
            } else {
                const data = result.data;
                transcription = data.transcription || '';
                reply = data.llm_reply || '';
                const visibleReply = sanitizeReply(reply);
                if (transcription) {
                    void probeAvatarIntent(transcription, { source: 'voice' });
                }
                transcriptionMsg.textContent = `ASR: ${transcription}`;
                transcriptionMsg.dataset.tone = transcription ? 'final' : 'idle';
                setAsrLivePanel('识别完成', transcription || '本轮未识别到可用文本', transcription ? 'final' : 'idle');
                updateAsrLiveBubble(transcription || '本轮未识别到可用文本', transcription ? 'final' : 'idle');
                assistantMsg.textContent = `${assistantName}: ${visibleReply}`;
                pipelineStatusMsg.textContent = 'System: Pipeline complete';
                streamText.textContent = transcription ? `最终 ASR：${transcription}` : '';
                chatHistory.scrollTop = chatHistory.scrollHeight;

                if (data.render_frame) {
                    if (window.updateAvatarState) {
                        window.updateAvatarState({
                            expression: data.render_frame.expression,
                            posture: data.render_frame.posture,
                            waveform: data.render_frame.waveform,
                        });
                    }

                    if (promptSettings.tts_enabled) {
                        if (useBrowserTts) {
                            const browserOk = await playBrowserTTS(visibleReply);
                            if (!browserOk && !streamedAudio && data.render_frame.audio_base64) {
                                playAudioFromBase64(
                                    data.render_frame.audio_base64,
                                    data.render_frame.audio_mime_type || 'audio/wav'
                                );
                            }
                        } else if (!streamedAudio && data.render_frame.audio_base64) {
                            playAudioFromBase64(
                                data.render_frame.audio_base64,
                                data.render_frame.audio_mime_type || 'audio/wav'
                            );
                        }
                    }
                }
            }
        } catch (err) {
            console.error(err);
            pipelineStatusMsg.textContent = 'System: Pipeline error.';
            assistantMsg.textContent = `${assistantName}: Pipeline error.`;
            streamText.textContent = '';
        }
    };

    const beginVoiceCapture = async () => {
        captureRequested = true;
        try {
            resetRealtimeAsrCapture();
            realtimeAsrBubble = null;
            realtimeAudioPlayer.reset();
            const promptSettings = getPromptSettings();
            const useBrowserAsr = promptSettings.browser_asr_enabled && Boolean(BrowserSpeechRecognitionCtor);
            activeAsrMode = useBrowserAsr ? 'browser' : 'local';

            if (promptSettings.tts_enabled && !promptSettings.browser_tts_enabled) {
                void realtimeAudioPlayer.ensureRunning();
            }

            if (useBrowserAsr) {
                startBrowserAsrCapture();
            }

            let started = false;
            try {
                started = await micRecorder.start();
            } catch (err) {
                if (!useBrowserAsr) throw err;
                console.warn('Local microphone recorder failed, browser ASR can still continue:', err);
            }

            if (!captureRequested) {
                micRecorder.stop();
                if (useBrowserAsr) stopBrowserAsrCapture();
                return;
            }

            voiceBtn.style.background = 'red';
            if (activeAsrMode === 'browser') {
                setAsrLivePanel(
                    '浏览器 ASR 录音中',
                    started
                        ? '请开始说话，浏览器会实时转写。'
                        : '浏览器 ASR 正在运行，本地录音未启动，仍可继续说话。',
                    'listening'
                );
                ensureAsrLiveBubble('等待你开口…').dataset.tone = 'listening';
                streamText.textContent = '浏览器 ASR：等待输入…';
            } else if (started) {
                setAsrLivePanel('录音中', '请开始说话，识别结果会实时显示在这里。', 'listening');
                ensureAsrLiveBubble('等待你开口…').dataset.tone = 'listening';
                streamText.textContent = '实时 ASR：等待输入…';
            }
        } catch (err) {
            captureRequested = false;
            console.error('Mic error:', err);
            if (activeAsrMode === 'browser' && BrowserSpeechRecognitionCtor) {
                setAsrLivePanel(
                    '浏览器 ASR 启动失败',
                    '浏览器实时识别无法启动；后端不再提供本地 ASR 模型推理，请检查浏览器权限或换用支持 SpeechRecognition 的浏览器。',
                    'error'
                );
            } else {
                setAsrLivePanel('麦克风启动失败', '无法打开麦克风，请检查浏览器权限。', 'error');
            }
            streamText.textContent = '麦克风启动失败';
            voiceBtn.style.background = '#28a745';
        }
    };

    const endVoiceCapture = async () => {
        captureRequested = false;
        const { bytes, sampleRate } = micRecorder.stop();
        const useBrowserAsr = activeAsrMode === 'browser';
        if (useBrowserAsr) {
            awaitingRealtimeAsrFinal = true;
            browserAsrStopRequested = true;
            stopBrowserAsrCapture();
        }
        voiceBtn.style.background = '#28a745';
        let realtimeTranscription = '';

        if (useBrowserAsr) {
            setAsrLivePanel('收口中', latestRealtimeAsrText || '等待最终识别结果…', 'processing');
            updateAsrLiveBubble(latestRealtimeAsrText || '等待最终识别结果…', 'processing');
            streamText.textContent = latestRealtimeAsrText
                ? `浏览器 ASR：${latestRealtimeAsrText}`
                : '浏览器 ASR：等待最终识别结果…';
            realtimeTranscription = await waitForRealtimeAsrFinal(1400);
            if (realtimeTranscription) {
                setAsrLivePanel('识别完成', realtimeTranscription, 'final');
                updateAsrLiveBubble(realtimeTranscription, 'final');
            } else if (latestRealtimeAsrText) {
                realtimeTranscription = latestRealtimeAsrText;
                setAsrLivePanel('识别完成', latestRealtimeAsrText, 'final');
                updateAsrLiveBubble(latestRealtimeAsrText, 'final');
            } else {
                setAsrLivePanel('识别完成', '本轮未识别到可用文本。', 'idle');
            }
        } else {
            if (!bytes.length) {
                setAsrLivePanel('待机', '未采集到语音，请重新按住说话。', 'idle');
                streamText.textContent = '实时 ASR：未采集到语音';
                return;
            }

            const base64Audio = uint8ArrayToBase64(bytes);
            if (asrWs && asrWs.readyState === WebSocket.OPEN) {
                awaitingRealtimeAsrFinal = true;
                asrWs.send(JSON.stringify({ type: 'commit' }));
            }
            setAsrLivePanel('收口中', latestRealtimeAsrText || '等待最终识别结果…', 'processing');
            updateAsrLiveBubble(latestRealtimeAsrText || '等待最终识别结果…', 'processing');
            streamText.textContent = latestRealtimeAsrText
                ? `实时 ASR：${latestRealtimeAsrText}`
                : '实时 ASR：等待最终识别结果…';
            realtimeTranscription = await waitForRealtimeAsrFinal(1400);
            if (realtimeTranscription) {
                setAsrLivePanel('识别完成', realtimeTranscription, 'final');
                updateAsrLiveBubble(realtimeTranscription, 'final');
            } else if (latestRealtimeAsrText) {
                realtimeTranscription = latestRealtimeAsrText;
                setAsrLivePanel('识别完成', latestRealtimeAsrText, 'final');
                updateAsrLiveBubble(latestRealtimeAsrText, 'final');
            } else {
                setAsrLivePanel('识别完成', '本轮未识别到可用文本。', 'idle');
            }
            void probeAvatarIntent(realtimeTranscription, { source: 'voice' });
            await submitPipelineAudio(base64Audio, sampleRate, realtimeTranscription);
            return;
        }

        const base64Audio = bytes.length ? uint8ArrayToBase64(bytes) : '';
        void probeAvatarIntent(realtimeTranscription, { source: 'voice' });
        await submitPipelineAudio(base64Audio, sampleRate, realtimeTranscription);
    };

    voiceBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        void beginVoiceCapture();
    });
    voiceBtn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        void endVoiceCapture();
    });
    voiceBtn.addEventListener('pointercancel', () => {
        void endVoiceCapture();
    });
    voiceBtn.addEventListener('pointerleave', () => {
        if (captureRequested || micRecorder.recording) {
            void endVoiceCapture();
        }
    });

    function base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            byteArrays.push(new Uint8Array(byteNumbers));
        }
        return new Blob(byteArrays, { type: mimeType });
    }

    function uint8ArrayToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x2000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, offset + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
    }

    function addMessage(sender, text, isUser = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
        msgDiv.textContent = `${sender}: ${text}`;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return msgDiv;
    }

    async function readStreamingResponse(res, onEvent) {
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/octet-stream') || contentType.includes('application/qdh-stream')) {
            return readBinaryStreamingResponse(res, onEvent);
        }
        if (!contentType.includes('application/x-ndjson') || !res.body) {
            return { streamed: false, data: await res.json() };
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalEvent = null;

        const processLine = (rawLine) => {
            const line = rawLine.trim();
            if (!line) return;

            let event;
            try {
                event = JSON.parse(line);
            } catch (parseErr) {
                console.warn('Bad stream chunk:', parseErr, line);
                return;
            }

            if (onEvent) {
                onEvent(event);
            }

            if (event.type === 'done') {
                finalEvent = event;
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                processLine(buffer.slice(0, newlineIndex));
                buffer = buffer.slice(newlineIndex + 1);
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
            processLine(buffer);
        }

        return { streamed: true, finalEvent };
    }

    async function readBinaryStreamingResponse(res, onEvent) {
        if (!res.body) {
            throw new Error('Binary stream response has no body');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = new Uint8Array(0);
        let pendingOffset = 0;
        let finalEvent = null;

        const stageNameFromCode = (stageCode) => {
            switch (stageCode) {
                case 1:
                    return 'asr';
                case 2:
                    return 'rag';
                case 3:
                    return 'llm';
                case 4:
                    return 'tts';
                case 5:
                    return 'render';
                default:
                    return 'unknown';
            }
        };

        const createPayloadReader = (bytes) => {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            let offset = 0;

            const remaining = () => bytes.byteLength - offset;
            const readU8 = () => {
                if (remaining() < 1) return null;
                const value = view.getUint8(offset);
                offset += 1;
                return value;
            };
            const readU32 = () => {
                if (remaining() < 4) return null;
                const value = view.getUint32(offset, true);
                offset += 4;
                return value;
            };
            const readF32 = () => {
                if (remaining() < 4) return null;
                const value = view.getFloat32(offset, true);
                offset += 4;
                return value;
            };
            const readBytes = (length) => {
                if (length < 0 || remaining() < length) return null;
                const slice = bytes.subarray(offset, offset + length);
                offset += length;
                return slice;
            };
            const readString = () => {
                const length = readU32();
                if (length === null) return null;
                const bytesSlice = readBytes(length);
                if (bytesSlice === null) return null;
                return decoder.decode(bytesSlice);
            };

            return { remaining, readU8, readU32, readF32, readBytes, readString };
        };

        const parseRenderFrame = (payload) => {
            const reader = createPayloadReader(payload);
            const audioMimeType = reader.readString();
            if (audioMimeType === null) return null;

            const mouthOpen = reader.readF32();
            const smile = reader.readF32();
            const blink = reader.readF32();
            const headPitch = reader.readF32();
            const headYaw = reader.readF32();
            const headRoll = reader.readF32();
            const waveformLen = reader.readU32();
            if (
                mouthOpen === null ||
                smile === null ||
                blink === null ||
                headPitch === null ||
                headYaw === null ||
                headRoll === null ||
                waveformLen === null
            ) {
                return null;
            }

            const waveform = new Float32Array(waveformLen);
            for (let i = 0; i < waveformLen; i++) {
                const value = reader.readF32();
                if (value === null) return null;
                waveform[i] = value;
            }

            const audioLen = reader.readU32();
            if (audioLen === null) return null;
            const audioBytes = reader.readBytes(audioLen);
            if (audioBytes === null) return null;

            return {
                expression: {
                    mouth_open: mouthOpen,
                    smile,
                    blink,
                },
                posture: {
                    head_pitch: headPitch,
                    head_yaw: headYaw,
                    head_roll: headRoll,
                },
                waveform,
                audio_mime_type: audioMimeType,
                audio_bytes: audioBytes,
            };
        };

        const parseStatusFrame = (payload) => {
            const reader = createPayloadReader(payload);
            const stageCode = reader.readU8();
            const message = reader.readString();
            if (stageCode === null || message === null) return null;
            return {
                type: 'status',
                stage: stageNameFromCode(stageCode),
                stage_code: stageCode,
                message,
            };
        };

        const parseTextFrame = (payload, eventType) => {
            const reader = createPayloadReader(payload);
            const text = reader.readString();
            if (text === null) return null;
            if (eventType === 'error') {
                return { type: 'error', message: text };
            }
            return { type: eventType, text };
        };

        const parseAudioFrame = (payload) => {
            const reader = createPayloadReader(payload);
            const sampleRate = reader.readU32();
            if (sampleRate === null) return null;
            const audioBytes = reader.readBytes(reader.remaining());
            if (audioBytes === null) return null;
            return {
                type: 'audio.delta',
                audio_bytes: audioBytes,
                sample_rate: sampleRate || 24000,
                format: 'pcm16le',
            };
        };

        const parseDoneFrame = (payload) => {
            const reader = createPayloadReader(payload);
            const flags = reader.readU8();
            if (flags === null) return null;

            let transcription;
            if (flags & 0x01) {
                transcription = reader.readString();
                if (transcription === null) return null;
            }

            const reply = reader.readString();
            if (reply === null) return null;

            let render_frame;
            if (flags & 0x02) {
                const renderLength = reader.readU32();
                if (renderLength === null) return null;
                const renderPayload = reader.readBytes(renderLength);
                if (renderPayload === null) return null;
                render_frame = parseRenderFrame(renderPayload);
                if (!render_frame) return null;
            }

            const event = { type: 'done', reply };
            if (transcription !== undefined) {
                event.transcription = transcription;
            }
            if (render_frame) {
                event.render_frame = render_frame;
            }
            return event;
        };

        const parseFrame = (frameType, payload) => {
            switch (frameType) {
                case 1:
                    return parseStatusFrame(payload);
                case 2:
                    return parseTextFrame(payload, 'asr');
                case 3:
                    return parseTextFrame(payload, 'delta');
                case 4:
                    return parseAudioFrame(payload);
                case 5:
                    return parseDoneFrame(payload);
                case 6:
                    return parseTextFrame(payload, 'error');
                default:
                    console.warn('Unknown binary frame type:', frameType);
                    return null;
            }
        };

        const appendChunk = (chunk) => {
            if (!chunk || chunk.length === 0) return;

            if (pendingOffset === pending.length) {
                pending = chunk;
                pendingOffset = 0;
                return;
            }

            const remaining = pending.length - pendingOffset;
            const merged = new Uint8Array(remaining + chunk.length);
            merged.set(pending.subarray(pendingOffset), 0);
            merged.set(chunk, remaining);
            pending = merged;
            pendingOffset = 0;
        };

        const processFrame = (frameType, payload) => {
            const event = parseFrame(frameType, payload);
            if (!event) return;

            if (onEvent) {
                onEvent(event);
            }
            if (event.type === 'done') {
                finalEvent = event;
            }
        };

        const processPendingFrames = () => {
            while (pending.length - pendingOffset >= 5) {
                const frameType = pending[pendingOffset];
                const view = new DataView(
                    pending.buffer,
                    pending.byteOffset + pendingOffset + 1,
                    4
                );
                const payloadLength = view.getUint32(0, true);
                if (pending.length - pendingOffset < 5 + payloadLength) {
                    break;
                }

                const payloadStart = pendingOffset + 5;
                const payload = pending.subarray(payloadStart, payloadStart + payloadLength);
                pendingOffset += 5 + payloadLength;
                processFrame(frameType, payload);
            }

            if (pendingOffset >= pending.length) {
                pending = new Uint8Array(0);
                pendingOffset = 0;
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value && value.length) {
                appendChunk(value);
                processPendingFrames();
            }
        }

        processPendingFrames();

        return { streamed: true, finalEvent };
    }

    function playAudioFromBase64(base64, mimeType = 'audio/wav') {
        if (!base64) return;

        const audioBlob = base64ToBlob(base64, mimeType);
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        audio.play().catch(() => URL.revokeObjectURL(url));
    }

    function playAudioFromBytes(bytes, mimeType = 'audio/wav') {
        if (!bytes || bytes.length === 0) return;

        const audioBlob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        audio.play().catch(() => URL.revokeObjectURL(url));
    }

    function base64ToUint8Array(base64) {
        const byteCharacters = atob(base64);
        const bytes = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            bytes[i] = byteCharacters.charCodeAt(i);
        }
        return bytes;
    }

    function createPcmStreamingPlayer(defaultSampleRate = 24000) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
            return {
                ensureRunning: async () => false,
                prewarm: async () => false,
                reset: () => {},
                enqueuePcm16leBytes: () => false,
                enqueueBase64: () => false,
            };
        }

        let context;
        try {
            context = new AudioContextCtor({
                latencyHint: 'interactive',
                sampleRate: defaultSampleRate,
            });
        } catch (_) {
            try {
                context = new AudioContextCtor({ latencyHint: 'interactive' });
            } catch (_) {
                context = new AudioContextCtor();
            }
        }

        const activeSources = new Set();
        const queuedChunks = [];
        let queueOffset = 0;
        let scriptNode = null;
        let workletNode = null;
        let workletReady = null;
        let nextStartTime = 0;
        const startLeadTime = 0.001;
        const workletCode = `
class PcmStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.offset = 0;
        this.port.onmessage = (event) => {
            const data = event.data || {};
            if (data.type === 'reset') {
                this.queue = [];
                this.offset = 0;
                return;
            }
            if (data.type === 'chunk' && data.samples && data.samples.length) {
                this.queue.push(data.samples);
            }
        };
    }

    process(_inputs, outputs) {
        const output = outputs[0];
        const channels = output.length;
        const frames = output[0]?.length || 0;

        for (let ch = 0; ch < channels; ch++) {
            output[ch].fill(0);
        }

        let written = 0;
        while (written < frames && this.queue.length > 0) {
            const current = this.queue[0];
            const available = current.length - this.offset;
            const toCopy = Math.min(available, frames - written);
            const segment = current.subarray(this.offset, this.offset + toCopy);

            for (let ch = 0; ch < channels; ch++) {
                output[ch].set(segment, written);
            }

            written += toCopy;
            this.offset += toCopy;

            if (this.offset >= current.length) {
                this.queue.shift();
                this.offset = 0;
            }
        }

        return true;
    }
}

registerProcessor('pcm-stream-processor', PcmStreamProcessor);
`;
        const workletUrl = URL.createObjectURL(new Blob([workletCode], { type: 'text/javascript' }));

        const stopAll = () => {
            for (const source of activeSources) {
                try {
                    source.stop();
                } catch (_) {}
            }
            activeSources.clear();
        };

        const pcm16leToFloat32 = (bytes) => {
            const sampleCount = Math.floor(bytes.byteLength / 2);
            if (sampleCount === 0) return new Float32Array(0);

            const samples = new Float32Array(sampleCount);
            const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
            for (let i = 0; i < sampleCount; i++) {
                samples[i] = view.getInt16(i * 2, true) / 32768;
            }
            return samples;
        };

        const resampleFloat32 = (samples, inputSampleRate, outputSampleRate) => {
            if (
                samples.length === 0 ||
                !Number.isFinite(inputSampleRate) ||
                !Number.isFinite(outputSampleRate) ||
                inputSampleRate <= 0 ||
                outputSampleRate <= 0 ||
                inputSampleRate === outputSampleRate
            ) {
                return samples;
            }

            const ratio = outputSampleRate / inputSampleRate;
            const outputLength = Math.max(1, Math.round(samples.length * ratio));
            const resampled = new Float32Array(outputLength);
            for (let i = 0; i < outputLength; i++) {
                const sourcePosition = i / ratio;
                const left = Math.floor(sourcePosition);
                const frac = sourcePosition - left;
                const s0 = samples[Math.min(left, samples.length - 1)] ?? 0;
                const s1 = samples[Math.min(left + 1, samples.length - 1)] ?? s0;
                resampled[i] = s0 + (s1 - s0) * frac;
            }
            return resampled;
        };

        const ensureScriptFallback = () => {
            if (scriptNode || typeof context.createScriptProcessor !== 'function') {
                return Boolean(scriptNode);
            }

            try {
                scriptNode = context.createScriptProcessor(256, 0, 1);
                scriptNode.onaudioprocess = (event) => {
                    const outputBuffer = event.outputBuffer;
                    const channels = outputBuffer.numberOfChannels;
                    const frames = outputBuffer.length;

                    for (let ch = 0; ch < channels; ch++) {
                        outputBuffer.getChannelData(ch).fill(0);
                    }

                    let written = 0;
                    while (written < frames && queuedChunks.length > 0) {
                        const current = queuedChunks[0];
                        const available = current.length - queueOffset;
                        const toCopy = Math.min(available, frames - written);

                        for (let ch = 0; ch < channels; ch++) {
                            outputBuffer
                                .getChannelData(ch)
                                .set(current.subarray(queueOffset, queueOffset + toCopy), written);
                        }

                        written += toCopy;
                        queueOffset += toCopy;

                        if (queueOffset >= current.length) {
                            queuedChunks.shift();
                            queueOffset = 0;
                        }
                    }
                };
                scriptNode.connect(context.destination);
            } catch (err) {
                console.warn('ScriptProcessorNode setup failed:', err);
                scriptNode = null;
            }

            return Boolean(scriptNode);
        };

        const ensureWorklet = async () => {
            if (!context.audioWorklet) return false;
            if (workletNode) return true;
            if (!workletReady) {
                workletReady = (async () => {
                    try {
                        await context.audioWorklet.addModule(workletUrl);
                        workletNode = new AudioWorkletNode(context, 'pcm-stream-processor', {
                            numberOfInputs: 0,
                            numberOfOutputs: 1,
                            outputChannelCount: [1],
                        });
                        workletNode.connect(context.destination);
                        return true;
                    } catch (err) {
                        console.warn('AudioWorklet setup failed:', err);
                        workletNode = null;
                        return false;
                    }
                })();
            }

            const ready = await workletReady;
            if (!ready) {
                workletReady = null;
            }
            return ready;
        };

        return {
            async prewarm() {
                return await ensureWorklet();
            },
            async ensureRunning() {
                try {
                    await ensureWorklet();
                    if (context.state === 'suspended') {
                        await context.resume();
                    }
                    return context.state === 'running';
                } catch (err) {
                    console.warn('AudioContext resume failed:', err);
                    return false;
                }
            },
            reset() {
                stopAll();
                queuedChunks.length = 0;
                queueOffset = 0;
                nextStartTime = 0;
                if (workletNode) {
                    try {
                        workletNode.port.postMessage({ type: 'reset' });
                    } catch (_) {}
                }
            },
            enqueuePcm16leBytes(bytes, sampleRate = defaultSampleRate) {
                if (!bytes) return false;
                const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                if (view.length < 2) return false;

                let samples = pcm16leToFloat32(view);
                if (samples.length === 0) return false;
                samples = resampleFloat32(samples, sampleRate, context.sampleRate);

                if (context.state === 'suspended') {
                    context.resume().catch(() => {});
                }

                if (workletNode) {
                    try {
                        workletNode.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
                        return true;
                    } catch (err) {
                        console.warn('AudioWorklet enqueue failed, falling back:', err);
                    }
                }

                if (ensureScriptFallback()) {
                    queuedChunks.push(samples);
                    return true;
                }

                const buffer = context.createBuffer(1, samples.length, context.sampleRate);
                buffer.copyToChannel(samples, 0);

                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(context.destination);
                source.onended = () => activeSources.delete(source);
                activeSources.add(source);

                nextStartTime = Math.max(nextStartTime, context.currentTime + startLeadTime);
                source.start(nextStartTime);
                nextStartTime += buffer.duration;
                return true;
            },
            enqueueBase64(base64, sampleRate = defaultSampleRate) {
                if (!base64) return false;
                return this.enqueuePcm16leBytes(base64ToUint8Array(base64), sampleRate);
            },
        };
    }

    const realtimeAudioPlayer = createPcmStreamingPlayer(24000);
    // Warm up the worklet early so the first streamed chunk can start playing
    // with less setup time after the user gesture.
    void realtimeAudioPlayer.prewarm();
    window.addEventListener(
        'pointerdown',
        () => {
            void realtimeAudioPlayer.prewarm();
        },
        { once: true, passive: true }
    );

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        const promptSettings = getPromptSettings();
        addMessage('You', text, true);
        void probeAvatarIntent(text, { source: 'text' });
        chatInput.value = '';
        const assistantMsg = addMessage(assistantName, '');
        realtimeAudioPlayer.reset();
        const useBrowserTts = promptSettings.tts_enabled && promptSettings.browser_tts_enabled;
        if (promptSettings.tts_enabled && !useBrowserTts) {
            await realtimeAudioPlayer.ensureRunning();
        }
        streamText.textContent = 'Streaming: ';
        let reply = '';
        let streamedAudio = false;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    fast_mode: fastModeCheckbox.checked,
                    stream: true,
                    tts_enabled: promptSettings.tts_enabled && !promptSettings.browser_tts_enabled,
                    use_rag_context: promptSettings.use_rag_context,
                    system_prompt: promptSettings.system_prompt,
                    memory: promptSettings.memory,
                    context: promptSettings.context,
                    rerank: promptSettings.rerank,
                    browser_tts_enabled: promptSettings.browser_tts_enabled,
                })
            });

            const result = await readStreamingResponse(res, (event) => {
                if (event.type === 'delta') {
                    reply += event.text || '';
                    const visibleReply = sanitizeReply(reply);
                    assistantMsg.textContent = `${assistantName}: ${visibleReply}`;
                    streamText.textContent = `Streaming: ${visibleReply}`;
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } else if (event.type === 'status') {
                    streamText.textContent = event.message || event.stage || 'Streaming...';
                } else if (event.type === 'audio.delta') {
                    if (event.audio_bytes) {
                        streamedAudio = realtimeAudioPlayer.enqueuePcm16leBytes(
                            event.audio_bytes,
                            event.sample_rate || 24000
                        ) || streamedAudio;
                    } else {
                        streamedAudio = realtimeAudioPlayer.enqueueBase64(
                            event.audio_base64 || '',
                            event.sample_rate || 24000
                        ) || streamedAudio;
                    }
                } else if (event.type === 'error') {
                    throw new Error(event.message || 'Stream error');
                }
            });

            if (result.streamed) {
                reply = result.finalEvent?.reply || reply;
            } else {
                reply = result.data.reply || '';
            }

            const visibleReply = sanitizeReply(reply);
            assistantMsg.textContent = `${assistantName}: ${visibleReply}`;
            streamText.textContent = '';
            chatHistory.scrollTop = chatHistory.scrollHeight;

            if (window.updateAvatarState) {
                window.updateAvatarState({
                    expression: { mouth_open: 0.3, smile: 0.4, blink: 0.1 },
                });
            }

            if (promptSettings.tts_enabled && visibleReply.trim()) {
                if (useBrowserTts) {
                    const browserOk = await playBrowserTTS(visibleReply);
                    if (!browserOk && !streamedAudio) {
                        await playTTS(visibleReply);
                    }
                } else if (!streamedAudio) {
                    await playTTS(visibleReply);
                }
            }
        } catch (err) {
            console.error(err);
            assistantMsg.textContent = `${assistantName}: Error communicating with server.`;
            streamText.textContent = '';
        }
    }

    async function playTTS(text) {
        try {
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const blob = await res.blob();
            if (blob.size > 0) {
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.onended = () => URL.revokeObjectURL(url);
                audio.onerror = () => URL.revokeObjectURL(url);
                audio.play().catch(() => URL.revokeObjectURL(url));
            }
        } catch (e) {
            console.error('TTS error:', e);
        }
    }

    async function playBrowserTTS(text) {
        const utterText = (text || '').trim();
        if (!utterText) return false;
        if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
            return false;
        }

        try {
            window.speechSynthesis.cancel();
            await new Promise((resolve, reject) => {
                const utterance = new SpeechSynthesisUtterance(utterText);
                utterance.lang = 'zh-CN';
                utterance.rate = 1;
                utterance.pitch = 1;
                utterance.volume = 1;
                utterance.onend = () => resolve(true);
                utterance.onerror = (event) => reject(event.error || new Error('Browser TTS failed'));
                window.speechSynthesis.speak(utterance);
            });
            return true;
        } catch (err) {
            console.error('Browser TTS error:', err);
            return false;
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});
