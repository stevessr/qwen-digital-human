<script setup lang="ts">
import { RUNTIME_RESOURCES } from '@/constants/config'
import { useModelManagement, type ManagedModelInfo } from '@/composables/useModelManagement'

const { models, isLoading, loadModels } = useModelManagement()

const openFile = (path: string) => {
  window.open(path, '_blank', 'noopener,noreferrer')
}

const serviceStatusColor = (model: ManagedModelInfo): string => (model.installed ? 'success' : 'error')

const serviceStatusText = (model: ManagedModelInfo): string => (
  model.installed ? '● 服务可用' : '○ 服务不可用'
)

const providerLabel = (model: ManagedModelInfo): string => {
  if (model.managed_by === 'ollama') return '本地 Ollama'
  if (model.managed_by === 'browser') return '浏览器'
  if (model.provider) return model.provider
  return '外部推理服务'
}
</script>

<template>
  <div class="models-page">
    <header class="page-header">
      <div>
        <h1>推理服务与浏览器能力</h1>
        <p>
          ASR 与 TTS 由浏览器提供；后端不再加载本地推理模型，只通过本地 Ollama 调用 LLM 推理服务。
        </p>
      </div>
      <ASpace wrap>
        <AButton :loading="isLoading" @click="loadModels">刷新状态</AButton>
        <RouterLink to="/config">
          <AButton>配置网页</AButton>
        </RouterLink>
        <RouterLink to="/">
          <AButton type="primary">返回主界面</AButton>
        </RouterLink>
      </ASpace>
    </header>

    <section class="runtime-section">
      <h2>浏览器能力与前端资源</h2>
      <p class="section-desc">
        语音识别和语音合成都由浏览器 Web Speech APIs 提供；Live2D 与 OpenCV 仍使用前端内置静态资源。
      </p>
      <div class="runtime-grid">
        <ACard
          v-for="resource in RUNTIME_RESOURCES"
          :key="resource.key"
          :title="resource.title"
          :bordered="false"
        >
          <p>{{ resource.description }}</p>
          <ATag v-if="resource.badge" color="success" class="runtime-badge">
            {{ resource.badge }}
          </ATag>
          <ASpace v-if="resource.actions.length > 0" wrap>
            <AButton
              v-for="action in resource.actions"
              :key="`${resource.key}-${action.label}`"
              @click="action.path && openFile(action.path)"
            >
              {{ action.label }}
            </AButton>
          </ASpace>
        </ACard>
      </div>
    </section>

    <section class="model-section">
      <div class="section-title-row">
        <h2>本地 Ollama LLM 推理服务</h2>
        <ATag color="blue">后端仅调用服务，不托管模型</ATag>
      </div>
      <p class="section-desc service-desc">
        这里展示后端当前连接的本地 Ollama 服务状态。模型下载、加载与推理由 Ollama 进程负责，不再由后端管理 GGUF/MNN 文件。
      </p>

      <AEmpty v-if="!isLoading && models.length === 0" description="暂无推理服务状态" />

      <ACard
        v-for="model in models"
        :key="model.name"
        class="model-card"
        :bordered="false"
      >
        <div class="model-card-header">
          <div class="model-info">
            <h3>{{ model.name }}</h3>
            <p>{{ model.description }}</p>
            <div class="meta">
              提供方：{{ providerLabel(model) }} |
              能力：{{ model.capability || 'LLM 推理' }} |
              服务地址：{{ model.url || '未配置' }}
            </div>
          </div>

          <div class="model-actions">
            <ATag :color="serviceStatusColor(model)" class="status-tag">
              {{ serviceStatusText(model) }}
            </ATag>
          </div>
        </div>
      </ACard>
    </section>
  </div>
</template>

<style scoped>
.models-page {
  min-height: 100vh;
  overflow: auto;
  background: #121212;
  color: #eee;
  padding: 40px;
}

.page-header,
.runtime-section,
.model-section {
  max-width: 980px;
  margin-left: auto;
  margin-right: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 30px;
}

.page-header h1 {
  margin: 0 0 8px;
  color: #fff;
}

.page-header p,
.section-desc {
  margin: 0;
  color: #a9b4c7;
  line-height: 1.5;
}

.runtime-section {
  margin-bottom: 32px;
  padding: 20px;
  background: #1a1f2a;
  border: 1px solid #2d3443;
  border-radius: 12px;
}

.runtime-section h2,
.model-section h2 {
  margin: 0 0 10px;
  color: #fff;
  font-size: 1.1em;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.runtime-grid :deep(.ant-card),
.model-card :deep(.ant-card-body) {
  background: #141922;
  border-color: #2b3342;
}

.runtime-grid :deep(.ant-card-head) {
  border-color: #2b3342;
}

.runtime-grid :deep(.ant-card-head-title),
.runtime-grid :deep(.ant-card-body),
.model-card :deep(.ant-card-body) {
  color: #eef5ff;
}

.runtime-grid :deep(.ant-card-body p) {
  margin-bottom: 12px;
  color: #a9b4c7;
  font-size: 0.92em;
  line-height: 1.5;
}

.runtime-badge {
  margin-bottom: 12px;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.service-desc {
  margin-bottom: 16px;
}

.model-card {
  margin-bottom: 20px;
}

.model-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}

.model-info {
  flex: 1;
}

.model-info h3 {
  margin: 0 0 8px;
  color: #fff;
  font-size: 1.1em;
}

.model-info p {
  margin: 0 0 8px;
  color: #aaa;
  font-size: 0.9em;
  line-height: 1.5;
}

.meta {
  font-size: 0.8em;
  color: #7f8794;
}

.model-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.status-tag {
  font-weight: bold;
}

@media (max-width: 760px) {
  .models-page {
    padding: 24px;
  }

  .page-header,
  .model-card-header {
    flex-direction: column;
  }

  .model-actions {
    align-items: flex-start;
  }
}
</style>
