import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import {
  DEFAULT_MAP_PLACE,
  MAP_CONTEXT_MARKER,
  OPENCV_CONTROL_CHANNEL_NAME,
  type MapPlace,
} from '@/constants/config'
import { useChatStore } from '@/stores/chat'
import { useFaceTrackingStore } from '@/stores/faceTracking'

interface MapSearchResponse {
  query: string
  results: MapPlace[]
}

interface ContextRetrieveResponse {
  context?: string
}

interface OpenCvApplyOptions {
  start?: boolean
  stop?: boolean
  calibrate?: boolean
  reset?: boolean
}

type OpenCvMessage =
  | { type: 'apply-settings'; enabled: boolean; autoStart: boolean; mirror: boolean }
  | { type: 'start-camera' }
  | { type: 'stop-camera' }
  | { type: 'calibrate' }
  | { type: 'reset-calibration' }

const mapContextPattern = /(?:^|\n\n)【地图讲解上下文】[\s\S]*?(?=\n\n|$)/g

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

const formatCoordinate = (value: number): string => Number(value).toFixed(6)

const buildMapContext = (place: MapPlace): string => [
  MAP_CONTEXT_MARKER,
  `地点：${place.display_name}`,
  `坐标：${formatCoordinate(place.lat)}, ${formatCoordinate(place.lon)}`,
  `类型：${place.kind || 'unknown'}`,
  `分类：${place.category || 'unknown'}`,
  '讲解要求：请以地图数字人讲解员的口吻，优先说明该地点的地理位置、周边地标、交通到达方式、适合人群与游览建议；语言简洁、自然、专业。',
  '如果用户继续追问，请围绕当前地点继续讲解，不要偏离地图主题。',
].join('\n')

const stripMapContext = (context: string): string => (
  context.replace(mapContextPattern, '').trim()
)

const buildMapFrameUrl = (place: MapPlace): string => {
  if (place.map_url) return place.map_url

  const lat = Number(place.lat || DEFAULT_MAP_PLACE.lat)
  const lon = Number(place.lon || DEFAULT_MAP_PLACE.lon)
  const bounds = place.bounds || DEFAULT_MAP_PLACE.bounds
  const south = Number(bounds.south ?? lat - 0.01)
  const north = Number(bounds.north ?? lat + 0.01)
  const west = Number(bounds.west ?? lon - 0.01)
  const east = Number(bounds.east ?? lon + 0.01)

  return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${lat}%2C${lon}`
}

export function useConfigPage() {
  const chatStore = useChatStore()
  const faceTrackingStore = useFaceTrackingStore()

  const settings = chatStore.settings
  const faceState = faceTrackingStore.state
  const mapSearchQuery = ref('')
  const mapResults = ref<MapPlace[]>([DEFAULT_MAP_PLACE])
  const selectedMapPlace = ref<MapPlace>(DEFAULT_MAP_PLACE)
  const mapStatus = ref('默认定位：北京天安门广场。可搜索地点并写入上下文。')
  const isMapSearching = ref(false)
  const opencvStatus = ref('OpenCV 模式尚未启用。')
  const opencvControlChannel = shallowRef<BroadcastChannel | null>(null)

  const mapFrameUrl = computed(() => buildMapFrameUrl(selectedMapPlace.value))
  const selectedMapSummary = computed(() => (
    selectedMapPlace.value.summary || buildMapContext(selectedMapPlace.value)
  ))

  const mapPlaceKey = (place: MapPlace, index: number): string => (
    `${place.place_id ?? place.osm_id ?? place.display_name}-${place.lat}-${place.lon}-${index}`
  )

  const isSelectedMapPlace = (place: MapPlace): boolean => (
    selectedMapPlace.value.display_name === place.display_name
    && selectedMapPlace.value.lat === place.lat
    && selectedMapPlace.value.lon === place.lon
  )

  const selectMapPlace = (place: MapPlace, announce = true) => {
    selectedMapPlace.value = place
    if (announce) {
      mapStatus.value = `已选中：${place.display_name}`
    }
  }

  const resetMapPanel = () => {
    selectedMapPlace.value = DEFAULT_MAP_PLACE
    mapResults.value = [DEFAULT_MAP_PLACE]
    mapSearchQuery.value = ''
    mapStatus.value = '默认定位：北京天安门广场。可搜索地点并写入上下文。'
  }

  const writeMapContext = () => {
    const cleaned = stripMapContext(settings.context)
    const block = buildMapContext(selectedMapPlace.value)
    settings.context = cleaned ? `${block}\n\n${cleaned}` : block
    chatStore.saveSettings()
    mapStatus.value = `已写入上下文：${selectedMapPlace.value.display_name}`
  }

  const clearMapContext = () => {
    settings.context = stripMapContext(settings.context)
    chatStore.saveSettings()
    resetMapPanel()
    mapStatus.value = '地图已清空，恢复默认定位。'
  }

  const clearContextDraft = () => {
    settings.context = ''
    settings.use_rag_context = false
    chatStore.saveSettings()
    mapStatus.value = '上下文已清空'
  }

  const searchMapPlaces = async () => {
    const query = mapSearchQuery.value.trim()
    if (!query) {
      mapStatus.value = '请输入地点名称后再搜索。'
      return
    }

    isMapSearching.value = true
    mapStatus.value = `正在搜索：${query} ...`

    try {
      const res = await fetch('/api/map/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5 }),
      })
      const data = await res.json() as MapSearchResponse & { error?: string }
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const results = Array.isArray(data.results) && data.results.length
        ? data.results
        : [DEFAULT_MAP_PLACE]
      mapResults.value = results
      selectedMapPlace.value = results[0] ?? DEFAULT_MAP_PLACE
      mapStatus.value = `搜索完成：${data.query || query}（${results.length} 个结果）`
    } catch (error) {
      mapStatus.value = `地图搜索失败：${errorMessage(error)}`
    } finally {
      isMapSearching.value = false
    }
  }

  const refreshContextFromRag = async () => {
    const query = mapSearchQuery.value.trim()
      || selectedMapPlace.value.display_name
      || settings.system_prompt.trim()
      || '地图讲解'

    if (!query) {
      mapStatus.value = '请先输入一段问题再刷新上下文'
      return
    }

    mapStatus.value = `正在刷新上下文：${query} ...`

    try {
      const res = await fetch('/api/context/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, rerank: settings.rerank }),
      })
      const data = await res.json() as ContextRetrieveResponse
      settings.context = data.context || ''
      chatStore.saveSettings()
      mapStatus.value = data.context ? '上下文已刷新' : '上下文为空'
    } catch (error) {
      mapStatus.value = `刷新上下文失败：${errorMessage(error)}`
    }
  }

  const postOpenCvMessage = (message: OpenCvMessage) => {
    opencvControlChannel.value?.postMessage(message)
  }

  const syncOpenCvStatusFromState = () => {
    opencvStatus.value = faceState.enabled
      ? (faceState.autoStart
        ? 'OpenCV 眼部追踪已启用，主界面会自动使用摄像头追踪人眼。'
        : 'OpenCV 眼部追踪已启用，等待手动启动摄像头。')
      : 'OpenCV 眼部追踪未启用。'
  }

  const sendOpenCvApply = (options: OpenCvApplyOptions = {}) => {
    postOpenCvMessage({
      type: 'apply-settings',
      enabled: faceState.enabled,
      autoStart: faceState.autoStart,
      mirror: faceState.mirror,
    })
    if (options.start) postOpenCvMessage({ type: 'start-camera' })
    if (options.stop) postOpenCvMessage({ type: 'stop-camera' })
    if (options.calibrate) postOpenCvMessage({ type: 'calibrate' })
    if (options.reset) postOpenCvMessage({ type: 'reset-calibration' })
  }

  const persistOpenCvAndApply = (options: OpenCvApplyOptions = {}) => {
    faceTrackingStore.saveToStorage()
    sendOpenCvApply(options)
  }

  const handleOpenCvEnabledChange = () => {
    if (!faceState.enabled) {
      faceState.active = false
      faceState.confidence = 0
    }
    faceTrackingStore.saveToStorage()
    syncOpenCvStatusFromState()
    sendOpenCvApply({
      start: faceState.enabled && faceState.autoStart,
      stop: !faceState.enabled,
    })
  }

  const handleOpenCvAutoStartChange = () => {
    faceTrackingStore.saveToStorage()
    syncOpenCvStatusFromState()
    sendOpenCvApply({ start: faceState.enabled && faceState.autoStart })
  }

  const handleOpenCvTuningChange = () => {
    persistOpenCvAndApply()
  }

  const startCamera = () => {
    faceState.enabled = true
    faceTrackingStore.saveToStorage()
    opencvStatus.value = '已向主页面发送启动摄像头指令。'
    sendOpenCvApply({ start: true })
  }

  const stopCamera = () => {
    opencvStatus.value = '已向主页面发送停止摄像头指令。'
    sendOpenCvApply({ stop: true })
  }

  const calibrateOpenCv = () => {
    opencvStatus.value = '已向主页面发送校准指令。'
    sendOpenCvApply({ calibrate: true })
  }

  const resetOpenCvCalibration = () => {
    opencvStatus.value = '已向主页面发送重置校准指令。'
    sendOpenCvApply({ reset: true })
  }

  onMounted(() => {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        opencvControlChannel.value = new BroadcastChannel(OPENCV_CONTROL_CHANNEL_NAME)
        opencvControlChannel.value.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type?: string; message?: string }
          if (data?.type === 'status') {
            opencvStatus.value = data.message || 'OpenCV 状态已更新。'
          }
        })
      }
    } catch (error) {
      console.warn('Failed to initialize OpenCV control channel:', error)
    }

    syncOpenCvStatusFromState()
    if (faceState.enabled && faceState.autoStart) {
      sendOpenCvApply({ start: true })
    }
  })

  onUnmounted(() => {
    opencvControlChannel.value?.close()
    opencvControlChannel.value = null
  })

  return {
    settings,
    faceState,
    mapSearchQuery,
    mapResults,
    selectedMapPlace,
    mapStatus,
    mapFrameUrl,
    selectedMapSummary,
    isMapSearching,
    opencvStatus,
    mapPlaceKey,
    isSelectedMapPlace,
    selectMapPlace,
    resetMapPanel,
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
  }
}
