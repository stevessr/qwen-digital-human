import type { StreamEvent } from '@/types/chat'

interface StreamCallbacks {
  onDelta?: (text: string) => void
  onStatus?: (message: string) => void
  onAudioDelta?: (audioBase64: string, sampleRate: number) => void
  onError?: (error: string) => void
  onDone?: (finalReply: string) => void
}

/**
 * Read Server-Sent Events (SSE) streaming response
 * Parses lines in format: data: {...}\n\n
 */
export async function readStreamingResponse(
  response: Response,
  callbacks: StreamCallbacks
): Promise<{
  streamed: boolean
  finalEvent?: StreamEvent
  data?: any
}> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''

  // Non-streaming JSON response
  if (contentType.includes('application/json') && !response.body) {
    const data = await response.json()
    return { streamed: false, data }
  }

  // Streaming SSE response
  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent: StreamEvent | undefined

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue

        // Parse SSE format: data: {...}
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6) // Remove 'data: ' prefix
          try {
            const event = JSON.parse(jsonStr) as StreamEvent

            switch (event.type) {
              case 'delta':
                if (event.text) {
                  callbacks.onDelta?.(event.text)
                }
                break

              case 'status':
                callbacks.onStatus?.(event.message || event.stage || '')
                break

              case 'audio.delta':
                if (event.audio_base64) {
                  callbacks.onAudioDelta?.(
                    event.audio_base64,
                    event.sample_rate || 24000
                  )
                }
                break

              case 'error':
                callbacks.onError?.(event.message || 'Stream error')
                break

              case 'done':
                finalEvent = event
                if (event.reply) {
                  callbacks.onDone?.(event.reply)
                }
                break
            }
          } catch (err) {
            console.warn('Failed to parse SSE event:', jsonStr, err)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { streamed: true, finalEvent }
}
