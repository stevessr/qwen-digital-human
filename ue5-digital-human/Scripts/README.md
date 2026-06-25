# Qwen Digital Human — UE5 MetaHuman 集成

本目录包含 Unreal Engine 5 (UE5) 项目模板，用于驱动高保真 MetaHuman 数字人，通过 Pixel Streaming 将渲染画面嵌入到浏览器中。

## 架构

```
UE5 MetaHuman  ←──  WebSocket (3322)  ←──  Python FastAPI 后端
     │
     └── Pixel Streaming (WebRTC)  ──→  浏览器 (WebRTC 播放器)
```

**UE5 端职责：**
- 通过 WebSocket 连接 Python 后端 `/api/ws/ue5`
- 接收 PCM 音频流并播放
- 接收 viseme/expression 消息驱动 MetaHuman 口型
- 将渲染画面通过 Pixel Streaming 推送至浏览器

**Python 后端职责：**
- LLM 对话生成回复
- edge-tts 合成语音
- 音频分析 → viseme 序列提取
- 统一通过 WebSocket 发送给 UE5

## 项目结构

```
ue5-digital-human/
├── QwenDigitalHuman.uproject          # UE5 项目文件
├── Config/                            # 引擎/游戏配置 (Pixel Streaming 启用)
├── Plugins/
│   └── QdhMetaHumanBridge/            # 自定义 C++ 插件
│       ├── QdhMetaHumanBridge.uplugin
│       ├── Source/QdhMetaHumanBridge/
│       │   ├── QdhWebSocketClient.h/cpp   # WebSocket 客户端 (自动重连)
│       │   ├── QdhAudioPlayer.h/cpp       # PCM 音频播放器
│       │   ├── QdhLipSyncDriver.h/cpp     # viseme 口型驱动
│       │   ├── QdhMetaHumanController.h/cpp  # 主控制器
│       │   └── QdhMetaHumanGameMode.h     # GameMode
│       └── Resources/Icon128.png
├── Content/QdhDigitalHuman/           # 蓝图 (参考文档)
└── Source/                            # 游戏模块入口
```

## 前置条件

| 组件 | 版本要求 | 安装方式 |
|------|---------|---------|
| Unreal Engine | 5.4+ | Epic Games Launcher 或源码编译 |
| Python | 3.11+ | 系统包管理器 |
| Node.js | 18+ | Pixel Streaming 信令服务器 |
| edge-tts | 6+ | `pip install edge-tts` |

## 使用步骤

### 1. 设置 Pixel Streaming 信令服务器

```bash
git clone https://github.com/EpicGames/PixelStreamingInfrastructure.git
cd PixelStreamingInfrastructure/SignallingWebServer
npm install
node app.js
```

信令服务器将在 `http://localhost:8888` 启动。

### 2. 启动 Python 后端

```bash
cd backend
uv sync
uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000
```

### 3. 在 UE5 中打开项目

1. 将 `ue5-digital-human` 目录复制到安装了 UE5 的机器上
2. 右键 `QwenDigitalHuman.uproject` → **Generate Visual Studio project files**
3. 编译 C++ 插件 (Ctrl+Shift+F5 编译项目)
4. 打开 `QwenDigitalHuman.uproject`
5. 在 Content Browser 中创建 `BP_QdhMetaHumanController` 蓝图，继承自 `AQdhMetaHumanController`
6. 创建 MetaHuman 角色蓝图，或使用示例 MetaHuman
7. 在关卡中将 `BP_QdhMetaHumanController` 的实例放置到场景中
8. 点击 **Play**

### 4. 启动前端

浏览器打开 `http://localhost:3000` (Python 后端静态服务)。

如果 UE5 和信令服务器正常运行，前端会自动切换到 Pixel Streaming 模式显示 UE5 画面。

> **提示：** 如果 UE5 不可用，前端会自动回退到原有的 `<model-viewer>` 在线 3D 模型。

## 通信协议

### WebSocket 地址

```
ws://127.0.0.1:3000/api/ws/ue5
```

### 消息格式

**Expression (JSON):**
```json
{
  "type": "expression",
  "data": {
    "mouth_open": 0.5, "jaw_open": 0.6,
    "lip_round": 0.1, "smile": 0.3,
    "head_yaw": 0.0, "head_pitch": 0.0,
    "blink": 0.1, "emotion": "neutral"
  }
}
```

**Viseme 序列 (JSON):**
```json
{
  "type": "viseme_sequence",
  "data": [
    {"viseme": "A", "start_ms": 0, "end_ms": 80,
     "mouth_open": 0.85, "jaw_open": 0.9,
     "lip_round": 0.0, "smile": 0.0, "blink": 0.0}
  ],
  "text": "你好",
  "duration_ms": 5000.0
}
```

**音频 (二进制):**
- 帧头: `[0xB2]` + sample_rate (uint32 LE) + pcm_length (uint32 LE)
- 帧体: PCM16LE mono 数据

**TTS 完成通知 (JSON):**
```json
{"type": "tts_complete", "text": "你好", "duration_ms": 5000.0}
```

### UE5 → 后端

UE5 可发送:
- `{"type": "pong"}` — 心跳响应
- `{"type": "ready"}` — 就绪通知
- `{"type": "log", "level": "info", "message": "..."}` — 日志
- `{"type": "error", "message": "..."}` — 错误

## 蓝图实现指南

参考 `Content/QdhDigitalHuman/BP_QdhMetaHumanController.md` 了解蓝图实现细节。
关键点：在 `OnExpressionUpdated` 蓝图中将 MouthOpen/JawOpen 等参数绑定到 MetaHuman 的 ControlRig 参数节点。