<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import { useDraggable, useResizeObserver } from '@vueuse/core'
import DigitalHumanAvatar from './DigitalHumanAvatar.vue'

// Draggable position state
const stage = useTemplateRef<HTMLElement>('stage')
const isDragging = ref(false)
const position = ref({ left: 18, top: 18 })

useDraggable(stage, {
  initialValue: { x: 18, y: 18 },
  onStart: (_position, _event) => {
    isDragging.value = true
  },
  onEnd: (_position, _event) => {
    isDragging.value = false
    savePosition()
  }
})

const STORAGE_KEY = 'qdh.avatarFloatPosition'
const VIEWPORT_GAP = 8

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
  const stageRect = stage.value?.getBoundingClientRect()
  const stageWidth = stageRect?.width ?? 280
  const stageHeight = stageRect?.height ?? 220
  const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - stageWidth - VIEWPORT_GAP)
  const maxTop = Math.max(VIEWPORT_GAP, window.innerHeight - stageHeight - VIEWPORT_GAP)

  return {
    left: Math.max(VIEWPORT_GAP, Math.min(maxLeft, left)),
    top: Math.max(VIEWPORT_GAP, Math.min(maxTop, top)),
  }
}

onMounted(() => {
  loadPosition()
  const clamped = clampPosition(position.value.left, position.value.top)
  position.value = clamped
})

// Handle responsive resize for useDraggable's external dependency
useResizeObserver(stage, () => {
  const clamped = clampPosition(position.value.left, position.value.top)
  position.value = clamped
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="stage"
      class="avatar-stage"
      :class="{ dragging: isDragging }"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }"
    >
      <DigitalHumanAvatar />
    </div>
  </Teleport>
</template>

<style scoped>
.avatar-stage {
  position: fixed;
  z-index: 2147483000;
  width: min(44vw, calc(100% - 36px), 560px);
  height: min(34vw, calc(100vh - 120px), 420px);
  min-width: 280px;
  min-height: 220px;
  background: transparent;
  isolation: isolate;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.avatar-stage.dragging {
  cursor: grabbing;
}

.avatar-stage :deep(*) {
  cursor: inherit;
}
</style>
