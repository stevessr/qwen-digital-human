import { computed, onMounted, onUnmounted, readonly, shallowRef, type Ref } from 'vue'
import type { AvatarState, FaceTrackingState } from '@/types/avatar'
import { clampNumber } from '@/utils/math'

const lerpNumber = (from: number, to: number, amount: number): number => {
  const t = clampNumber(amount, 0, 1, 0)
  return from + (to - from) * t
}

const easeOut = (value: number): number => {
  const t = clampNumber(value, 0, 1, 0)
  return 1 - (1 - t) * (1 - t)
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
  motionWeight: number
}

export function useDigitalHuman(
  avatarState: Ref<AvatarState>,
  faceTrackingState: Ref<FaceTrackingState>
) {
  const now = shallowRef(performance.now())
  let frameId = 0

  const tick = () => {
    now.value = performance.now()
    frameId = window.requestAnimationFrame(tick)
  }

  onMounted(() => {
    frameId = window.requestAnimationFrame(tick)
  })

  onUnmounted(() => {
    if (frameId) window.cancelAnimationFrame(frameId)
  })

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
    const elapsed = (now.value - base.startTime) / 1000
    const waveformEnergy = base.waveform.length
      ? base.waveform.reduce((sum, value) => sum + Math.abs(value), 0) / base.waveform.length
      : 0
    const autoBlinkPhase = Math.sin(elapsed * 2.25) * 0.5 + 0.5
    const autoBlink = autoBlinkPhase > 0.985 ? (autoBlinkPhase - 0.985) * 62 : 0
    const motionElapsed = now.value - base.motion.startedAt
    const motionProgress = clampNumber(motionElapsed / base.motion.durationMs, 0, 1, 1)
    const motionWeight = motionProgress >= 1
      ? 0
      : Math.sin(easeOut(motionProgress) * Math.PI)

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
          : autoBlink
      ),
      0,
      1,
      0
    )

    let motionYaw = 0
    let motionPitch = 0
    let motionRoll = 0
    if (base.motion.name === 'flick_head') {
      motionYaw = Math.sin(motionProgress * Math.PI * 2) * 0.36 * motionWeight
      motionRoll = -0.12 * motionWeight
    } else if (base.motion.name === 'tap_body') {
      motionPitch = Math.sin(motionProgress * Math.PI * 2) * 0.16 * motionWeight
    } else if (base.motion.name === 'pinch_in') {
      motionPitch = 0.12 * motionWeight
      motionYaw = -0.08 * motionWeight
    } else if (base.motion.name === 'shake') {
      motionYaw = Math.sin(motionProgress * Math.PI * 7) * 0.22 * motionWeight
      motionRoll = Math.sin(motionProgress * Math.PI * 5) * 0.12 * motionWeight
    }

    return {
      mouthOpen,
      smile,
      blink,
      headPitch: clampNumber(lerpNumber(
        clampNumber(base.posture.head_pitch, -1, 1, 0),
        clampNumber(trackingPose?.head_pitch ?? 0, -1, 1, 0),
        trackingBlend
      ) + motionPitch, -1, 1, 0),
      headYaw: clampNumber(lerpNumber(
        clampNumber(base.posture.head_yaw, -1, 1, 0),
        clampNumber(trackingPose?.head_yaw ?? 0, -1, 1, 0),
        trackingBlend
      ) + motionYaw, -1, 1, 0),
      headRoll: clampNumber(lerpNumber(
        clampNumber(base.posture.head_roll, -1, 1, 0),
        clampNumber(trackingPose?.head_roll ?? 0, -1, 1, 0),
        trackingBlend
      ) + motionRoll, -1, 1, 0),
      eyeOpen: 1 - blink,
      breath: Math.sin(elapsed * 1.35) * 0.5 + 0.5,
      energy: clampNumber(Math.max(waveformEnergy, mouthOpen * 0.65, motionWeight * 0.36), 0, 1, 0),
      motionWeight,
    }
  })

  return {
    signals: readonly(signals),
  }
}
