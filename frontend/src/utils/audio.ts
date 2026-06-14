/**
 * Audio utility functions for PCM processing and resampling
 */

/**
 * Convert Float32 samples to PCM 16-bit little-endian bytes
 */
export function float32ToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0))
    const pcm16 = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(i * 2, pcm16, true) // little-endian
  }

  return bytes
}

/**
 * Convert PCM 16-bit little-endian bytes to Float32 samples
 */
export function pcm16leBytesToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.length / 2)
  if (sampleCount === 0) return new Float32Array(0)

  const samples = new Float32Array(sampleCount)
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2)

  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768
  }

  return samples
}

/**
 * Linear resampling of Float32 audio samples
 */
export function resampleLinearFloat32(
  samples: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (
    !samples ||
    samples.length === 0 ||
    !Number.isFinite(inputSampleRate) ||
    !Number.isFinite(outputSampleRate) ||
    inputSampleRate <= 0 ||
    outputSampleRate <= 0 ||
    inputSampleRate === outputSampleRate
  ) {
    return samples instanceof Float32Array ? samples : new Float32Array(samples || [])
  }

  const ratio = outputSampleRate / inputSampleRate
  const outputLength = Math.max(1, Math.round(samples.length * ratio))
  const resampled = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const sourcePosition = i / ratio
    const left = Math.floor(sourcePosition)
    const frac = sourcePosition - left
    const s0 = samples[Math.min(left, samples.length - 1)] ?? 0
    const s1 = samples[Math.min(left + 1, samples.length - 1)] ?? s0
    resampled[i] = s0 + (s1 - s0) * frac
  }

  return resampled
}

/**
 * Mix multi-channel AudioBuffer to mono Float32Array
 */
export function mixBufferToMono(inputBuffer: AudioBuffer): Float32Array {
  const channels = inputBuffer.numberOfChannels
  const frameCount = inputBuffer.length
  if (frameCount === 0) return new Float32Array(0)

  const mono = new Float32Array(frameCount)

  for (let ch = 0; ch < channels; ch++) {
    const channelData = inputBuffer.getChannelData(ch)
    for (let i = 0; i < frameCount; i++) {
      const sample = channelData[i]
      if (sample !== undefined) {
        mono[i] = (mono[i] || 0) + sample
      }
    }
  }

  if (channels > 1) {
    for (let i = 0; i < frameCount; i++) {
      const value = mono[i]
      if (value !== undefined) {
        mono[i] = value / channels
      }
    }
  }

  return mono
}

/**
 * Concatenate multiple Uint8Array chunks into one
 */
export function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

/**
 * Decode base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Play audio blob with Audio element
 */
export async function playAudioBlob(blob: Blob): Promise<void> {
  if (blob.size === 0) return

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)

    audio.onended = () => {
      URL.revokeObjectURL(url)
      resolve()
    }

    audio.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err)
    }

    audio.play().catch((err) => {
      URL.revokeObjectURL(url)
      reject(err)
    })
  })
}
