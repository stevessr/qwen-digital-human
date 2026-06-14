import { ref, shallowRef, watch, onMounted, onUnmounted, nextTick, readonly, type Ref } from 'vue'
import { LIVE2D_MODELS } from '@/constants/config'
import type { AvatarState, Live2DModelKey, FaceTrackingState } from '@/types/avatar'

interface Live2DApp {
  destroy: (options?: any) => void
  renderer: {
    resize: (width: number, height: number) => void
  }
  stage: any
}

interface Live2DModel {
  internalModel?: {
    coreModel?: any
  }
  width?: number
  height?: number
  anchor?: {
    set: (x: number, y: number) => void
  }
  position?: {
    set: (x: number, y: number) => void
  }
  scale?: {
    set: (scale: number) => void
  }
  skew?: {
    set: (x: number, y: number) => void
  }
  parent?: any
  getLocalBounds: () => { width: number; height: number }
  motion?: (name: string, index?: number) => Promise<boolean>
  expression?: (name: string) => Promise<boolean>
  off?: (event: string, handler: any) => void
}

declare global {
  interface Window {
    PIXI?: {
      Application: any
      Ticker?: any
      live2d?: {
        Live2DModel: {
          from: (url: string, options?: any) => Promise<Live2DModel>
          registerTicker: (ticker: any) => void
        }
      }
    }
  }
}

const clampNumber = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const lerpNumber = (from: number, to: number, amount: number): number => {
  const t = clampNumber(amount, 0, 1, 0)
  return from + (to - from) * t
}

const setCoreParameter = (
  coreModel: any,
  candidateIds: string[],
  value: number,
  weight = 1
): boolean => {
  if (!coreModel || typeof coreModel.setParameterValueById !== 'function') return false
  for (const id of candidateIds) {
    try {
      coreModel.setParameterValueById(id, value, weight)
      return true
    } catch {
      continue
    }
  }
  return false
}

export function useLive2D(
  canvasRef: Ref<HTMLCanvasElement | undefined>,
  avatarState: Ref<AvatarState>,
  faceTrackingState: Ref<FaceTrackingState>
) {
  const app = shallowRef<Live2DApp>()
  const model = shallowRef<Live2DModel>()
  const isLoaded = ref(false)
  const currentModelKey = ref<Live2DModelKey>('shizuku')
  const error = ref<string>()

  const ensureDependencies = async () => {
    if (window.PIXI?.live2d?.Live2DModel) {
      if (window.PIXI.Ticker) {
        window.PIXI.live2d.Live2DModel.registerTicker(window.PIXI.Ticker)
      }
      return
    }

    // Wait for scripts to load (they are in index.html)
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (window.PIXI?.live2d?.Live2DModel) {
          if (window.PIXI.Ticker) {
            window.PIXI.live2d.Live2DModel.registerTicker(window.PIXI.Ticker)
          }
          resolve()
        } else {
          setTimeout(check, 100)
        }
      }
      check()
      setTimeout(() => reject(new Error('Live2D dependencies timeout')), 10000)
    })
  }

  const getBlendedState = () => {
    const base = avatarState.value
    const tracking = faceTrackingState.value

    const trackingPose =
      tracking.enabled && tracking.cameraActive && tracking.active ? tracking.pose : null
    const trackingBlend = trackingPose
      ? clampNumber(tracking.blend, 0, 1, 0.85) * clampNumber(tracking.confidence, 0, 1, 1)
      : 0
    const trackingSignals =
      tracking.enabled && tracking.cameraActive && tracking.active ? tracking.signals : null
    const trackingExpression = trackingSignals
      ? {
          mouth_open: clampNumber(trackingSignals.mouth_open, 0, 1, 0),
          smile: clampNumber(trackingSignals.smile, -1, 1, 0),
          blink: clampNumber(trackingSignals.blink, 0, 1, 0),
        }
      : null
    const trackingExpressionBlend = trackingExpression ? trackingBlend * 0.72 : 0

    const baseYaw = clampNumber(base.posture.head_yaw, -1, 1, 0)
    const basePitch = clampNumber(base.posture.head_pitch, -1, 1, 0)
    const baseRoll = clampNumber(base.posture.head_roll, -1, 1, 0)
    const trackYaw = clampNumber(trackingPose?.head_yaw ?? 0, -1, 1, 0)
    const trackPitch = clampNumber(trackingPose?.head_pitch ?? 0, -1, 1, 0)
    const trackRoll = clampNumber(trackingPose?.head_roll ?? 0, -1, 1, 0)

    return {
      expression: {
        mouth_open: clampNumber(
          Math.max(
            base.expression.mouth_open,
            trackingExpression
              ? lerpNumber(
                  base.expression.mouth_open,
                  trackingExpression.mouth_open,
                  trackingExpressionBlend
                )
              : 0
          ),
          0,
          1,
          0
        ),
        smile: clampNumber(
          lerpNumber(
            base.expression.smile,
            trackingExpression ? trackingExpression.smile : 0,
            trackingExpressionBlend
          ),
          -1,
          1,
          0
        ),
        blink: clampNumber(
          Math.max(
            base.expression.blink,
            trackingExpression
              ? lerpNumber(base.expression.blink, trackingExpression.blink, trackingExpressionBlend)
              : 0
          ),
          0,
          1,
          0
        ),
      },
      posture: {
        head_yaw: lerpNumber(baseYaw, trackYaw, trackingBlend),
        head_pitch: lerpNumber(basePitch, trackPitch, trackingBlend),
        head_roll: lerpNumber(baseRoll, trackRoll, trackingBlend),
      },
    }
  }

  const applyState = () => {
    const coreModel = model.value?.internalModel?.coreModel
    if (!coreModel) return

    const elapsed = (performance.now() - avatarState.value.startTime) / 1000.0
    const state = getBlendedState()
    const mouthOpen = clampNumber(state.expression.mouth_open, 0, 1, 0)
    const smile = clampNumber(state.expression.smile, -1, 1, 0)
    const blink = clampNumber(state.expression.blink, 0, 1, 0)
    const yaw = clampNumber(state.posture.head_yaw, -1, 1, 0)
    const pitch = clampNumber(state.posture.head_pitch, -1, 1, 0)
    const roll = clampNumber(state.posture.head_roll, -1, 1, 0)
    const breath = Math.sin(elapsed * 1.4) * 0.05

    setCoreParameter(coreModel, ['ParamAngleX', 'PARAM_ANGLE_X'], yaw * 18)
    setCoreParameter(coreModel, ['ParamAngleY', 'PARAM_ANGLE_Y'], pitch * 16)
    setCoreParameter(coreModel, ['ParamAngleZ', 'PARAM_ANGLE_Z'], roll * 10)
    setCoreParameter(coreModel, ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'], yaw * 8 + breath)
    setCoreParameter(coreModel, ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], 1 - blink)
    setCoreParameter(coreModel, ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], 1 - blink)
    setCoreParameter(coreModel, ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], mouthOpen)
    setCoreParameter(coreModel, ['ParamMouthForm', 'PARAM_MOUTH_FORM'], 0.5 + smile * 0.35)
  }

  const fitModel = (m: Live2DModel, a: Live2DApp, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    a.renderer.resize(width, height)

    const bounds = m.getLocalBounds()
    const naturalWidth = Math.max(1, bounds.width || m.width || 1)
    const naturalHeight = Math.max(1, bounds.height || m.height || 1)
    const fitScale = Math.min(width / naturalWidth, height / naturalHeight) * 0.92

    if (m.anchor) m.anchor.set(0.5, 0.98)
    if (m.position) m.position.set(width * 0.5, height * 0.985)
    if (m.scale) m.scale.set(fitScale)
    if (m.skew) m.skew.set(0, 0)

    if (m.parent !== a.stage) {
      a.stage.addChild(m)
    }
  }

  const loadModel = async (modelKey: Live2DModelKey) => {
    if (!canvasRef.value || !window.PIXI?.live2d?.Live2DModel) {
      throw new Error('Canvas or Live2D not ready')
    }

    const spec = LIVE2D_MODELS[modelKey]
    if (!spec) throw new Error(`Unknown model: ${modelKey}`)

    isLoaded.value = false
    error.value = undefined

    try {
      // Teardown old
      if (app.value) {
        app.value.destroy(true)
        app.value = undefined
      }
      model.value = undefined

      // Create app
      const PIXI = window.PIXI as any
      const newApp = new PIXI.Application({
        view: canvasRef.value,
        transparent: true,
        autoStart: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      }) as Live2DApp

      // Load model
      const newModel = await window.PIXI.live2d.Live2DModel.from(spec.url)

      fitModel(newModel, newApp, canvasRef.value)

      app.value = newApp
      model.value = newModel
      currentModelKey.value = modelKey
      isLoaded.value = true

      // Auto-update on state change
      const stopWatch = watch([avatarState, faceTrackingState], applyState, { deep: true })

      onUnmounted(() => {
        stopWatch()
      })

      // Fit on resize
      const resizeHandler = () => {
        if (canvasRef.value && newApp && newModel) {
          fitModel(newModel, newApp, canvasRef.value)
        }
      }
      window.addEventListener('resize', resizeHandler)

      onUnmounted(() => {
        window.removeEventListener('resize', resizeHandler)
      })
    } catch (err: any) {
      error.value = err.message || 'Failed to load Live2D model'
      console.error('Live2D load error:', err)
      throw err
    }
  }

  onMounted(async () => {
    try {
      await ensureDependencies()
      await nextTick()
      if (!canvasRef.value) {
        throw new Error('Canvas not mounted')
      }
      await loadModel(currentModelKey.value)
    } catch (err: any) {
      error.value = err.message || 'Failed to initialize Live2D'
      console.error('Live2D init error:', err)
    }
  })

  onUnmounted(() => {
    if (app.value) {
      app.value.destroy(true)
    }
  })

  const switchModel = async (modelKey: Live2DModelKey) => {
    await loadModel(modelKey)
  }

  return {
    isLoaded,
    currentModelKey: readonly(currentModelKey),
    error: readonly(error),
    switchModel,
  }
}
