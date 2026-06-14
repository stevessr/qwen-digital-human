import { ref, reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import {
  CHAT_SETTINGS_STORAGE_KEY,
  DEFAULT_PROMPT_SETTINGS,
  DEFAULT_RERANK_INSTRUCTION,
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_SYSTEM_PROMPT,
  PROMPT_STORAGE_KEYS,
} from '@/constants/config'
import type { ChatMessage, PromptSettings, RerankSettings } from '@/types/chat'

type PromptSettingsPatch = Partial<Omit<PromptSettings, 'rerank'>> & {
  rerank?: Partial<RerankSettings>
}

const createDefaultPromptSettings = (): PromptSettings => ({
  ...DEFAULT_PROMPT_SETTINGS,
  rerank: { ...DEFAULT_PROMPT_SETTINGS.rerank },
})

const normalizePrompt = (value: string): string => (
  value === LEGACY_SYSTEM_PROMPT ? DEFAULT_SYSTEM_PROMPT : value
)

const loadBoolean = (key: string, fallback: boolean): boolean => {
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw !== 'false'
}

const loadNumber = (key: string, fallback: number, min: number, max: number): number => {
  const raw = localStorage.getItem(key)
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const loadInteger = (key: string, fallback: number, min: number, max: number): number => (
  Math.round(loadNumber(key, fallback, min, max))
)

const readLegacyPromptSettings = (): PromptSettingsPatch | null => {
  const hasLegacyKey = Object.values(PROMPT_STORAGE_KEYS).some(key => localStorage.getItem(key) !== null)
  if (!hasLegacyKey) return null

  const systemPrompt = localStorage.getItem(PROMPT_STORAGE_KEYS.systemPrompt)
  const memory = localStorage.getItem(PROMPT_STORAGE_KEYS.memory)
  const context = localStorage.getItem(PROMPT_STORAGE_KEYS.context)
  const rerankInstruction = localStorage.getItem(PROMPT_STORAGE_KEYS.rerankInstruction)

  return {
    ...(systemPrompt !== null ? { system_prompt: normalizePrompt(systemPrompt) } : {}),
    ...(memory !== null ? { memory: memory.trim() ? memory : DEFAULT_PROMPT_SETTINGS.memory } : {}),
    ...(context !== null ? { context } : {}),
    use_rag_context: loadBoolean(PROMPT_STORAGE_KEYS.useRagContext, DEFAULT_PROMPT_SETTINGS.use_rag_context),
    tts_enabled: loadBoolean(PROMPT_STORAGE_KEYS.ttsMode, DEFAULT_PROMPT_SETTINGS.tts_enabled),
    browser_asr_mode: loadBoolean(PROMPT_STORAGE_KEYS.browserAsrMode, DEFAULT_PROMPT_SETTINGS.browser_asr_mode),
    browser_tts_enabled: loadBoolean(PROMPT_STORAGE_KEYS.browserTtsMode, DEFAULT_PROMPT_SETTINGS.browser_tts_enabled),
    collapse_think: loadBoolean(PROMPT_STORAGE_KEYS.collapseThink, DEFAULT_PROMPT_SETTINGS.collapse_think),
    rerank: {
      candidate_pool: loadInteger(
        PROMPT_STORAGE_KEYS.rerankCandidatePool,
        DEFAULT_PROMPT_SETTINGS.rerank.candidate_pool,
        1,
        64,
      ),
      similarity_threshold: loadNumber(
        PROMPT_STORAGE_KEYS.rerankSimilarityThreshold,
        DEFAULT_PROMPT_SETTINGS.rerank.similarity_threshold,
        0,
        1,
      ),
      top_k: loadInteger(
        PROMPT_STORAGE_KEYS.rerankTopK,
        DEFAULT_PROMPT_SETTINGS.rerank.top_k,
        0,
        32,
      ),
      instruction: rerankInstruction?.trim() || DEFAULT_RERANK_INSTRUCTION,
    },
  }
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const isStreaming = ref(false)
  const streamingText = ref('')

  const settings = reactive<PromptSettings>(createDefaultPromptSettings())

  const applySettingsPatch = (patch: PromptSettingsPatch) => {
    if (typeof patch.system_prompt === 'string') settings.system_prompt = normalizePrompt(patch.system_prompt)
    if (typeof patch.memory === 'string') settings.memory = patch.memory.trim() ? patch.memory : DEFAULT_PROMPT_SETTINGS.memory
    if (typeof patch.context === 'string') settings.context = patch.context
    if (typeof patch.use_rag_context === 'boolean') settings.use_rag_context = patch.use_rag_context
    if (typeof patch.tts_enabled === 'boolean') settings.tts_enabled = patch.tts_enabled
    if (typeof patch.browser_tts_enabled === 'boolean') settings.browser_tts_enabled = patch.browser_tts_enabled
    if (typeof patch.browser_asr_mode === 'boolean') settings.browser_asr_mode = patch.browser_asr_mode
    if (typeof patch.collapse_think === 'boolean') settings.collapse_think = patch.collapse_think

    if (patch.rerank) {
      if (typeof patch.rerank.candidate_pool === 'number') {
        settings.rerank.candidate_pool = Math.max(1, Math.min(64, Math.round(patch.rerank.candidate_pool)))
      }
      if (typeof patch.rerank.similarity_threshold === 'number') {
        settings.rerank.similarity_threshold = Math.max(0, Math.min(1, patch.rerank.similarity_threshold))
      }
      if (typeof patch.rerank.top_k === 'number') {
        settings.rerank.top_k = Math.max(0, Math.min(32, Math.round(patch.rerank.top_k)))
      }
      if (typeof patch.rerank.instruction === 'string') {
        settings.rerank.instruction = patch.rerank.instruction.trim() || DEFAULT_RERANK_INSTRUCTION
      }
    }
  }

  const resetSettings = () => {
    const defaults = createDefaultPromptSettings()
    Object.assign(settings, defaults)
    Object.assign(settings.rerank, defaults.rerank)
  }

  const addMessage = (role: 'user' | 'assistant', content: string): ChatMessage => {
    const message: ChatMessage = {
      id: nanoid(),
      role,
      content,
      timestamp: Date.now(),
    }
    messages.value.push(message)
    return message
  }

  const updateLastMessage = (content: string) => {
    const last = messages.value[messages.value.length - 1]
    if (last && last.role === 'assistant') {
      last.content = content
    }
  }

  const clearMessages = () => {
    messages.value = []
  }

  const setStreaming = (streaming: boolean) => {
    isStreaming.value = streaming
    if (!streaming) {
      streamingText.value = ''
    }
  }

  const appendStreamingText = (text: string) => {
    streamingText.value += text
  }

  const loadSettings = () => {
    resetSettings()

    const stored = localStorage.getItem(CHAT_SETTINGS_STORAGE_KEY)
    if (stored) {
      try {
        applySettingsPatch(JSON.parse(stored) as PromptSettingsPatch)
      } catch (err) {
        console.warn('Failed to load chat settings:', err)
      }
    }

    const legacySettings = readLegacyPromptSettings()
    if (legacySettings) {
      applySettingsPatch(legacySettings)
    }

    saveSettings()
  }

  const saveSettings = () => {
    localStorage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    localStorage.setItem(PROMPT_STORAGE_KEYS.systemPrompt, settings.system_prompt)
    localStorage.setItem(PROMPT_STORAGE_KEYS.memory, settings.memory)
    localStorage.setItem(PROMPT_STORAGE_KEYS.context, settings.context)
    localStorage.setItem(PROMPT_STORAGE_KEYS.useRagContext, String(settings.use_rag_context))
    localStorage.setItem(PROMPT_STORAGE_KEYS.ttsMode, String(settings.tts_enabled))
    localStorage.setItem(PROMPT_STORAGE_KEYS.browserAsrMode, String(settings.browser_asr_mode))
    localStorage.setItem(PROMPT_STORAGE_KEYS.browserTtsMode, String(settings.browser_tts_enabled))
    localStorage.setItem(PROMPT_STORAGE_KEYS.collapseThink, String(settings.collapse_think))
    localStorage.setItem(PROMPT_STORAGE_KEYS.rerankCandidatePool, String(settings.rerank.candidate_pool))
    localStorage.setItem(PROMPT_STORAGE_KEYS.rerankSimilarityThreshold, String(settings.rerank.similarity_threshold))
    localStorage.setItem(PROMPT_STORAGE_KEYS.rerankTopK, String(settings.rerank.top_k))
    localStorage.setItem(PROMPT_STORAGE_KEYS.rerankInstruction, settings.rerank.instruction)
  }

  watch(settings, saveSettings, { deep: true })

  return {
    messages,
    isStreaming,
    streamingText,
    settings,
    addMessage,
    updateLastMessage,
    clearMessages,
    setStreaming,
    appendStreamingText,
    loadSettings,
    saveSettings,
  }
})
