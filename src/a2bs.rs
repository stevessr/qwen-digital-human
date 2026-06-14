use serde::Serialize;
use std::io::Cursor;
use tracing::info;

#[derive(Serialize, Clone, Debug)]
pub struct ExpressionData {
    pub mouth_open: f32,
    pub smile: f32,
    pub blink: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct PostureData {
    pub head_pitch: f32,
    pub head_yaw: f32,
    pub head_roll: f32,
}

pub struct A2bsEngine;

impl A2bsEngine {
    pub fn new() -> Self {
        Self
    }

    /// 从音频数据提取面部表情和姿态
    /// - 解码音频为 PCM 样本
    /// - RMS 能量 → 嘴巴张合 (mouth_open)
    /// - 频谱变化/过零率 → 微笑程度 (smile)
    /// - 周期性眨眼 + 头部微动
    pub async fn synthesize_body_data(
        &self,
        audio_data: &[u8],
    ) -> anyhow::Result<(ExpressionData, PostureData)> {
        info!(
            "A2BS: Analyzing {} bytes of audio for expression/posture",
            audio_data.len()
        );

        if audio_data.is_empty() {
            return Ok((
                ExpressionData {
                    mouth_open: 0.0,
                    smile: 0.0,
                    blink: 0.0,
                },
                PostureData {
                    head_pitch: 0.0,
                    head_yaw: 0.0,
                    head_roll: 0.0,
                },
            ));
        }

        // Decode audio bytes to PCM samples
        let decoded = decode_audio_to_mono(audio_data)?;

        if decoded.samples.is_empty() {
            return Ok((
                ExpressionData {
                    mouth_open: 0.2,
                    smile: 0.0,
                    blink: 0.0,
                },
                PostureData {
                    head_pitch: 0.0,
                    head_yaw: 0.0,
                    head_roll: 0.0,
                },
            ));
        }

        // Compute audio features
        let rms = compute_rms(&decoded.samples);
        let zcr = compute_zero_crossing_rate(&decoded.samples);
        let spectral_centroid = compute_spectral_centroid_approx(&decoded.samples);

        // Map features to expression
        // RMS typically 0.0-0.3 for speech, clamp and scale
        let mouth_open = (rms * 6.0).min(1.0).max(0.0);

        // Smile from spectral centroid and ZCR combination
        let smile_raw = (spectral_centroid - 0.1) * 2.0 + (zcr - 0.15) * 2.0;
        let smile = smile_raw.min(0.9).max(0.0);

        // Blink - driven by a deterministic pattern tied to audio length
        // Simple: if the audio is short (single utterance), blink once
        let duration_secs = decoded.samples.len() as f32 / decoded.sample_rate.max(1) as f32;
        let blink = if duration_secs < 2.0 { 0.3 } else { 0.0 };

        // Head posture — small rhythmic movements
        let head_pitch = (rms * 5.0).min(0.15); // slight nod when speaking loudly
        let head_yaw = (zcr - 0.15).max(-0.1).min(0.1); // slight head turn
        let head_roll = 0.0;

        info!(
            "A2BS results: mouth_open={:.3}, smile={:.3}, rms={:.4}, zcr={:.4}",
            mouth_open, smile, rms, zcr
        );

        Ok((
            ExpressionData {
                mouth_open,
                smile,
                blink,
            },
            PostureData {
                head_pitch,
                head_yaw,
                head_roll,
            },
        ))
    }
}

struct DecodedAudio {
    samples: Vec<f32>,
    sample_rate: u32,
}

/// Decode audio bytes to mono f32 PCM samples
fn decode_audio_to_mono(data: &[u8]) -> anyhow::Result<DecodedAudio> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let owned = data.to_vec();
    let cursor = Cursor::new(owned);
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let hint = Hint::new();
    let format_opts = FormatOptions::default();
    let meta_opts = MetadataOptions::default();
    let decoder_opts = DecoderOptions::default();

    let probed = symphonia::default::get_probe().format(&hint, mss, &format_opts, &meta_opts)?;
    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or_else(|| anyhow::anyhow!("No default audio track found"))?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    let mut decoder = symphonia::default::get_codecs().make(&codec_params, &decoder_opts)?;
    let _ = track;

    let mut samples_out = Vec::new();
    let mut sample_rate = 0u32;
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
        if sample_rate == 0 {
            sample_rate = spec.rate;
        }
        let duration = decoded.capacity() as u64;

        if sample_buf.is_none() {
            sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
        }

        if let Some(buf) = &mut sample_buf {
            buf.copy_interleaved_ref(decoded);

            let all_samples = buf.samples();
            let channels = spec.channels.count();

            for chunk in all_samples.chunks(channels) {
                let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                samples_out.push(mono);
            }
        }
    }

    info!(
        "Decoded {} PCM samples from audio ({} Hz)",
        samples_out.len(),
        sample_rate
    );
    Ok(DecodedAudio {
        samples: samples_out,
        sample_rate,
    })
}

/// Root Mean Square energy
fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Zero-crossing rate (normalized)
fn compute_zero_crossing_rate(samples: &[f32]) -> f32 {
    if samples.len() < 2 {
        return 0.0;
    }
    let mut crossings = 0usize;
    for window in samples.windows(2) {
        if (window[0] >= 0.0) != (window[1] >= 0.0) {
            crossings += 1;
        }
    }
    crossings as f32 / (samples.len() - 1) as f32
}

/// Approximate spectral centroid using zero-crossing and energy distribution
fn compute_spectral_centroid_approx(samples: &[f32]) -> f32 {
    if samples.len() < 2 {
        return 0.0;
    }

    // Use ratio of high-freq energy (difference between consecutive samples)
    // to total energy as a proxy for spectral centroid
    let mut total_energy = 0.0f64;
    let mut high_freq_energy = 0.0f64;

    for window in samples.windows(2) {
        let diff = (window[1] - window[0]) as f64;
        let amp = window[1] as f64;
        total_energy += amp * amp;
        high_freq_energy += diff * diff;
    }

    if total_energy < 1e-9 {
        return 0.0;
    }

    (high_freq_energy / total_energy).min(1.0) as f32
}
