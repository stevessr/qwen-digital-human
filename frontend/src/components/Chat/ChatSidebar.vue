<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useStreamingChat } from '@/composables/useStreamingChat'
import { useTTS } from '@/composables/useTTS'
import { useAvatarIntent } from '@/utils/intent'
import { message as AMessage } from 'ant-design-vue'

const chatStore = useChatStore()
const { isStreaming, sendMessage } = useStreamingChat()
const { play: playTTS } = useTTS()
const { detectIntents } = useAvatarIntent()

const inputText = ref('')

const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return

  inputText.value = ''

  // Detect avatar intents
  const intents = detectIntents(text)
  if (intents.length > 0) {
    console.log('Detected intents:', intents)
    // TODO: Trigger expressions/motions via useLive2D
  }

  // Send message
  try {
    await sendMessage(text, {
      onDelta: (_delta: string) => {
        // Delta is already handled in useStreamingChat
      },
      onStatus: (msg: string) => {
        console.log('Status:', msg)
      },
      onAudioDelta: (audioBase64: string, _sampleRate: number) => {
        // TODO: Enqueue audio for real-time playback
        console.log('Audio delta received:', audioBase64.length, 'bytes')
      },
      onError: (err: Error) => {
        AMessage.error(err.message)
      },
      onComplete: async (reply: string) => {
        // Play TTS if enabled
        if (chatStore.settings.tts_enabled && reply.trim()) {
          try {
            await playTTS(reply, chatStore.settings.browser_tts_enabled)
          } catch (err) {
            console.error('TTS playback failed:', err)
          }
        }
      },
    })
  } catch (err: any) {
    AMessage.error(err.message || 'Failed to send message')
  }
}

const handleKeyPress = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="chat-sidebar">
    <div class="model-info">
      <div class="info-text">
        <strong>Models:</strong> Loading...
        <div class="info-hint">
          Live2D 头像：Shizuku / Haru 01 / Haru 02（本地资源）
        </div>
      </div>
      <div class="info-links">
        <a href="/config.html" target="_blank">配置网页</a>
        <a href="/models.html" target="_blank">管理控制台</a>
      </div>
    </div>

    <div class="toolbar">
      <AButton>切换模型</AButton>
      <AButton>开心</AButton>
      <AButton>思考</AButton>
      <AButton>惊讶</AButton>
      <AButton>难过</AButton>
      <AButton>生气</AButton>
      <span class="intent-status">意图：待机</span>
    </div>

    <div class="opencv-notice">
      OpenCV 眼部追踪已迁移到
      <a href="/config.html" target="_blank">配置网页</a>
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
