import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { MapSearchResult } from '@/types/api'

export const useMapStore = defineStore('map', () => {
  const currentLocation = ref<MapSearchResult | null>(null)
  const searchResults = ref<MapSearchResult[]>([])
  const mapContext = ref<string>('')
  const searchQuery = ref<string>('')
  const isSearching = ref(false)

  const setCurrentLocation = (location: MapSearchResult | null) => {
    currentLocation.value = location
    if (location) {
      mapContext.value = `当前地点：${location.name}\n地址：${location.address}\n坐标：${location.location.lat}, ${location.location.lng}`
    }
  }

  const setSearchResults = (results: MapSearchResult[]) => {
    searchResults.value = results
  }

  const clearResults = () => {
    searchResults.value = []
    searchQuery.value = ''
  }

  const clearMap = () => {
    currentLocation.value = null
    searchResults.value = []
    mapContext.value = ''
    searchQuery.value = ''
  }

  return {
    currentLocation,
    searchResults,
    mapContext,
    searchQuery,
    isSearching,
    setCurrentLocation,
    setSearchResults,
    clearResults,
    clearMap,
  }
})
