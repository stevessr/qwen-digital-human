import { readonly, shallowRef } from 'vue'
import { playAudioBlob } from '@/utils/audio'
import { playTTS } from '@/api/chat'
import { useAvatarStore } from '@/stores/avatar'

const BROWSER_TTS_CHUNK_SIZE = 120

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

const sanitizeSpeechText = (text: string): string => text
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
  .replace(/<\/?think>/gi, ' ')
  .replace(/[#>*_\-[\]()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const splitSpeechText = (text: string): string[] => {
  const normalized = sanitizeSpeechText(text)
  if (!normalized) return []

  const sentenceParts = normalized.match(/[^。！？!?；;，,]+[。！？!?；;，,]?/g) ?? [normalized]
  const chunks: string[] = []
  let buffer = ''

  for (const part of sentenceParts) {
    const sentence = part.trim()
    if (!sentence) continue

    if ((buffer + sentence).length <= BROWSER_TTS_CHUNK_SIZE) {
      buffer = `${buffer}${sentence}`
      continue
    }

    if (buffer) {
      chunks.push(buffer)
      buffer = ''
    }

    if (sentence.length <= BROWSER_TTS_CHUNK_SIZE) {
      buffer = sentence
      continue
    }

    for (let index = 0; index < sentence.length; index += BROWSER_TTS_CHUNK_SIZE) {
      chunks.push(sentence.slice(index, index + BROWSER_TTS_CHUNK_SIZE))
    }
  }

  if (buffer) chunks.push(buffer)
  return chunks
}

const loadVoices = async (): Promise<SpeechSynthesisVoice[]> => {
  const synth = window.speechSynthesis
  const loadedVoices = synth.getVoices()
  if (loadedVoices.length) return loadedVoices

  await new Promise<void>(resolve => {
    const cleanup = () => {
      window.clearTimeout(timer)
      if (synth.onvoiceschanged === cleanup) {
        synth.onvoiceschanged = null
      }
      resolve()
    }
    const timer = window.setTimeout(cleanup, 800)
    synth.onvoiceschanged = cleanup
  })

  return synth.getVoices()
}

const pickChineseVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => (
  voices.find(voice => /^zh([-_]|$)/i.test(voice.lang))
  ?? voices.find(voice => /(cmn|yue|zh|chinese|mandarin|中文|普通话|粤语)/i.test(`${voice.lang} ${voice.name}`))
  ?? null
)

const startSpeechKeepAlive = () => {
  const timer = window.setInterval(() => {
    const synth = window.speechSynthesis
    if (synth.speaking) {
      synth.resume()
    }
  }, 3500)

  return () => window.clearInterval(timer)
}

const speakChunk = (
  chunk: string,
  voice: SpeechSynthesisVoice | null,
): Promise<void> => new Promise((resolve, reject) => {
  const utterance = new SpeechSynthesisUtterance(chunk)
  utterance.lang = voice?.lang || 'zh-CN'
  utterance.voice = voice
  utterance.rate = 1
  utterance.pitch = 1
  utterance.volume = 1

  let settled = false
  const settle = (callback: () => void) => {
    if (settled) return
    settled = true
    window.clearTimeout(timeout)
    callback()
  }
  const timeout = window.setTimeout(() => {
    settle(() => reject(new Error('Browser TTS timeout')))
  }, Math.max(12_000, chunk.length * 450))

  utterance.onstart = () => {
    window.speechSynthesis.resume()
  }
  utterance.onend = () => settle(resolve)
  utterance.onerror = (event) => {
    const errorName = event.error || 'unknown'
    settle(() => reject(new Error(`Browser TTS failed: ${errorName}`)))
  }

  window.speechSynthesis.speak(utterance)
  window.speechSynthesis.resume()
})

/**
 * Browser TTS using SpeechSynthesis API
 */
export async function playBrowserTTS(text: string): Promise<boolean> {
  const chunks = splitSpeechText(text || '')
  if (!chunks.length) return false

  if (
    typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof window.SpeechSynthesisUtterance === 'undefined'
  ) {
    return false
  }

  try {
    const synth = window.speechSynthesis
    synth.cancel()
    await sleep(80)

    const voice = pickChineseVoice(await loadVoices())
    const stopKeepAlive = startSpeechKeepAlive()
    try {
      for (const chunk of chunks) {
        await speakChunk(chunk, voice)
      }
    } finally {
      stopKeepAlive()
    }

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
  const isPlaying = shallowRef(false)
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
