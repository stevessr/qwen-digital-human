import type { MapPlace } from '@/constants/config'

export interface MapSearchResponse {
  query: string
  results: MapPlace[]
}

export async function searchMapPlaces(query: string, limit = 5): Promise<MapSearchResponse> {
  const response = await fetch('/api/map/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })

  const data = await response.json() as MapSearchResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || `地图搜索失败：HTTP ${response.status}`)
  }

  return data
}
