// Avatar expression and posture types
export interface AvatarExpression {
  mouth_open: number  // 0-1
  smile: number       // -1 to 1
  blink: number       // 0-1
}

export interface AvatarPosture {
  head_pitch: number  // -1 to 1
  head_yaw: number    // -1 to 1
  head_roll: number   // -1 to 1
}

export interface AvatarState {
  expression: AvatarExpression
  posture: AvatarPosture
  waveform: Float32Array
  startTime: number
}

// Live2D types
export type Live2DModelKey = 'shizuku' | 'haru01' | 'haru02'

export interface Live2DModelSpec {
  label: string
  url: string
}

export type Live2DExpressionName = 'happy' | 'thinking' | 'surprised' | 'sad' | 'angry'
export type Live2DMotionName = 'idle' | 'tap_body' | 'flick_head' | 'pinch_in' | 'shake' | 'pinch_out'

export interface AvatarIntent {
  kind: 'switch_model' | 'switch_model_cycle' | 'expression' | 'motion'
  label: string
  modelKey?: Live2DModelKey
  expression?: Live2DExpressionName
  motion?: Live2DMotionName
}

// Face tracking types
export interface FaceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FaceSignals {
  eye_open: number
  left_eye_open: number
  right_eye_open: number
  mouth_open: number
  smile: number
  blink: number
  roll: number
  confidence: number
}

export interface FaceCalibration {
  centerXRatio: number
  centerYRatio: number
  faceWidthRatio: number
  faceHeightRatio: number
  coordinateSpace: 'raw' | 'legacy-display'
  createdAt: number
}

export interface FaceTrackingState {
  enabled: boolean
  autoStart: boolean
  cameraActive: boolean
  calibrated: boolean
  active: boolean
  confidence: number
  pose: AvatarPosture
  calibration: FaceCalibration | null
  lastFace: any
  lastSeenAt: number
  signals: FaceSignals
  blend: number
  mirror: boolean
  smooth: number
  yawGain: number
  pitchGain: number
}
