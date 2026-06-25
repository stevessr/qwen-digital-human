<script setup lang="ts">
import { computed, ref, toRef, onUnmounted } from 'vue'
import { useDigitalHuman } from '@/composables/useDigitalHuman'
import { useAvatarStore } from '@/stores/avatar'
import { useFaceTrackingStore } from '@/stores/faceTracking'
import type { DigitalHumanPersonaKey } from '@/types/avatar'

interface PersonaSpec {
  label: string
  modelUrl: string
  cameraOrbit: string
  fieldOfView: string
}

const avatarStore = useAvatarStore()
const faceTrackingStore = useFaceTrackingStore()

const { signals } = useDigitalHuman(
  computed(() => avatarStore.state),
  toRef(() => faceTrackingStore.state)
)

// UE5 Pixel Streaming mode (from localStorage)
const ue5Mode = ref(localStorage.getItem('qdh.ue5Mode') !== 'disabled')
const ue5Connected = ref(false)
const ue5StreamUrl = ref(localStorage.getItem('qdh.ue5StreamUrl') || 'http://localhost:8888')

// Watch for UE5 connection status changes via localStorage
const storageHandler = (e: StorageEvent) => {
  if (e.key === 'qdh.ue5Mode') {
    ue5Mode.value = e.newValue !== 'disabled'
  }
  if (e.key === 'qdh.ue5Connected') {
    ue5Connected.value = e.newValue === 'true'
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', storageHandler)
}

// Cleanup storage event listener on unmount
onUnmounted(() => {
  window.removeEventListener('storage', storageHandler)
})

const PERSONAS: Record<DigitalHumanPersonaKey, PersonaSpec> = {
  guide: {
    label: '地图讲解员',
    modelUrl: 'https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb',
    cameraOrbit: '0deg 68deg 2.35m',
    fieldOfView: '26deg',
  },
  professional: {
    label: '专业导览员',
    modelUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
    cameraOrbit: '-8deg 66deg 2.55m',
    fieldOfView: '25deg',
  },
  energetic: {
    label: '元气助手',
    modelUrl: 'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb',
    cameraOrbit: '8deg 68deg 2.25m',
    fieldOfView: '28deg',
  },
}

const personaSpec = computed(() => PERSONAS[avatarStore.persona])

const rootClasses = computed(() => [
  'digital-human',
  `persona-${avatarStore.persona}`,
])

const modelFrameStyle = computed(() => ({
  transform: [
    `translateY(${(signals.value.breath - 0.5) * -8}px)`,
    `rotateZ(${signals.value.headRoll * 5}deg)`,
    `rotateY(${signals.value.headYaw * 8}deg)`,
    `rotateX(${signals.value.headPitch * -5}deg)`,
  ].join(' '),
}))

const auraStyle = computed(() => ({
  opacity: 0.35 + signals.value.energy * 0.35,
  transform: `scale(${1 + signals.value.energy * 0.08})`,
}))
</script>

<template>
  <div :class="rootClasses" aria-label="数字人形象">
    <!-- UE5 Pixel Streaming embed (when enabled) -->
    <div v-if="ue5Mode" class="ue5-stream-wrapper">
      <iframe
        class="ue5-stream-iframe"
        :src="ue5StreamUrl"
        allow="autoplay; microphone; camera"
        title="UE5 MetaHuman 数字人"
        @load="ue5Connected = true"
        @error="ue5Connected = false"
      />
      <div class="ue5-status">
        <span class="status-dot" :class="{ connected: ue5Connected }" />
        {{ ue5Connected ? 'UE5 MetaHuman' : 'UE5 连接中…' }}
      </div>
    </div>

    <!-- Fallback: online 3D model viewer -->
    <template v-else>
      <div class="aura" :style="auraStyle" />
      <div class="hologram-ring ring-one" />
      <div class="hologram-ring ring-two" />

      <div class="model-frame" :style="modelFrameStyle">
        <model-viewer
          class="model-viewer"
          :src="personaSpec.modelUrl"
          :alt="`${personaSpec.label} 3D 数字人模型`"
          :camera-orbit="personaSpec.cameraOrbit"
          :field-of-view="personaSpec.fieldOfView"
          camera-controls
          auto-rotate
          autoplay
          touch-action="pan-y"
          interaction-prompt="none"
          environment-image="neutral"
          shadow-intensity="0.85"
          exposure="0.95"
          :loading="ue5Mode ? 'lazy' : 'eager'"
          reveal="auto"
        />
      </div>

      <div class="speech-meter" aria-hidden="true">
        <span
          v-for="index in 12"
          :key="index"
          :style="{ transform: `scaleY(${0.35 + signals.energy * 1.1 + ((index % 3) * 0.09)})` }"
        />
      </div>

      <div class="status-panel">
        <span class="status-dot" />
        {{ personaSpec.label }} · 在线 3D 模型 / 口型 / 姿态
      </div>
    </template>
  </div>
</template>

<style scoped>
.digital-human {
  --aura-color: rgba(91, 190, 255, 0.5);
  --ring-color: rgba(106, 214, 255, 0.36);
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 220px;
  overflow: hidden;
  border-radius: 24px;
  perspective: 900px;
  background:
    radial-gradient(circle at 50% 18%, rgba(84, 185, 255, 0.2), transparent 36%),
    radial-gradient(circle at 50% 82%, rgba(78, 255, 194, 0.13), transparent 44%),
    linear-gradient(180deg, rgba(4, 10, 20, 0.78), rgba(2, 5, 12, 0.92));
}

.persona-professional {
  --aura-color: rgba(94, 151, 255, 0.5);
  --ring-color: rgba(129, 169, 255, 0.42);
}

.persona-energetic {
  --aura-color: rgba(87, 255, 197, 0.48);
  --ring-color: rgba(98, 255, 208, 0.4);
}

.aura {
  position: absolute;
  inset: 8% 12%;
  border-radius: 999px;
  background: radial-gradient(circle, var(--aura-color), rgba(33, 77, 122, 0.18) 46%, transparent 70%);
  filter: blur(14px);
  transition: opacity 180ms ease, transform 180ms ease;
}

.hologram-ring {
  position: absolute;
  left: 50%;
  bottom: 9%;
  width: 64%;
  height: 16%;
  border: 1px solid var(--ring-color);
  border-radius: 50%;
  transform: translateX(-50%) rotateX(68deg);
  box-shadow: 0 0 24px rgba(70, 180, 255, 0.25);
}

.ring-two {
  bottom: 17%;
  width: 48%;
  opacity: 0.55;
}

.model-frame {
  position: absolute;
  inset: 2% 5% 8%;
  transform-origin: 50% 70%;
  transition: transform 120ms ease-out;
}

.model-viewer {
  width: 100%;
  height: 100%;
  --poster-color: transparent;
  background: transparent;
  outline: none;
}

.speech-meter {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  gap: 3px;
  align-items: end;
  height: 32px;
  opacity: 0.72;
  pointer-events: none;
}

.speech-meter span {
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: linear-gradient(180deg, #bff8ff, rgba(98, 230, 255, 0.18));
  transform-origin: bottom;
  transition: transform 80ms ease-out;
}

.status-panel {
  position: absolute;
  left: 16px;
  bottom: 14px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid rgba(118, 210, 255, 0.24);
  border-radius: 999px;
  background: rgba(6, 12, 22, 0.58);
  color: #bfeaff;
  font-size: 0.74rem;
  backdrop-filter: blur(8px);
}

/* UE5 Pixel Streaming wrapper */
.ue5-stream-wrapper {
  position: absolute;
  inset: 0;
  border-radius: 24px;
  overflow: hidden;
  background: #000;
}

.ue5-stream-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: #000;
}

.ue5-status {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 4px 14px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.72);
  color: #8ac2ff;
  font-size: 0.75rem;
  white-space: nowrap;
  pointer-events: none;
}

.ue5-status .status-dot {
  background: #8ac2ff;
  box-shadow: none;
}

.ue5-status .status-dot.connected {
  background: #34d399;
  box-shadow: 0 0 14px #34d399;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #62e6ff;
  box-shadow: 0 0 14px #62e6ff;
}
</style>
