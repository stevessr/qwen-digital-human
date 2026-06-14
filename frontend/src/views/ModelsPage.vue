<script setup lang="ts">
import { Modal, message } from 'ant-design-vue'
import { RUNTIME_RESOURCES, type RuntimeResourceAction } from '@/constants/config'
import { useModelManagement, type ManagedModelInfo } from '@/composables/useModelManagement'

const {
  models,
  isLoading,
  hasDownloadingModel,
  loadModels,
  downloadModel,
  deleteModel,
  verifyModel,
  preloadRuntimeModel,
  isRuntimePreloading,
} = useModelManagement()

const openFile = (path: string) => {
  window.open(path, '_blank', 'noopener,noreferrer')
}

const isRuntimeActionLoading = (action: RuntimeResourceAction): boolean => (
  action.preloadKind ? isRuntimePreloading(action.preloadKind) : false
)

const handleRuntimeAction = async (action: RuntimeResourceAction) => {
  if (action.path) {
    openFile(action.path)
    return
  }

  if (!action.preloadKind) return

  try {
    await preloadRuntimeModel(action.preloadKind)
    message.success(`${action.label} 已完成`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '预热失败')
  }
}

const handleDownloadModel = async (model: ManagedModelInfo) => {
  try {
    await downloadModel(model.name, model.url)
    message.success(`已开始下载 ${model.name}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '下载启动失败')
  }
}

const confirmDeleteModel = (model: ManagedModelInfo) => {
  Modal.confirm({
    title: `确定要删除模型 ${model.name} 吗？`,
    content: '删除后如需使用，需要重新下载。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteModel(model.name)
        message.success(`已删除 ${model.name}`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败')
      }
    },
  })
}

const handleVerifyModel = async (model: ManagedModelInfo) => {
  try {
    const ok = await verifyModel(model.name, model.expected_sha256)
    if (ok) {
      message.success('校验成功：文件完整且校验和（SHA256）匹配。')
    } else {
      message.error('校验失败：文件损坏、不完整或校验和不匹配。')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '校验失败')
  }
}
</script>

<template>
  <div class="models-page">
    <header class="page-header">
      <div>
        <h1>模型库管理</h1>
        <p>统一管理本地推理、语音、Live2D 与 OpenCV 运行时资源。</p>
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
      <h2>本地运行时资源</h2>
      <p class="section-desc">
        这些资源由共享配置动态渲染；修改资源路径或新增资源时，只需要维护 constants，不再修改静态 HTML。
      </p>
      <div class="runtime-grid">
        <ACard
          v-for="resource in RUNTIME_RESOURCES"
          :key="resource.key"
          :title="resource.title"
          :bordered="false"
        >
          <p>{{ resource.description }}</p>
          <ASpace wrap>
            <AButton
              v-for="action in resource.actions"
              :key="`${resource.key}-${action.label}`"
              :type="action.preloadKind ? 'primary' : 'default'"
              :loading="isRuntimeActionLoading(action)"
              @click="handleRuntimeAction(action)"
            >
              {{ action.label }}
            </AButton>
          </ASpace>
        </ACard>
      </div>
    </section>

    <section class="model-section">
      <div class="section-title-row">
        <h2>模型文件</h2>
        <ATag v-if="hasDownloadingModel" color="processing">正在下载，自动刷新中</ATag>
      </div>

      <AEmpty v-if="!isLoading && models.length === 0" description="暂无模型状态" />

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
              文件大小：{{ model.size }} |
              状态：{{ model.installed ? '已就绪' : (model.progress !== null ? '下载中' : '缺失') }}
            </div>
          </div>

          <div class="model-actions">
            <ATag
              :color="model.installed ? 'success' : (model.progress !== null ? 'processing' : 'error')"
              class="status-tag"
            >
              {{ model.installed ? '● 已就绪' : (model.progress !== null ? `正在下载 ${Math.round(model.progress)}%` : '○ 缺失') }}
            </ATag>
            <ASpace wrap>
              <AButton
                v-if="model.installed"
                @click="handleVerifyModel(model)"
              >
                校验
              </AButton>
              <AButton
                v-if="model.installed"
                danger
                @click="confirmDeleteModel(model)"
              >
                删除
              </AButton>
              <AButton
                type="primary"
                :disabled="model.installed || model.progress !== null"
                :loading="model.progress !== null"
                @click="handleDownloadModel(model)"
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

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
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
