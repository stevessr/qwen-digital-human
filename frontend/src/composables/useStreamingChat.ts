import { ref, readonly } from 'vue'
import { sendChatMessage } from '@/api/chat'
import { readStreamingResponse } from '@/utils/streaming'
import { useChatStore } from '@/stores/chat'
import { useAvatarStore } from '@/stores/avatar'

interface ChatCallbacks {
  onDelta?: (text: string) => void
  onStatus?: (message: string) => void
  onAudioDelta?: (audioBase64: string, sampleRate: number) => void
  onError?: (error: Error) => void
  onComplete?: (reply: string) => void
}

export function useStreamingChat() {
  const chatStore = useChatStore()
  const avatarStore = useAvatarStore()
  const isStreaming = ref(false)

  const sendMessage = async (text: string, callbacks?: ChatCallbacks) => {
    if (!text.trim()) return

    isStreaming.value = true
    chatStore.setStreaming(true)

    try {
      // Add user message
      chatStore.addMessage('user', text)

      // Add assistant message placeholder
      chatStore.addMessage('assistant', '')
      let accumulatedReply = ''

      // Send request
      const response = await sendChatMessage({
        message: text,
        fast_mode: true, // TODO: get from settings
        stream: true,
        tts_enabled: chatStore.settings.tts_enabled && !chatStore.settings.browser_tts_enabled,
        use_rag_context: chatStore.settings.use_rag_context,
        system_prompt: chatStore.settings.system_prompt,
        memory: chatStore.settings.memory,
        context: chatStore.settings.context,
        rerank: chatStore.settings.rerank,
        browser_tts_enabled: chatStore.settings.browser_tts_enabled,
      })

      // Read streaming response
      const result = await readStreamingResponse(response, {
        onDelta: (deltaText: string) => {
          accumulatedReply += deltaText
          const sanitized = sanitizeAssistantText(
            accumulatedReply,
            chatStore.settings.collapse_think
          )
          chatStore.updateLastMessage(sanitized)
          chatStore.appendStreamingText(deltaText)
          callbacks?.onDelta?.(deltaText)
        },
        onStatus: (message: string) => {
          callbacks?.onStatus?.(message)
        },
        onAudioDelta: (audioBase64: string, sampleRate: number) => {
          callbacks?.onAudioDelta?.(audioBase64, sampleRate)
        },
        onError: (errorMsg: string) => {
          callbacks?.onError?.(new Error(errorMsg))
        },
        onDone: (finalReply: string) => {
          if (finalReply) {
            accumulatedReply = finalReply
          }
        },
      })

      // Update final message
      const finalText = sanitizeAssistantText(
        result.finalEvent?.reply || accumulatedReply,
        chatStore.settings.collapse_think
      )
      chatStore.updateLastMessage(finalText)

      // Update avatar expression (happy)
      avatarStore.updateExpression({
        mouth_open: 0.3,
        smile: 0.4,
      })

      callbacks?.onComplete?.(finalText)
    } catch (error) {
      console.error('Chat error:', error)
      chatStore.updateLastMessage('Error: Failed to communicate with server.')
      callbacks?.onError?.(error as Error)
    } finally {
      isStreaming.value = false
      chatStore.setStreaming(false)
    }
  }

  return {
    isStreaming: readonly(isStreaming),
    sendMessage,
  }
}

/**
 * Sanitize assistant response by removing <think> tags
 */
function sanitizeAssistantText(text: string, collapseThink: boolean): string {
  if (!collapseThink) return text
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}
