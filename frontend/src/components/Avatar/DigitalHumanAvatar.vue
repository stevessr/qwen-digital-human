<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useDigitalHuman } from '@/composables/useDigitalHuman'
import { useAvatarStore } from '@/stores/avatar'
import { useFaceTrackingStore } from '@/stores/faceTracking'

const avatarStore = useAvatarStore()
const faceTrackingStore = useFaceTrackingStore()

const { signals } = useDigitalHuman(
  computed(() => avatarStore.state),
  toRef(() => faceTrackingStore.state)
)

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
</script>

<template>
  <div class="digital-human" aria-label="数字人形象">
    <div class="aura" :style="auraStyle" />
    <div class="hologram-ring ring-one" />
    <div class="hologram-ring ring-two" />

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
      Procedural Digital Human
    </div>
  </div>
</template>

<style scoped>
.digital-human {
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

.aura {
  position: absolute;
  inset: 10% 12%;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(91, 190, 255, 0.5), rgba(33, 77, 122, 0.18) 44%, transparent 68%);
  filter: blur(12px);
  transition: opacity 180ms ease, transform 180ms ease;
}

.hologram-ring {
  position: absolute;
  left: 50%;
  bottom: 11%;
  width: 62%;
  height: 16%;
  border: 1px solid rgba(106, 214, 255, 0.36);
  border-radius: 50%;
  transform: translateX(-50%) rotateX(68deg);
  box-shadow: 0 0 24px rgba(70, 180, 255, 0.25);
}

.ring-two {
  bottom: 18%;
  width: 46%;
  opacity: 0.55;
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
    linear-gradient(135deg, rgba(47, 95, 154, 0.95), rgba(23, 39, 70, 0.95)),
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
  background: linear-gradient(140deg, #13233d, #05080f 72%);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
}

.hair-front {
  left: -6%;
  top: -5%;
  width: 112%;
  height: 38%;
  border-radius: 48% 48% 30% 30%;
  background: linear-gradient(155deg, #1d3458, #070b14 74%);
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
  background: radial-gradient(circle at 35% 32%, #baf6ff 0 13%, #1478a8 14% 48%, #081527 49%);
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
