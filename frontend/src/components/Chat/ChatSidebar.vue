<script setup lang="ts">
import { computed, ref } from 'vue'
import { message as AMessage } from 'ant-design-vue'
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
const { detectIntents } = useAvatarIntent()

const inputText = ref('')
const activeIntentLabel = ref('待机')
const renderedMessages = computed(() => chatStore.messages.map(message => ({
  ...message,
  html: renderMarkdown(message.content),
})))

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
      <AInput
        v-model:value="inputText"
        placeholder="输入地点、路线或地图问题..."
        :disabled="isStreaming"
        @keypress="handleKeyPress"
      />
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
</style>
