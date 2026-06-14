import { ref, readonly } from 'vue'
import { playAudioBlob } from '@/utils/audio'
import { playTTS } from '@/api/chat'

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
  const isPlaying = ref(false)

  const play = async (text: string, useBrowserTTS = false) => {
    if (isPlaying.value) return
    isPlaying.value = true

    try {
      if (useBrowserTTS) {
        const success = await playBrowserTTS(text)
        if (!success) {
          // Fallback to cloud TTS
          await playCloudTTS(text)
        }
      } else {
        await playCloudTTS(text)
      }
    } finally {
      isPlaying.value = false
    }
  }

  return {
    isPlaying: readonly(isPlaying),
    play,
  }
}
