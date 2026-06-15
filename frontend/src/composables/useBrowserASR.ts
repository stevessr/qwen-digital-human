import { computed, onBeforeUnmount, readonly, shallowRef } from 'vue'

interface BrowserSpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: BrowserSpeechRecognitionAlternative | undefined
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number
  [index: number]: BrowserSpeechRecognitionResult | undefined
}

interface BrowserSpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: BrowserSpeechRecognitionResultList
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message?: string
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onaudioend: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onspeechend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

interface BrowserASRStartOptions {
  lang?: string
}

const getRecognitionConstructor = (): BrowserSpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

const normalizeSpeechError = (error: string, message?: string): string => {
  if (message?.trim()) return message.trim()

  const errorMessages: Record<string, string> = {
    aborted: '语音识别已取消',
    'audio-capture': '无法访问麦克风，请检查浏览器权限或输入设备',
    network: '浏览器语音识别网络异常',
    'not-allowed': '浏览器未授权麦克风，请允许麦克风权限',
    'service-not-allowed': '浏览器语音识别服务不可用',
    'no-speech': '没有识别到语音，请按住按钮后再说话',
    'language-not-supported': '当前浏览器不支持中文语音识别',
  }

  return errorMessages[error] ?? `浏览器语音识别失败：${error}`
}

export function useBrowserASR() {
  const isListening = shallowRef(false)
  const finalText = shallowRef('')
  const interimText = shallowRef('')
  const errorMessage = shallowRef('')
  const isSupported = computed(() => getRecognitionConstructor() !== null)

  let recognition: BrowserSpeechRecognition | null = null
  let stopResolver: ((text: string) => void) | null = null
  let stopPromise: Promise<string> | null = null

  const currentTranscript = () => [finalText.value, interimText.value]
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')
    .trim()

  const resolveStop = () => {
    const text = currentTranscript()
    stopResolver?.(text)
    stopResolver = null
    stopPromise = null
    return text
  }

  const detachRecognition = () => {
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.onaudioend = null
    recognition.onspeechend = null
    recognition = null
  }

  const abort = () => {
    const activeRecognition = recognition
    if (activeRecognition) {
      try {
        activeRecognition.abort()
      } catch {
        // Recognition may already be closed by the browser.
      }
    }
    isListening.value = false
    interimText.value = ''
    resolveStop()
    detachRecognition()
  }

  const stop = (): Promise<string> => {
    if (stopPromise) return stopPromise

    stopPromise = new Promise(resolve => {
      stopResolver = resolve
      if (!recognition || !isListening.value) {
        resolve(resolveStop())
        return
      }

      try {
        recognition.stop()
      } catch {
        isListening.value = false
        resolve(resolveStop())
        detachRecognition()
      }
    })

    return stopPromise
  }

  const start = ({ lang = 'zh-CN' }: BrowserASRStartOptions = {}) => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      throw new Error('当前浏览器不支持 SpeechRecognition / webkitSpeechRecognition')
    }

    abort()
    finalText.value = ''
    interimText.value = ''
    errorMessage.value = ''

    const nextRecognition = new Recognition()
    nextRecognition.lang = lang
    nextRecognition.continuous = true
    nextRecognition.interimResults = true
    nextRecognition.maxAlternatives = 1

    nextRecognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
      let nextFinal = finalText.value
      let nextInterim = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript ?? ''
        if (!transcript.trim()) continue

        if (result?.isFinal) {
          nextFinal = `${nextFinal} ${transcript}`.trim()
        } else {
          nextInterim = `${nextInterim} ${transcript}`.trim()
        }
      }

      finalText.value = nextFinal
      interimText.value = nextInterim
    }

    nextRecognition.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
      errorMessage.value = normalizeSpeechError(event.error, event.message)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        isListening.value = false
      }
    }

    nextRecognition.onend = () => {
      isListening.value = false
      finalText.value = resolveStop()
      interimText.value = ''
      detachRecognition()
    }

    recognition = nextRecognition
    recognition.start()
    isListening.value = true
  }

  onBeforeUnmount(() => {
    abort()
  })

  return {
    isSupported,
    isListening: readonly(isListening),
    finalText: readonly(finalText),
    interimText: readonly(interimText),
    errorMessage: readonly(errorMessage),
    start,
    stop,
    abort,
  }
}
