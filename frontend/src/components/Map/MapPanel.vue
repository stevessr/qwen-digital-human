<script setup lang="ts">
</script>

<template>
  <div class="map-panel">
    <div class="map-topbar">
      <div>
        <div class="map-title">地图讲解面板</div>
        <div class="map-status">默认定位：北京天安门广场。可搜索地点并写入上下文。</div>
      </div>
      <div class="map-actions">
        <a-button>写入上下文</a-button>
        <a-button>清空地图</a-button>
      </div>
    </div>

    <div class="map-search">
      <a-input placeholder="搜索地点，例如：北京故宫 / 上海外滩 / 深圳湾公园" />
      <a-button type="primary">搜索地点</a-button>
    </div>

    <div class="map-results">
      <!-- Search results will go here -->
    </div>

    <iframe
      class="map-frame"
      title="地图视图"
      loading="lazy"
    ></iframe>

    <div class="map-legend">
      地图会显示当前选中的地点。点击"写入上下文"后，地图信息会进入讲解上下文，数字人将围绕该地点回答。
    </div>
  </div>
</template>

<style scoped>
.map-panel {
  display: flex;
  flex-direction: column;
  background: #0f1115;
  border-top: 1px solid #222;
}

.map-topbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 14px;
  border-bottom: 1px solid #262626;
  background: linear-gradient(180deg, #171b24, #11151c);
}

.map-title {
  font-weight: 700;
  line-height: 1.3;
}

.map-status {
  margin-top: 4px;
  color: #aab4c6;
  font-size: 0.82em;
  line-height: 1.4;
}

.map-actions {
  display: flex;
  gap: 8px;
}

.map-search {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #262626;
  background: #12151c;
}

.map-results {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 14px;
  border-bottom: 1px solid #262626;
  background: #101419;
  min-height: 60px;
}

.map-frame {
  flex: 1;
  width: 100%;
  border: 0;
  background: #111;
}

.map-legend {
  padding: 10px 14px;
  border-top: 1px solid #262626;
  background: #101419;
  color: #b8c0d0;
  font-size: 0.82em;
  line-height: 1.45;
}
</style>
