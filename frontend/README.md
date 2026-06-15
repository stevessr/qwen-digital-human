# Qwen Digital Human - Vue3 Frontend

前端 Vue3 + TypeScript + Ant Design Vue + Vite 实现。数字人形象通过已有在线 GLB 3D 模型渲染，并叠加口型能量、表情状态、动作状态与 OpenCV 姿态驱动。

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（确保 Python 后端在 http://127.0.0.1:3000 运行）
npm run dev

# 类型检查
npm run type-check

# 构建生产版本
npm run build
```

## 项目结构

```
frontend/
├── src/
│   ├── components/      # Vue 组件
│   │   ├── Avatar/      # 在线 3D 数字人
│   │   ├── Chat/        # 聊天面板
│   │   ├── Map/         # 地图讲解
│   │   └── ...
│   ├── composables/     # Composition API 逻辑
│   ├── stores/          # Pinia 状态管理
│   ├── types/           # TypeScript 类型定义
│   └── api/             # API 调用封装
├── public/
│   └── vendor/          # OpenCV.js 与级联文件
└── vite.config.ts
```

## 技术栈

- **Vue 3.5** - Composition API + `<script setup>`
- **TypeScript 5** - 严格类型检查
- **Vite 6** - 快速构建工具
- **Ant Design Vue 4** - UI 组件库
- **Pinia** - 状态管理
- **VueUse** - Composition 工具集
- **model-viewer** - 通过 Web Component 渲染在线 GLB 3D 模型

## 功能模块

### 1. 在线 3D 数字人
- 通过已有在线 GLB 模型渲染数字人形象
- 支持地图讲解员、专业导览员、元气助手三种形象
- 支持口型能量、表情状态、动作状态与拖拽定位
- 支持 OpenCV 面部追踪驱动头部姿态

### 2. Face Tracking (OpenCV.js)
- 实时面部追踪
- 眼部锚点计算
- 校准系统
- 姿态混合

### 3. 地图讲解
- 地图搜索
- 地点展示
- 上下文管理

### 4. 聊天系统
- 流式响应处理
- TTS 播放
- 消息历史

### 5. 语音输入 (ASR)
- 按住说话
- WebSocket 实时转写
- 浏览器 ASR 模式

## 配置代理

Vite 开发服务器自动代理以下路径到后端：
- `/api/*` → `http://127.0.0.1:3000`

OpenCV 静态资源由 Vite `public/vendor/` 直接提供；在线 3D 模型由 `<model-viewer>` 从公开 GLB URL 加载。
