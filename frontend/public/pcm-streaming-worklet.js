/**
 * PCM Streaming Audio Worklet Processor
 * Plays PCM 16-bit samples in real-time with minimal latency
 */

class PcmStreamingProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []
    this.sampleRate = 24000 // Default, can be updated

    this.port.onmessage = (event) => {
      const { type, samples, sampleRate } = event.data

      if (type === 'enqueue') {
        if (sampleRate && sampleRate !== this.sampleRate) {
          this.sampleRate = sampleRate
        }
        if (samples && samples.length > 0) {
          this.queue.push(...samples)
        }
      } else if (type === 'reset') {
        this.queue = []
      }
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const channel = output[0]
    const framesToWrite = channel.length

    // Fill output buffer from queue
    for (let i = 0; i < framesToWrite; i++) {
      if (this.queue.length > 0) {
        channel[i] = this.queue.shift()
      } else {
        channel[i] = 0 // Silence if queue is empty
      }
    }

    // Report queue status
    this.port.postMessage({
      type: 'status',
      queueLength: this.queue.length,
      isEmpty: this.queue.length === 0,
    })

    return true
  }
}

registerProcessor('pcm-streaming-processor', PcmStreamingProcessor)
