import { computed, onMounted, onUnmounted, ref } from 'vue'

export interface ManagedModelInfo {
  name: string
  description: string
  size: string
  url: string
  installed: boolean
  progress: number | null
  expected_sha256: string
}

const MODEL_POLL_INTERVAL_MS = 1000

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json() as T
  if (!response.ok) {
    const maybeMessage = data as { message?: string; error?: string }
    throw new Error(maybeMessage.message || maybeMessage.error || `HTTP ${response.status}`)
  }
  return data
}

export function useModelManagement() {
  const models = ref<ManagedModelInfo[]>([])
  const isLoading = ref(false)
  const activeRuntimePreloads = ref<Set<'asr' | 'tts'>>(new Set())
  const pollingInterval = ref<number | null>(null)

  const hasDownloadingModel = computed(() => models.value.some(model => model.progress !== null))

  const stopPolling = () => {
    if (pollingInterval.value !== null) {
      clearInterval(pollingInterval.value)
      pollingInterval.value = null
    }
  }

  const startPolling = () => {
    if (pollingInterval.value === null) {
      pollingInterval.value = window.setInterval(() => {
        void loadModels()
      }, MODEL_POLL_INTERVAL_MS)
    }
  }

  const syncPolling = () => {
    if (hasDownloadingModel.value) {
      startPolling()
    } else {
      stopPolling()
    }
  }

  const loadModels = async () => {
    isLoading.value = true
    try {
      const response = await fetch('/api/models/status')
      models.value = await parseJsonResponse<ManagedModelInfo[]>(response)
      syncPolling()
    } finally {
      isLoading.value = false
    }
  }

  const downloadModel = async (name: string, url: string) => {
    await parseJsonResponse<{ status: string; message?: string }>(await fetch('/api/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    }))
    await loadModels()
  }

  const deleteModel = async (name: string) => {
    await parseJsonResponse<{ status: string; message?: string }>(await fetch('/api/models/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }))
    await loadModels()
  }

  const verifyModel = async (name: string, expectedSha256: string): Promise<boolean> => {
    const result = await parseJsonResponse<{ status: string }>(await fetch('/api/models/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, expected_sha256: expectedSha256 }),
    }))
    if (result.status !== 'ok') {
      await loadModels()
      return false
    }
    return true
  }

  const preloadRuntimeModel = async (kind: 'asr' | 'tts') => {
    activeRuntimePreloads.value = new Set(activeRuntimePreloads.value).add(kind)
    try {
      const endpoint = kind === 'tts' ? '/api/models/preload/tts' : '/api/models/preload/asr'
      await parseJsonResponse<{ status: string; message?: string }>(await fetch(endpoint, { method: 'POST' }))
    } finally {
      const next = new Set(activeRuntimePreloads.value)
      next.delete(kind)
      activeRuntimePreloads.value = next
    }
  }

  const isRuntimePreloading = (kind: 'asr' | 'tts'): boolean => activeRuntimePreloads.value.has(kind)

  onMounted(() => {
    void loadModels()
  })

  onUnmounted(stopPolling)

  return {
    models,
    isLoading,
    hasDownloadingModel,
    loadModels,
    downloadModel,
    deleteModel,
    verifyModel,
    preloadRuntimeModel,
    isRuntimePreloading,
  }
}
