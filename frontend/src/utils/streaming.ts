import type { StreamEvent } from '@/types/chat'

interface StreamCallbacks {
  onDelta?: (text: string) => void
  onStatus?: (message: string) => void
  onAudioDelta?: (audioBase64: string, sampleRate: number) => void
  onError?: (error: string) => void
  onDone?: (finalReply: string) => void
}

/**
 * Read a chat/pipeline stream.
 *
 * The Python backend sends `qdh-binary-v2` frames for streaming endpoints.  The
 * legacy SSE parser is still kept as a fallback so older/static services remain
 * compatible.
 */
export async function readStreamingResponse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<{
  streamed: boolean
  finalEvent?: StreamEvent
  data?: any
}> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''
  const streamFormat = response.headers.get('x-stream-format') || ''

  if (contentType.includes('application/json')) {
    const data = await response.json()
    if (typeof data?.reply === 'string') {
      callbacks.onDone?.(data.reply)
      return { streamed: false, data, finalEvent: { type: 'done', reply: data.reply } }
    }
    return { streamed: false, data }
  }

  if (
    streamFormat === 'qdh-binary-v2'
    || contentType.includes('application/octet-stream')
    || contentType.includes('application/qdh-stream')
  ) {
    return readBinaryStreamingResponse(response, callbacks)
  }

  return readSseStreamingResponse(response, callbacks)
}

async function readSseStreamingResponse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<{
  streamed: boolean
  finalEvent?: StreamEvent
}> {
  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent: StreamEvent | undefined

  const handleEvent = (event: StreamEvent) => {
    switch (event.type) {
      case 'delta':
        if (event.text) callbacks.onDelta?.(event.text)
        break
      case 'status':
        callbacks.onStatus?.(event.message || event.stage || '')
        break
      case 'audio.delta':
        if (event.audio_base64) {
          callbacks.onAudioDelta?.(event.audio_base64, event.sample_rate || 24000)
        }
        break
      case 'error':
        callbacks.onError?.(event.message || 'Stream error')
        throw new Error(event.message || 'Stream error')
      case 'done':
        finalEvent = event
        if (event.reply) callbacks.onDone?.(event.reply)
        break
    }
  }

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return

    const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
    try {
      handleEvent(JSON.parse(jsonStr) as StreamEvent)
    } catch (error) {
      if (error instanceof Error && error.message !== 'Stream error') {
        console.warn('Failed to parse stream event:', jsonStr, error)
      } else {
        throw error
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        processLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) processLine(buffer)
  } finally {
    reader.releaseLock()
  }

  return { streamed: true, finalEvent }
}

const BINARY_FRAME_STATUS = 1
const BINARY_FRAME_ASR = 2
const BINARY_FRAME_DELTA = 3
const BINARY_FRAME_AUDIO = 4
const BINARY_FRAME_DONE = 5
const BINARY_FRAME_ERROR = 6

const stageNameFromCode = (stageCode: number): string => {
  switch (stageCode) {
    case 1:
      return 'asr'
    case 2:
      return 'rag'
    case 3:
      return 'llm'
    case 4:
      return 'tts'
    case 5:
      return 'render'
    default:
      return 'unknown'
  }
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x2000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function readBinaryStreamingResponse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<{
  streamed: boolean
  finalEvent?: StreamEvent
}> {
  if (!response.body) {
    throw new Error('Binary stream response has no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = new Uint8Array(0)
  let pendingOffset = 0
  let finalEvent: StreamEvent | undefined

  const createPayloadReader = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0

    const remaining = () => bytes.byteLength - offset
    const readU8 = (): number | null => {
      if (remaining() < 1) return null
      const value = view.getUint8(offset)
      offset += 1
      return value
    }
    const readU32 = (): number | null => {
      if (remaining() < 4) return null
      const value = view.getUint32(offset, true)
      offset += 4
      return value
    }
    const readBytes = (length: number): Uint8Array | null => {
      if (length < 0 || remaining() < length) return null
      const slice = bytes.subarray(offset, offset + length)
      offset += length
      return slice
    }
    const readString = (): string | null => {
      const length = readU32()
      if (length === null) return null
      const bytesSlice = readBytes(length)
      if (bytesSlice === null) return null
      return decoder.decode(bytesSlice)
    }

    return { remaining, readU8, readU32, readBytes, readString }
  }

  const parseStatusFrame = (payload: Uint8Array): StreamEvent | null => {
    const payloadReader = createPayloadReader(payload)
    const stageCode = payloadReader.readU8()
    const message = payloadReader.readString()
    if (stageCode === null || message === null) return null

    return {
      type: 'status',
      stage: stageNameFromCode(stageCode),
      message,
    }
  }

  const parseTextFrame = (
    payload: Uint8Array,
    eventType: 'delta' | 'error',
  ): StreamEvent | null => {
    const payloadReader = createPayloadReader(payload)
    const text = payloadReader.readString()
    if (text === null) return null

    if (eventType === 'error') {
      return { type: 'error', message: text }
    }

    return { type: eventType, text }
  }

  const parseAudioFrame = (payload: Uint8Array): StreamEvent | null => {
    const payloadReader = createPayloadReader(payload)
    const sampleRate = payloadReader.readU32()
    if (sampleRate === null) return null
    const audioBytes = payloadReader.readBytes(payloadReader.remaining())
    if (audioBytes === null) return null

    return {
      type: 'audio.delta',
      audio_base64: bytesToBase64(audioBytes),
      audio_bytes: audioBytes,
      sample_rate: sampleRate || 24000,
    }
  }

  const parseDoneFrame = (payload: Uint8Array): StreamEvent | null => {
    const payloadReader = createPayloadReader(payload)
    const flags = payloadReader.readU8()
    if (flags === null) return null

    if (flags & 0x01) {
      const transcription = payloadReader.readString()
      if (transcription === null) return null
    }

    const reply = payloadReader.readString()
    if (reply === null) return null

    return { type: 'done', reply }
  }

  const parseFrame = (frameType: number, payload: Uint8Array): StreamEvent | null => {
    switch (frameType) {
      case BINARY_FRAME_STATUS:
        return parseStatusFrame(payload)
      case BINARY_FRAME_ASR:
        return null
      case BINARY_FRAME_DELTA:
        return parseTextFrame(payload, 'delta')
      case BINARY_FRAME_AUDIO:
        return parseAudioFrame(payload)
      case BINARY_FRAME_DONE:
        return parseDoneFrame(payload)
      case BINARY_FRAME_ERROR:
        return parseTextFrame(payload, 'error')
      default:
        console.warn('Unknown binary stream frame type:', frameType)
        return null
    }
  }

  const appendChunk = (chunk: Uint8Array) => {
    if (!chunk.length) return

    if (pendingOffset === pending.length) {
      pending = new Uint8Array(chunk)
      pendingOffset = 0
      return
    }

    const remaining = pending.length - pendingOffset
    const merged = new Uint8Array(remaining + chunk.length)
    merged.set(pending.subarray(pendingOffset), 0)
    merged.set(chunk, remaining)
    pending = merged
    pendingOffset = 0
  }

  const processEvent = (event: StreamEvent) => {
    switch (event.type) {
      case 'delta':
        if (event.text) callbacks.onDelta?.(event.text)
        break
      case 'status':
        callbacks.onStatus?.(event.message || event.stage || '')
        break
      case 'audio.delta':
        if (event.audio_base64) {
          callbacks.onAudioDelta?.(event.audio_base64, event.sample_rate || 24000)
        }
        break
      case 'done':
        finalEvent = event
        if (event.reply) callbacks.onDone?.(event.reply)
        break
      case 'error':
        callbacks.onError?.(event.message || 'Stream error')
        throw new Error(event.message || 'Stream error')
    }
  }

  const processPendingFrames = () => {
    while (pending.length - pendingOffset >= 5) {
      const frameType = pending[pendingOffset] ?? 0
      const view = new DataView(
        pending.buffer,
        pending.byteOffset + pendingOffset + 1,
        4,
      )
      const payloadLength = view.getUint32(0, true)
      if (pending.length - pendingOffset < 5 + payloadLength) break

      const payloadStart = pendingOffset + 5
      const payload = pending.subarray(payloadStart, payloadStart + payloadLength)
      pendingOffset += 5 + payloadLength

      const event = parseFrame(frameType, payload)
      if (event) processEvent(event)
    }

    if (pendingOffset >= pending.length) {
      pending = new Uint8Array(0)
      pendingOffset = 0
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (value?.length) {
        appendChunk(value)
        processPendingFrames()
      }
    }

    processPendingFrames()
  } finally {
    reader.releaseLock()
  }

  return { streamed: true, finalEvent }
}
