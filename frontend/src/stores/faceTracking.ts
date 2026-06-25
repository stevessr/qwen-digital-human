import { reactive, watch, onUnmounted } from 'vue'
import { defineStore } from 'pinia'
import {
  DEFAULT_OPENCV_SETTINGS,
  LEGACY_OPENCV_STORAGE_KEYS,
  OPENCV_STORAGE_KEYS,
} from '@/constants/config'
import type { FaceTrackingState, FaceCalibration } from '@/types/avatar'
import { clampNumber } from '@/utils/math'

const DEBOUNCE_DELAY = 300

interface DebouncedFn<Args extends unknown[]> {
  (...args: Args): void
  cancel: () => void
}

function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delay: number): DebouncedFn<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = ((...args: Args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
      timer = null
    }, delay)
  }) as DebouncedFn<Args>
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  return debounced
}

const debouncedSaveToStorage = debounce((s: FaceTrackingState) => {
  localStorage.setItem(OPENCV_STORAGE_KEYS.enabled, String(s.enabled))
  localStorage.setItem(OPENCV_STORAGE_KEYS.autoStart, String(s.autoStart))
  localStorage.setItem(OPENCV_STORAGE_KEYS.mirror, String(s.mirror))
  localStorage.setItem(OPENCV_STORAGE_KEYS.smooth, String(s.smooth))
  localStorage.setItem(OPENCV_STORAGE_KEYS.yawGain, String(s.yawGain))
  localStorage.setItem(OPENCV_STORAGE_KEYS.pitchGain, String(s.pitchGain))
  localStorage.setItem(OPENCV_STORAGE_KEYS.blend, String(s.blend))

  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.enabled, String(s.enabled))
  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.autoStart, String(s.autoStart))
  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.mirror, String(s.mirror))
  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.smooth, String(s.smooth))
  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.yawGain, String(s.yawGain))
  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.pitchGain, String(s.pitchGain))
  localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.blend, String(s.blend))

  if (s.calibration) {
    const calibration = JSON.stringify(s.calibration)
    localStorage.setItem(OPENCV_STORAGE_KEYS.calibration, calibration)
    localStorage.setItem(LEGACY_OPENCV_STORAGE_KEYS.calibration, calibration)
  } else {
    localStorage.removeItem(OPENCV_STORAGE_KEYS.calibration)
    localStorage.removeItem(LEGACY_OPENCV_STORAGE_KEYS.calibration)
  }
}, DEBOUNCE_DELAY)

const loadBooleanSetting = (key: string, legacyKey: string, fallback: boolean): boolean => {
  const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey)
  return raw === null ? fallback : raw !== 'false'
}

const loadNumberSetting = (
  key: string,
  legacyKey: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey)
  if (raw === null || raw.trim() === '') return fallback
  return clampNumber(Number(raw), min, max, fallback)
}

export const useFaceTrackingStore = defineStore('faceTracking', () => {
  const state = reactive<FaceTrackingState>({
    enabled: DEFAULT_OPENCV_SETTINGS.enabled,
    autoStart: DEFAULT_OPENCV_SETTINGS.autoStart,
    cameraActive: false,
    calibrated: false,
    active: false,
    confidence: 0,
    pose: { head_pitch: 0, head_yaw: 0, head_roll: 0 },
    calibration: null,
    lastFace: null,
    lastSeenAt: 0,
    signals: {
      eye_open: 1.0,
      left_eye_open: 1.0,
      right_eye_open: 1.0,
      mouth_open: 0,
      smile: 0,
      blink: 0,
      roll: 0,
      confidence: 0,
    },
    blend: DEFAULT_OPENCV_SETTINGS.blend,
    mirror: DEFAULT_OPENCV_SETTINGS.mirror,
    smooth: DEFAULT_OPENCV_SETTINGS.smooth,
    yawGain: DEFAULT_OPENCV_SETTINGS.yawGain,
    pitchGain: DEFAULT_OPENCV_SETTINGS.pitchGain,
  })

  const setEnabled = (enabled: boolean) => {
    state.enabled = enabled
    if (!enabled) {
      state.active = false
      state.confidence = 0
    }
  }

  const setCalibration = (calibration: FaceCalibration | null) => {
    state.calibration = calibration
    state.calibrated = !!calibration
  }

  const loadFromStorage = () => {
    state.enabled = loadBooleanSetting(
      OPENCV_STORAGE_KEYS.enabled,
      LEGACY_OPENCV_STORAGE_KEYS.enabled,
      DEFAULT_OPENCV_SETTINGS.enabled,
    )
    state.autoStart = loadBooleanSetting(
      OPENCV_STORAGE_KEYS.autoStart,
      LEGACY_OPENCV_STORAGE_KEYS.autoStart,
      DEFAULT_OPENCV_SETTINGS.autoStart,
    )
    state.mirror = loadBooleanSetting(
      OPENCV_STORAGE_KEYS.mirror,
      LEGACY_OPENCV_STORAGE_KEYS.mirror,
      DEFAULT_OPENCV_SETTINGS.mirror,
    )
    state.smooth = loadNumberSetting(
      OPENCV_STORAGE_KEYS.smooth,
      LEGACY_OPENCV_STORAGE_KEYS.smooth,
      DEFAULT_OPENCV_SETTINGS.smooth,
      0.05,
      0.98,
    )
    state.yawGain = loadNumberSetting(
      OPENCV_STORAGE_KEYS.yawGain,
      LEGACY_OPENCV_STORAGE_KEYS.yawGain,
      DEFAULT_OPENCV_SETTINGS.yawGain,
      0.1,
      4,
    )
    state.pitchGain = loadNumberSetting(
      OPENCV_STORAGE_KEYS.pitchGain,
      LEGACY_OPENCV_STORAGE_KEYS.pitchGain,
      DEFAULT_OPENCV_SETTINGS.pitchGain,
      0.1,
      4,
    )
    state.blend = loadNumberSetting(
      OPENCV_STORAGE_KEYS.blend,
      LEGACY_OPENCV_STORAGE_KEYS.blend,
      DEFAULT_OPENCV_SETTINGS.blend,
      0,
      1,
    )

    const calibrationStr = localStorage.getItem(OPENCV_STORAGE_KEYS.calibration)
      ?? localStorage.getItem(LEGACY_OPENCV_STORAGE_KEYS.calibration)
    if (calibrationStr) {
      try {
        const parsed = JSON.parse(calibrationStr)
        if (parsed && typeof parsed === 'object') {
          state.calibration = parsed as FaceCalibration
          state.calibrated = true
        }
      } catch {
        state.calibration = null
        state.calibrated = false
      }
    }

    saveToStorage()
  }

  const saveToStorage = () => {
    debouncedSaveToStorage(state)
  }

  const saveWatcher = watch(state, () => {
    debouncedSaveToStorage(state)
  }, { deep: true })

  onUnmounted(() => {
    debouncedSaveToStorage.cancel()
    saveWatcher()
  })

  return {
    state,
    setEnabled,
    setCalibration,
    loadFromStorage,
    saveToStorage,
  }
})
