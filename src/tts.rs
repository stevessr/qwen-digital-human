use candle_core_v09::{Device, Tensor};
use qwen_tts::{
    io::{model_path::get_model_path, ModelArgs},
    model::loader::load_from_pretrained,
    synthesis::detect_mode::DetectedMode,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, OnceCell};
use tracing::info;

use crate::gpu::{GpuPlanner, GpuTier};

pub const LOCAL_SAMPLE_RATE: u32 = 24_000;
const DEFAULT_TTS_MODEL_ID: &str = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice";
const DEFAULT_TTS_SPEAKER: &str = "vivian";
const DEFAULT_TTS_LANGUAGE: &str = "chinese";
const DEFAULT_TTS_INSTRUCT: &str = "地图讲解口吻，清晰、亲切、自然、适合导览介绍。";

#[derive(Clone)]
pub struct GeneratedAudio {
    pub pcm16le: Vec<u8>,
    pub wav_bytes: Vec<u8>,
    pub sample_rate: u32,
}

pub struct LocalTtsEngine {
    model_id: String,
    model_path: Option<PathBuf>,
    speaker: String,
    language: String,
    instruct: Option<String>,
    gpu: Arc<GpuPlanner>,
    model: OnceCell<Arc<Mutex<qwen_tts::model::Model>>>,
}

impl LocalTtsEngine {
    pub fn new(gpu: Arc<GpuPlanner>) -> Self {
        let model_id = std::env::var("QWEN_TTS_MODEL_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_TTS_MODEL_ID.to_string());
        let model_path = std::env::var_os("QWEN_TTS_MODEL_DIR").map(PathBuf::from);
        let speaker = std::env::var("QWEN_TTS_SPEAKER")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_TTS_SPEAKER.to_string());
        let language = std::env::var("QWEN_TTS_LANGUAGE")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_TTS_LANGUAGE.to_string());
        let instruct = std::env::var("QWEN_TTS_INSTRUCT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| Some(DEFAULT_TTS_INSTRUCT.to_string()));

        info!(
            model_id = %model_id,
            model_path = ?model_path,
            speaker = %speaker,
            language = %language,
            "TTS engine initialized (local Qwen3-TTS)"
        );

        Self {
            model_id,
            model_path,
            speaker,
            language,
            instruct,
            gpu,
            model: OnceCell::new(),
        }
    }

    async fn model(&self) -> anyhow::Result<Arc<Mutex<qwen_tts::model::Model>>> {
        self.model
            .get_or_try_init(|| async {
                let model_id = self.model_id.clone();
                let model_path = self.model_path.clone();
                let gpu = self.gpu.clone();

                let model = tokio::task::spawn_blocking(move || -> anyhow::Result<qwen_tts::model::Model> {
                    let loaded_path = if let Some(path) = model_path {
                        if !path.exists() {
                            return Err(anyhow::anyhow!("TTS model path does not exist: {}", path.display()));
                        }
                        info!(path = %path.display(), "Loading local Qwen3-TTS model");
                        path
                    } else {
                        let model_args = ModelArgs {
                            model: Some(model_id.clone()),
                            model_path: None,
                            device: "cpu".to_string(),
                            dtype: "f32".to_string(),
                        };
                        let mode = DetectedMode::CustomVoice {
                            speaker: DEFAULT_TTS_SPEAKER.to_string(),
                            instruct: Some(DEFAULT_TTS_INSTRUCT.to_string()),
                        };
                        get_model_path(&model_args, &mode)
                            .map_err(|err| anyhow::anyhow!(err.to_string()))?
                    };

                    let mut devices = Vec::new();
                    if gpu.should_use_cuda_for_tier(GpuTier::Tts) {
                        match Device::new_cuda(0) {
                            Ok(device) => devices.push(("CUDA", device)),
                            Err(err) => tracing::warn!("TTS CUDA device unavailable, falling back to CPU: {}", err),
                        }
                    }
                    devices.push(("CPU", Device::Cpu));

                    let mut last_error: Option<anyhow::Error> = None;
                    for (label, device) in devices {
                        match load_from_pretrained(&loaded_path, &device) {
                            Ok(model) => {
                                info!(device = label, "Qwen3-TTS model loaded");
                                return Ok(model);
                            }
                            Err(err) => {
                                tracing::warn!("TTS load failed on {}: {}", label, err);
                                last_error = Some(anyhow::anyhow!(err.to_string()));
                            }
                        }
                    }

                    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to load Qwen3-TTS model")))
                })
                .await
                .map_err(|err| anyhow::anyhow!("Failed to join TTS loader: {}", err))??;

                Ok(Arc::new(Mutex::new(model)))
            })
            .await
            .map(Arc::clone)
    }

    pub async fn preload(&self) -> anyhow::Result<()> {
        let _ = self.model().await?;
        Ok(())
    }

    pub async fn generate_tts(&self, text: &str) -> anyhow::Result<Vec<u8>> {
        let generated = self.synthesize_audio(text).await?;
        Ok(generated.wav_bytes)
    }

    pub async fn synthesize_audio(&self, text: &str) -> anyhow::Result<GeneratedAudio> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(GeneratedAudio {
                pcm16le: Vec::new(),
                wav_bytes: Vec::new(),
                sample_rate: LOCAL_SAMPLE_RATE,
            });
        }

        let model = self.model().await?;
        let speaker = self.speaker.clone();
        let language = self.language.clone();
        let instruct = self.instruct.clone();
        let text = trimmed.to_string();

        tokio::task::spawn_blocking(move || {
            let guard = model
                .lock()
                .map_err(|_| anyhow::anyhow!("TTS model mutex poisoned"))?;
            let result = guard
                .generate_custom_voice_from_text(
                    &text,
                    &speaker,
                    &language,
                    instruct.as_deref(),
                    None,
                )
                .map_err(|err| anyhow::anyhow!(err.to_string()))?;

            let sample_rate = result.sample_rate as u32;
            let pcm16le = tensor_to_pcm16le_bytes(&result.audio)?;
            let wav_bytes = pcm16le_to_wav_bytes(&pcm16le, sample_rate)?;
            Ok(GeneratedAudio {
                pcm16le,
                wav_bytes,
                sample_rate,
            })
        })
        .await
        .map_err(|err| anyhow::anyhow!("Failed to join TTS synthesis task: {}", err))?
    }
}

pub async fn stream_realtime_tts<F>(
    engine: Arc<LocalTtsEngine>,
    mut text_rx: mpsc::UnboundedReceiver<String>,
    mut on_audio_chunk: F,
) -> anyhow::Result<Vec<u8>>
where
    F: FnMut(&[u8]) -> anyhow::Result<()> + Send,
{
    let mut text_buffer = String::new();
    let mut final_pcm = Vec::new();
    let mut final_sample_rate = LOCAL_SAMPLE_RATE;
    let mut saw_text = false;

    while let Some(fragment) = text_rx.recv().await {
        if fragment.trim().is_empty() {
            continue;
        }
        saw_text = true;
        text_buffer.push_str(&fragment);

        while let Some((segment, rest)) = take_tts_segment(&text_buffer, false) {
            if segment.trim().is_empty() {
                text_buffer = rest;
                continue;
            }

            let audio = synthesize_segment(engine.clone(), &segment).await?;
            final_sample_rate = audio.sample_rate;
            forward_pcm_chunks(&audio.pcm16le, audio.sample_rate, &mut on_audio_chunk, &mut final_pcm)?;
            text_buffer = rest;
        }

        if text_buffer.chars().count() > 72 {
            if let Some((segment, rest)) = take_tts_segment(&text_buffer, true) {
                if !segment.trim().is_empty() {
                    let audio = synthesize_segment(engine.clone(), &segment).await?;
                    final_sample_rate = audio.sample_rate;
                    forward_pcm_chunks(
                        &audio.pcm16le,
                        audio.sample_rate,
                        &mut on_audio_chunk,
                        &mut final_pcm,
                    )?;
                }
                text_buffer = rest;
            }
        }
    }

    if !text_buffer.trim().is_empty() {
        let audio = synthesize_segment(engine.clone(), text_buffer.trim()).await?;
        final_sample_rate = audio.sample_rate;
        forward_pcm_chunks(&audio.pcm16le, audio.sample_rate, &mut on_audio_chunk, &mut final_pcm)?;
    } else if !saw_text {
        return Err(anyhow::anyhow!("Realtime TTS ended without receiving any text"));
    }

    if final_pcm.is_empty() {
        return Err(anyhow::anyhow!("Realtime TTS ended without producing any audio"));
    }

    info!("Local TTS completed ({} bytes of PCM audio)", final_pcm.len());
    pcm16le_to_wav_bytes(&final_pcm, final_sample_rate)
}

async fn synthesize_segment(
    engine: Arc<LocalTtsEngine>,
    text: &str,
) -> anyhow::Result<GeneratedAudio> {
    engine.synthesize_audio(text).await
}

fn forward_pcm_chunks<F>(
    pcm16le: &[u8],
    sample_rate: u32,
    on_audio_chunk: &mut F,
    final_pcm: &mut Vec<u8>,
) -> anyhow::Result<()>
where
    F: FnMut(&[u8]) -> anyhow::Result<()> + Send,
{
    if pcm16le.is_empty() {
        return Ok(());
    }

    let mut chunk_size = ((sample_rate as usize / 100) * 2).max(2) & !1;
    if chunk_size == 0 {
        chunk_size = 2;
    }

    for chunk in pcm16le.chunks(chunk_size) {
        if chunk.len() < 2 {
            continue;
        }
        on_audio_chunk(chunk)?;
        final_pcm.extend_from_slice(chunk);
    }

    Ok(())
}

fn take_tts_segment(buffer: &str, force: bool) -> Option<(String, String)> {
    let trimmed = buffer.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut boundary = None;
    for (idx, ch) in trimmed.char_indices() {
        if matches!(ch, '。' | '！' | '？' | '!' | '?' | '；' | ';' | '\n') {
            boundary = Some(idx + ch.len_utf8());
        } else if force && idx > 64 {
            boundary = Some(idx);
        }
    }

    if let Some(end) = boundary {
        let segment = trimmed[..end].trim().to_string();
        let rest = trimmed[end..].trim_start().to_string();
        Some((segment, rest))
    } else if force {
        Some((trimmed.to_string(), String::new()))
    } else {
        None
    }
}

fn tensor_to_pcm16le_bytes(audio: &Tensor) -> anyhow::Result<Vec<u8>> {
    let flattened = audio.flatten_all().map_err(|err| anyhow::anyhow!(err.to_string()))?;
    let samples = flattened
        .to_vec1::<f32>()
        .map_err(|err| anyhow::anyhow!(err.to_string()))?;

    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = if clamped < 0.0 {
            (clamped * 32768.0).round() as i16
        } else {
            (clamped * 32767.0).round() as i16
        };
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Ok(bytes)
}

pub fn pcm16le_to_wav_bytes(pcm_bytes: &[u8], sample_rate: u32) -> anyhow::Result<Vec<u8>> {
    if pcm_bytes.is_empty() {
        return Ok(Vec::new());
    }

    let data_len = pcm_bytes.len() - (pcm_bytes.len() % 2);
    let pcm_bytes = &pcm_bytes[..data_len];
    let mut wav = Vec::with_capacity(44 + pcm_bytes.len());
    let byte_rate = sample_rate * 2;
    let block_align: u16 = 2;
    let data_size = pcm_bytes.len() as u32;
    let riff_size = 36u32
        .checked_add(data_size)
        .ok_or_else(|| anyhow::anyhow!("PCM data is too large to encode as WAV"))?;

    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&riff_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(pcm_bytes);

    Ok(wav)
}
