export interface ApiError {
  message: string
  code?: string
}

export interface ModelInfo {
  name: string
  size?: number
  downloaded: boolean
  progress?: number
  verified?: boolean
}

export interface MapBounds {
  south: number
  north: number
  west: number
  east: number
}

export interface MapSearchResult {
  place_id?: number | null
  osm_type?: string | null
  osm_id?: number | null
  display_name: string
  lat: number
  lon: number
  bounds: MapBounds
  category?: string | null
  kind?: string | null
  importance?: number | null
  map_url?: string
  summary?: string
}

export interface AsrState {
  state: 'idle' | 'listening' | 'processing' | 'final' | 'error'
  text: string
  confidence?: number
}
