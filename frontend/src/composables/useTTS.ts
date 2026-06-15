import { readonly, ref } from 'vue'
import { playAudioBlob } from '@/utils/audio'
import { playTTS } from '@/api/chat'
import { useAvatarStore } from '@/stores/avatar'

/**
 * Browser TTS using SpeechSynthesis API
 */
export async function playBrowserTTS(text: string): Promise<boolean> {
  const utterText = (text || '').trim()
  if (!utterText) return false

  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    return false
  }

  try {
    window.speechSynthesis.cancel()

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(utterText)
      utterance.lang = 'zh-CN'
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 1

      utterance.onend = () => resolve()
      utterance.onerror = (event) => reject(event.error || new Error('Browser TTS failed'))

      window.speechSynthesis.speak(utterance)
    })

    return true
  } catch (err) {
    console.error('Browser TTS error:', err)
    return false
  }
}

/**
 * Cloud TTS using backend API
 */
export async function playCloudTTS(text: string): Promise<void> {
  if (!text.trim()) return

  try {
    const blob = await playTTS(text)
    await playAudioBlob(blob)
  } catch (err) {
    console.error('Cloud TTS error:', err)
    throw err
  }
}

/**
 * Composable for TTS playback
 */
export function useTTS() {
  const avatarStore = useAvatarStore()
  const isPlaying = ref(false)
  let mouthTimer: number | null = null

  const startMouthAnimation = () => {
    stopMouthAnimation()
    mouthTimer = window.setInterval(() => {
      avatarStore.updateExpression({
        mouth_open: 0.18 + Math.random() * 0.46,
        smile: Math.max(avatarStore.expression.smile, 0.18),
      })
    }, 120)
  }

  const stopMouthAnimation = () => {
    if (mouthTimer) {
      window.clearInterval(mouthTimer)
      mouthTimer = null
    }
    avatarStore.updateExpression({ mouth_open: 0.04 })
  }

  const play = async (text: string, useBrowserTTS = false) => {
    if (isPlaying.value) return
    isPlaying.value = true
    startMouthAnimation()

    try {
      if (useBrowserTTS) {
        const success = await playBrowserTTS(text)
        if (!success) {
          await playCloudTTS(text)
        }
      } else {
        await playCloudTTS(text)
      }
    } finally {
      stopMouthAnimation()
      isPlaying.value = false
    }
  }

  return {
    isPlaying: readonly(isPlaying),
    play,
  }
}
