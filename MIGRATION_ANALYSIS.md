# 前端迁移到 Vue3 + Ant Design + TypeScript 分析

## 当前架构评估 (Vanilla JS)

### 文件结构
- `static/index.html` - 主页面 (229 行)
- `static/main.js` - 核心逻辑 (4959 行)
- `static/config.html` + `static/config.js` - 配置页面
- `static/models.html` - 模型管理页面
- `static/vendor/` - 第三方库 (PIXI.js, Live2D, OpenCV.js)
- `static/live2d_models/` - Live2D 模型资源

### 核心功能模块 (约 120 个函数/变量)

#### 1. **Avatar 系统** (Live2D + WebGPU)
- Live2D 模型加载和渲染 (PIXI.js)
- 表情控制 (mouth_open, smile, blink)
- 姿态控制 (head_pitch, head_yaw, head_roll)
- 模型切换 (Shizuku, Haru 01, Haru 02)
- 意图识别 (从文本提取表情/动作指令)
- 拖拽定位和持久化
- 波形可视化叠加层

#### 2. **Face Tracking** (OpenCV.js)
- 摄像头实时面部追踪
- Haar Cascade 级联检测器 (face, eyes, mouth, smile)
- 眼部锚点计算和平滑
- 校准系统 (calibration)
- 镜像模式
- 姿态估算和混合 (blend)
- Canvas 叠加层绘制

#### 3. **地图讲解面板**
- 地图搜索 (高德地图 API)
- 地点结果展示
- 上下文写入
- iframe 地图嵌入

#### 4. **聊天系统**
- 消息历史渲染
- 流式响应处理 (`readStreamingResponse`)
- Server-Sent Events (SSE) 解析
- 文本消息发送
- TTS 播放 (云端 + 浏览器 TTS)
- 实时 PCM 音频流播放 (AudioWorklet)

#### 5. **语音输入 (ASR)**
- 按住说话 (push-to-talk)
- MediaRecorder API
- WebSocket 实时 ASR
- 音频重采样 (16kHz PCM)
- 浏览器 ASR 模式切换

#### 6. **Prompt 配置**
- System Prompt / Memory / Context
- RAG 上下文开关
- Rerank 参数调整
- TTS 模式切换
- localStorage 持久化

#### 7. **Model Manager**
- 模型列表和状态
- 下载进度显示
- SHA256 校验

### 技术依赖

#### 浏览器 API
- **Canvas API** - WebGPU fallback, 波形绘制，OpenCV 处理
- **WebGPU** - (当前未使用，准备用于 SDF 渲染)
- **Audio API** - AudioContext, AudioWorklet, Audio 元素
- **MediaRecorder** - 录音
- **WebSocket** - 实时 ASR
- **Fetch + SSE** - 流式响应
- **localStorage** - 状态持久化
- **SpeechSynthesis** - 浏览器 TTS
- **MediaDevices** - 摄像头访问

#### 第三方库
- **PIXI.js** - 2D 渲染引擎
- **pixi-live2d-display-cubism2** - Live2D Cubism 2 插件
- **live2d.min.js** - Live2D SDK
- **OpenCV.js** - 计算机视觉 (Wasm)

### 状态管理模式
- 全局 `avatarState` 对象
- 各子系统独立运行时对象 (`faceTrackingRuntime`, `asrContext`, etc.)
- DOM 直接操作 (`getElementById`, `textContent`)
- 事件监听器 (`addEventListener`)

### 挑战点

1. **Live2D 集成复杂度高**
   - PIXI.js 应用生命周期
   - 模型资源加载和缓存
   - 参数映射和动画系统

2. **OpenCV.js 集成**
   - Wasm 模块加载
   - Cascade 文件管理
   - 性能密集型处理循环

3. **实时音频处理**
   - AudioWorklet 线程通信
   - PCM 流解码和重采样
   - 音频上下文状态管理

4. **流式响应处理**
   - SSE 解析器
   - 分块 JSON 处理
   - 音频数据流同步

5. **跨标签页通信**
   - BroadcastChannel (face tracking control)

---

## Vue3 迁移架构设计

### 技术栈
- **Vue 3.5+** (Composition API + `<script setup>`)
- **TypeScript 5.x**
- **Vite 6.x**
- **Ant Design Vue 4.x**
- **Pinia** - 状态管理
- **VueUse** - Composition 工具集

### 项目结构
```
frontend/
├── src/
│   ├── main.ts                 # 入口
│   ├── App.vue                 # 根组件
│   ├── components/
│   │   ├── Avatar/
│   │   │   ├── Live2DCanvas.vue      # Live2D 渲染
│   │   │   ├── WaveformOverlay.vue   # 波形叠加
│   │   │   ├── AvatarControls.vue    # 表情按钮
│   │   │   └── useLive2D.ts          # Composition API
│   │   ├── FaceTracking/
│   │   │   ├── FaceTrackingPanel.vue
│   │   │   ├── CameraPreview.vue
│   │   │   └── useFaceTracking.ts    # OpenCV 集成
│   │   ├── Chat/
│   │   │   ├── ChatPanel.vue
│   │   │   ├── MessageList.vue
│   │   │   ├── ChatInput.vue
│   │   │   └── StreamIndicator.vue
│   │   ├── Map/
│   │   │   ├── MapPanel.vue
│   │   │   ├── MapSearch.vue
│   │   │   └── MapResults.vue
│   │   ├── ASR/
│   │   │   ├── AsrLivePanel.vue
│   │   │   └── VoiceButton.vue
│   │   └── Config/
│   │       ├── PromptConfig.vue
│   │       └── ModelManager.vue
│   ├── stores/
│   │   ├── avatar.ts           # Avatar 状态
│   │   ├── chat.ts             # 聊天历史
│   │   ├── config.ts           # 用户配置
│   │   ├── faceTracking.ts    # 追踪状态
│   │   └── map.ts              # 地图上下文
│   ├── composables/
│   │   ├── useAudioPlayer.ts  # 音频播放
│   │   ├── useAudioRecorder.ts # 录音
│   │   ├── useWebSocket.ts    # WebSocket 连接
│   │   └── useStreamingFetch.ts # SSE 解析
│   ├── api/
│   │   ├── chat.ts
│   │   ├── tts.ts
│   │   ├── asr.ts
│   │   └── models.ts
│   ├── types/
│   │   ├── avatar.ts
│   │   ├── chat.ts
│   │   └── api.ts
│   ├── utils/
│   │   ├── audio.ts           # 音频处理工具
│   │   ├── intent.ts          # 意图识别
│   │   └── storage.ts         # localStorage 封装
│   └── assets/
│       └── styles/
│           └── main.css
├── public/
│   ├── vendor/                # 保留第三方库
│   └── live2d_models/         # 保留 Live2D 资源
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 组件设计

#### 1. Live2DCanvas.vue
```vue
<script setup lang="ts">
import { useLive2D } from './useLive2D'
import { useAvatarStore } from '@/stores/avatar'

const avatarStore = useAvatarStore()
const canvasRef = ref<HTMLCanvasElement>()

const { 
  isLoaded, 
  currentModel, 
  switchModel, 
  triggerExpression,
  triggerMotion 
} = useLive2D(canvasRef, avatarStore.state)
</script>

<template>
  <div class="avatar-stage" :class="{ dragging }">
    <canvas ref="canvasRef" />
    <WaveformOverlay :waveform="avatarStore.waveform" />
  </div>
</template>
```

#### 2. ChatPanel.vue
```vue
<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import { useStreamingChat } from '@/composables/useStreamingChat'
import { message as AMessage } from 'ant-design-vue'

const chatStore = useChatStore()
const { sendMessage, isStreaming } = useStreamingChat()

const handleSend = async (text: string) => {
  await sendMessage(text, {
    onDelta: (delta) => chatStore.appendDelta(delta),
    onAudio: (chunk) => audioPlayer.enqueue(chunk),
    onError: (err) => AMessage.error(err.message)
  })
}
</script>

<template>
  <a-layout-sider width="420" theme="dark">
    <MessageList :messages="chatStore.messages" />
    <StreamIndicator v-if="isStreaming" />
    <ChatInput @send="handleSend" />
  </a-layout-sider>
</template>
```

### 状态管理 (Pinia)

#### avatar.ts
```typescript
export const useAvatarStore = defineStore('avatar', () => {
  const expression = reactive({
    mouth_open: 0,
    smile: 0,
    blink: 0
  })
  
  const posture = reactive({
    head_pitch: 0,
    head_yaw: 0,
    head_roll: 0
  })
  
  const waveform = ref<Float32Array>(new Float32Array(128))
  
  const updateExpression = (partial: Partial<typeof expression>) => {
    Object.assign(expression, partial)
  }
  
  return { expression, posture, waveform, updateExpression }
})
```

### Composables

#### useLive2D.ts
```typescript
export function useLive2D(
  canvasRef: Ref<HTMLCanvasElement | undefined>,
  avatarState: AvatarState
) {
  const app = shallowRef<PIXI.Application>()
  const model = shallowRef<Live2DModel>()
  const isLoaded = ref(false)
  
  const loadModel = async (modelKey: string) => {
    // 保持原有逻辑，但使用 Vue 响应式系统
  }
  
  const applyState = () => {
    // 从 avatarState 更新 Live2D 参数
  }
  
  watchEffect(() => {
    if (model.value) {
      applyState()
    }
  })
  
  onMounted(async () => {
    await ensureLive2DDependencies()
    await loadModel('shizuku')
  })
  
  onUnmounted(() => {
    app.value?.destroy()
  })
  
  return { isLoaded, model, loadModel, triggerExpression }
}
```

### 迁移步骤

#### Phase 1: 基础搭建
1. ✅ 创建 Vite + Vue3 + TS 项目
2. ✅ 配置 Ant Design Vue
3. ✅ 配置 Pinia 和 VueUse
4. ✅ 设置 TypeScript 严格模式
5. ✅ 配置 Vite 代理到 Rust 后端 (http://127.0.0.1:3000)

#### Phase 2: 核心组件迁移
1. 迁移 Live2D 渲染 → Live2DCanvas.vue
2. 迁移 Face Tracking → FaceTrackingPanel.vue
3. 迁移聊天系统 → ChatPanel.vue
4. 迁移地图面板 → MapPanel.vue
5. 迁移 ASR → AsrLivePanel.vue

#### Phase 3: 状态和 API 集成
1. 实现 Pinia stores
2. 封装 API 调用 (fetch + SSE)
3. WebSocket ASR 连接
4. 音频播放器 (AudioWorklet)

#### Phase 4: 优化和测试
1. 性能优化 (虚拟滚动，懒加载)
2. 错误处理和边界情况
3. 响应式布局适配
4. 浏览器兼容性测试

### 保留原生 JS 的部分
- OpenCV.js 加载和初始化 (Wasm)
- PIXI.js + Live2D SDK (canvas 渲染)
- AudioWorklet 处理器脚本
- 第三方库加载逻辑

### 使用 Ant Design 组件
- `a-layout` - 整体布局
- `a-input` / `a-textarea` - 输入框
- `a-button` - 按钮
- `a-card` - 面板容器
- `a-list` - 消息列表
- `a-badge` - 状态指示
- `a-tag` - 标签
- `a-switch` - 开关
- `a-slider` - 滑块 (gain, smooth)
- `a-collapse` - 折叠面板 (prompt config)
- `a-modal` - 模态框
- `a-message` - 提示消息
- `a-spin` - 加载指示器
- `a-progress` - 进度条 (模型下载)

---

## 迁移优势

1. **类型安全**: TypeScript 类型检查，减少运行时错误
2. **组件化**: 逻辑隔离，易于测试和维护
3. **响应式**: Vue 自动追踪依赖，简化状态同步
4. **开发体验**: HMR 热更新，Vite 快速构建
5. **UI 一致性**: Ant Design 统一设计语言
6. **代码复用**: Composables 抽象公共逻辑

## 迁移风险

1. **Live2D 集成复杂**: PIXI.js 生命周期需要仔细处理
2. **OpenCV 性能**: 追踪循环需要避免触发 Vue 不必要的响应
3. **音频实时性**: AudioWorklet 和 Vue 解耦
4. **兼容性**: 确保 WebGPU/AudioWorklet 优雅降级
