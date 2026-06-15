import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { searchMapPlaces } from '@/api/map'
import {
  DEFAULT_MAP_PLACE,
  MAP_CONTEXT_MARKER,
  type MapBounds,
  type MapPlace,
} from '@/constants/config'

const DEFAULT_MAP_STATUS = '默认定位：北京天安门广场。可搜索地点并写入上下文。'

const mapContextPattern = /(?:^|\n\n)【地图讲解上下文】[\s\S]*?(?=\n\n|$)/g

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const toFiniteNumber = (value: unknown, fallback: number): number => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

const formatCoordinate = (value: number): string => Number(value).toFixed(6)

const safeBounds = (place: MapPlace): MapBounds => {
  const lat = toFiniteNumber(place.lat, DEFAULT_MAP_PLACE.lat)
  const lon = toFiniteNumber(place.lon, DEFAULT_MAP_PLACE.lon)
  const bounds = place.bounds || DEFAULT_MAP_PLACE.bounds
  const south = toFiniteNumber(bounds.south, lat - 0.01)
  const north = toFiniteNumber(bounds.north, lat + 0.01)
  const west = toFiniteNumber(bounds.west, lon - 0.01)
  const east = toFiniteNumber(bounds.east, lon + 0.01)

  return {
    south: Math.min(south, north),
    north: Math.max(south, north),
    west: Math.min(west, east),
    east: Math.max(west, east),
  }
}

const buildManualBounds = (lat: number, lon: number): MapBounds => ({
  south: lat - 0.006,
  north: lat + 0.006,
  west: lon - 0.008,
  east: lon + 0.008,
})

const buildManualPlace = (lat: number, lon: number): MapPlace => {
  const formattedLat = formatCoordinate(lat)
  const formattedLon = formatCoordinate(lon)

  return {
    display_name: `手动标点（${formattedLat}, ${formattedLon}）`,
    lat,
    lon,
    bounds: buildManualBounds(lat, lon),
    category: 'manual',
    kind: 'manual-pin',
    importance: 1,
    summary: [
      `手动标点（${formattedLat}, ${formattedLon}）`,
      `坐标：${formattedLat}, ${formattedLon}`,
      '分类：manual',
      '类型：manual-pin',
    ].join('\n'),
  }
}

export const buildMapFrameUrl = (place: MapPlace): string => {
  if (place.map_url) return place.map_url

  const lat = toFiniteNumber(place.lat, DEFAULT_MAP_PLACE.lat)
  const lon = toFiniteNumber(place.lon, DEFAULT_MAP_PLACE.lon)
  const bounds = safeBounds(place)

  return `https://www.openstreetmap.org/export/embed.html?bbox=${bounds.west}%2C${bounds.south}%2C${bounds.east}%2C${bounds.north}&layer=mapnik&marker=${lat}%2C${lon}`
}

export const buildMapContext = (place: MapPlace): string => [
  MAP_CONTEXT_MARKER,
  `地点：${place.display_name}`,
  `坐标：${formatCoordinate(place.lat)}, ${formatCoordinate(place.lon)}`,
  `类型：${place.kind || 'unknown'}`,
  `分类：${place.category || 'unknown'}`,
  '讲解要求：请以地图数字人讲解员的口吻，优先说明该地点的地理位置、周边地标、交通到达方式、适合人群与游览建议；语言简洁、自然、专业。',
  '如果用户继续追问，请围绕当前地点继续讲解，不要偏离地图主题。',
].join('\n')

export const stripMapContext = (context: string): string => context.replace(mapContextPattern, '').trim()

export const useMapStore = defineStore('map', () => {
  const currentLocation = shallowRef<MapPlace>(DEFAULT_MAP_PLACE)
  const searchResults = ref<MapPlace[]>([DEFAULT_MAP_PLACE])
  const searchQuery = ref('')
  const status = ref(DEFAULT_MAP_STATUS)
  const isSearching = ref(false)

  const mapContext = computed(() => buildMapContext(currentLocation.value))
  const mapFrameUrl = computed(() => buildMapFrameUrl(currentLocation.value))
  const selectedSummary = computed(() => currentLocation.value.summary || mapContext.value)
  const selectedMarkerStyle = computed(() => {
    const place = currentLocation.value
    const bounds = safeBounds(place)
    const lat = toFiniteNumber(place.lat, DEFAULT_MAP_PLACE.lat)
    const lon = toFiniteNumber(place.lon, DEFAULT_MAP_PLACE.lon)
    const width = Math.max(0.000001, bounds.east - bounds.west)
    const height = Math.max(0.000001, bounds.north - bounds.south)

    return {
      left: `${clamp(((lon - bounds.west) / width) * 100, 8, 92)}%`,
      top: `${clamp(((bounds.north - lat) / height) * 100, 8, 92)}%`,
    }
  })

  const setCurrentLocation = (location: MapPlace | null, announce = true) => {
    currentLocation.value = location || DEFAULT_MAP_PLACE
    if (announce) {
      status.value = location ? `已选中：${location.display_name}` : DEFAULT_MAP_STATUS
    }
  }

  const setSearchResults = (results: MapPlace[]) => {
    searchResults.value = results
  }

  const mapPlaceKey = (place: MapPlace, index: number): string => (
    `${place.place_id ?? place.osm_id ?? place.display_name}-${place.lat}-${place.lon}-${index}`
  )

  const isSelectedMapPlace = (place: MapPlace): boolean => (
    currentLocation.value.display_name === place.display_name
    && currentLocation.value.lat === place.lat
    && currentLocation.value.lon === place.lon
  )

  const searchPlaces = async () => {
    const query = searchQuery.value.trim()
    if (!query) {
      status.value = '请输入地点名称后再搜索。'
      return
    }

    isSearching.value = true
    status.value = `正在搜索：${query} ...`

    try {
      const data = await searchMapPlaces(query, 6)
      const results = Array.isArray(data.results) && data.results.length
        ? data.results
        : [DEFAULT_MAP_PLACE]

      searchResults.value = results
      setCurrentLocation(results[0] ?? DEFAULT_MAP_PLACE, false)
      status.value = `搜索完成：${data.query || query}（${results.length} 个结果）`
    } catch (error) {
      status.value = error instanceof Error ? error.message : String(error)
    } finally {
      isSearching.value = false
    }
  }

  const clearResults = () => {
    searchResults.value = [DEFAULT_MAP_PLACE]
    searchQuery.value = ''
  }

  const clearMap = () => {
    currentLocation.value = DEFAULT_MAP_PLACE
    searchResults.value = [DEFAULT_MAP_PLACE]
    searchQuery.value = ''
    status.value = '地图已清空，恢复默认定位。'
  }

  const setManualLocation = (lat: number, lon: number) => {
    const safeLat = toFiniteNumber(lat, DEFAULT_MAP_PLACE.lat)
    const safeLon = toFiniteNumber(lon, DEFAULT_MAP_PLACE.lon)
    const manualPlace = buildManualPlace(safeLat, safeLon)

    currentLocation.value = manualPlace
    searchResults.value = [
      manualPlace,
      ...searchResults.value.filter(place => !isSelectedMapPlace(place)),
    ].slice(0, 8)
    status.value = '已手动标点。点击“写入上下文”后，后端回复会围绕该坐标。'
  }

  return {
    currentLocation,
    searchResults,
    mapContext,
    mapFrameUrl,
    selectedSummary,
    selectedMarkerStyle,
    searchQuery,
    status,
    isSearching,
    setCurrentLocation,
    setSearchResults,
    mapPlaceKey,
    isSelectedMapPlace,
    searchPlaces,
    clearResults,
    clearMap,
    setManualLocation,
  }
})
