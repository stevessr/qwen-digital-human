<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

interface ModelInfo {
  name: string
  description: string
  size: string
  url: string
  installed: boolean
  progress: number | null
  expected_sha256: string
}

const router = useRouter()
const models = ref<ModelInfo[]>([])
const pollingInterval = ref<number | null>(null)

const loadModels = async () => {
  try {
    const res = await fetch('/api/models/status')
    models.value = await res.json()

    const anyDownloading = models.value.some(m => m.progress !== null)

    if (anyDownloading && !pollingInterval.value) {
      pollingInterval.value = window.setInterval(loadModels, 1000)
    } else if (!anyDownloading && pollingInterval.value) {
      clearInterval(pollingInterval.value)
      pollingInterval.value = null
    }
  } catch (error) {
    console.error('Failed to load models:', error)
  }
}

const downloadModel = async (name: string, url: string) => {
  try {
    const res = await fetch('/api/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    })
    const result = await res.json()
    if (result.status === 'success') {
      loadModels()
    } else {
      alert('下载启动失败: ' + result.message)
    }
  } catch (error) {
    alert('网络错误')
  }
}

const deleteModel = async (name: string) => {
  if (!confirm(`确定要删除模型 ${name} 吗？`)) return

  try {
    await fetch('/api/models/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    loadModels()
  } catch (error) {
    alert('网络错误')
  }
}

const verifyModel = async (name: string, expectedSha256: string) => {
  try {
    const res = await fetch('/api/models/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, expected_sha256: expectedSha256 }),
    })
    const result = await res.json()
    if (result.status === 'ok') {
      alert('校验成功：文件完整且校验和(SHA256)匹配。')
    } else {
      alert('校验失败：文件损坏、不完整或校验和不匹配。')
      loadModels()
    }
  } catch (error) {
    alert('网络错误')
  }
}

const preloadRuntimeModel = async (kind: 'asr' | 'tts') => {
  const endpoint = kind === 'tts' ? '/api/models/preload/tts' : '/api/models/preload/asr'

  try {
    const res = await fetch(endpoint, { method: 'POST' })
    const result = await res.json()
    if (res.ok && result.status === 'success') {
      alert(`${kind.toUpperCase()} 模型预热成功`)
    } else {
      alert('预热失败: ' + (result.message || '未知错误'))
    }
  } catch (error) {
    alert('网络错误')
  }
}

const openFile = (path: string) => {
  window.open(path, '_blank')
}

onMounted(() => {
  loadModels()
})

onUnmounted(() => {
  if (pollingInterval.value) {
    clearInterval(pollingInterval.value)
  }
})
</script>

<template>
  <div class="models-page">
    <header class="page-header">
      <h1>模型库管理</h1>
      <AButton type="link" @click="router.push('/')">← 返回主界面</AButton>
    </header>

    <section class="runtime-section">
      <h2>本地 Qwen 语音模型</h2>
      <p class="section-desc">
        这几个运行时资源由程序自动加载到本地；点击下面按钮可以提前预热或直接查看对应模型文件，避免第一次切换/说话时等待。
      </p>
      <div class="runtime-grid">
        <ACard title="Qwen3-ASR" :bordered="false">
          <p>本地语音识别模型，缓存目录由后端自动管理。</p>
          <AButton type="primary" block @click="preloadRuntimeModel('asr')">
            预热下载 ASR
          </AButton>
        </ACard>

        <ACard title="Qwen3-TTS" :bordered="false">
          <p>本地语音合成模型，首次使用时会自动拉取到缓存。</p>
          <AButton type="primary" block @click="preloadRuntimeModel('tts')">
            预热下载 TTS
          </AButton>
        </ACard>

        <ACard title="Live2D Shizuku" :bordered="false">
          <p>主界面头像模型，已随静态资源内置到 <code>/live2d_models/shizuku/assets/shizuku.model.json</code>。</p>
          <AButton type="primary" block @click="openFile('/live2d_models/shizuku/assets/shizuku.model.json')">
            查看模型文件
          </AButton>
        </ACard>

        <ACard title="Live2D Haru 01" :bordered="false">
          <p>主界面可切换的职业风头像模型，已内置到 <code>/live2d_models/haru01/assets/haru01.model.json</code>。</p>
          <AButton type="primary" block @click="openFile('/live2d_models/haru01/assets/haru01.model.json')">
            查看模型文件
          </AButton>
        </ACard>

        <ACard title="Live2D Haru 02" :bordered="false">
          <p>主界面可切换的活泼风头像模型，已内置到 <code>/live2d_models/haru02/assets/haru02.model.json</code>。</p>
          <AButton type="primary" block @click="openFile('/live2d_models/haru02/assets/haru02.model.json')">
            查看模型文件
          </AButton>
        </ACard>

        <ACard title="OpenCV 面部追踪" :bordered="false">
          <p>前端面部追踪依赖本地内置资源：<code>/vendor/opencv.js</code>、人脸、眼睛、嘴部与微笑级联文件。</p>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <AButton size="small" @click="openFile('/vendor/opencv.js')">opencv.js</AButton>
            <AButton size="small" @click="openFile('/vendor/haarcascade_frontalface_default.xml')">人脸级联</AButton>
            <AButton size="small" @click="openFile('/vendor/haarcascade_eye.xml')">眼睛级联</AButton>
            <AButton size="small" @click="openFile('/vendor/haarcascade_eye_tree_eyeglasses.xml')">眼镜级联</AButton>
            <AButton size="small" @click="openFile('/vendor/haarcascade_mcs_mouth.xml')">嘴部级联</AButton>
            <AButton size="small" @click="openFile('/vendor/haarcascade_smile.xml')">微笑级联</AButton>
          </div>
        </ACard>
      </div>
    </section>

    <div class="model-list">
      <ACard
        v-for="model in models"
        :key="model.name"
        class="model-card"
      >
        <div class="card-header">
          <div class="info">
            <h3>{{ model.name }}</h3>
            <p>{{ model.description }}</p>
            <div class="meta">
              文件大小: {{ model.size }} |
              状态: {{ model.installed ? '已就绪' : (model.progress !== null ? '下载中' : '缺失') }}
            </div>
          </div>
          <div class="actions">
            <ATag
              :color="model.installed ? 'success' : (model.progress !== null ? 'processing' : 'error')"
              class="status-tag"
            >
              {{ model.installed ? '● 已就绪' : (model.progress !== null ? `正在下载 ${Math.round(model.progress)}%` : '○ 缺失') }}
            </ATag>
            <ASpace>
              <AButton
                v-if="model.installed"
                @click="verifyModel(model.name, model.expected_sha256)"
              >
                校验
              </AButton>
              <AButton
                v-if="model.installed"
                danger
                @click="deleteModel(model.name)"
              >
                删除
              </AButton>
              <AButton
                type="primary"
                :disabled="model.installed || model.progress !== null"
                :loading="model.progress !== null"
                @click="downloadModel(model.name, model.url)"
              >
                {{ model.installed ? '无需下载' : (model.progress !== null ? '下载中...' : '一键下载') }}
              </AButton>
            </ASpace>
          </div>
        </div>
        <AProgress
          v-if="model.progress !== null"
          :percent="Math.round(model.progress)"
          status="active"
          style="margin-top: 16px"
        />
      </ACard>
    </div>
  </div>
</template>

<style scoped>
.models-page {
  min-height: 100vh;
  background: #121212;
  color: #eee;
  padding: 40px;
}

.page-header {
  max-width: 900px;
  margin: 0 auto 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-header h1 {
  margin: 0;
  color: #fff;
}

.runtime-section {
  max-width: 900px;
  margin: 0 auto 40px;
  padding: 20px;
  background: #1a1f2a;
  border: 1px solid #2d3443;
  border-radius: 12px;
}

.runtime-section h2 {
  margin: 0 0 10px 0;
  font-size: 1.1em;
  color: #fff;
}

.section-desc {
  margin: 0 0 16px 0;
  color: #a9b4c7;
  line-height: 1.5;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.runtime-grid :deep(.ant-card) {
  background: #141922;
  border-color: #2b3342;
}

.runtime-grid :deep(.ant-card-head-title) {
  color: #fff;
}

.runtime-grid :deep(.ant-card-body p) {
  margin-bottom: 12px;
  color: #a9b4c7;
  font-size: 0.92em;
  line-height: 1.5;
}

.model-list {
  max-width: 900px;
  margin: 0 auto;
}

.model-card {
  margin-bottom: 20px;
}

.model-card :deep(.ant-card-body) {
  background: #1e1e1e;
  border-color: #333;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}

.info {
  flex: 1;
}

.info h3 {
  margin: 0 0 8px 0;
  color: #fff;
  font-size: 1.1em;
}

.info p {
  margin: 0 0 8px 0;
  color: #aaa;
  font-size: 0.9em;
}

.meta {
  font-size: 0.8em;
  color: #666;
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.status-tag {
  font-weight: bold;
}

code {
  background: #0f131a;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  color: #67a7ff;
}
</style>
