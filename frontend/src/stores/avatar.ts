import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AvatarExpression,
  AvatarPosture,
  AvatarState,
  DigitalHumanExpressionName,
  DigitalHumanMotionName,
  DigitalHumanMotionState,
  DigitalHumanPersonaKey,
} from '@/types/avatar'

const PERSONA_SEQUENCE: DigitalHumanPersonaKey[] = ['guide', 'professional', 'energetic']

const EXPRESSION_PRESETS: Record<DigitalHumanExpressionName, AvatarExpression> = {
  happy: { mouth_open: 0.24, smile: 0.72, blink: 0 },
  thinking: { mouth_open: 0.06, smile: 0.12, blink: 0.12 },
  surprised: { mouth_open: 0.64, smile: 0.08, blink: 0 },
  sad: { mouth_open: 0.08, smile: -0.42, blink: 0.18 },
  angry: { mouth_open: 0.18, smile: -0.72, blink: 0.08 },
}

const MOTION_DURATIONS: Record<DigitalHumanMotionName, number> = {
  idle: 900,
  tap_body: 720,
  flick_head: 760,
  pinch_in: 820,
  shake: 900,
}

export const useAvatarStore = defineStore('avatar', () => {
  const expression = reactive<AvatarExpression>({
    mouth_open: 0,
    smile: 0,
    blink: 0,
  })

  const posture = reactive<AvatarPosture>({
    head_pitch: 0,
    head_yaw: 0,
    head_roll: 0,
  })

  const waveform = ref<Float32Array>(new Float32Array(128))
  const startTime = ref(performance.now())
  const persona = ref<DigitalHumanPersonaKey>('guide')
  const motion = reactive<DigitalHumanMotionState>({
    name: 'idle',
    startedAt: performance.now(),
    durationMs: MOTION_DURATIONS.idle,
  })

  const state = computed<AvatarState>(() => ({
    expression: {
      mouth_open: expression.mouth_open,
      smile: expression.smile,
      blink: expression.blink,
    },
    posture: {
      head_pitch: posture.head_pitch,
      head_yaw: posture.head_yaw,
      head_roll: posture.head_roll,
    },
    waveform: waveform.value,
    startTime: startTime.value,
    persona: persona.value,
    motion: {
      name: motion.name,
      startedAt: motion.startedAt,
      durationMs: motion.durationMs,
    },
  }))

  const updateExpression = (partial: Partial<AvatarExpression>) => {
    Object.assign(expression, partial)
  }

  const updatePosture = (partial: Partial<AvatarPosture>) => {
    Object.assign(posture, partial)
  }

  const updateWaveform = (newWaveform: Float32Array) => {
    waveform.value = newWaveform
  }

  const setPersona = (nextPersona: DigitalHumanPersonaKey) => {
    persona.value = nextPersona
  }

  const cyclePersona = () => {
    const currentIndex = PERSONA_SEQUENCE.indexOf(persona.value)
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % PERSONA_SEQUENCE.length : 0
    setPersona(PERSONA_SEQUENCE[nextIndex] ?? 'guide')
    return persona.value
  }

  const applyExpressionPreset = (name: DigitalHumanExpressionName) => {
    updateExpression(EXPRESSION_PRESETS[name])
  }

  const performMotion = (name: DigitalHumanMotionName) => {
    motion.name = name
    motion.startedAt = performance.now()
    motion.durationMs = MOTION_DURATIONS[name]
  }

  const reset = () => {
    Object.assign(expression, { mouth_open: 0, smile: 0, blink: 0 })
    Object.assign(posture, { head_pitch: 0, head_yaw: 0, head_roll: 0 })
    waveform.value = new Float32Array(128)
    startTime.value = performance.now()
    persona.value = 'guide'
    performMotion('idle')
  }

  return {
    expression,
    posture,
    waveform,
    startTime,
    persona,
    motion,
    state,
    updateExpression,
    updatePosture,
    updateWaveform,
    setPersona,
    cyclePersona,
    applyExpressionPreset,
    performMotion,
    reset,
  }
})
