import { onMounted, ref } from 'vue'

export interface ManagedModelInfo {
  name: string
  description: string
  size: string
  url: string
  installed: boolean
  progress: number | null
  expected_sha256: string
  provider?: string
  capability?: string
  managed_by?: 'ollama' | 'browser' | 'external'
  downloadable?: boolean
  verifiable?: boolean
  deletable?: boolean
}

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

  const loadModels = async () => {
    isLoading.value = true
    try {
      const response = await fetch('/api/models/status')
      models.value = await parseJsonResponse<ManagedModelInfo[]>(response)
    } finally {
      isLoading.value = false
    }
  }

  onMounted(() => {
    void loadModels()
  })

  return {
    models,
    isLoading,
    loadModels,
  }
}
