#!/usr/bin/env bash
# ============================================================
# UE5 Pixel Streaming 环境设置脚本
# ============================================================
# 此脚本用于设置 Pixel Streaming 信令服务器。
# UE5 端需要在安装了 Unreal Engine 5.4+ 的机器上手动编译和运行项目。
#
# 使用方法：
#   1. 克隆 Pixel Streaming 基础设施:
#      git clone https://github.com/EpicGames/PixelStreamingInfrastructure.git
#   2. 安装信令服务器:
#      cd PixelStreamingInfrastructure/SignallingWebServer
#      npm install
#   3. 启动信令服务器:
#      node app.js
#   4. 启动 Python 后端:
#      cd backend && uv sync && uv run uvicorn qdh_backend.main:app
#   5. 在 UE5 编辑器中打开项目并点击 "Play" (或打包运行)
#   6. 浏览器访问 http://localhost:8888 查看 UE5 流
#
# 命令行启动 UE5 (无头渲染):
#   <UE5_ENGINE>/Engine/Binaries/Linux/UnrealEditor \\
#       /path/to/QwenDigitalHuman.uproject \\
#       -RenderOffscreen \\
#       -ResX=1280 -ResY=720 \\
#       -PixelStreamingIP=127.0.0.1 \\
#       -PixelStreamingPort=8888
#
# 依赖:
#   - Node.js >= 18 (信令服务器)
#   - Python >= 3.11 (FastAPI 后端)
#   - edge-tts (pip install edge-tts)
#   - 可选: Unreal Engine 5.4+ (仅需在一台机器上安装)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo " QDH UE5 MetaHuman - Pixel Streaming Setup"
echo "============================================"
echo ""
echo "项目路径: $PROJECT_ROOT"

# --- 检查 Python 后端 ---
echo ""
echo "[1/4] 检查 Python 环境..."
if command -v uv &>/dev/null; then
    echo "  ✓ uv found"
    echo "  正在同步依赖..."
    cd "$PROJECT_ROOT/backend"
    uv sync --extra dev
else
    echo "  ⚠ uv not found — 使用纯 Python 环境"
    echo "  请手动安装依赖: pip install -r requirements.txt"
fi

# --- 检查 edge-tts ---
echo ""
echo "[2/4] 检查 edge-tts..."
if python3 -c "import edge_tts" 2>/dev/null; then
    echo "  ✓ edge-tts 已安装"
else
    echo "  installing edge-tts..."
    pip install edge-tts
fi

# --- 检查 Node.js (信令服务器) ---
echo ""
echo "[3/4] 检查 Pixel Streaming 信令服务器..."
if command -v node &>/dev/null; then
    echo "  ✓ Node.js $(node --version)"
    PS_DIR="$HOME/PixelStreamingInfrastructure"
    if [ -d "$PS_DIR/SignallingWebServer" ]; then
        echo "  ✓ Pixel Streaming 基础设施已找到: $PS_DIR"
    else
        echo "  ⚠ Pixel Streaming 基础设施未找到"
        echo "  → 请手动克隆:"
        echo "    git clone https://github.com/EpicGames/PixelStreamingInfrastructure.git"
        echo "    cd PixelStreamingInfrastructure/SignallingWebServer"
        echo "    npm install"
    fi
else
    echo "  ⚠ Node.js 未安装。Pixel Streaming 信令服务器需要 Node.js >= 18"
fi

# --- 启动摘要 ---
echo ""
echo "[4/4] 启动指南"
echo "============================================"
echo ""
echo "启动顺序:"
echo ""
echo "  1. 启动 Ollama LLM 服务:"
echo "     ollama serve"
echo ""
echo "  2. 启动 Pixel Streaming 信令服务器 (另一终端):"
echo "     cd ~/PixelStreamingInfrastructure/SignallingWebServer"
echo "     node app.js"
echo ""
echo "  3. 启动 Python 后端 (另一终端):"
echo "     cd $PROJECT_ROOT/backend"
echo "     uv run uvicorn qdh_backend.main:app --host 127.0.0.1 --port 3000"
echo ""
echo "  4. 启动 UE5 (在有 UE5 的机器上):"
echo "     <UE5_ENGINE>/Engine/Binaries/Linux/UnrealEditor"
echo "         $PROJECT_ROOT/ue5-digital-human/QwenDigitalHuman.uproject"
echo "         -RenderOffscreen -ResX=1280 -ResY=720"
echo ""
echo "  5. 打开浏览器:"
echo "     → 主界面: http://localhost:3000"
echo "     → UE5 流:  http://localhost:8888"
echo ""
echo "============================================"