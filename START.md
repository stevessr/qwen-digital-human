# 🚀 Qwen Digital Human - 快速开始

## 项目结构

```
qwen-digital-human/
├── src/          # Rust 后端 (Axum)
├── frontend/     # Vue3 前端 (新)
├── static/       # 原前端 (旧，已迁移)
├── models/       # AI 模型文件
└── Cargo.toml    # Rust 配置
```

## 启动步骤

### 1. 启动后端服务器

```bash
# 设置环境变量 (可选，用于云端 TTS)
export DASHSCOPE_API_KEY="your_key_here"

# 启动 Rust 服务器
cargo run
```

后端将运行在: **http://127.0.0.1:3000**

### 2. 启动前端开发服务器

```bash
# 进入前端目录
cd frontend

# 安装依赖 (首次运行)
pnpm install  # 或 npm install

# 启动开发服务器
pnpm dev  # 或 npm run dev
```

前端将运行在: **http://localhost:5173**

### 3. 访问应用

打开浏览器访问: **http://localhost:5173**

## 功能验证清单

### ✅ 基础功能
- [ ] 页面加载无报错
- [ ] Live2D 模型显示 (Shizuku)
- [ ] 数字人可拖拽
- [ ] 聊天输入框可用

### ✅ 聊天功能
- [ ] 发送消息 (需要后端运行)
- [ ] 流式响应显示
- [ ] TTS 播放 (云端或浏览器)
- [ ] 消息历史记录

### ⏳ 待实现功能
- [ ] ASR 录音 (按住说话按钮)
- [ ] 地图搜索
- [ ] 表情按钮触发
- [ ] 模型切换按钮
- [ ] OpenCV 面部追踪

## 开发命令

```bash
# 前端开发服务器
cd frontend && pnpm dev

# 前端生产构建
cd frontend && pnpm build

# 前端类型检查
cd frontend && pnpm type-check

# 后端开发 (自动重载)
cargo watch -x run

# 后端发布构建
cargo build --release
```

## 常见问题

### Q: 前端无法连接后端？
A: 确保后端运行在 `http://127.0.0.1:3000`，Vite 会自动代理 `/api`, `/vendor`, `/live2d_models`

### Q: Live2D 模型无法加载？
A: 检查 `static/vendor/` 和 `static/live2d_models/` 目录是否存在

### Q: npm install 失败？
A: 尝试使用国内镜像: `npm config set registry https://registry.npmmirror.com`

### Q: TypeScript 报错？
A: 运行 `pnpm dev` 后会自动生成类型文件 `src/auto-imports.d.ts`

## 文档

- **FINAL_SUMMARY.md** - 迁移完成总结
- **MIGRATION_ANALYSIS.md** - 架构分析
- **MIGRATION_PROGRESS.md** - 详细进度
- **frontend/README.md** - 前端文档

## 技术栈

**后端**: Rust + Axum + llama-cpp-2 + Sherpa  
**前端**: Vue 3 + TypeScript + Vite + Ant Design Vue + Pinia  
**Live2D**: PIXI.js + Live2D Cubism 2  
**音频**: AudioWorklet + PCM Streaming

---

**祝开发愉快！** 🎉
