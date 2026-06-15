<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { RUNTIME_RESOURCES } from '@/constants/config'
import { useModelManagement, type ManagedModelInfo } from '@/composables/useModelManagement'

const {
  models,
  isLoading,
  isSelecting,
  loadError,
  selectError,
  selectedModel,
  ollamaOptions,
  loadModels,
  selectModel,
} = useModelManagement()

const modelSelectValue = shallowRef('')

watch(
  selectedModel,
  (model) => {
    modelSelectValue.value = model?.name || ''
  },
  { immediate: true },
)

const selectOptions = computed(() => (
  ollamaOptions.value.map(option => ({
    value: option.name,
    label: [
      option.name,
      option.cloud_hosted ? 'Ollama Cloud' : '本地',
      option.installed ? '已可用' : '需 pull',
      option.size && option.size !== '由 Ollama 管理' ? option.size : '',
      option.parameter_size || '',
      option.quantization_level || '',
    ].filter(Boolean).join(' · '),
  }))
))

const hasOllamaBackend = computed(() => (
  models.value.some(model => model.managed_by === 'ollama')
))

const ollamaServiceUnavailable = computed(() => (
  hasOllamaBackend.value && selectedModel.value?.service_available === false
))

const canApplySelection = computed(() => (
  Boolean(modelSelectValue.value)
  && !isLoading.value
  && !isSelecting.value
  && modelSelectValue.value !== selectedModel.value?.name
))

const openFile = (path: string) => {
  window.open(path, '_blank', 'noopener,noreferrer')
}

const serviceStatusColor = (model: ManagedModelInfo): string => {
  if (model.installed) return 'success'
  if (model.cloud_hosted && model.service_available) return 'warning'
  return 'error'
}

const serviceStatusText = (model: ManagedModelInfo): string => {
  if (model.installed) return '● 服务可用'
  if (model.cloud_hosted && model.service_available) return '○ Cloud 待 pull'
  return '○ 服务不可用'
}

const providerLabel = (model: ManagedModelInfo): string => {
  if (model.cloud_hosted) return 'Ollama Cloud'
  if (model.provider) return model.provider
  if (model.managed_by === 'ollama') return '本地 Ollama'
  if (model.managed_by === 'browser') return '浏览器'
  return '外部推理服务'
}

const handleSelectModel = async () => {
  await selectModel(modelSelectValue.value)
}

const selectFromCard = async (name: string) => {
  modelSelectValue.value = name
  await handleSelectModel()
}
</script>

<template>
  <div class="models-page">
    <header class="page-header">
      <div>
        <h1>推理服务与浏览器能力</h1>
        <p>
          ASR 与 TTS 由浏览器提供；LLM 优先使用 Ollama Cloud 托管模型，并通过本地 Ollama 后端调用。
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

    <AAlert
      v-if="loadError"
      class="page-alert"
      type="error"
      show-icon
      message="无法读取后端模型状态"
      :description="loadError"
    />
    <AAlert
      v-if="selectError"
      class="page-alert"
      type="error"
      show-icon
      message="模型切换失败"
      :description="selectError"
    />

    <section class="runtime-section">
      <h2>浏览器能力与前端资源</h2>
      <p class="section-desc">
        语音识别和语音合成都由浏览器 Web Speech APIs 提供；数字人形象通过已有在线 GLB 3D 模型渲染，OpenCV 仍使用前端内置静态资源。
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
        <h2>Ollama LLM 推理服务</h2>
        <ATag color="blue">优先 Ollama Cloud</ATag>
      </div>
      <p class="section-desc service-desc">
        这里展示后端当前连接的 Ollama 服务状态。Cloud 模型会排在本地模型前面；模型 pull、加载与推理由 Ollama 进程负责。
      </p>

      <div class="selector-card">
        <div class="selector-copy">
          <h3>聊天后端模型选择</h3>
          <p>
            当前模型：
            <strong>{{ selectedModel?.name || '未配置' }}</strong>
            <ATag v-if="selectedModel?.selected" color="green">当前生效</ATag>
          </p>
          <p class="selector-hint">
            这里直接读取本地 Ollama 的 <code>/api/tags</code>，并额外提供 Cloud 托管候选模型；切换后新的聊天和地图讲解请求会立即使用所选模型。
          </p>
        </div>
        <ASpace class="selector-controls" wrap>
          <ASelect
            v-model:value="modelSelectValue"
            class="model-select"
            :options="selectOptions"
            :disabled="ollamaOptions.length === 0 || isLoading || isSelecting"
            placeholder="选择 Ollama Cloud 或本地模型"
          />
          <AButton
            type="primary"
            :loading="isSelecting"
            :disabled="!canApplySelection"
            @click="handleSelectModel"
          >
            切换为聊天模型
          </AButton>
        </ASpace>
        <AAlert
          v-if="ollamaServiceUnavailable"
          class="selector-alert"
          type="warning"
          show-icon
          message="本地 Ollama 后端未连接"
          description="请先在本机启动 ollama serve，并确认后端可以访问 OLLAMA_BASE_URL（默认 http://127.0.0.1:11434）。"
        />
        <AAlert
          v-else-if="hasOllamaBackend && ollamaOptions.length === 0"
          class="selector-alert"
          type="warning"
          show-icon
          message="没有可选择的 Ollama 模型"
          :description="`请先执行 ollama pull ${selectedModel?.name || 'gpt-oss:120b-cloud'}，然后点击刷新状态。`"
        />
      </div>

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
              服务地址：{{ model.url || '未配置' }} |
              大小：{{ model.size || '未知' }}
            </div>
          </div>

          <div class="model-actions">
            <ATag v-if="model.selected" color="green" class="status-tag">
              当前聊天模型
            </ATag>
            <ATag v-if="model.cloud_hosted" color="cyan" class="status-tag">
              Ollama Cloud
            </ATag>
            <ATag :color="serviceStatusColor(model)" class="status-tag">
              {{ serviceStatusText(model) }}
            </ATag>
            <AButton
              v-if="model.managed_by === 'ollama' && (model.installed || model.cloud_hosted) && !model.selected"
              size="small"
              :loading="isSelecting && modelSelectValue === model.name"
              @click="selectFromCard(model.name)"
            >
              设为聊天模型
            </AButton>
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

.page-alert {
  max-width: 980px;
  margin: 0 auto 18px;
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

.selector-card {
  margin-bottom: 20px;
  padding: 18px;
  border: 1px solid #30415f;
  border-radius: 12px;
  background: linear-gradient(135deg, #162033 0%, #151922 100%);
}

.selector-copy h3 {
  margin: 0 0 8px;
  color: #fff;
}

.selector-copy p {
  margin: 0 0 8px;
  color: #cbd7ea;
  line-height: 1.5;
}

.selector-copy strong {
  color: #fff;
}

.selector-copy code {
  color: #9ed0ff;
}

.selector-hint {
  color: #8f9db3 !important;
  font-size: 0.9em;
}

.selector-controls {
  margin-top: 12px;
}

.model-select {
  min-width: min(420px, 72vw);
}

.selector-alert {
  margin-top: 14px;
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
