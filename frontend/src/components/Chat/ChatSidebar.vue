<script setup lang="ts">
import { ref } from 'vue'
import { message as AMessage } from 'ant-design-vue'
import { useStreamingChat } from '@/composables/useStreamingChat'
import { useTTS } from '@/composables/useTTS'
import { useAvatarIntent } from '@/utils/intent'
import { useAvatarStore } from '@/stores/avatar'
import { useChatStore } from '@/stores/chat'
import type { AvatarIntent, DigitalHumanExpressionName } from '@/types/avatar'

const chatStore = useChatStore()
const avatarStore = useAvatarStore()
const { isStreaming, sendMessage } = useStreamingChat()
const { play: playTTS } = useTTS()
const { detectIntents } = useAvatarIntent()

const inputText = ref('')
const activeIntentLabel = ref('待机')

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
      <div class="info-text">
        <strong>Models:</strong> Loading...
        <div class="info-hint">
          数字人形象：在线 GLB 3D 模型渲染，支持口型、动作状态与 OpenCV 姿态驱动。
        </div>
      </div>
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

    <div class="opencv-notice">
      OpenCV 眼部追踪已迁移到
      <RouterLink to="/config">配置网页</RouterLink>
      。开启后，主页面会自动使用摄像头跟踪人眼并驱动数字人姿态。
    </div>

    <div class="asr-panel">
      <div class="asr-head">
        <div class="asr-title">实时 ASR</div>
        <div class="asr-state" data-tone="idle">待机</div>
      </div>
      <div class="asr-text" data-tone="idle">
        按住"按住说话（地图讲解）"开始实时转写，识别结果会在这里即时显示。
      </div>
    </div>

    <div class="chat-history">
      <div
        v-for="msg in chatStore.messages"
        :key="msg.id"
        class="message"
        :class="msg.role === 'user' ? 'user-message' : 'bot-message'"
      >
        <strong>{{ msg.role === 'user' ? 'You' : '地图数字人' }}:</strong>
        {{ msg.content }}
      </div>
    </div>

    <div v-if="chatStore.streamingText" class="stream-text">
      {{ chatStore.streamingText }}
    </div>

    <div class="controls">
      <div class="control-row">
        <ASwitch v-model:checked="chatStore.settings.tts_enabled" />
        <span>TTS Enabled</span>
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
      <AButton type="primary" block style="background: #28a745">
        按住说话（地图讲解）
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
  justify-content: space-between;
  align-items: center;
}

.info-hint {
  margin-top: 4px;
  color: #9aa4b2;
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

.opencv-notice {
  margin: 8px 0 0;
  padding: 10px 14px;
  border: 1px solid #2b3550;
  border-radius: 10px;
  background: #101723;
  color: #9ab3d4;
  font-size: 0.88rem;
}

.opencv-notice a {
  color: #4ea1ff;
  text-decoration: none;
}

.asr-panel {
  margin: 8px 20px 0;
  padding: 12px 14px;
  border: 1px solid #2f4f73;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(14, 22, 34, 0.98), rgba(11, 17, 26, 0.98));
}

.asr-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.asr-title {
  font-weight: 700;
  color: #e8f1ff;
}

.asr-state {
  color: #8ac2ff;
  font-size: 0.8rem;
}

.asr-text {
  margin-top: 8px;
  min-height: 3.2em;
  color: #eef5ff;
  line-height: 1.5;
  font-size: 0.94rem;
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

.user-message {
  background: #2b5278;
}

.bot-message {
  background: #2c2c2c;
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
