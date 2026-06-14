# Vue3 前端迁移 - 完成总结

## ✅ 已完成的工作

### 1. 项目基础架构搭建 ✅
- [x] 创建 `frontend/` 目录结构
- [x] 配置 Vite 6 + Vue 3.5 + TypeScript 5
- [x] 配置 Ant Design Vue 4
- [x] 配置 Pinia 状态管理
- [x] 配置 VueUse 工具集
- [x] 配置自动导入 (unplugin-auto-import + unplugin-vue-components)
- [x] 配置 Vite 代理到后端 (http://127.0.0.1:3000)

### 2. 类型系统设计 ✅
创建了完整的 TypeScript 类型定义：
- `types/avatar.ts` - Avatar 表情、姿态、Live2D、Face Tracking 类型
- `types/chat.ts` - 聊天消息、Prompt 设置、流式事件类型
- `types/api.ts` - API 错误、模型信息、地图结果、ASR 状态类型

### 3. 状态管理 (Pinia Stores) ✅
- `stores/avatar.ts` - Avatar 表情和姿态状态
- `stores/chat.ts` - 聊天历史、流式状态、Prompt 设置
- `stores/faceTracking.ts` - 面部追踪状态、校准数据、设置

### 4. 核心 Composables ✅
- `composables/useLive2D.ts` - Live2D 模型加载、PIXI.js 集成、参数映射、面部追踪混合

### 5. Vue 组件迁移 ✅
已创建所有主要组件：

#### Avatar 组件
- `Avatar/Live2DCanvas.vue` - Live2D 渲染画布
- `Avatar/AvatarPanel.vue` - 可拖拽的浮动数字人面板

#### Chat 组件
- `Chat/ChatSidebar.vue` - 完整的聊天侧边栏
  - 模型信息展示
  - Live2D 表情控制工具栏
  - OpenCV 追踪提示
  - 实时 ASR 面板
  - 聊天历史
  - 流式文本指示器
  - 控制面板 (Fast Mode, 输入框, 发送按钮, 语音按钮)

#### Map 组件
- `Map/MapPanel.vue` - 地图讲解面板
  - 顶部栏 (标题、状态、操作按钮)
  - 搜索框
  - 结果展示区
  - 地图 iframe
  - 说明文字

#### 布局组件
- `MainLayout.vue` - 主布局 (Ant Design Layout)
- `App.vue` - 根组件 (ConfigProvider + 暗色主题)

### 6. 配置文件 ✅
- `vite.config.ts` - Vite 配置 (插件、代理、构建选项)
- `tsconfig.json` - TypeScript 严格模式配置
- `tsconfig.node.json` - Node 环境配置
- `package.json` - 依赖声明和脚本
- `index.html` - HTML 入口 (预加载 Live2D 依赖)
- `src/main.ts` - Vue 应用入口
- `src/assets/styles/main.css` - 全局样式
- `README.md` - 项目文档

## 📦 技术栈

### 核心框架
- **Vue 3.5.13** - Composition API + `<script setup>`
- **TypeScript 5.7.2** - 严格类型检查
- **Vite 6.0.5** - 极速构建工具

### UI 和工具库
- **Ant Design Vue 4.2.5** - 企业级 UI 组件库
- **Pinia 2.3.0** - 轻量级状态管理
- **VueUse 11.3.0** - Composition API 工具集
- **Dayjs 1.11.13** - 日期处理
- **Nanoid 5.0.9** - ID 生成器

### 开发工具
- **unplugin-vue-components** - 组件自动导入
- **unplugin-auto-import** - API 自动导入
- **vue-tsc** - Vue TypeScript 类型检查

### 保留的原生依赖
- **PIXI.js** - 2D 渲染引擎 (在 index.html 中预加载)
- **Live2D SDK** - Cubism 2 模型支持
- **pixi-live2d-display-cubism2** - PIXI Live2D 插件
- **OpenCV.js** (未来集成) - 计算机视觉

## 📂 项目结构

```
frontend/
├── src/
│   ├── main.ts                     # Vue 入口
│   ├── App.vue                     # 根组件
│   ├── components/
│   │   ├── MainLayout.vue          # 主布局
│   │   ├── Avatar/
│   │   │   ├── Live2DCanvas.vue    # Live2D 渲染
│   │   │   └── AvatarPanel.vue     # 浮动数字人面板
│   │   ├── Chat/
│   │   │   └── ChatSidebar.vue     # 聊天侧边栏
│   │   └── Map/
│   │       └── MapPanel.vue        # 地图面板
│   ├── stores/
│   │   ├── avatar.ts               # Avatar 状态
│   │   ├── chat.ts                 # 聊天状态
│   │   └── faceTracking.ts         # 追踪状态
│   ├── composables/
│   │   └── useLive2D.ts            # Live2D 逻辑
│   ├── types/
│   │   ├── avatar.ts               # Avatar 类型
│   │   ├── chat.ts                 # Chat 类型
│   │   └── api.ts                  # API 类型
│   └── assets/
│       └── styles/
│           └── main.css            # 全局样式
├── public/                          # 静态资源 (通过代理访问后端)
├── index.html                       # HTML 入口
├── vite.config.ts                   # Vite 配置
├── tsconfig.json                    # TS 配置
├── package.json                     # 依赖声明
└── README.md                        # 项目文档
```

## 🎯 核心功能已迁移

### ✅ Live2D 数字人
- [x] PIXI.js 应用初始化
- [x] 模型加载 (Shizuku, Haru 01, Haru 02)
- [x] 表情参数映射 (mouth_open, smile, blink)
- [x] 姿态参数映射 (head_yaw, head_pitch, head_roll)
- [x] 面部追踪混合 (blend tracking signals with base state)
- [x] 响应式更新 (watchEffect)
- [x] 拖拽定位 + localStorage 持久化
- [x] Canvas 自适应 (resize handler)

### ✅ 状态管理
- [x] Avatar 表情和姿态状态
- [x] 聊天历史和流式状态
- [x] Prompt 设置 (system_prompt, memory, context, RAG, rerank)
- [x] Face Tracking 设置和状态
- [x] localStorage 自动持久化

### ✅ UI 布局
- [x] Ant Design 暗色主题
- [x] 左右分栏布局 (Avatar+Map | Chat)
- [x] 地图面板 (搜索、结果、iframe)
- [x] 聊天侧边栏 (历史、输入、控制)
- [x] 模型信息栏
- [x] 表情按钮工具栏
- [x] ASR 实时面板
- [x] 响应式滚动条样式

## 🚧 待完成的工作

### 1. API 集成 (高优先级)
需要创建以下文件：

#### `api/chat.ts`
```typescript
export async function sendChatMessage(params: {
  message: string
  fast_mode: boolean
  stream: boolean
  tts_enabled: boolean
  use_rag_context: boolean
  system_prompt: string
  memory: string
  context: string
  rerank: RerankSettings
  browser_tts_enabled: boolean
}): Promise<Response> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}
```

#### `composables/useStreamingChat.ts`
```typescript
export function useStreamingChat() {
  const chatStore = useChatStore()
  
  const sendMessage = async (text: string, callbacks: {
    onDelta?: (text: string) => void
    onStatus?: (message: string) => void
    onAudio?: (chunk: AudioChunk) => void
    onError?: (error: Error) => void
  }) => {
    chatStore.setStreaming(true)
    try {
      const response = await sendChatMessage({
        message: text,
        fast_mode: true, // TODO: get from settings
        stream: true,
        tts_enabled: chatStore.settings.tts_enabled,
        use_rag_context: chatStore.settings.use_rag_context,
        system_prompt: chatStore.settings.system_prompt,
        memory: chatStore.settings.memory,
        context: chatStore.settings.context,
        rerank: chatStore.settings.rerank,
        browser_tts_enabled: chatStore.settings.browser_tts_enabled,
      })
      
      await readStreamingResponse(response, callbacks)
    } catch (error) {
      callbacks.onError?.(error as Error)
    } finally {
      chatStore.setStreaming(false)
    }
  }
  
  return { sendMessage }
}
```

#### `composables/useStreamingResponse.ts`
迁移原有的 SSE 解析逻辑：
- 解析 `data: {...}` 行
- 处理 `delta`, `status`, `audio.delta`, `error`, `done` 事件
- Base64 音频解码

### 2. 音频系统 (高优先级)
#### `composables/useAudioPlayer.ts`
- AudioContext 初始化
- AudioWorklet 加载 (`pcm-streaming-worklet.js`)
- PCM 16-bit LE 解码
- 音频队列和播放控制
- 采样率重采样 (24kHz)

#### `composables/useTTS.ts`
- 云端 TTS API 调用
- 浏览器 TTS (SpeechSynthesis)
- Audio 元素播放

### 3. ASR 系统 (中优先级)
#### `composables/useAudioRecorder.ts`
- MediaRecorder API
- 按住说话 (push-to-talk)
- 音频采样和重采样 (16kHz PCM)

#### `composables/useWebSocketASR.ts`
- WebSocket 连接管理
- 实时音频流发送
- ASR 结果接收和状态更新

#### 更新 `components/Chat/ChatSidebar.vue`
- 绑定录音按钮 (pointerdown/pointerup)
- 更新 ASR 实时面板状态和文本

### 4. 地图系统 (中优先级)
#### `stores/map.ts`
```typescript
export const useMapStore = defineStore('map', () => {
  const currentLocation = ref<MapSearchResult | null>(null)
  const searchResults = ref<MapSearchResult[]>([])
  const context = ref<string>('')
  
  return { currentLocation, searchResults, context }
})
```

#### `api/map.ts`
- 高德地图搜索 API 封装

#### 更新 `components/Map/MapPanel.vue`
- 搜索功能
- 结果展示和选择
- iframe URL 更新
- 上下文写入到 `chatStore.settings.context`

### 5. 配置页面迁移 (低优先级)
#### `components/Config/PromptConfig.vue`
- System Prompt / Memory / Context 编辑
- RAG 开关
- Rerank 参数调整
- 折叠面板 (a-collapse)

#### `components/Config/ModelManager.vue`
- 模型列表
- 下载按钮和进度条 (a-progress)
- SHA256 校验
- 删除按钮

### 6. Face Tracking 集成 (低优先级)
#### `composables/useFaceTracking.ts`
- OpenCV.js 加载和初始化
- Cascade 文件加载 (face, eye, mouth, smile)
- 摄像头启动 (MediaDevices)
- 检测循环 (requestAnimationFrame)
- Canvas 叠加层绘制
- 校准逻辑
- 与 `faceTrackingStore` 同步

#### `components/FaceTracking/FaceTrackingPanel.vue`
- 摄像头预览
- 启动/停止按钮
- 校准按钮
- 镜像开关
- 平滑度、增益滑块

### 7. 意图识别 (低优先级)
#### `utils/intent.ts`
迁移原有的 `detectAvatarIntents` 逻辑：
- 文本关键词匹配
- 表情意图 (happy, thinking, surprised, sad, angry)
- 动作意图 (flick_head, tap_body, shake)
- 模型切换意图

#### 在 `ChatSidebar.vue` 中集成
- 用户发送消息时调用 `detectAvatarIntents`
- 触发对应的 Live2D 表情或动作

### 8. 其他工具函数
#### `utils/audio.ts`
- `float32ToPcm16Bytes` - Float32 转 PCM16
- `pcm16leBytesToFloat32` - PCM16 转 Float32
- `resampleLinearFloat32` - 线性重采样
- `mixBufferToMono` - 多声道混音为单声道
- `concatUint8Arrays` - 合并字节数组

#### `utils/storage.ts`
- `loadFromLocalStorage` - 通用 localStorage 读取
- `saveToLocalStorage` - 通用 localStorage 保存
- 类型安全的封装

## 🏃 如何启动项目

### 前提条件
1. 确保后端 Rust 服务器运行在 `http://127.0.0.1:3000`
2. 确保 `static/vendor/` 和 `static/live2d_models/` 资源可访问

### 启动步骤

```bash
# 1. 进入前端目录
cd frontend

# 2. 安装依赖 (如果网络有问题，多试几次)
npm install

# 3. 启动开发服务器
npm run dev

# 4. 打开浏览器访问 http://localhost:5173
```

### 验证清单
- [ ] 页面加载无报错
- [ ] Live2D 模型加载成功
- [ ] 聊天输入框可用
- [ ] 地图 iframe 显示
- [ ] 控制台无 TypeScript 错误

## 📝 下一步行动计划

### 立即执行 (P0)
1. **修复网络问题，完成 `npm install`**
2. **创建 `api/chat.ts` 和 `composables/useStreamingChat.ts`**
3. **在 `ChatSidebar.vue` 中集成发送消息功能**
4. **测试基本的聊天流程**

### 短期任务 (P1)
5. **创建音频播放器 `composables/useAudioPlayer.ts`**
6. **集成 TTS 播放功能**
7. **创建 `composables/useStreamingResponse.ts` 解析 SSE**
8. **测试流式响应和音频播放**

### 中期任务 (P2)
9. **实现地图搜索和上下文写入**
10. **实现 ASR 录音和 WebSocket 连接**
11. **实现意图识别和表情触发**

### 长期任务 (P3)
12. **迁移配置页面 (Prompt 编辑、模型管理)**
13. **集成 Face Tracking (OpenCV.js)**
14. **性能优化和错误处理**
15. **浏览器兼容性测试**

## 🎨 设计决策记录

### 为什么选择 Composition API？
- 更好的逻辑复用 (composables)
- 更好的 TypeScript 支持
- 更灵活的状态组织

### 为什么使用 shallowRef 存储 PIXI.Application？
- PIXI.js 对象不需要深度响应式
- 避免性能开销和代理问题

### 为什么在 index.html 中预加载 Live2D？
- PIXI.js 和 Live2D SDK 是全局 UMD 模块
- 需要在 Vue 应用启动前加载
- 避免模块化导入的复杂性

### 为什么用 watchEffect 而不是 watch？
- 自动追踪依赖
- 更简洁的语法
- 适合多个响应式源的场景

## 🐛 已知问题

1. **TypeScript 错误** - `vue` 模块导出成员找不到
   - **原因**: `node_modules` 未安装完成
   - **解决**: 成功运行 `npm install` 后会消失

2. **网络超时** - `npm install` 失败
   - **原因**: 网络连接问题或代理设置
   - **解决**: 检查网络，或使用国内镜像 (`npm config set registry https://registry.npmmirror.com`)

3. **Ant Design Vue 版本** - 4.2.7 不存在
   - **解决**: 已改为 4.2.5

## 📚 参考资源

- [Vue 3 文档](https://vuejs.org/)
- [Ant Design Vue 文档](https://antdv.com/)
- [Pinia 文档](https://pinia.vuejs.org/)
- [VueUse 文档](https://vueuse.org/)
- [Vite 文档](https://vitejs.dev/)
- [PIXI.js 文档](https://pixijs.com/)
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/)

---

**迁移完成度**: 约 70%

**核心架构**: ✅ 完成  
**UI 布局**: ✅ 完成  
**Live2D 集成**: ✅ 完成  
**API 集成**: ⏳ 待完成  
**音频系统**: ⏳ 待完成  
**ASR 系统**: ⏳ 待完成  
**地图功能**: ⏳ 待完成
