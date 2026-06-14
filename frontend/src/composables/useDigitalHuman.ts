import { computed, readonly, type Ref } from 'vue'
import type { AvatarState, FaceTrackingState } from '@/types/avatar'

const clampNumber = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const lerpNumber = (from: number, to: number, amount: number): number => {
  const t = clampNumber(amount, 0, 1, 0)
  return from + (to - from) * t
}

export interface DigitalHumanSignals {
  mouthOpen: number
  smile: number
  blink: number
  headPitch: number
  headYaw: number
  headRoll: number
  eyeOpen: number
  breath: number
  energy: number
}

export function useDigitalHuman(
  avatarState: Ref<AvatarState>,
  faceTrackingState: Ref<FaceTrackingState>
) {
  const signals = computed<DigitalHumanSignals>(() => {
    const base = avatarState.value
    const tracking = faceTrackingState.value
    const trackingPose = tracking.enabled && tracking.cameraActive && tracking.active
      ? tracking.pose
      : null
    const trackingBlend = trackingPose
      ? clampNumber(tracking.blend, 0, 1, 0.85) * clampNumber(tracking.confidence, 0, 1, 1)
      : 0
    const trackingSignals = tracking.enabled && tracking.cameraActive && tracking.active
      ? tracking.signals
      : null
    const expressionBlend = trackingSignals ? trackingBlend * 0.72 : 0
    const elapsed = (performance.now() - base.startTime) / 1000
    const waveformEnergy = base.waveform.length
      ? base.waveform.reduce((sum, value) => sum + Math.abs(value), 0) / base.waveform.length
      : 0

    const mouthOpen = clampNumber(
      Math.max(
        base.expression.mouth_open,
        trackingSignals
          ? lerpNumber(base.expression.mouth_open, trackingSignals.mouth_open, expressionBlend)
          : 0
      ),
      0,
      1,
      0
    )
    const smile = clampNumber(
      lerpNumber(
        base.expression.smile,
        trackingSignals ? trackingSignals.smile : 0,
        expressionBlend
      ),
      -1,
      1,
      0
    )
    const blink = clampNumber(
      Math.max(
        base.expression.blink,
        trackingSignals
          ? lerpNumber(base.expression.blink, trackingSignals.blink, expressionBlend)
          : 0
      ),
      0,
      1,
      0
    )

    return {
      mouthOpen,
      smile,
      blink,
      headPitch: lerpNumber(
        clampNumber(base.posture.head_pitch, -1, 1, 0),
        clampNumber(trackingPose?.head_pitch ?? 0, -1, 1, 0),
        trackingBlend
      ),
      headYaw: lerpNumber(
        clampNumber(base.posture.head_yaw, -1, 1, 0),
        clampNumber(trackingPose?.head_yaw ?? 0, -1, 1, 0),
        trackingBlend
      ),
      headRoll: lerpNumber(
        clampNumber(base.posture.head_roll, -1, 1, 0),
        clampNumber(trackingPose?.head_roll ?? 0, -1, 1, 0),
        trackingBlend
      ),
      eyeOpen: 1 - blink,
      breath: Math.sin(elapsed * 1.35) * 0.5 + 0.5,
      energy: clampNumber(Math.max(waveformEnergy, mouthOpen * 0.65), 0, 1, 0),
    }
  })

  return {
    signals: readonly(signals),
  }
}
