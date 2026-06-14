import { reactive, readonly, onUnmounted } from 'vue'
import { base64ToUint8Array, pcm16leBytesToFloat32, resampleLinearFloat32 } from '@/utils/audio'

const WORKLET_URL = '/pcm-streaming-worklet.js'

interface AudioPlayerState {
  context: AudioContext | null
  workletNode: AudioWorkletNode | null
  isRunning: boolean
  queueLength: number
}

/**
 * Real-time PCM streaming audio player using AudioWorklet
 */
export function useAudioPlayer(defaultSampleRate = 24000) {
  const state = reactive<AudioPlayerState>({
    context: null,
    workletNode: null,
    isRunning: false,
    queueLength: 0,
  })

  const ensureRunning = async () => {
    if (state.isRunning && state.context && state.workletNode) {
      return
    }

    try {
      // Create AudioContext
      const context = new AudioContext({ sampleRate: defaultSampleRate })
      state.context = context

      // Load worklet module
      await context.audioWorklet.addModule(WORKLET_URL)

      // Create worklet node
      const workletNode = new AudioWorkletNode(context, 'pcm-streaming-processor')

      // Listen to status messages
      workletNode.port.onmessage = (event) => {
        const { type, queueLength } = event.data
        if (type === 'status') {
          state.queueLength = queueLength || 0
        }
      }

      workletNode.connect(context.destination)
      state.workletNode = workletNode
      state.isRunning = true

      // Resume context if suspended
      if (context.state === 'suspended') {
        await context.resume()
      }
    } catch (err) {
      console.error('Failed to start audio player:', err)
      throw err
    }
  }

  /**
   * Prewarm the audio context (call on user gesture)
   */
  const prewarm = async () => {
    try {
      await ensureRunning()
    } catch (err) {
      console.warn('Prewarm failed:', err)
    }
  }

  /**
   * Enqueue PCM 16-bit LE bytes for playback
   */
  const enqueuePcm16leBytes = (bytes: Uint8Array, sampleRate = defaultSampleRate): boolean => {
    if (!state.workletNode) {
      console.warn('Audio player not running, cannot enqueue')
      return false
    }

    try {
      // Convert PCM bytes to Float32 samples
      let samples = pcm16leBytesToFloat32(bytes)

      // Resample if needed
      if (sampleRate !== defaultSampleRate) {
        samples = resampleLinearFloat32(samples, sampleRate, defaultSampleRate)
      }

      // Send to worklet
      state.workletNode.port.postMessage({
        type: 'enqueue',
        samples: samples,
        sampleRate: defaultSampleRate,
      })

      return true
    } catch (err) {
      console.error('Failed to enqueue audio:', err)
      return false
    }
  }

  /**
   * Enqueue base64-encoded PCM audio for playback
   */
  const enqueueBase64 = (base64: string, sampleRate = defaultSampleRate): boolean => {
    if (!base64) return false

    try {
      const bytes = base64ToUint8Array(base64)
      return enqueuePcm16leBytes(bytes, sampleRate)
    } catch (err) {
      console.error('Failed to decode base64 audio:', err)
      return false
    }
  }

  /**
   * Reset the audio queue (clear all pending audio)
   */
  const reset = () => {
    if (state.workletNode) {
      state.workletNode.port.postMessage({ type: 'reset' })
      state.queueLength = 0
    }
  }

  /**
   * Stop and cleanup
   */
  const stop = () => {
    if (state.workletNode) {
      state.workletNode.disconnect()
      state.workletNode = null
    }
    if (state.context) {
      state.context.close()
      state.context = null
    }
    state.isRunning = false
    state.queueLength = 0
  }

  onUnmounted(() => {
    stop()
  })

  return {
    state: readonly(state),
    ensureRunning,
    prewarm,
    enqueuePcm16leBytes,
    enqueueBase64,
    reset,
    stop,
  }
}
