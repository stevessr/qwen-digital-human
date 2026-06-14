export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface PromptSettings {
  system_prompt: string
  memory: string
  context: string
  use_rag_context: boolean
  tts_enabled: boolean
  browser_tts_enabled: boolean
  browser_asr_mode: boolean
  collapse_think: boolean
  rerank: RerankSettings
}

export interface RerankSettings {
  candidate_pool: number
  similarity_threshold: number
  top_k: number
  instruction: string
}

export interface StreamEvent {
  type: 'delta' | 'status' | 'audio.delta' | 'error' | 'done'
  text?: string
  message?: string
  stage?: string
  audio_base64?: string
  audio_bytes?: Uint8Array
  sample_rate?: number
  reply?: string
}

export interface ChatResponse {
  reply: string
  audio_base64?: string
  sample_rate?: number
}
