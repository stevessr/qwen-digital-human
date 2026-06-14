import { ref, reactive, computed } from 'vue'
import { defineStore } from 'pinia'
import type { AvatarExpression, AvatarPosture, AvatarState } from '@/types/avatar'

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

  const state = computed<AvatarState>(() => ({
    expression: { ...expression },
    posture: { ...posture },
    waveform: waveform.value,
    startTime: startTime.value,
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

  const reset = () => {
    Object.assign(expression, { mouth_open: 0, smile: 0, blink: 0 })
    Object.assign(posture, { head_pitch: 0, head_yaw: 0, head_roll: 0 })
    waveform.value = new Float32Array(128)
    startTime.value = performance.now()
  }

  return {
    expression,
    posture,
    waveform,
    startTime,
    state,
    updateExpression,
    updatePosture,
    updateWaveform,
    reset,
  }
})
