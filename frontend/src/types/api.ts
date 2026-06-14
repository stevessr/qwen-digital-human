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

export interface MapSearchResult {
  name: string
  address: string
  location: {
    lat: number
    lng: number
  }
}

export interface AsrState {
  state: 'idle' | 'listening' | 'processing' | 'final' | 'error'
  text: string
  confidence?: number
}
