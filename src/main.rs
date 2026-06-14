use axum::{
    body::{Body, Bytes},
    extract::{ws::WebSocketUpgrade, State},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tower_http::services::ServeDir;
use tracing::{error, info, warn};

mod a2bs;
mod asr;
mod device;
mod gpu;
mod llm;
mod mcp;
mod map;
mod model_manager;
mod nnr;
mod rag;
mod tts;

const STREAM_FRAME_STATUS: u8 = 1;
const STREAM_FRAME_ASR: u8 = 2;
const STREAM_FRAME_DELTA: u8 = 3;
const STREAM_FRAME_AUDIO: u8 = 4;
const STREAM_FRAME_DONE: u8 = 5;
const STREAM_FRAME_ERROR: u8 = 6;

const STREAM_STAGE_ASR: u8 = 1;
const STREAM_STAGE_RAG: u8 = 2;
const STREAM_STAGE_LLM: u8 = 3;
const STREAM_STAGE_TTS: u8 = 4;
const STREAM_STAGE_RENDER: u8 = 5;

#[derive(Clone)]
pub struct AppState {
    pub asr_engine: Arc<asr::SherpaAsrEngine>,
    pub tts_engine: Arc<tts::LocalTtsEngine>,
    pub llm_engine: Arc<llm::LlmEngine>,
    pub rag_engine: Arc<rag::RagEngine>,
    pub a2bs_engine: Arc<a2bs::A2bsEngine>,
    pub nnr_engine: Arc<nnr::NnrEngine>,
    pub model_manager: Arc<model_manager::ModelManager>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    info!("Starting Map Digital Human Server (local Qwen ASR/TTS)...");

    let model_manager = Arc::new(model_manager::ModelManager::new());
    model_manager.init().await?;

    let backend = Arc::new(
        llama_cpp_2::llama_backend::LlamaBackend::init()
            .expect("Failed to initialize llama.cpp backend"),
    );
    let gpu_planner = Arc::new(gpu::GpuPlanner::detect());
    let llm_engine = Arc::new(llm::LlmEngine::new(backend.clone(), gpu_planner.clone()));
    let rag_engine = Arc::new(rag::RagEngine::new(backend.clone(), gpu_planner.clone()));

    // Auto-load models if they exist in models/
    let _ = llm_engine
        .load_model("models/Qwen3.5-0.8B-Q4_K_M.gguf")
        .await;
    let _ = rag_engine
        .load_embedding_model("models/Qwen3-Embedding-0.6B-Q8_0.gguf")
        .await;
    let _ = rag_engine
        .load_reranker_model("models/qwen3-reranker-0.6b-q8_0.gguf")
        .await;

    let state = AppState {
        asr_engine: Arc::new(asr::SherpaAsrEngine::new(gpu_planner.clone())),
        tts_engine: Arc::new(tts::LocalTtsEngine::new(gpu_planner.clone())),
        llm_engine,
        rag_engine,
        a2bs_engine: Arc::new(a2bs::A2bsEngine::new()),
        nnr_engine: Arc::new(nnr::NnrEngine::new()),
        model_manager,
    };

    let app = Router::new()
        .route("/api/chat", post(chat_handler))
        .route("/api/tts", post(tts_handler))
        .route("/api/pipeline", post(pipeline_handler))
        .route("/api/map/search", post(map_search_handler))
        .route("/api/context/retrieve", post(context_retrieve_handler))
        .route("/api/ws/asr", get(asr_ws_handler))
        .route("/api/models/status", get(model_status_handler))
        .route("/api/models/download", post(model_download_handler))
        .route("/api/models/delete", post(model_delete_handler))
        .route("/api/models/verify", post(model_verify_handler))
        .route("/api/models/preload/asr", post(model_preload_asr_handler))
        .route("/api/models/preload/tts", post(model_preload_tts_handler))
        .nest_service("/", ServeDir::new("static"))
        .with_state(state);

    let base_port = std::env::var("QDH_PORT")
        .ok()
        .or_else(|| std::env::var("PORT").ok())
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3000);
    let max_hops = std::env::var("QDH_PORT_MAX_HOPS")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(32);

    let (listener, selected_port) = bind_listener_with_port_hopping(base_port, max_hops).await?;
    info!(
        "Listening on http://0.0.0.0:{}",
        selected_port
    );
    axum::serve(listener, app).await?;

    Ok(())
}

async fn bind_listener_with_port_hopping(
    base_port: u16,
    max_hops: u16,
) -> anyhow::Result<(TcpListener, u16)> {
    if base_port == 0 {
        let listener = TcpListener::bind("0.0.0.0:0").await?;
        let selected_port = listener.local_addr()?.port();
        return Ok((listener, selected_port));
    }

    let mut last_error: Option<std::io::Error> = None;
    for offset in 0..=max_hops {
        let port = match base_port.checked_add(offset) {
            Some(port) => port,
            None => break,
        };
        match TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => return Ok((listener, port)),
            Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
                warn!("Port {} is already in use, trying {}...", port, port.saturating_add(1));
                last_error = Some(err);
            }
            Err(err) => return Err(err.into()),
        }
    }

    Err(last_error
        .map(|err| anyhow::anyhow!(err))
        .unwrap_or_else(|| anyhow::anyhow!("Unable to bind any port starting from {}", base_port)))
}

async fn asr_ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| asr::handle_realtime_socket(socket, state.asr_engine.clone()))
}

async fn model_status_handler(State(state): State<AppState>) -> impl IntoResponse {
    let status = state.model_manager.get_model_library().await;
    Json(status)
}

#[derive(Deserialize)]
struct DownloadRequest {
    name: String,
    url: String,
}

async fn model_download_handler(
    State(state): State<AppState>,
    Json(payload): Json<DownloadRequest>,
) -> impl IntoResponse {
    let mm = state.model_manager.clone();
    let name = payload.name.clone();
    let url = payload.url.clone();

    tokio::spawn(async move {
        if let Err(e) = mm.download_model(name, url).await {
            error!("Download failed: {}", e);
        }
    });

    Json(json!({"status": "success", "message": "Download started"}))
}

#[derive(Deserialize)]
struct ModelActionRequest {
    name: String,
    expected_sha256: Option<String>,
}

async fn model_delete_handler(
    State(state): State<AppState>,
    Json(payload): Json<ModelActionRequest>,
) -> impl IntoResponse {
    let _ = state.model_manager.delete_model(&payload.name).await;
    Json(json!({"status": "success"}))
}

async fn model_verify_handler(
    State(state): State<AppState>,
    Json(payload): Json<ModelActionRequest>,
) -> impl IntoResponse {
    let sha256 = payload.expected_sha256.unwrap_or_default();
    let ok = state
        .model_manager
        .verify_model(&payload.name, &sha256)
        .await;
    Json(json!({"status": if ok { "ok" } else { "error" }}))
}

async fn model_preload_asr_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.asr_engine.preload().await {
        Ok(_) => Json(json!({"status": "success", "message": "ASR model preloaded"})).into_response(),
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"status": "error", "message": err.to_string()})),
        )
            .into_response(),
    }
}

async fn model_preload_tts_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.tts_engine.preload().await {
        Ok(_) => Json(json!({"status": "success", "message": "TTS model preloaded"})).into_response(),
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"status": "error", "message": err.to_string()})),
        )
            .into_response(),
    }
}

fn push_u8(buf: &mut Vec<u8>, value: u8) {
    buf.push(value);
}

fn push_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_f32(buf: &mut Vec<u8>, value: f32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    push_u32(buf, bytes.len() as u32);
    buf.extend_from_slice(bytes);
}

fn push_string(buf: &mut Vec<u8>, value: &str) {
    push_bytes(buf, value.as_bytes());
}

fn default_true() -> bool {
    true
}

async fn resolve_context(
    state: &AppState,
    query: &str,
    manual_context: &str,
    use_rag_context: bool,
    rerank: &rag::RerankConfigPatch,
) -> String {
    if !manual_context.trim().is_empty() {
        manual_context.to_string()
    } else if use_rag_context {
        state
            .rag_engine
            .retrieve_with_config(query, Some(rerank))
            .await
    } else {
        String::new()
    }
}

fn encode_stream_frame(frame_type: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + payload.len());
    push_u8(&mut frame, frame_type);
    push_u32(&mut frame, payload.len() as u32);
    frame.extend_from_slice(payload);
    frame
}

fn encode_text_frame(frame_type: u8, text: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + text.len());
    push_string(&mut payload, text);
    encode_stream_frame(frame_type, &payload)
}

fn encode_status_frame(stage: u8, message: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(5 + message.len());
    push_u8(&mut payload, stage);
    push_string(&mut payload, message);
    encode_stream_frame(STREAM_FRAME_STATUS, &payload)
}

fn encode_audio_frame(sample_rate: u32, audio_chunk: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + audio_chunk.len());
    push_u32(&mut payload, sample_rate);
    payload.extend_from_slice(audio_chunk);
    encode_stream_frame(STREAM_FRAME_AUDIO, &payload)
}

fn encode_render_frame_payload(render_frame: &nnr::RenderFrame, audio_bytes: &[u8]) -> Vec<u8> {
    let mut payload = Vec::new();

    push_string(&mut payload, &render_frame.audio_mime_type);

    push_f32(&mut payload, render_frame.expression.mouth_open);
    push_f32(&mut payload, render_frame.expression.smile);
    push_f32(&mut payload, render_frame.expression.blink);

    push_f32(&mut payload, render_frame.posture.head_pitch);
    push_f32(&mut payload, render_frame.posture.head_yaw);
    push_f32(&mut payload, render_frame.posture.head_roll);

    push_u32(&mut payload, render_frame.waveform.len() as u32);
    for value in &render_frame.waveform {
        push_f32(&mut payload, *value);
    }

    push_bytes(&mut payload, audio_bytes);
    payload
}

fn encode_done_frame(
    transcription: Option<&str>,
    reply: &str,
    render_frame: Option<(&nnr::RenderFrame, &[u8])>,
) -> Vec<u8> {
    let mut payload = Vec::new();
    let mut flags = 0u8;
    if transcription.is_some() {
        flags |= 0x01;
    }
    if render_frame.is_some() {
        flags |= 0x02;
    }

    push_u8(&mut payload, flags);
    if let Some(transcription) = transcription {
        push_string(&mut payload, transcription);
    }
    push_string(&mut payload, reply);

    if let Some((frame, audio_bytes)) = render_frame {
        let render_payload = encode_render_frame_payload(frame, audio_bytes);
        push_u32(&mut payload, render_payload.len() as u32);
        payload.extend_from_slice(&render_payload);
    }

    encode_stream_frame(STREAM_FRAME_DONE, &payload)
}

fn encode_error_frame(message: &str) -> Vec<u8> {
    encode_text_frame(STREAM_FRAME_ERROR, message)
}

fn send_stream_frame(tx: &mpsc::UnboundedSender<Vec<u8>>, frame: Vec<u8>) -> anyhow::Result<()> {
    tx.send(frame)
        .map_err(|_| anyhow::anyhow!("stream closed"))?;
    Ok(())
}

fn realtime_tts_audio_delta_frames(audio_chunk: &[u8]) -> Vec<Vec<u8>> {
    if audio_chunk.is_empty() {
        return Vec::new();
    }

    // Slice audio into very small ~5ms chunks to reduce time-to-first-audio
    // on the frontend while keeping transport overhead reasonable.
    let slice_bytes = ((tts::LOCAL_SAMPLE_RATE as usize / 200) * 2).max(2) & !1;
    let mut frames = Vec::new();

    for slice in audio_chunk.chunks(slice_bytes) {
        if slice.len() < 2 {
            continue;
        }
        frames.push(encode_audio_frame(tts::LOCAL_SAMPLE_RATE, slice));
    }

    frames
}

fn spawn_realtime_tts_forwarder(
    engine: Arc<tts::LocalTtsEngine>,
    tx: mpsc::UnboundedSender<Vec<u8>>,
    text_rx: mpsc::UnboundedReceiver<String>,
    active: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<anyhow::Result<Vec<u8>>> {
    struct ActiveGuard(Arc<AtomicBool>);

    impl Drop for ActiveGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Relaxed);
        }
    }

    tokio::spawn(async move {
        let _guard = ActiveGuard(active);
        tts::stream_realtime_tts(engine, text_rx, move |audio_chunk| {
            for frame in realtime_tts_audio_delta_frames(audio_chunk) {
                tx.send(frame)
                    .map_err(|_| anyhow::anyhow!("realtime TTS stream closed"))?;
            }
            Ok(())
        })
        .await
    })
}

#[derive(Deserialize)]
struct PipelineRequest {
    audio_base64: String,
    fast_mode: bool,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    transcription: Option<String>,
    #[serde(default)]
    audio_format: String,
    #[serde(default)]
    audio_sample_rate: Option<u32>,
    #[serde(default = "default_true")]
    tts_enabled: bool,
    #[serde(default = "default_true")]
    use_rag_context: bool,
    #[serde(default)]
    system_prompt: String,
    #[serde(default)]
    memory: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    rerank: rag::RerankConfigPatch,
}

#[derive(Serialize)]
struct PipelineResponse {
    transcription: String,
    llm_reply: String,
    render_frame: nnr::RenderFrame,
}

async fn pipeline_handler(
    State(state): State<AppState>,
    Json(payload): Json<PipelineRequest>,
) -> Response {
    let PipelineRequest {
        audio_base64,
        fast_mode,
        stream,
        transcription,
        audio_format,
        audio_sample_rate,
        tts_enabled,
        use_rag_context,
        system_prompt,
        memory,
        context,
        rerank,
    } = payload;
    let voice_audio = STANDARD.decode(&audio_base64).unwrap_or_default();
    let realtime_transcription = transcription.clone();

    if stream {
        let state_stream = state.clone();
        let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let chunk_tx = tx.clone();

        tokio::spawn(async move {
            let result: anyhow::Result<()> = async {
                let asr_text = if let Some(transcription) = realtime_transcription.clone() {
                    let transcription = transcription.trim().to_string();
                    if transcription.is_empty() {
                        send_stream_frame(
                            &tx,
                            encode_status_frame(STREAM_STAGE_ASR, "Recognizing speech"),
                        )?;

                        state_stream
                            .asr_engine
                            .recognize(&voice_audio, Some(audio_format.as_str()), audio_sample_rate)
                            .await
                            .unwrap_or_default()
                    } else {
                        send_stream_frame(
                            &tx,
                            encode_status_frame(
                                STREAM_STAGE_ASR,
                                "Reusing realtime ASR transcript",
                            ),
                        )?;
                        transcription
                    }
                } else {
                    send_stream_frame(
                        &tx,
                        encode_status_frame(STREAM_STAGE_ASR, "Recognizing speech"),
                    )?;

                    state_stream
                        .asr_engine
                        .recognize(&voice_audio, Some(audio_format.as_str()), audio_sample_rate)
                        .await
                        .unwrap_or_default()
                };

                send_stream_frame(&tx, encode_text_frame(STREAM_FRAME_ASR, &asr_text))?;

                send_stream_frame(
                    &tx,
                    encode_status_frame(STREAM_STAGE_RAG, "Retrieving context"),
                )?;

                let context =
                    resolve_context(
                        &state_stream,
                        &asr_text,
                        &context,
                        use_rag_context,
                        &rerank,
                    )
                    .await;

                send_stream_frame(
                    &tx,
                    encode_status_frame(STREAM_STAGE_LLM, "Generating reply"),
                )?;

                let use_realtime_tts = tts_enabled;
                let realtime_tts_active = Arc::new(AtomicBool::new(use_realtime_tts));
                let (tts_text_tx, tts_handle) = if use_realtime_tts {
                    let (tts_text_tx, tts_text_rx) = mpsc::unbounded_channel::<String>();
                    let handle = spawn_realtime_tts_forwarder(
                        state_stream.tts_engine.clone(),
                        tx.clone(),
                        tts_text_rx,
                        realtime_tts_active.clone(),
                    );
                    (Some(tts_text_tx), Some(handle))
                } else {
                    (None, None)
                };
                let tts_text_tx_for_llm = tts_text_tx.clone();

                if use_realtime_tts {
                    send_stream_frame(
                        &tx,
                        encode_status_frame(STREAM_STAGE_TTS, "Streaming local audio"),
                    )?;
                } else {
                    send_stream_frame(
                        &tx,
                        encode_status_frame(STREAM_STAGE_TTS, "Synthesizing local audio"),
                    )?;
                }

                let llm_reply = state_stream
                    .llm_engine
                    .generate_with_callback(
                        &asr_text,
                        &system_prompt,
                        &memory,
                        &context,
                        fast_mode,
                        move |chunk| {
                            chunk_tx
                                .send(encode_text_frame(STREAM_FRAME_DELTA, &chunk))
                                .map_err(|_| anyhow::anyhow!("pipeline stream closed"))?;

                            if realtime_tts_active.load(Ordering::Relaxed) {
                                if let Some(tts_text_tx) = tts_text_tx_for_llm.as_ref() {
                                    if tts_text_tx.send(chunk.clone()).is_err() {
                                        realtime_tts_active.store(false, Ordering::Relaxed);
                                    }
                                }
                            }

                            Ok(())
                        },
                    )
                    .await?;

                let (generated_audio, audio_mime_type) = if !tts_enabled {
                    (Vec::new(), "audio/wav".to_string())
                } else if use_realtime_tts {
                    drop(tts_text_tx);

                    let realtime_audio =
                        match tts_handle.expect("realtime TTS handle missing").await {
                            Ok(Ok(audio)) => audio,
                            Ok(Err(err)) => {
                                warn!(
                                    "Realtime TTS failed, falling back to batch synthesis: {}",
                                    err
                                );
                                Vec::new()
                            }
                            Err(err) => {
                                warn!(
                                "Realtime TTS task panicked, falling back to batch synthesis: {}",
                                err
                            );
                                Vec::new()
                            }
                        };

                    if realtime_audio.is_empty() {
                        send_stream_frame(
                            &tx,
                            encode_status_frame(STREAM_STAGE_TTS, "Synthesizing local audio"),
                        )?;
                        (
                            state_stream
                                .tts_engine
                                .generate_tts(&llm_reply)
                                .await
                                .unwrap_or_default(),
                            "audio/wav".to_string(),
                        )
                    } else {
                        (realtime_audio, "audio/wav".to_string())
                    }
                } else {
                    (
                        state_stream
                            .tts_engine
                            .generate_tts(&llm_reply)
                            .await
                            .unwrap_or_default(),
                        "audio/wav".to_string(),
                    )
                };

                send_stream_frame(
                    &tx,
                    encode_status_frame(STREAM_STAGE_RENDER, "Preparing avatar"),
                )?;

                let (expression, posture) = state_stream
                    .a2bs_engine
                    .synthesize_body_data(&generated_audio)
                    .await
                    .unwrap();
                let render_audio = generated_audio.clone();
                let render_frame = state_stream
                    .nnr_engine
                    .prepare_render_data(expression, posture, generated_audio, audio_mime_type)
                    .await
                    .unwrap();

                send_stream_frame(
                    &tx,
                    encode_done_frame(
                        Some(&asr_text),
                        &llm_reply,
                        Some((&render_frame, &render_audio)),
                    ),
                )?;

                Ok(())
            }
            .await;

            if let Err(err) = result {
                let _ = send_stream_frame(&tx, encode_error_frame(&err.to_string()));
            }
        });

        let stream = async_stream::stream! {
            let mut rx = rx;
            while let Some(frame) = rx.recv().await {
                yield Ok::<Bytes, Infallible>(Bytes::from(frame));
            }
        };

        return Response::builder()
            .header(axum::http::header::CONTENT_TYPE, "application/octet-stream")
            .header("X-Stream-Format", "qdh-binary-v2")
            .header(axum::http::header::CACHE_CONTROL, "no-cache")
            .header(axum::http::header::CONNECTION, "keep-alive")
            .body(Body::from_stream(stream))
            .unwrap();
    }

    let asr_text = transcription
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| String::new());
    let asr_text = if asr_text.is_empty() {
        state
            .asr_engine
            .recognize(&voice_audio, Some(audio_format.as_str()), audio_sample_rate)
            .await
            .unwrap_or_default()
    } else {
        asr_text
    };
    if asr_text.trim().is_empty() {
        let empty_response = Json(PipelineResponse {
            transcription: String::new(),
            llm_reply: String::new(),
            render_frame: state
                .nnr_engine
                .prepare_render_data(
                    a2bs::ExpressionData {
                        mouth_open: 0.0,
                        smile: 0.0,
                        blink: 0.0,
                    },
                    a2bs::PostureData {
                        head_pitch: 0.0,
                        head_yaw: 0.0,
                        head_roll: 0.0,
                    },
                    Vec::new(),
                    "audio/wav",
                )
                .await
                .unwrap(),
        });
        return empty_response.into_response();
    }
    let context = resolve_context(&state, &asr_text, &context, use_rag_context, &rerank).await;
    let llm_reply = state
        .llm_engine
        .generate(&asr_text, &system_prompt, &memory, &context, fast_mode)
        .await
        .unwrap_or_default();
    let generated_audio = if tts_enabled {
        state.tts_engine
            .generate_tts(&llm_reply)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let (expression, posture) = state
        .a2bs_engine
        .synthesize_body_data(&generated_audio)
        .await
        .unwrap();
    let render_frame = state
        .nnr_engine
        .prepare_render_data(expression, posture, generated_audio, "audio/wav")
        .await
        .unwrap();

    Json(PipelineResponse {
        transcription: asr_text,
        llm_reply,
        render_frame,
    })
    .into_response()
}

#[derive(serde::Deserialize)]
struct ChatRequest {
    message: String,
    fast_mode: bool,
    #[serde(default)]
    stream: bool,
    #[serde(default = "default_true")]
    tts_enabled: bool,
    #[serde(default = "default_true")]
    use_rag_context: bool,
    #[serde(default)]
    system_prompt: String,
    #[serde(default)]
    memory: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    rerank: rag::RerankConfigPatch,
}

#[derive(serde::Serialize)]
struct ChatResponse {
    reply: String,
}

async fn chat_handler(State(state): State<AppState>, Json(payload): Json<ChatRequest>) -> Response {
    let ChatRequest {
        message,
        fast_mode,
        stream,
        tts_enabled,
        use_rag_context,
        system_prompt,
        memory,
        context,
        rerank,
    } = payload;

    let context = resolve_context(&state, &message, &context, use_rag_context, &rerank).await;

    if stream {
        let llm_engine = state.llm_engine.clone();
        let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let chunk_tx = tx.clone();

        tokio::spawn(async move {
            let result: anyhow::Result<()> = async {
                send_stream_frame(
                    &tx,
                    encode_status_frame(STREAM_STAGE_LLM, "Generating reply"),
                )?;

                let use_realtime_tts = tts_enabled;
                let realtime_tts_active = Arc::new(AtomicBool::new(use_realtime_tts));
                let (tts_text_tx, tts_handle) = if use_realtime_tts {
                    let (tts_text_tx, tts_text_rx) = mpsc::unbounded_channel::<String>();
                    let handle = spawn_realtime_tts_forwarder(
                        state.tts_engine.clone(),
                        tx.clone(),
                        tts_text_rx,
                        realtime_tts_active.clone(),
                    );
                    (Some(tts_text_tx), Some(handle))
                } else {
                    (None, None)
                };
                let tts_text_tx_for_llm = tts_text_tx.clone();

                if use_realtime_tts {
                    send_stream_frame(
                        &tx,
                        encode_status_frame(STREAM_STAGE_TTS, "Streaming local audio"),
                    )?;
                }

                let reply = llm_engine
                    .generate_with_callback(
                        &message,
                        &system_prompt,
                        &memory,
                        &context,
                        fast_mode,
                        move |chunk| {
                            let frame = encode_text_frame(STREAM_FRAME_DELTA, &chunk);
                            chunk_tx
                                .send(frame)
                                .map_err(|_| anyhow::anyhow!("chat stream closed"))?;

                            if realtime_tts_active.load(Ordering::Relaxed) {
                                if let Some(tts_text_tx) = tts_text_tx_for_llm.as_ref() {
                                    if tts_text_tx.send(chunk.clone()).is_err() {
                                        realtime_tts_active.store(false, Ordering::Relaxed);
                                    }
                                }
                            }

                            Ok(())
                        },
                    )
                    .await?;

                if use_realtime_tts {
                    drop(tts_text_tx);
                    match tts_handle.expect("realtime TTS handle missing").await {
                        Ok(Ok(_audio)) => {}
                        Ok(Err(err)) => {
                            warn!("Realtime chat TTS ended without audio: {}", err);
                        }
                        Err(err) => {
                            warn!("Realtime chat TTS task panicked: {}", err);
                        }
                    }
                }

                send_stream_frame(&tx, encode_done_frame(None, &reply, None))?;

                Ok(())
            }
            .await;

            if let Err(err) = result {
                let _ = send_stream_frame(&tx, encode_error_frame(&err.to_string()));
            }
        });

        let stream = async_stream::stream! {
            let mut rx = rx;
            while let Some(frame) = rx.recv().await {
                yield Ok::<Bytes, Infallible>(Bytes::from(frame));
            }
        };

        return Response::builder()
            .header(axum::http::header::CONTENT_TYPE, "application/octet-stream")
            .header("X-Stream-Format", "qdh-binary-v2")
            .header(axum::http::header::CACHE_CONTROL, "no-cache")
            .header(axum::http::header::CONNECTION, "keep-alive")
            .body(Body::from_stream(stream))
            .unwrap();
    }

    let reply = state
        .llm_engine
        .generate(&message, &system_prompt, &memory, &context, fast_mode)
        .await;
    Json(ChatResponse {
        reply: reply.unwrap_or_else(|e| format!("Error: {}", e)),
    })
    .into_response()
}

#[derive(serde::Deserialize)]
struct ContextRequest {
    query: String,
    #[serde(default)]
    rerank: rag::RerankConfigPatch,
}

#[derive(serde::Serialize)]
struct ContextResponse {
    context: String,
}

async fn context_retrieve_handler(
    State(state): State<AppState>,
    Json(payload): Json<ContextRequest>,
) -> impl IntoResponse {
    let context = state
        .rag_engine
        .retrieve_with_config(&payload.query, Some(&payload.rerank))
        .await;
    Json(ContextResponse { context })
}

#[derive(serde::Deserialize)]
struct MapSearchRequest {
    query: String,
    #[serde(default = "default_map_limit")]
    limit: usize,
}

#[derive(serde::Serialize)]
struct MapSearchResponse {
    query: String,
    results: Vec<map::MapPlace>,
}

fn default_map_limit() -> usize {
    5
}

async fn map_search_handler(Json(payload): Json<MapSearchRequest>) -> impl IntoResponse {
    let response = map::search_places(&payload.query, payload.limit).await;
    match response {
        Ok(result) => Json(MapSearchResponse {
            query: result.query,
            results: result.results,
        })
        .into_response(),
        Err(err) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": err.to_string(),
            })),
        )
            .into_response(),
    }
}

#[derive(serde::Deserialize)]
struct TtsRequest {
    text: String,
}

async fn tts_handler(State(state): State<AppState>, Json(payload): Json<TtsRequest>) -> impl IntoResponse {
    let audio_data = state
        .tts_engine
        .generate_tts(&payload.text)
        .await
        .unwrap_or_default();
    (
        [(axum::http::header::CONTENT_TYPE, "audio/wav")],
        audio_data,
    )
}
