use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use candle_core_v09::Device;
use qwen3_asr::{AsrInference, StreamingOptions, TranscribeOptions};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::OnceCell;
use tracing::{info, warn};

use crate::gpu::{GpuPlanner, GpuTier};

const DEFAULT_ASR_MODEL_ID: &str = "Qwen/Qwen3-ASR-0.6B";
const DEFAULT_ASR_CACHE_DIR: &str = "models/qwen3-asr";
const TARGET_SAMPLE_RATE: u32 = 16_000;

pub type SherpaAsrEngine = QwenAsrEngine;

pub struct QwenAsrEngine {
    model_id: String,
    model_path: Option<PathBuf>,
    cache_dir: PathBuf,
    forced_language: Option<String>,
    gpu: Arc<GpuPlanner>,
    inference: OnceCell<Arc<AsrInference>>,
}

impl QwenAsrEngine {
    pub fn new(gpu: Arc<GpuPlanner>) -> Self {
        let model_id = std::env::var("QWEN_ASR_MODEL_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_ASR_MODEL_ID.to_string());

        let model_path = std::env::var_os("QWEN_ASR_MODEL_DIR").map(PathBuf::from);
        let cache_dir = std::env::var_os("QWEN_ASR_CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_ASR_CACHE_DIR));
        let forced_language = std::env::var("QWEN_ASR_LANGUAGE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        info!(
            model_id = %model_id,
            model_path = ?model_path,
            cache_dir = %cache_dir.display(),
            "ASR engine initialized (local Qwen3-ASR)"
        );

        Self {
            model_id,
            model_path,
            cache_dir,
            forced_language,
            gpu,
            inference: OnceCell::new(),
        }
    }

    async fn inference(&self) -> anyhow::Result<Arc<AsrInference>> {
        self.inference
            .get_or_try_init(|| async {
                let model_id = self.model_id.clone();
                let model_path = self.model_path.clone();
                let cache_dir = self.cache_dir.clone();
                let gpu = self.gpu.clone();

                let inference = tokio::task::spawn_blocking(move || {
                    let mut devices = Vec::new();
                    if gpu.should_use_cuda_for_tier(GpuTier::Asr) {
                        match Device::new_cuda(0) {
                            Ok(device) => devices.push(("CUDA", device)),
                            Err(err) => warn!("ASR CUDA device unavailable, falling back to CPU: {}", err),
                        }
                    }
                    devices.push(("CPU", Device::Cpu));

                    let mut last_error: Option<anyhow::Error> = None;
                    for (label, device) in devices {
                        let result = if let Some(model_path) = &model_path {
                            info!(path = %model_path.display(), device = label, "Loading local Qwen3-ASR model");
                            AsrInference::load(model_path, device)
                                .map_err(|err| anyhow::anyhow!(err.to_string()))
                        } else {
                            info!(model_id = %model_id, cache = %cache_dir.display(), device = label, "Downloading/loading Qwen3-ASR model");
                            AsrInference::from_pretrained(&model_id, &cache_dir, device)
                                .map_err(|err| anyhow::anyhow!(err.to_string()))
                        };

                        match result {
                            Ok(inference) => return Ok(inference),
                            Err(err) => {
                                warn!("ASR load failed on {}: {}", label, err);
                                last_error = Some(err);
                            }
                        }
                    }

                    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to load local Qwen ASR model")))
                })
                .await
                .map_err(|err| anyhow::anyhow!("Failed to join ASR loader: {}", err))??;

                Ok(Arc::new(inference))
            })
            .await
            .map(Arc::clone)
    }

    pub async fn preload(&self) -> anyhow::Result<()> {
        let _ = self.inference().await?;
        Ok(())
    }

    pub async fn recognize(
        &self,
        audio_data: &[u8],
        audio_format: Option<&str>,
        sample_rate: Option<u32>,
    ) -> anyhow::Result<String> {
        info!(bytes = audio_data.len(), "ASR: processing audio with local Qwen3-ASR");

        if audio_data.is_empty() {
            return Ok(String::new());
        }

        let samples = decode_audio_samples(audio_data, audio_format, sample_rate)?;
        if samples.is_empty() {
            return Ok(String::new());
        }

        let inference = self.inference().await?;
        let mut options = TranscribeOptions::default();
        options.language = self.forced_language.clone();

        let result = inference
            .transcribe_samples(&samples, options)
            .map_err(|err| anyhow::anyhow!(err.to_string()))?;

        Ok(result.text.trim().to_string())
    }

    fn streaming_options(&self) -> StreamingOptions {
        let mut options = StreamingOptions::default()
            .with_chunk_size_sec(1.0)
            .with_unfixed_chunk_num(2)
            .with_unfixed_token_num(5)
            .with_max_new_tokens_streaming(32)
            .with_max_new_tokens_final(512);
        if let Some(language) = &self.forced_language {
            options = options.with_language(language.clone());
        }
        options
    }
}

pub async fn handle_realtime_socket(socket: WebSocket, engine: Arc<QwenAsrEngine>) {
    info!("New ASR WebSocket connection established (local Qwen3-ASR)");

    let inference = match engine.inference().await {
        Ok(inference) => inference,
        Err(err) => {
            warn!("Failed to load local Qwen ASR model: {}", err);
            return;
        }
    };

    let (mut client_write, mut client_read) = socket.split();

    let status = json_status("status", "本地 Qwen ASR 已连接");
    if let Err(err) = client_write
        .send(Message::Text(status.to_string().into()))
        .await
    {
        warn!("Failed to send ASR ready status: {}", err);
        return;
    }

    let mut stream_state = inference.init_streaming(engine.streaming_options());
    let mut last_partial = String::new();

    while let Some(msg) = client_read.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                if bytes.is_empty() {
                    continue;
                }

                let samples = pcm16le_bytes_to_f32(&bytes);
                if samples.is_empty() {
                    continue;
                }

                match inference.feed_audio(&mut stream_state, &samples) {
                    Ok(Some(result)) => {
                        let text = result.text.trim().to_string();
                        if text != last_partial {
                            last_partial = text.clone();
                            let payload = serde_json::json!({
                                "type": "partial",
                                "text": text,
                                "preview": text,
                                "language": result.language,
                            });
                            if let Err(err) = client_write
                                .send(Message::Text(payload.to_string().into()))
                                .await
                            {
                                warn!("Failed to send ASR partial result: {}", err);
                                break;
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(err) => {
                        warn!("Local Qwen ASR streaming failed: {}", err);
                        let payload = json_status("error", &format!("本地 ASR 识别失败：{}", err));
                        if client_write
                            .send(Message::Text(payload.to_string().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            Ok(Message::Text(text)) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(value) => match value.get("type").and_then(|v| v.as_str()) {
                        Some("commit") => match inference.finish_streaming(&mut stream_state) {
                            Ok(result) => {
                                let text = result.text.trim().to_string();
                                last_partial = text.clone();
                                let payload = serde_json::json!({
                                    "type": "final",
                                    "text": text,
                                    "language": result.language,
                                });
                                if client_write
                                    .send(Message::Text(payload.to_string().into()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                                stream_state = inference.init_streaming(engine.streaming_options());
                                last_partial.clear();
                            }
                            Err(err) => {
                                warn!("Failed to finish local ASR session: {}", err);
                                let payload = json_status("error", &format!("本地 ASR 收口失败：{}", err));
                                if client_write
                                    .send(Message::Text(payload.to_string().into()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                                stream_state = inference.init_streaming(engine.streaming_options());
                                last_partial.clear();
                            }
                        },
                        Some("reset") => {
                            stream_state = inference.init_streaming(engine.streaming_options());
                            last_partial.clear();
                            let payload = json_status("status", "ASR session reset");
                            if client_write
                                .send(Message::Text(payload.to_string().into()))
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        _ => {
                            let payload = json_status("status", "ASR control message ignored");
                            if client_write
                                .send(Message::Text(payload.to_string().into()))
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                    },
                    Err(_) => {
                        let payload = json_status("status", "ASR control message ignored");
                        if client_write
                            .send(Message::Text(payload.to_string().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(err) => {
                warn!("ASR websocket error: {}", err);
                break;
            }
        }
    }
}

fn json_status(kind: &str, message: &str) -> serde_json::Value {
    serde_json::json!({
        "type": kind,
        "message": message,
    })
}

fn decode_audio_samples(
    audio_data: &[u8],
    audio_format: Option<&str>,
    sample_rate: Option<u32>,
) -> anyhow::Result<Vec<f32>> {
    let audio_format = audio_format.unwrap_or_default().to_ascii_lowercase();
    if audio_format == "pcm16le" || audio_format.is_empty() {
        let rate = sample_rate.unwrap_or(TARGET_SAMPLE_RATE);
        let samples = pcm16le_bytes_to_f32(audio_data);
        if !samples.is_empty() {
            return Ok(if rate == TARGET_SAMPLE_RATE {
                samples
            } else {
                resample_linear(&samples, rate, TARGET_SAMPLE_RATE)
            });
        }
    }

    let (decoded, decoded_rate) = decode_audio_to_mono(audio_data);
    if !decoded.is_empty() {
        let rate = decoded_rate.unwrap_or(sample_rate.unwrap_or(TARGET_SAMPLE_RATE));
        return Ok(if rate == TARGET_SAMPLE_RATE {
            decoded
        } else {
            resample_linear(&decoded, rate, TARGET_SAMPLE_RATE)
        });
    }

    Ok(Vec::new())
}

fn pcm16le_bytes_to_f32(data: &[u8]) -> Vec<f32> {
    let mut samples = Vec::with_capacity(data.len() / 2);
    for chunk in data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0;
        samples.push(sample);
    }
    samples
}

fn decode_audio_to_mono(data: &[u8]) -> (Vec<f32>, Option<u32>) {
    use std::io::Cursor;
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let cursor = Cursor::new(data.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let probed = match symphonia::default::get_probe().format(
        &Hint::new(),
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(p) => p,
        Err(_) => return (Vec::new(), None),
    };

    let mut format = probed.format;
    let track = match format.default_track() {
        Some(track) => track,
        None => return (Vec::new(), None),
    };
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let _ = track;

    let mut decoder = match symphonia::default::get_codecs().make(&codec_params, &DecoderOptions::default()) {
        Ok(decoder) => decoder,
        Err(_) => return (Vec::new(), None),
    };

    let mut samples = Vec::new();
    let mut sample_rate = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        sample_rate = Some(spec.rate as u32);
        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let channels = spec.channels.count().max(1);
        for chunk in sample_buf.samples().chunks(channels) {
            samples.push(chunk.iter().sum::<f32>() / channels as f32);
        }
    }

    (samples, sample_rate)
}

fn resample_linear(samples: &[f32], input_rate: u32, output_rate: u32) -> Vec<f32> {
    if samples.is_empty() || input_rate == 0 || output_rate == 0 || input_rate == output_rate {
        return samples.to_vec();
    }

    let ratio = output_rate as f32 / input_rate as f32;
    let output_len = ((samples.len() as f32) * ratio).max(1.0).round() as usize;
    let mut resampled = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let source_pos = i as f32 / ratio;
        let left = source_pos.floor() as usize;
        let frac = source_pos - left as f32;
        let s0 = *samples.get(left).unwrap_or(&0.0);
        let s1 = *samples.get(left + 1).unwrap_or(&s0);
        resampled.push(s0 + (s1 - s0) * frac);
    }

    resampled
}
