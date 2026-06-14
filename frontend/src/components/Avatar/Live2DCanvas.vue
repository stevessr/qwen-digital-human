<script setup lang="ts">
import { ref, toRef, computed } from 'vue'
import { useLive2D } from '@/composables/useLive2D'
import { useAvatarStore } from '@/stores/avatar'
import { useFaceTrackingStore } from '@/stores/faceTracking'

const avatarStore = useAvatarStore()
const faceTrackingStore = useFaceTrackingStore()
const canvasRef = ref<HTMLCanvasElement>()

const { isLoaded, error } = useLive2D(
  canvasRef,
  computed(() => avatarStore.state),
  toRef(() => faceTrackingStore.state)
)
</script>

<template>
  <div class="live2d-container">
    <canvas ref="canvasRef" />
    <div v-if="!isLoaded" class="loading-overlay">
      <a-spin size="large" tip="Loading Live2D model..." />
    </div>
    <div v-if="error" class="error-overlay">
      <a-alert :message="error" type="error" show-icon />
    </div>
  </div>
</template>

<style scoped>
.live2d-container {
  position: relative;
  width: 100%;
  height: 100%;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.loading-overlay,
.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
</style>
