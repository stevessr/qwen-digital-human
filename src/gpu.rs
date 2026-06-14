use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::{list_llama_ggml_backend_devices, LlamaBackendDeviceType};
use std::path::Path;
use std::sync::Arc;
use tracing::info;

const GPU_USABLE_RATIO_NUM: usize = 85;
const GPU_USABLE_RATIO_DEN: usize = 100;
const LLM_RATIO_NUM: usize = 58;
const ASR_RATIO_NUM: usize = 18;
const TTS_RATIO_NUM: usize = 14;
const RERANKER_RATIO_NUM: usize = 5;

const LLM_SAFE_RATIO_NUM: usize = 80;
const LLM_SAFE_RATIO_DEN: usize = 100;

const MIN_ASR_CUDA_BYTES: usize = 1_536 * 1024 * 1024;
const MIN_TTS_CUDA_BYTES: usize = 1_536 * 1024 * 1024;
const MIN_RERANKER_CUDA_BYTES: usize = 512 * 1024 * 1024;
const MIN_EMBEDDING_CUDA_BYTES: usize = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuTier {
    Llm,
    Asr,
    Tts,
    Reranker,
    Embedding,
}

#[derive(Debug, Clone)]
pub struct GpuPlanner {
    cuda_device_index: Option<usize>,
    cuda_device_name: Option<String>,
    cuda_memory_total: usize,
    cuda_memory_free: usize,
    usable_bytes: usize,
    llm_budget: usize,
    asr_budget: usize,
    tts_budget: usize,
    reranker_budget: usize,
    embedding_budget: usize,
}

#[derive(Debug, Clone)]
pub struct LlamaProbe {
    pub size_bytes: u64,
    pub n_layer: u32,
}

impl GpuPlanner {
    pub fn detect() -> Self {
        let devices = list_llama_ggml_backend_devices();
        let best_cuda = devices
            .iter()
            .filter(|device| device.backend.eq_ignore_ascii_case("CUDA"))
            .filter(|device| matches!(
                device.device_type,
                LlamaBackendDeviceType::Gpu
                    | LlamaBackendDeviceType::IntegratedGpu
                    | LlamaBackendDeviceType::Accelerator
            ))
            .max_by_key(|device| device.memory_free)
            .cloned();

        let primary = best_cuda;

        let (cuda_device_index, cuda_device_name, cuda_memory_total, cuda_memory_free) = primary
            .map(|device| {
                (
                    Some(device.index),
                    Some(device.name),
                    device.memory_total,
                    device.memory_free,
                )
            })
            .unwrap_or((None, None, 0, 0));

        let usable_bytes = cuda_memory_free.saturating_mul(GPU_USABLE_RATIO_NUM) / GPU_USABLE_RATIO_DEN;
        let llm_budget = usable_bytes.saturating_mul(LLM_RATIO_NUM) / 100;
        let asr_budget = usable_bytes.saturating_mul(ASR_RATIO_NUM) / 100;
        let tts_budget = usable_bytes.saturating_mul(TTS_RATIO_NUM) / 100;
        let reranker_budget = usable_bytes.saturating_mul(RERANKER_RATIO_NUM) / 100;
        let embedding_budget = usable_bytes
            .saturating_sub(llm_budget + asr_budget + tts_budget + reranker_budget);

        let planner = Self {
            cuda_device_index,
            cuda_device_name,
            cuda_memory_total,
            cuda_memory_free,
            usable_bytes,
            llm_budget,
            asr_budget,
            tts_budget,
            reranker_budget,
            embedding_budget,
        };

        info!("{}", planner.summary());
        planner
    }

    pub fn summary(&self) -> String {
        if let Some(name) = &self.cuda_device_name {
            format!(
                "GPU planner: device={} total={:.2}GiB free={:.2}GiB usable={:.2}GiB budgets=[llm={:.2}, asr={:.2}, tts={:.2}, reranker={:.2}, embedding={:.2}]",
                name,
                self.cuda_memory_total as f64 / gib(1) as f64,
                self.cuda_memory_free as f64 / gib(1) as f64,
                self.usable_bytes as f64 / gib(1) as f64,
                self.llm_budget as f64 / gib(1) as f64,
                self.asr_budget as f64 / gib(1) as f64,
                self.tts_budget as f64 / gib(1) as f64,
                self.reranker_budget as f64 / gib(1) as f64,
                self.embedding_budget as f64 / gib(1) as f64,
            )
        } else {
            "GPU planner: no CUDA/GPU backend detected; models will fall back to CPU".to_string()
        }
    }

    pub fn cuda_device_index(&self) -> Option<usize> {
        self.cuda_device_index
    }

    pub fn has_cuda(&self) -> bool {
        self.cuda_device_index.is_some()
    }

    pub fn budget_bytes(&self, tier: GpuTier) -> usize {
        match tier {
            GpuTier::Llm => self.llm_budget,
            GpuTier::Asr => self.asr_budget,
            GpuTier::Tts => self.tts_budget,
            GpuTier::Reranker => self.reranker_budget,
            GpuTier::Embedding => self.embedding_budget,
        }
    }

    pub fn should_use_cuda_for_tier(&self, tier: GpuTier) -> bool {
        if !self.has_cuda() {
            return false;
        }

        let budget = self.budget_bytes(tier);
        let threshold = match tier {
            GpuTier::Llm => 0,
            GpuTier::Asr => MIN_ASR_CUDA_BYTES,
            GpuTier::Tts => MIN_TTS_CUDA_BYTES,
            GpuTier::Reranker => MIN_RERANKER_CUDA_BYTES,
            GpuTier::Embedding => MIN_EMBEDDING_CUDA_BYTES,
        };
        budget >= threshold
    }

    pub fn llama_gpu_layers_for(&self, tier: GpuTier, model_size_bytes: u64, n_layer: u32) -> u32 {
        if !self.has_cuda() || n_layer == 0 || model_size_bytes == 0 {
            return 0;
        }

        let budget = self.budget_bytes(tier) as u64;
        if budget == 0 {
            return 0;
        }

        let effective_budget = budget.saturating_mul(LLM_SAFE_RATIO_NUM as u64) / LLM_SAFE_RATIO_DEN as u64;
        let per_layer = ((model_size_bytes + u64::from(n_layer) - 1) / u64::from(n_layer)).max(1);
        let layers = (effective_budget / per_layer).min(u64::from(n_layer)) as u32;

        if tier == GpuTier::Llm && layers == 0 && effective_budget > 0 {
            1
        } else {
            layers
        }
    }

    pub fn llama_context_profile(&self, tier: GpuTier) -> (u32, u32, u32) {
        let free = self.cuda_memory_free;
        match tier {
            GpuTier::Embedding => (512, 256, 64),
            _ if free >= gib(16) => (4096, 512, 256),
            _ if free >= gib(12) => (4096, 256, 128),
            _ if free >= gib(8) => (3072, 256, 128),
            _ if free >= gib(6) => (2048, 128, 64),
            _ => (1536, 64, 32),
        }
    }
}

pub fn probe_llama_model(backend: &Arc<LlamaBackend>, model_path: &str) -> anyhow::Result<LlamaProbe> {
    if !Path::new(model_path).exists() {
        return Err(anyhow::anyhow!("Model file not found: {}", model_path));
    }

    let model_params = LlamaModelParams::default()
        .with_no_alloc(true)
        .with_n_gpu_layers(0);

    let model = LlamaModel::load_from_file(backend, model_path, &model_params)
        .map_err(|err| anyhow::anyhow!("Failed to probe model {}: {:?}", model_path, err))?;

    Ok(LlamaProbe {
        size_bytes: model.size(),
        n_layer: model.n_layer(),
    })
}

fn gib(count: usize) -> usize {
    count * 1024 * 1024 * 1024
}
