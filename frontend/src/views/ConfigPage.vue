<script setup lang="ts">
import { useConfigPage } from '@/composables/useConfigPage'

const {
  settings,
  faceState,
  mapSearchQuery,
  mapResults,
  mapStatus,
  mapFrameUrl,
  selectedMapSummary,
  isMapSearching,
  opencvStatus,
  mapPlaceKey,
  isSelectedMapPlace,
  selectMapPlace,
  writeMapContext,
  clearMapContext,
  clearContextDraft,
  searchMapPlaces,
  refreshContextFromRag,
  handleOpenCvEnabledChange,
  handleOpenCvAutoStartChange,
  handleOpenCvTuningChange,
  startCamera,
  stopCamera,
  calibrateOpenCv,
  resetOpenCvCalibration,
} = useConfigPage()
</script>

<template>
  <div class="config-page">
    <header class="page-header">
      <div>
        <h1>地图数字人配置网页</h1>
        <p>
          这里编辑 Prompt / Memory / Context / RAG / Map / OpenCV 配置。设置会保存在浏览器本地，并被主页面直接读取。
        </p>
      </div>
      <ASpace wrap>
        <RouterLink to="/">
          <AButton>返回主界面</AButton>
        </RouterLink>
        <RouterLink to="/models">
          <AButton type="primary">模型管理</AButton>
        </RouterLink>
      </ASpace>
    </header>

    <main class="config-grid">
      <ACard class="panel-card" title="Prompt / Memory / Context / RAG" :bordered="false">
        <AForm layout="vertical">
          <AFormItem label="系统提示词">
            <ATextarea
              v-model:value="settings.system_prompt"
              :rows="4"
              placeholder="输入系统提示词"
            />
          </AFormItem>

          <AFormItem label="记忆">
            <ATextarea
              v-model:value="settings.memory"
              :rows="4"
              placeholder="输入长期记忆"
            />
          </AFormItem>

          <AFormItem label="上下文">
            <ATextarea
              v-model:value="settings.context"
              :rows="6"
              placeholder="输入或刷新 RAG / 地图上下文"
            />
          </AFormItem>

          <div class="toggle-grid">
            <ACheckbox v-model:checked="settings.use_rag_context">空上下文时自动用 RAG</ACheckbox>
            <ACheckbox v-model:checked="settings.tts_enabled">TTS 对话模式</ACheckbox>
            <ACheckbox v-model:checked="settings.browser_asr_mode">浏览器 ASR</ACheckbox>
            <ACheckbox v-model:checked="settings.browser_tts_enabled">浏览器 TTS</ACheckbox>
            <ACheckbox v-model:checked="settings.collapse_think">折叠思考</ACheckbox>
          </div>

          <div class="rerank-grid">
            <AFormItem label="候选数">
              <AInputNumber
                v-model:value="settings.rerank.candidate_pool"
                :min="1"
                :max="64"
                :step="1"
                style="width: 100%"
              />
            </AFormItem>
            <AFormItem label="阈值">
              <AInputNumber
                v-model:value="settings.rerank.similarity_threshold"
                :min="0"
                :max="1"
                :step="0.01"
                style="width: 100%"
              />
            </AFormItem>
            <AFormItem label="TopK">
              <AInputNumber
                v-model:value="settings.rerank.top_k"
                :min="0"
                :max="32"
                :step="1"
                style="width: 100%"
              />
            </AFormItem>
          </div>

          <AFormItem label="Reranker 提示词">
            <ATextarea
              v-model:value="settings.rerank.instruction"
              :rows="3"
              placeholder="输入 reranker instruction"
            />
          </AFormItem>

          <ASpace wrap class="actions-row">
            <AButton type="primary" @click="refreshContextFromRag">刷新上下文</AButton>
            <AButton danger @click="clearContextDraft">清空上下文</AButton>
          </ASpace>

          <p class="legend">
            TopK 设为 0 会让 RAG 返回空上下文。浏览器 ASR 依赖 SpeechRecognition / webkitSpeechRecognition，开启后会优先使用浏览器实时转写；若浏览器不支持，会继续回退到本地 Qwen ASR。浏览器 TTS 开启后，主页面会直接使用 SpeechSynthesis 发声。
          </p>
        </AForm>
      </ACard>

      <ACard class="panel-card" title="地图讲解面板" :bordered="false">
        <div class="map-top">
          <p class="map-status">{{ mapStatus }}</p>
          <ASpace wrap>
            <AButton type="primary" @click="writeMapContext">写入上下文</AButton>
            <AButton danger @click="clearMapContext">清空地图</AButton>
          </ASpace>
        </div>

        <div class="map-search">
          <AInput
            v-model:value="mapSearchQuery"
            placeholder="搜索地点，例如：北京故宫 / 上海外滩 / 深圳湾公园"
            @press-enter="searchMapPlaces"
          />
          <AButton type="primary" :loading="isMapSearching" @click="searchMapPlaces">
            搜索地点
          </AButton>
        </div>

        <div class="map-results">
          <button
            v-for="(place, index) in mapResults"
            :key="mapPlaceKey(place, index)"
            type="button"
            class="map-result"
            :class="{ selected: isSelectedMapPlace(place) }"
            @click="selectMapPlace(place)"
          >
            <strong>{{ place.display_name }}</strong>
            <small>{{ place.summary || `坐标：${Number(place.lat).toFixed(4)}, ${Number(place.lon).toFixed(4)}` }}</small>
          </button>
        </div>

        <iframe
          class="map-frame"
          :src="mapFrameUrl"
          title="地图视图"
          loading="lazy"
        />
        <p class="legend map-summary">{{ selectedMapSummary }}</p>
      </ACard>
    </main>

    <ACard class="panel-card opencv-card" title="OpenCV 眼部追踪" :bordered="false">
      <p class="note">
        这里控制 OpenCV 模式。开启后，主界面会使用摄像头追踪人眼，并把眼部中心、眨眼、张嘴与微笑信号同步给数字人。
      </p>

      <div class="toggle-grid opencv-toggles">
        <ACheckbox
          v-model:checked="faceState.enabled"
          @change="handleOpenCvEnabledChange"
        >
          启用 OpenCV 模式
        </ACheckbox>
        <ACheckbox
          v-model:checked="faceState.autoStart"
          @change="handleOpenCvAutoStartChange"
        >
          开启后自动启动摄像头
        </ACheckbox>
        <ACheckbox
          v-model:checked="faceState.mirror"
          @change="handleOpenCvTuningChange"
        >
          镜像预览 / 方向同步
        </ACheckbox>
      </div>

      <div class="opencv-grid">
        <AFormItem label="平滑">
          <AInputNumber
            v-model:value="faceState.smooth"
            :min="0.05"
            :max="0.98"
            :step="0.01"
            style="width: 100%"
            @change="handleOpenCvTuningChange"
          />
        </AFormItem>
        <AFormItem label="偏航增益">
          <AInputNumber
            v-model:value="faceState.yawGain"
            :min="0.1"
            :max="4"
            :step="0.1"
            style="width: 100%"
            @change="handleOpenCvTuningChange"
          />
        </AFormItem>
        <AFormItem label="俯仰增益">
          <AInputNumber
            v-model:value="faceState.pitchGain"
            :min="0.1"
            :max="4"
            :step="0.1"
            style="width: 100%"
            @change="handleOpenCvTuningChange"
          />
        </AFormItem>
        <AFormItem label="跟随混合">
          <AInputNumber
            v-model:value="faceState.blend"
            :min="0"
            :max="1"
            :step="0.01"
            style="width: 100%"
            @change="handleOpenCvTuningChange"
          />
        </AFormItem>
      </div>

      <ASpace wrap class="actions-row">
        <AButton type="primary" @click="startCamera">启动摄像头</AButton>
        <AButton @click="stopCamera">停止摄像头</AButton>
        <AButton @click="calibrateOpenCv">校准</AButton>
        <AButton danger @click="resetOpenCvCalibration">重置校准</AButton>
      </ASpace>

      <p class="legend opencv-status">{{ opencvStatus }}</p>
    </ACard>
  </div>
</template>

<style scoped>
.config-page {
  min-height: 100vh;
  overflow: auto;
  background: #0f1115;
  color: #fff;
  padding: 24px;
}

.page-header {
  max-width: 1280px;
  margin: 0 auto 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.page-header h1 {
  margin: 0 0 8px;
  color: #fff;
  font-size: 1.4rem;
}

.page-header p,
.note,
.legend,
.map-status {
  color: #9aa4b2;
  line-height: 1.5;
}

.config-grid {
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
  gap: 20px;
}

.panel-card {
  background: #151a22;
  border: 1px solid #2a3240;
  border-radius: 14px;
}

.panel-card :deep(.ant-card-head) {
  border-color: #2a3240;
}

.panel-card :deep(.ant-card-head-title),
.panel-card :deep(.ant-form-item-label > label) {
  color: #e8f1ff;
}

.panel-card :deep(.ant-card-body) {
  color: #eef5ff;
}

.toggle-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  margin: 12px 0 20px;
}

.toggle-grid :deep(.ant-checkbox-wrapper) {
  color: #d3dae6;
}

.rerank-grid,
.opencv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.opencv-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 16px;
}

.actions-row {
  margin-top: 8px;
}

.legend {
  margin: 14px 0 0;
  white-space: pre-wrap;
  font-size: 0.9rem;
}

.map-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.map-status {
  margin: 0;
  white-space: pre-wrap;
}

.map-search {
  display: flex;
  gap: 8px;
  margin: 14px 0;
}

.map-search :deep(.ant-input-affix-wrapper),
.map-search :deep(.ant-input) {
  flex: 1;
}

.map-results {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 12px;
}

.map-result {
  min-width: 220px;
  max-width: 260px;
  border-radius: 10px;
  padding: 10px 12px;
  background: #0f131a;
  border: 1px solid #313a49;
  color: #fff;
  cursor: pointer;
  text-align: left;
}

.map-result.selected {
  border-color: #2a7bff;
  background: #13233f;
}

.map-result small {
  display: block;
  color: #a7b2c3;
  margin-top: 6px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.map-frame {
  width: 100%;
  height: 360px;
  border: 0;
  border-radius: 12px;
  background: #0b0f14;
}

.map-summary,
.opencv-status {
  color: #9ab3d4;
}

.opencv-card {
  max-width: 1280px;
  margin: 20px auto 0;
}

.opencv-toggles {
  margin-top: 14px;
}

@media (max-width: 1040px) {
  .page-header,
  .config-grid {
    grid-template-columns: 1fr;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .opencv-grid,
  .rerank-grid {
    grid-template-columns: 1fr;
  }

  .map-frame {
    height: 300px;
  }
}
</style>
