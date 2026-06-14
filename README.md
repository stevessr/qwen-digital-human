# Qwen Digital Human (Rust + WebGPU)

A completely local, Rust-based Digital Human project integrating Qwen Large Language Models, text-to-speech, and RAG. 

**Features:**
- **Local vs Cloud:** Fast mode uses local infrastructure (like llama.cpp) targeting Qwen3.5-0.8B. Slow mode utilizes the DashScope API (Qwen-Max/Omni).
- **RAG Support:** In-memory document retrieval system built in Rust.
- **Model Context Protocol (MCP):** Basic server implementation allowing tools capabilities.
- **WebGPU Avatar:** UI leverages WebGPU to render a stylized 3D avatar that speaks.
- **100% Rust Backend:** Zero Python. Built with `axum` and `reqwest`.

## Setup & Running

1. **Prerequisites:**
   - Rust toolchain installed (`cargo`).
   - A WebGPU-capable browser (Chrome 113+ or Edge 113+).
   - *Optional:* DashScope API key for cloud LLM & TTS.

2. **Environment Variables:**
   ```bash
   export DASHSCOPE_API_KEY="your-api-key-here"
   ```

3. **Build and Run:**
   ```bash
   cargo run
   ```

4. **Access the UI:**
   Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser.

## Architecture
- `src/main.rs`: Axum web server and API routing.
- `src/llm.rs`: LLM engine routing logic between local inference and Cloud Qwen API.
- `src/rag.rs`: Retrieval Augmented Generation storage and search.
- `src/mcp.rs`: Model Context Protocol structures and handlers.
- `src/tts.rs`: Integration with DashScope Qwen TTS (sambert).
- `static/index.html` & `static/main.js`: Web interface, chat logic, and WebGPU WGSL shaders for rendering the avatar.
