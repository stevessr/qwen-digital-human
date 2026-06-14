export async function sendChatMessage(params: {
  message: string
  fast_mode: boolean
  stream: boolean
  tts_enabled: boolean
  use_rag_context: boolean
  system_prompt: string
  memory: string
  context: string
  rerank: {
    candidate_pool: number
    similarity_threshold: number
    top_k: number
    instruction: string
  }
  browser_tts_enabled: boolean
}): Promise<Response> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export async function playTTS(text: string): Promise<Blob> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!response.ok) {
    throw new Error(`TTS failed: ${response.status}`)
  }

  return response.blob()
}
