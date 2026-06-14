import type { PromptSettings } from '@/types/chat'

export const DEFAULT_SYSTEM_PROMPT = '你是地图数字人讲解员，专注介绍地点、地标、路线、周边设施和到达方式。请优先用中文回答，语气自然、清晰、简洁；如果上下文提供了地图信息，请优先围绕当前地点讲解。'
export const LEGACY_SYSTEM_PROMPT = '你是 Qwen Digital Human，一个简洁、友好、会结合上下文回答的数字人助手。请优先用中文回答，除非用户明确要求其他语言。'
export const DEFAULT_MEMORY = '你是地图讲解型数字人。回答时优先说明地点位置、周边地标、交通方式、适合人群与游览建议，并保持解释简洁自然。'
export const DEFAULT_RERANK_INSTRUCTION = 'Given a web search query, retrieve relevant passages that answer the query'

export const CHAT_SETTINGS_STORAGE_KEY = 'qdh.chatSettings'

export const PROMPT_STORAGE_KEYS = {
  systemPrompt: 'qdh.systemPrompt',
  memory: 'qdh.memory',
  context: 'qdh.context',
  useRagContext: 'qdh.useRagContext',
  ttsMode: 'qdh.ttsMode',
  browserAsrMode: 'qdh.browserAsrMode',
  browserTtsMode: 'qdh.browserTtsMode',
  collapseThink: 'qdh.collapseThink',
  rerankCandidatePool: 'qdh.rerankCandidatePool',
  rerankSimilarityThreshold: 'qdh.rerankSimilarityThreshold',
  rerankTopK: 'qdh.rerankTopK',
  rerankInstruction: 'qdh.rerankInstruction',
} as const

export const OPENCV_STORAGE_KEYS = {
  enabled: 'qdh.opencv.enabled',
  autoStart: 'qdh.opencv.autoStart',
  mirror: 'qdh.opencv.mirror',
  smooth: 'qdh.opencv.smooth',
  yawGain: 'qdh.opencv.yawGain',
  pitchGain: 'qdh.opencv.pitchGain',
  blend: 'qdh.opencv.blend',
  calibration: 'qdh.opencv.calibration',
} as const

export const LEGACY_OPENCV_STORAGE_KEYS = {
  enabled: 'qdh.faceTracking.enabled',
  autoStart: 'qdh.faceTracking.autoStart',
  mirror: 'qdh.faceTracking.mirror',
  smooth: 'qdh.faceTracking.smooth',
  yawGain: 'qdh.faceTracking.yawGain',
  pitchGain: 'qdh.faceTracking.pitchGain',
  blend: 'qdh.faceTracking.blend',
  calibration: 'qdh.faceTracking.calibration',
} as const

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  memory: DEFAULT_MEMORY,
  context: '',
  use_rag_context: true,
  tts_enabled: true,
  browser_tts_enabled: true,
  browser_asr_mode: true,
  collapse_think: true,
  rerank: {
    candidate_pool: 8,
    similarity_threshold: 0.3,
    top_k: 3,
    instruction: DEFAULT_RERANK_INSTRUCTION,
  },
}

export const DEFAULT_OPENCV_SETTINGS = {
  enabled: false,
  autoStart: true,
  mirror: true,
  smooth: 0.72,
  yawGain: 1.8,
  pitchGain: 1.6,
  blend: 0.85,
} as const

export const OPENCV_CONTROL_CHANNEL_NAME = 'qdh-opencv-control'

export interface MapBounds {
  south: number
  north: number
  west: number
  east: number
}

export interface MapPlace {
  place_id?: number | null
  osm_type?: string | null
  osm_id?: number | null
  display_name: string
  lat: number
  lon: number
  bounds: MapBounds
  category?: string | null
  kind?: string | null
  importance?: number | null
  map_url?: string
  summary?: string
}

export const DEFAULT_MAP_PLACE: MapPlace = {
  display_name: '北京天安门广场（默认讲解中心）',
  lat: 39.9087,
  lon: 116.3975,
  bounds: { south: 39.8937, north: 39.9237, west: 116.3775, east: 116.4175 },
  category: 'tourist_attraction',
  kind: 'default',
  importance: 1.0,
  map_url: 'https://www.openstreetmap.org/export/embed.html?bbox=116.3775%2C39.8937%2C116.4175%2C39.9237&layer=mapnik&marker=39.9087%2C116.3975',
  summary: '北京天安门广场（默认讲解中心）\n坐标：39.908700, 116.397500\n类型：default',
}

export const MAP_CONTEXT_MARKER = '【地图讲解上下文】'

export interface RuntimeResourceAction {
  label: string
  path?: string
}

export interface RuntimeResource {
  key: string
  title: string
  description: string
  badge?: string
  actions: RuntimeResourceAction[]
}

export const RUNTIME_RESOURCES: RuntimeResource[] = [
  {
    key: 'browser-asr',
    title: '浏览器 ASR',
    description: '语音识别由浏览器 SpeechRecognition / webkitSpeechRecognition 提供；后端不再下载、预热或加载 ASR 模型。',
    badge: '浏览器提供',
    actions: [],
  },
  {
    key: 'browser-tts',
    title: '浏览器 TTS',
    description: '语音合成由浏览器 SpeechSynthesis 提供；后端不再下载、预热或加载 TTS 模型。',
    badge: '浏览器提供',
    actions: [],
  },
  {
    key: 'digital-human-avatar',
    title: '程序化数字人形象',
    description: '前端使用 CSS/SVG/DOM 程序化渲染数字人头像、表情、眨眼、口型和头部姿态，不再依赖外部头像模型运行时。',
    badge: '无模型运行时',
    actions: [],
  },
  {
    key: 'opencv-assets',
    title: 'OpenCV 面部追踪',
    description: '前端面部追踪依赖本地内置资源：opencv.js、人脸、眼睛、嘴部与微笑级联文件。',
    actions: [
      { label: 'opencv.js', path: '/vendor/opencv.js' },
      { label: '人脸级联', path: '/vendor/haarcascade_frontalface_default.xml' },
      { label: '眼睛级联', path: '/vendor/haarcascade_eye.xml' },
      { label: '眼镜眼睛级联', path: '/vendor/haarcascade_eye_tree_eyeglasses.xml' },
      { label: '嘴部级联', path: '/vendor/haarcascade_mcs_mouth.xml' },
      { label: '微笑级联', path: '/vendor/haarcascade_smile.xml' },
    ],
  },
]
