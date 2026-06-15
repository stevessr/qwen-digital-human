<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { message as AMessage } from 'ant-design-vue'
import { useBrowserASR } from '@/composables/useBrowserASR'
import { useStreamingChat } from '@/composables/useStreamingChat'
import { useTTS } from '@/composables/useTTS'
import { useAvatarIntent } from '@/utils/intent'
import { useAvatarStore } from '@/stores/avatar'
import { useChatStore } from '@/stores/chat'
import { renderMarkdown } from '@/utils/markdown'
import type { AvatarIntent, DigitalHumanExpressionName } from '@/types/avatar'

const chatStore = useChatStore()
const avatarStore = useAvatarStore()
const { isStreaming, sendMessage } = useStreamingChat()
const { play: playTTS } = useTTS()
const {
  isSupported: isBrowserASRSupported,
  isListening: isASRListening,
  finalText: asrFinalText,
  interimText: asrInterimText,
  errorMessage: asrErrorMessage,
  start: startBrowserASR,
  stop: stopBrowserASR,
  abort: abortBrowserASR,
} = useBrowserASR()
const { detectIntents } = useAvatarIntent()

const inputText = shallowRef('')
const activeIntentLabel = shallowRef('待机')
const asrBaseText = shallowRef('')
const isHoldingASR = shallowRef(false)
const shouldSendAfterASRStop = shallowRef(false)
const renderedMessages = computed(() => chatStore.messages.map(message => ({
  ...message,
  html: renderMarkdown(message.content),
})))
const asrTranscriptPreview = computed(() => [asrFinalText.value, asrInterimText.value]
  .map(text => text.trim())
  .filter(Boolean)
  .join(' ')
  .trim())
const canUseBrowserASR = computed(() => (
  chatStore.settings.browser_asr_mode
  && isBrowserASRSupported.value
  && !isStreaming.value
))
const asrButtonLabel = computed(() => {
  if (isHoldingASR.value) return '松开发送'
  if (!chatStore.settings.browser_asr_mode) return '浏览器 ASR 已关闭'
  if (!isBrowserASRSupported.value) return '当前浏览器不支持 ASR'
  return '按住说话'
})

const applyAvatarIntent = (intent: AvatarIntent) => {
  if (intent.kind === 'switch_persona_cycle') {
    avatarStore.cyclePersona()
  } else if (intent.kind === 'switch_persona' && intent.personaKey) {
    avatarStore.setPersona(intent.personaKey)
  } else if (intent.kind === 'expression' && intent.expression) {
    avatarStore.applyExpressionPreset(intent.expression)
    if (intent.motion) avatarStore.performMotion(intent.motion)
  } else if (intent.kind === 'motion' && intent.motion) {
    avatarStore.performMotion(intent.motion)
  }

  activeIntentLabel.value = intent.label
}

const EXPRESSION_LABELS: Record<DigitalHumanExpressionName, string> = {
  happy: '开心',
  thinking: '思考',
  surprised: '惊讶',
  sad: '难过',
  angry: '生气',
}

const setExpression = (expression: DigitalHumanExpressionName) => {
  applyAvatarIntent({ kind: 'expression', expression, label: EXPRESSION_LABELS[expression] })
}

const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return

  inputText.value = ''

  const intents = detectIntents(text)
  intents.forEach(applyAvatarIntent)

  try {
    await sendMessage(text, {
      onDelta: (_delta: string) => {
        avatarStore.updateExpression({ mouth_open: 0.22, smile: Math.max(avatarStore.expression.smile, 0.18) })
      },
      onStatus: (msg: string) => {
        console.log('Status:', msg)
      },
      onAudioDelta: (audioBase64: string, _sampleRate: number) => {
        console.log('Audio delta received:', audioBase64.length, 'bytes')
      },
      onError: (err: Error) => {
        AMessage.error(err.message)
      },
      onComplete: async (reply: string) => {
        if (chatStore.settings.tts_enabled && reply.trim()) {
          try {
            await playTTS(reply, chatStore.settings.browser_tts_enabled)
          } catch (err) {
            console.error('TTS playback failed:', err)
          }
        }
        avatarStore.applyExpressionPreset('happy')
      },
    })
  } catch (err: any) {
    AMessage.error(err.message || 'Failed to send message')
  }
}

const handleKeyPress = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void handleSend()
  }
}

const mergeASRTranscript = (transcript: string) => {
  const spokenText = transcript.trim()
  if (!spokenText) return

  const prefix = asrBaseText.value.trim()
  inputText.value = prefix ? `${prefix}\n${spokenText}` : spokenText
}

const handleASRPointerDown = (event: PointerEvent) => {
  event.preventDefault()

  if (isStreaming.value || isASRListening.value) return
  if (!chatStore.settings.browser_asr_mode) {
    AMessage.warning('请先启用浏览器 ASR。')
    return
  }
  if (!isBrowserASRSupported.value) {
    AMessage.error('当前浏览器不支持 SpeechRecognition / webkitSpeechRecognition。')
    return
  }

  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  asrBaseText.value = inputText.value.trim()
  isHoldingASR.value = true
  shouldSendAfterASRStop.value = true
  inputText.value = asrBaseText.value
  avatarStore.applyExpressionPreset('thinking')

  try {
    startBrowserASR({ lang: 'zh-CN' })
  } catch (err) {
    isHoldingASR.value = false
    shouldSendAfterASRStop.value = false
    AMessage.error(err instanceof Error ? err.message : '浏览器 ASR 启动失败。')
  }
}

const stopASRAndMaybeSend = async () => {
  if (!shouldSendAfterASRStop.value && !isASRListening.value) return

  isHoldingASR.value = false
  const shouldSend = shouldSendAfterASRStop.value
  shouldSendAfterASRStop.value = false

  const transcript = await stopBrowserASR()
  mergeASRTranscript(transcript)

  if (!shouldSend) return
  if (!inputText.value.trim()) {
    AMessage.warning(asrErrorMessage.value || '没有识别到语音。')
    return
  }

  await handleSend()
}

const cancelASR = () => {
  isHoldingASR.value = false
  shouldSendAfterASRStop.value = false
  abortBrowserASR()
}

watch(asrTranscriptPreview, (transcript) => {
  if (isASRListening.value) {
    mergeASRTranscript(transcript)
  }
})

watch(asrErrorMessage, (message) => {
  if (message && message !== '语音识别已取消') {
    AMessage.warning(message)
  }
})
</script>

<template>
  <div class="chat-sidebar">
    <div class="model-info">
      <div class="info-links">
        <RouterLink to="/config">配置网页</RouterLink>
        <RouterLink to="/models">管理控制台</RouterLink>
      </div>
    </div>

    <div class="toolbar">
      <AButton @click="applyAvatarIntent({ kind: 'switch_persona_cycle', label: '切换形象' })">
        切换形象
      </AButton>
      <AButton @click="setExpression('happy')">开心</AButton>
      <AButton @click="setExpression('thinking')">思考</AButton>
      <AButton @click="setExpression('surprised')">惊讶</AButton>
      <AButton @click="setExpression('sad')">难过</AButton>
      <AButton @click="setExpression('angry')">生气</AButton>
      <span class="intent-status">意图：{{ activeIntentLabel }}</span>
    </div>

    <div class="chat-history">
      <div
        v-for="msg in renderedMessages"
        :key="msg.id"
        class="message"
        :class="msg.role === 'user' ? 'user-message' : 'bot-message'"
      >
        <strong>{{ msg.role === 'user' ? 'You' : '地图数字人' }}:</strong>
        <div class="markdown-body" v-html="msg.html" />
      </div>
    </div>

    <div v-if="chatStore.streamingText" class="stream-text">
      {{ chatStore.streamingText }}
    </div>

    <div class="controls">
      <div class="control-row">
        <ASwitch v-model:checked="chatStore.settings.tts_enabled" />
        <span>语音播报</span>
      </div>
      <div class="control-row compact">
        <ASwitch
          v-model:checked="chatStore.settings.browser_tts_enabled"
          :disabled="!chatStore.settings.tts_enabled"
        />
        <span>浏览器 TTS</span>
        <ASwitch v-model:checked="chatStore.settings.browser_asr_mode" />
        <span>浏览器 ASR</span>
      </div>
      <AInput
        v-model:value="inputText"
        placeholder="输入地点、路线或地图问题..."
        :disabled="isStreaming"
        @keypress="handleKeyPress"
      />
      <AButton
        class="voice-hold-button"
        :class="{ listening: isASRListening }"
        block
        :disabled="!canUseBrowserASR"
        @pointerdown="handleASRPointerDown"
        @pointerup="stopASRAndMaybeSend"
        @pointercancel="cancelASR"
        @lostpointercapture="stopASRAndMaybeSend"
        @click="stopASRAndMaybeSend"
        @contextmenu.prevent
      >
        {{ asrButtonLabel }}
      </AButton>
      <AButton
        type="primary"
        block
        :loading="isStreaming"
        @click="handleSend"
      >
        {{ isStreaming ? '发送中...' : '发送讲解' }}
      </AButton>
    </div>
  </div>
</template>

<style scoped>
.chat-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}

.model-info {
  padding: 10px;
  border-bottom: 1px solid #333;
  font-size: 0.8em;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.info-links {
  display: flex;
  gap: 8px;
}

.info-links a {
  color: #007bff;
  text-decoration: none;
  border: 1px solid #007bff;
  padding: 2px 8px;
  border-radius: 4px;
}

.toolbar {
  padding: 8px 10px;
  border-bottom: 1px solid #333;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.intent-status {
  margin-left: auto;
  color: #9aa4b2;
}

.chat-history {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.message {
  margin-bottom: 15px;
  line-height: 1.5;
  padding: 10px;
  border-radius: 8px;
}

.message > strong {
  display: block;
  margin-bottom: 6px;
}

.user-message {
  background: #2b5278;
}

.bot-message {
  background: #2c2c2c;
}

.message :deep(.markdown-body) {
  overflow-wrap: anywhere;
}

.message :deep(.markdown-body > :first-child) {
  margin-top: 0;
}

.message :deep(.markdown-body > :last-child) {
  margin-bottom: 0;
}

.message :deep(.markdown-body p),
.message :deep(.markdown-body ul),
.message :deep(.markdown-body ol),
.message :deep(.markdown-body blockquote),
.message :deep(.markdown-body pre) {
  margin: 0 0 0.75em;
}

.message :deep(.markdown-body h1),
.message :deep(.markdown-body h2),
.message :deep(.markdown-body h3) {
  margin: 0.45em 0 0.35em;
  color: #f3f7ff;
  line-height: 1.25;
}

.message :deep(.markdown-body h1) {
  font-size: 1.22rem;
}

.message :deep(.markdown-body h2) {
  font-size: 1.1rem;
}

.message :deep(.markdown-body h3) {
  font-size: 1rem;
}

.message :deep(.markdown-body ul),
.message :deep(.markdown-body ol) {
  padding-left: 1.35em;
}

.message :deep(.markdown-body li + li) {
  margin-top: 0.25em;
}

.message :deep(.markdown-body code) {
  padding: 0.12em 0.32em;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.28);
  color: #ffd98a;
  font-size: 0.92em;
}

.message :deep(.markdown-body pre) {
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
}

.message :deep(.markdown-body pre code) {
  padding: 0;
  background: transparent;
  color: #e8eef8;
}

.message :deep(.markdown-body a) {
  color: #8bc7ff;
}

.message :deep(.markdown-body blockquote) {
  padding-left: 0.9em;
  border-left: 3px solid rgba(139, 199, 255, 0.45);
  color: #c6d3e4;
}

.stream-text {
  color: #aaa;
  padding: 0 20px;
  font-style: italic;
  min-height: 1.2em;
}

.controls {
  padding: 20px;
  border-top: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9em;
}

.control-row.compact {
  gap: 8px;
  flex-wrap: wrap;
  color: #b9c4d6;
}

.voice-hold-button {
  border-color: #245c39;
  background: #183c28;
  color: #bdf8d3;
  touch-action: none;
  user-select: none;
}

.voice-hold-button.listening {
  border-color: #24c35a;
  background: #17823d;
  color: #fff;
  box-shadow: 0 0 0 2px rgba(36, 195, 90, 0.18);
}
</style>
