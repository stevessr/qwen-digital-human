<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useDigitalHuman } from '@/composables/useDigitalHuman'
import { useAvatarStore } from '@/stores/avatar'
import { useFaceTrackingStore } from '@/stores/faceTracking'
import type { DigitalHumanPersonaKey } from '@/types/avatar'

const avatarStore = useAvatarStore()
const faceTrackingStore = useFaceTrackingStore()

const { signals } = useDigitalHuman(
  computed(() => avatarStore.state),
  toRef(() => faceTrackingStore.state)
)

const PERSONA_LABELS: Record<DigitalHumanPersonaKey, string> = {
  guide: '地图讲解员',
  professional: '专业导览员',
  energetic: '元气助手',
}

const rootClasses = computed(() => [
  'digital-human',
  `persona-${avatarStore.persona}`,
])

const headStyle = computed(() => ({
  transform: [
    `translateY(${(signals.value.breath - 0.5) * -5}px)`,
    `rotateZ(${signals.value.headRoll * 12}deg)`,
    `rotateY(${signals.value.headYaw * 18}deg)`,
    `rotateX(${signals.value.headPitch * -12}deg)`,
  ].join(' '),
}))

const torsoStyle = computed(() => ({
  transform: `translateY(${signals.value.breath * 4}px) rotateZ(${signals.value.headRoll * 3}deg)`,
}))

const eyeStyle = computed(() => ({
  transform: `scaleY(${Math.max(0.08, signals.value.eyeOpen)}) translateX(${signals.value.headYaw * 4}px)`,
}))

const mouthStyle = computed(() => ({
  height: `${8 + signals.value.mouthOpen * 24}px`,
  width: `${34 + Math.max(0, signals.value.smile) * 18}px`,
  borderRadius: signals.value.smile >= 0 ? '0 0 999px 999px' : '999px 999px 0 0',
  transform: `translateX(-50%) translateY(${signals.value.mouthOpen * 3}px)`,
}))

const auraStyle = computed(() => ({
  opacity: 0.35 + signals.value.energy * 0.35,
  transform: `scale(${1 + signals.value.energy * 0.08})`,
}))

const personaLabel = computed(() => PERSONA_LABELS[avatarStore.persona])
</script>

<template>
  <div :class="rootClasses" aria-label="程序化数字人形象">
    <div class="aura" :style="auraStyle" />
    <div class="hologram-ring ring-one" />
    <div class="hologram-ring ring-two" />
    <div class="speech-meter" aria-hidden="true">
      <span
        v-for="index in 12"
        :key="index"
        :style="{ transform: `scaleY(${0.35 + signals.energy * 1.1 + ((index % 3) * 0.09)})` }"
      />
    </div>

    <div class="body" :style="torsoStyle">
      <div class="shoulders" />
      <div class="chest-core">
        <span />
      </div>
    </div>

    <div class="head" :style="headStyle">
      <div class="hair hair-back" />
      <div class="face">
        <div class="hair hair-front" />
        <div class="brow brow-left" />
        <div class="brow brow-right" />
        <div class="eye eye-left" :style="eyeStyle">
          <span />
        </div>
        <div class="eye eye-right" :style="eyeStyle">
          <span />
        </div>
        <div class="nose" />
        <div class="mouth" :style="mouthStyle" />
        <div class="cheek cheek-left" />
        <div class="cheek cheek-right" />
      </div>
    </div>

    <div class="status-panel">
      <span class="status-dot" />
      {{ personaLabel }} · 表情 / 口型 / 眼动
    </div>
  </div>
</template>

<style scoped>
.digital-human {
  --aura-color: rgba(91, 190, 255, 0.5);
  --ring-color: rgba(106, 214, 255, 0.36);
  --jacket-start: rgba(47, 95, 154, 0.95);
  --jacket-end: rgba(23, 39, 70, 0.95);
  --hair-start: #1d3458;
  --hair-end: #070b14;
  --iris-start: #baf6ff;
  --iris-mid: #1478a8;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 220px;
  overflow: hidden;
  border-radius: 24px;
  perspective: 900px;
  background:
    radial-gradient(circle at 50% 20%, rgba(84, 185, 255, 0.18), transparent 34%),
    radial-gradient(circle at 50% 80%, rgba(78, 255, 194, 0.12), transparent 42%);
}

.persona-professional {
  --aura-color: rgba(94, 151, 255, 0.5);
  --ring-color: rgba(129, 169, 255, 0.42);
  --jacket-start: rgba(40, 64, 112, 0.96);
  --jacket-end: rgba(14, 23, 48, 0.96);
  --hair-start: #182338;
  --hair-end: #05070d;
  --iris-start: #dce8ff;
  --iris-mid: #315aa0;
}

.persona-energetic {
  --aura-color: rgba(87, 255, 197, 0.48);
  --ring-color: rgba(98, 255, 208, 0.4);
  --jacket-start: rgba(36, 139, 121, 0.96);
  --jacket-end: rgba(12, 48, 61, 0.96);
  --hair-start: #263d50;
  --hair-end: #07111a;
  --iris-start: #cfffea;
  --iris-mid: #0f9075;
}

.aura {
  position: absolute;
  inset: 10% 12%;
  border-radius: 999px;
  background: radial-gradient(circle, var(--aura-color), rgba(33, 77, 122, 0.18) 44%, transparent 68%);
  filter: blur(12px);
  transition: opacity 180ms ease, transform 180ms ease;
}

.hologram-ring {
  position: absolute;
  left: 50%;
  bottom: 11%;
  width: 62%;
  height: 16%;
  border: 1px solid var(--ring-color);
  border-radius: 50%;
  transform: translateX(-50%) rotateX(68deg);
  box-shadow: 0 0 24px rgba(70, 180, 255, 0.25);
}

.ring-two {
  bottom: 18%;
  width: 46%;
  opacity: 0.55;
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
}

.speech-meter span {
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: linear-gradient(180deg, #bff8ff, rgba(98, 230, 255, 0.18));
  transform-origin: bottom;
  transition: transform 80ms ease-out;
}

.body {
  position: absolute;
  left: 50%;
  bottom: 13%;
  width: 48%;
  height: 30%;
  transform-origin: 50% 0;
  transition: transform 160ms ease-out;
}

.shoulders {
  position: absolute;
  inset: 18% 0 0;
  transform: translateX(-50%);
  left: 50%;
  width: 100%;
  height: 74%;
  border-radius: 45% 45% 18% 18%;
  background:
    linear-gradient(135deg, var(--jacket-start), var(--jacket-end)),
    radial-gradient(circle at 50% 0, rgba(84, 210, 255, 0.42), transparent 38%);
  border: 1px solid rgba(135, 213, 255, 0.22);
  box-shadow: inset 0 18px 42px rgba(148, 220, 255, 0.13), 0 18px 42px rgba(0, 0, 0, 0.26);
}

.chest-core {
  position: absolute;
  left: 50%;
  top: 42%;
  width: 54px;
  height: 54px;
  transform: translateX(-50%);
  border-radius: 50%;
  border: 1px solid rgba(119, 231, 255, 0.7);
  box-shadow: 0 0 22px rgba(86, 207, 255, 0.35), inset 0 0 20px rgba(86, 207, 255, 0.24);
}

.chest-core span {
  position: absolute;
  inset: 13px;
  border-radius: 50%;
  background: #8af0ff;
  box-shadow: 0 0 18px #8af0ff;
}

.head {
  position: absolute;
  left: 50%;
  top: 13%;
  width: min(47%, 230px);
  aspect-ratio: 0.82;
  transform-origin: 50% 82%;
  transform-style: preserve-3d;
  transition: transform 120ms ease-out;
}

.face {
  position: absolute;
  inset: 11% 9% 7%;
  border-radius: 46% 46% 48% 48%;
  background:
    radial-gradient(circle at 34% 35%, rgba(255, 255, 255, 0.64), transparent 8%),
    linear-gradient(160deg, #ffd8bf 0%, #f6b795 68%, #d88b75 100%);
  border: 1px solid rgba(255, 238, 219, 0.8);
  box-shadow: inset 0 -18px 34px rgba(160, 76, 62, 0.16), 0 16px 34px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}

.hair {
  position: absolute;
  pointer-events: none;
}

.hair-back {
  inset: 0 2% 16%;
  border-radius: 48% 48% 34% 34%;
  background: linear-gradient(140deg, var(--hair-start), var(--hair-end) 72%);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
}

.hair-front {
  left: -6%;
  top: -5%;
  width: 112%;
  height: 38%;
  border-radius: 48% 48% 30% 30%;
  background: linear-gradient(155deg, var(--hair-start), var(--hair-end) 74%);
  clip-path: polygon(0 0, 100% 0, 94% 62%, 75% 42%, 60% 76%, 42% 38%, 24% 72%, 7% 48%);
}

.brow,
.eye,
.nose,
.mouth,
.cheek {
  position: absolute;
}

.brow {
  top: 38%;
  width: 22%;
  height: 4px;
  border-radius: 999px;
  background: rgba(28, 37, 55, 0.74);
}

.brow-left {
  left: 22%;
  transform: rotate(-5deg);
}

.brow-right {
  right: 22%;
  transform: rotate(5deg);
}

.eye {
  top: 44%;
  width: 18%;
  height: 13%;
  border-radius: 999px;
  background: #f8fbff;
  overflow: hidden;
  transform-origin: center;
  transition: transform 90ms ease-out;
  box-shadow: inset 0 -4px 9px rgba(35, 65, 98, 0.24);
}

.eye-left {
  left: 23%;
}

.eye-right {
  right: 23%;
}

.eye span {
  position: absolute;
  left: 50%;
  top: 48%;
  width: 42%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 32%, var(--iris-start) 0 13%, var(--iris-mid) 14% 48%, #081527 49%);
}

.nose {
  left: 50%;
  top: 54%;
  width: 12px;
  height: 28px;
  border-radius: 50%;
  transform: translateX(-50%);
  border-right: 2px solid rgba(144, 87, 72, 0.28);
}

.mouth {
  left: 50%;
  top: 70%;
  min-height: 7px;
  background: linear-gradient(180deg, #8a3142, #351018);
  border: 2px solid rgba(87, 26, 38, 0.46);
  transition: width 90ms ease, height 90ms ease, border-radius 90ms ease, transform 90ms ease;
  box-shadow: inset 0 7px 8px rgba(255, 160, 170, 0.22);
}

.cheek {
  top: 60%;
  width: 16%;
  height: 8%;
  border-radius: 50%;
  background: rgba(255, 118, 135, 0.22);
  filter: blur(1px);
}

.cheek-left {
  left: 16%;
}

.cheek-right {
  right: 16%;
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

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #62e6ff;
  box-shadow: 0 0 14px #62e6ff;
}
</style>
