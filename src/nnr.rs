use crate::a2bs::{ExpressionData, PostureData};
use serde::Serialize;
use tracing::info;

#[derive(Serialize)]
pub struct RenderFrame {
    pub expression: ExpressionData,
    pub posture: PostureData,
    pub audio_base64: String,
    pub audio_mime_type: String,
    /// Downsampled audio waveform for frontend visualization (128 points)
    pub waveform: Vec<f32>,
}

pub struct NnrEngine;

impl NnrEngine {
    pub fn new() -> Self {
        Self
    }

    /// 准备发送到前端 WebGPU 的渲染数据
    /// 包含表情、姿态、base64 音频和降采样波形
    pub async fn prepare_render_data(
        &self,
        expression: ExpressionData,
        posture: PostureData,
        audio_chunk: Vec<u8>,
        audio_mime_type: impl Into<String>,
    ) -> anyhow::Result<RenderFrame> {
        info!(
            "NNR: Preparing render frame with {} bytes of audio",
            audio_chunk.len()
        );

        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let audio_base64 = STANDARD.encode(&audio_chunk);
        let audio_mime_type = audio_mime_type.into();

        // Extract waveform from audio for visualization
        let waveform = extract_waveform(&audio_chunk);

        Ok(RenderFrame {
            expression,
            posture,
            audio_base64,
            audio_mime_type,
            waveform,
        })
    }
}

/// Extract downsampled amplitude envelope from raw audio bytes.
/// Returns 128 normalized samples suitable for frontend waveform display.
fn extract_waveform(audio_data: &[u8]) -> Vec<f32> {
    if audio_data.is_empty() {
        return vec![0.0; 128];
    }

    // Try decoding as MP3 PCM
    let samples = decode_audio_to_samples(audio_data);
    if samples.is_empty() {
        return vec![0.0; 128];
    }

    // Downsample to target count using max envelope per bucket
    let target = 128;
    let bucket_size = (samples.len() / target).max(1);
    let mut waveform = Vec::with_capacity(target);

    for i in 0..target {
        let start = i * bucket_size;
        let end = ((i + 1) * bucket_size).min(samples.len());
        if start >= end {
            waveform.push(0.0);
            continue;
        }
        let max_amp = samples[start..end]
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max);
        waveform.push(max_amp.min(1.0));
    }

    // Normalize to 0-1 range
    let max_val = waveform.iter().cloned().fold(0.0f32, f32::max);
    if max_val > 0.01 {
        for v in &mut waveform {
            *v /= max_val;
        }
    }

    waveform
}

/// Decode raw audio bytes (MP3) to mono f32 PCM samples
fn decode_audio_to_samples(data: &[u8]) -> Vec<f32> {
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
        Err(_) => return Vec::new(),
    };

    let mut format = probed.format;
    let track = match format.default_track() {
        Some(t) => t,
        None => return Vec::new(),
    };
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let _ = track;

    let mut decoder =
        match symphonia::default::get_codecs().make(&codec_params, &DecoderOptions::default()) {
            Ok(d) => d,
            Err(_) => return Vec::new(),
        };

    let mut samples_out = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let duration = decoded.capacity() as u64;
        let channels = spec.channels.count();

        if sample_buf.is_none() {
            sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
        }

        if let Some(buf) = &mut sample_buf {
            buf.copy_interleaved_ref(decoded);
            for chunk in buf.samples().chunks(channels) {
                samples_out.push(chunk.iter().sum::<f32>() / channels as f32);
            }
        }
    }

    samples_out
}
