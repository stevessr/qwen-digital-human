<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { message as AMessage } from 'ant-design-vue'
import L, { type LatLngExpression, type LeafletMouseEvent, type Map as LeafletMap, type Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { useChatStore } from '@/stores/chat'
import {
  buildMapContext,
  stripMapContext,
  useMapStore,
} from '@/stores/map'

const chatStore = useChatStore()
const mapStore = useMapStore()
const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer')
const isManualPinMode = shallowRef(false)

let map: LeafletMap | null = null
let marker: Marker | null = null
let resizeObserver: ResizeObserver | null = null

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const selectedPlace = computed(() => mapStore.currentLocation)
const coordinateText = computed(() => (
  `${Number(selectedPlace.value.lat).toFixed(6)}, ${Number(selectedPlace.value.lon).toFixed(6)}`
))

const writeMapContext = () => {
  const cleaned = stripMapContext(chatStore.settings.context)
  const block = buildMapContext(selectedPlace.value)
  chatStore.settings.context = cleaned ? `${block}\n\n${cleaned}` : block
  chatStore.saveSettings()
  mapStore.status = `已写入上下文：${selectedPlace.value.display_name}`
  AMessage.success('地图上下文已写入，后续回复会围绕当前地点。')
}

const clearMap = () => {
  chatStore.settings.context = stripMapContext(chatStore.settings.context)
  chatStore.saveSettings()
  mapStore.clearMap()
  AMessage.success('地图已清空，地图上下文已移除。')
}

const clearAllContext = () => {
  chatStore.settings.context = ''
  chatStore.saveSettings()
  AMessage.success('上下文已清空。')
}

const toggleManualPinMode = () => {
  isManualPinMode.value = !isManualPinMode.value
  mapStore.status = isManualPinMode.value
    ? '手动标点已开启：请在地图上点击一个位置。'
    : '手动标点已关闭。'
}

const ensureMap = () => {
  if (map || !mapContainer.value) return

  map = L.map(mapContainer.value, {
    zoomControl: true,
    attributionControl: true,
  })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)

  map.on('click', (event: LeafletMouseEvent) => {
    if (!isManualPinMode.value) return

    mapStore.setManualLocation(event.latlng.lat, event.latlng.lng)
    isManualPinMode.value = false
  })
}

const updateMapView = () => {
  if (!map) return

  const place = selectedPlace.value
  const lat = Number(place.lat)
  const lon = Number(place.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

  const latLng: LatLngExpression = [lat, lon]
  if (!marker) {
    marker = L.marker(latLng, { alt: place.display_name }).addTo(map)
  } else {
    marker.setLatLng(latLng)
  }

  const popup = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = place.display_name
  const coordinate = document.createElement('div')
  coordinate.textContent = `坐标：${lat.toFixed(6)}, ${lon.toFixed(6)}`
  popup.append(title, coordinate)

  marker
    .bindPopup(popup)
    .openPopup()

  const bounds = place.bounds
  if (bounds) {
    map.fitBounds(
      [
        [Number(bounds.south), Number(bounds.west)],
        [Number(bounds.north), Number(bounds.east)],
      ],
      { padding: [28, 28], maxZoom: 16 },
    )
  } else {
    map.setView(latLng, 14)
  }

  void nextTick(() => map?.invalidateSize({ pan: false }))
}

onMounted(() => {
  ensureMap()
  updateMapView()
  window.setTimeout(() => map?.invalidateSize({ pan: false }), 120)

  if (mapContainer.value && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => map?.invalidateSize({ pan: false }))
    resizeObserver.observe(mapContainer.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  marker = null
  map?.remove()
  map = null
})

watch(selectedPlace, updateMapView)
</script>

<template>
  <div class="map-panel">
    <div class="map-topbar">
      <div>
        <div class="map-title">地图讲解面板</div>
        <div class="map-status">{{ mapStore.status }}</div>
      </div>
      <div class="map-actions">
        <AButton :type="isManualPinMode ? 'primary' : 'default'" @click="toggleManualPinMode">
          {{ isManualPinMode ? '点击地图标点中' : '手动标点' }}
        </AButton>
        <AButton type="primary" @click="writeMapContext">写入上下文</AButton>
        <AButton danger @click="clearMap">清空地图</AButton>
        <AButton danger ghost @click="clearAllContext">清空上下文</AButton>
      </div>
    </div>

    <div class="map-search">
      <AInput
        v-model:value="mapStore.searchQuery"
        placeholder="搜索地点，例如：北京故宫 / 上海外滩 / 深圳湾公园"
        @press-enter="mapStore.searchPlaces"
      />
      <AButton type="primary" :loading="mapStore.isSearching" @click="mapStore.searchPlaces">
        搜索地点
      </AButton>
    </div>

    <div class="map-results">
      <button
        v-for="(place, index) in mapStore.searchResults"
        :key="mapStore.mapPlaceKey(place, index)"
        type="button"
        class="map-result"
        :class="{ selected: mapStore.isSelectedMapPlace(place) }"
        @click="mapStore.setCurrentLocation(place)"
      >
        <strong>{{ place.display_name }}</strong>
        <small>{{ place.summary || `坐标：${Number(place.lat).toFixed(4)}, ${Number(place.lon).toFixed(4)}` }}</small>
      </button>
    </div>

    <div class="map-shell">
      <div
        ref="mapContainer"
        class="map-frame"
        :aria-label="`地图预览：${selectedPlace.display_name}，坐标 ${coordinateText}`"
      />
      <div class="map-card">
        <strong>{{ selectedPlace.display_name }}</strong>
        <span>坐标：{{ coordinateText }}</span>
        <span>类型：{{ selectedPlace.kind || 'unknown' }} · 分类：{{ selectedPlace.category || 'unknown' }}</span>
        <span v-if="isManualPinMode">请直接点击地图选择标点</span>
        <a :href="mapStore.mapFrameUrl" target="_blank" rel="noreferrer">打开外部地图</a>
      </div>
    </div>

    <div class="map-legend">
      {{ mapStore.selectedSummary }}
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
  min-height: 72px;
}

.map-result {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid #2a3342;
  border-radius: 10px;
  background: #151b24;
  color: #dce9ff;
  text-align: left;
  cursor: pointer;
}

.map-result:hover,
.map-result.selected {
  border-color: #2d8cff;
  background: #10223a;
  box-shadow: 0 0 0 1px rgba(45, 140, 255, 0.18) inset;
}

.map-result strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-result small {
  display: -webkit-box;
  overflow: hidden;
  color: #93a7c0;
  font-size: 0.78rem;
  line-height: 1.35;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.map-frame {
  width: 100%;
  height: 100%;
  min-height: 300px;
  background: #111;
}

.map-shell {
  position: relative;
  flex: 1;
  min-height: 300px;
  overflow: hidden;
}

.map-card {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(460px, calc(100% - 36px));
  padding: 12px 14px;
  border: 1px solid rgba(114, 190, 255, 0.24);
  border-radius: 14px;
  background: rgba(6, 13, 22, 0.82);
  color: #dcecff;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(10px);
}

.map-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-card span,
.map-card a {
  color: #9eb6cf;
  font-size: 0.82rem;
}

.map-card a {
  color: #65b7ff;
  text-decoration: none;
}

.map-legend {
  padding: 10px 14px;
  border-top: 1px solid #262626;
  background: #101419;
  color: #b8c0d0;
  font-size: 0.82em;
  line-height: 1.45;
  white-space: pre-wrap;
}
</style>
