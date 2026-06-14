<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useEventListener } from '@vueuse/core'
import Live2DCanvas from './Live2DCanvas.vue'

// Draggable position state
const stage = ref<HTMLElement>()
const isDragging = ref(false)
const position = ref({ left: 18, top: 18 })

const STORAGE_KEY = 'qdh.avatarFloatPosition'

const loadPosition = () => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      position.value = {
        left: Number(parsed.left) || 18,
        top: Number(parsed.top) || 18,
      }
    } catch {
      // Use default
    }
  }
}

const savePosition = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(position.value))
}

const clampPosition = (left: number, top: number) => {
  const leftPane = stage.value?.parentElement
  const stageRect = stage.value?.getBoundingClientRect()
  const bounds = leftPane?.getBoundingClientRect()

  if (!bounds || !stageRect) {
    return { left: Math.max(8, left), top: Math.max(8, top) }
  }

  const maxLeft = Math.max(8, bounds.width - stageRect.width - 8)
  const maxTop = Math.max(8, bounds.height - stageRect.height - 8)

  return {
    left: Math.max(8, Math.min(maxLeft, left)),
    top: Math.max(8, Math.min(maxTop, top)),
  }
}

const handlePointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || !stage.value) return
  event.preventDefault()

  isDragging.value = true
  const startX = event.clientX
  const startY = event.clientY
  const startLeft = position.value.left
  const startTop = position.value.top

  const handleMove = (e: PointerEvent) => {
    if (!isDragging.value) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const clamped = clampPosition(startLeft + dx, startTop + dy)
    position.value = clamped
  }

  const handleUp = () => {
    if (!isDragging.value) return
    isDragging.value = false
    savePosition()
    document.removeEventListener('pointermove', handleMove)
    document.removeEventListener('pointerup', handleUp)
    document.removeEventListener('pointercancel', handleUp)
  }

  document.addEventListener('pointermove', handleMove)
  document.addEventListener('pointerup', handleUp)
  document.addEventListener('pointercancel', handleUp)
}

onMounted(() => {
  loadPosition()
  const clamped = clampPosition(position.value.left, position.value.top)
  position.value = clamped
})

useEventListener('resize', () => {
  const clamped = clampPosition(position.value.left, position.value.top)
  position.value = clamped
})
</script>

<template>
  <div
    ref="stage"
    class="avatar-stage"
    :class="{ dragging: isDragging }"
    :style="{
      left: `${position.left}px`,
      top: `${position.top}px`,
    }"
    @pointerdown="handlePointerDown"
  >
    <Live2DCanvas />
  </div>
</template>

<style scoped>
.avatar-stage {
  position: absolute;
  z-index: 10;
  width: min(44vw, calc(100% - 36px), 560px);
  height: min(34vw, calc(100vh - 120px), 420px);
  min-width: 280px;
  min-height: 220px;
  background: transparent;
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.avatar-stage.dragging {
  cursor: grabbing;
}

.avatar-stage canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: inherit;
}
</style>
