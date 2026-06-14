import { computed, onMounted, ref, shallowRef } from 'vue'

export interface OllamaModelOption {
  name: string
  size: string
  size_bytes?: number | null
  installed?: boolean
  cloud_hosted?: boolean
  digest?: string
  modified_at?: string
  family?: string
  parameter_size?: string
  quantization_level?: string
}

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
  selected?: boolean
  cloud_hosted?: boolean
  service_available?: boolean | null
  status_message?: string | null
  options?: OllamaModelOption[]
}

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const rawText = await response.text()
  const data = (rawText ? JSON.parse(rawText) : {}) as T
  if (!response.ok) {
    const maybeMessage = data as { message?: string; error?: string }
    throw new Error(maybeMessage.message || maybeMessage.error || `HTTP ${response.status}`)
  }
  return data
}

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error || '未知错误')
)

export function useModelManagement() {
  const models = ref<ManagedModelInfo[]>([])
  const isLoading = shallowRef(false)
  const isSelecting = shallowRef(false)
  const loadError = shallowRef('')
  const selectError = shallowRef('')

  const selectedModel = computed(() => (
    models.value.find(model => model.selected) || models.value[0] || null
  ))

  const ollamaOptions = computed<OllamaModelOption[]>(() => {
    const optionMap = new Map<string, OllamaModelOption>()
    for (const option of selectedModel.value?.options || []) {
      if (option.name) optionMap.set(option.name, option)
    }
    for (const model of models.value) {
      if (model.managed_by === 'ollama' && model.installed) {
        optionMap.set(model.name, {
          name: model.name,
          size: model.size,
          installed: model.installed,
          cloud_hosted: model.cloud_hosted,
          digest: model.expected_sha256,
        })
      }
    }
    return [...optionMap.values()].sort((left, right) => {
      const leftCloudRank = left.cloud_hosted ? 0 : 1
      const rightCloudRank = right.cloud_hosted ? 0 : 1
      if (leftCloudRank !== rightCloudRank) return leftCloudRank - rightCloudRank
      const leftInstalledRank = left.installed ? 0 : 1
      const rightInstalledRank = right.installed ? 0 : 1
      if (leftInstalledRank !== rightInstalledRank) return leftInstalledRank - rightInstalledRank
      return left.name.localeCompare(right.name)
    })
  })

  const loadModels = async () => {
    isLoading.value = true
    loadError.value = ''
    try {
      const response = await fetch('/api/models/status')
      models.value = await parseJsonResponse<ManagedModelInfo[]>(response)
    } catch (error) {
      loadError.value = errorMessage(error)
    } finally {
      isLoading.value = false
    }
  }

  const selectModel = async (name: string) => {
    const selectedName = name.trim()
    if (!selectedName) return

    isSelecting.value = true
    selectError.value = ''
    try {
      const response = await fetch('/api/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedName }),
      })
      await parseJsonResponse<{ status: string; message?: string; model?: ManagedModelInfo }>(response)
      await loadModels()
    } catch (error) {
      selectError.value = errorMessage(error)
    } finally {
      isSelecting.value = false
    }
  }

  onMounted(() => {
    void loadModels()
  })

  return {
    models,
    isLoading,
    isSelecting,
    loadError,
    selectError,
    selectedModel,
    ollamaOptions,
    loadModels,
    selectModel,
  }
}
