use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::token::LlamaToken;
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::gpu::{self, GpuPlanner, GpuTier};

const DEFAULT_RERANK_INSTRUCT: &str = "Given a web search query, retrieve relevant passages that answer the query";
const DEFAULT_RERANK_CANDIDATE_POOL: usize = 8;
const DEFAULT_RERANK_SIMILARITY_THRESHOLD: f32 = 0.3;
const DEFAULT_RERANK_TOP_K: usize = 3;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RerankConfigPatch {
    #[serde(default)]
    pub candidate_pool: Option<usize>,
    #[serde(default)]
    pub similarity_threshold: Option<f32>,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub instruction: Option<String>,
}

#[derive(Clone, Debug)]
struct RerankDefaults {
    candidate_pool: usize,
    similarity_threshold: f32,
    top_k: usize,
    instruction: String,
}

#[derive(Clone, Debug)]
struct ResolvedRerankConfig {
    candidate_pool: usize,
    similarity_threshold: f32,
    top_k: usize,
    instruction: String,
}

impl RerankDefaults {
    fn from_env() -> Self {
        let candidate_pool = std::env::var("QWEN_RERANK_CANDIDATE_POOL")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_RERANK_CANDIDATE_POOL)
            .max(1);
        let similarity_threshold = std::env::var("QWEN_RERANK_SIMILARITY_THRESHOLD")
            .ok()
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(DEFAULT_RERANK_SIMILARITY_THRESHOLD)
            .clamp(0.0, 1.0);
        let top_k = std::env::var("QWEN_RERANK_TOP_K")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_RERANK_TOP_K);
        let instruction = std::env::var("QWEN_RERANK_INSTRUCT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_RERANK_INSTRUCT.to_string());

        Self {
            candidate_pool,
            similarity_threshold,
            top_k,
            instruction,
        }
    }

    fn resolve(&self, patch: Option<&RerankConfigPatch>) -> ResolvedRerankConfig {
        let patch = patch.cloned().unwrap_or_default();
        let candidate_pool = patch
            .candidate_pool
            .unwrap_or(self.candidate_pool)
            .max(1);
        let similarity_threshold = patch
            .similarity_threshold
            .unwrap_or(self.similarity_threshold)
            .clamp(0.0, 1.0);
        let top_k = patch.top_k.unwrap_or(self.top_k);
        let instruction = patch
            .instruction
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| self.instruction.clone());

        ResolvedRerankConfig {
            candidate_pool,
            similarity_threshold,
            top_k,
            instruction,
        }
    }
}

struct EmbeddingModel {
    ctx: LlamaContext<'static>,
    model: &'static LlamaModel,
    dim: usize,
}

impl Drop for EmbeddingModel {
    fn drop(&mut self) {
        unsafe {
            drop(Box::from_raw(
                self.model as *const LlamaModel as *mut LlamaModel,
            ));
        }
    }
}

unsafe impl Send for EmbeddingModel {}
unsafe impl Sync for EmbeddingModel {}

struct RerankerModel {
    ctx: LlamaContext<'static>,
    model: &'static LlamaModel,
    yes_token: LlamaToken,
    no_token: LlamaToken,
    instruction: String,
}

impl Drop for RerankerModel {
    fn drop(&mut self) {
        unsafe {
            drop(Box::from_raw(
                self.model as *const LlamaModel as *mut LlamaModel,
            ));
        }
    }
}

unsafe impl Send for RerankerModel {}
unsafe impl Sync for RerankerModel {}

struct Document {
    text: String,
    embedding: Vec<f32>,
}

pub struct RagEngine {
    backend: Arc<LlamaBackend>,
    gpu: Arc<GpuPlanner>,
    rerank_defaults: RerankDefaults,
    embed_model: Arc<Mutex<Option<EmbeddingModel>>>,
    rerank_model: Arc<Mutex<Option<RerankerModel>>>,
    documents: Arc<Mutex<Vec<Document>>>,
}

impl RagEngine {
    pub fn new(backend: Arc<LlamaBackend>, gpu: Arc<GpuPlanner>) -> Self {
        Self {
            backend,
            gpu,
            rerank_defaults: RerankDefaults::from_env(),
            embed_model: Arc::new(Mutex::new(None)),
            rerank_model: Arc::new(Mutex::new(None)),
            documents: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn load_embedding_model(&self, path: &str) -> anyhow::Result<()> {
        if !Path::new(path).exists() {
            info!(
                "Embedding model not found at {}, RAG will return empty context",
                path
            );
            return Ok(());
        }

        let backend = self.backend.clone();
        let gpu = self.gpu.clone();
        let path = path.to_string();
        let embedding = tokio::task::spawn_blocking(move || -> anyhow::Result<EmbeddingModel> {
            let probe = gpu::probe_llama_model(&backend, &path)?;
            let candidate_layers = build_layer_candidates(
                gpu.llama_gpu_layers_for(GpuTier::Embedding, probe.size_bytes, probe.n_layer),
                probe.n_layer,
            );
            let ctx_profiles = build_context_profiles(&gpu, GpuTier::Embedding);
            let mut last_error: Option<anyhow::Error> = None;

            for trial_layers in candidate_layers {
                let mut model_params = LlamaModelParams::default().with_n_gpu_layers(trial_layers);
                if trial_layers > 0 {
                    if let Some(device_index) = gpu.cuda_device_index() {
                        model_params = model_params
                            .with_devices(&[device_index])
                            .map_err(|err| anyhow::anyhow!(err.to_string()))?;
                    }
                }

                let model = match LlamaModel::load_from_file(&backend, &path, &model_params) {
                    Ok(model) => model,
                    Err(err) => {
                        last_error = Some(anyhow::anyhow!("Failed to load embedding model: {:?}", err));
                        continue;
                    }
                };

                let dim = model.n_embd() as usize;
                let model_ref: &'static LlamaModel = Box::leak(Box::new(model));
                for (n_ctx, n_batch, n_ubatch) in &ctx_profiles {
                    let ctx_params = LlamaContextParams::default()
                        .with_n_ctx(Some(NonZeroU32::new(*n_ctx).unwrap()))
                        .with_n_batch(*n_batch)
                        .with_n_ubatch(*n_ubatch)
                        .with_embeddings(true);

                    match model_ref.new_context(&backend, ctx_params) {
                        Ok(ctx) => {
                            info!(
                                "Embedding model loaded (dim={}, gpu_layers={}, device={:?})",
                                dim,
                                trial_layers,
                                gpu.cuda_device_index()
                            );
                            return Ok(EmbeddingModel {
                                ctx,
                                model: model_ref,
                                dim,
                            });
                        }
                        Err(err) => {
                            last_error = Some(anyhow::anyhow!("Failed to create embedding context: {:?}", err));
                        }
                    }
                }

                unsafe {
                    drop(Box::from_raw(model_ref as *const LlamaModel as *mut LlamaModel));
                }
            }

            Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to load embedding model with auto GPU policy")))
        })
        .await
        .map_err(|err| anyhow::anyhow!("Failed to join embedding loader: {}", err))??;

        {
            let mut guard = self.embed_model.lock().await;
            *guard = Some(embedding);
        }
        // ^^ lock released here — add_documents also needs embed_model lock

        // Seed with some knowledge documents
        self.add_documents(&[
            "Qwen is an advanced AI developed by Alibaba Cloud.",
            "Qwen3.5 is the latest version with improved reasoning and multilingual support.",
            "Tongyi Qianwen (Qwen) offers models from 0.5B to 72B parameters.",
            "Digital human technology combines ASR, NLP, TTS, and computer graphics.",
            "This project uses WebGPU for real-time 3D avatar rendering with a Rust backend.",
        ])
        .await;

        Ok(())
    }

    pub async fn load_reranker_model(&self, path: &str) -> anyhow::Result<()> {
        if !Path::new(path).exists() {
            info!(
                "Reranker model not found at {}, RAG will fall back to embedding-only retrieval",
                path
            );
            return Ok(());
        }

        let backend = self.backend.clone();
        let gpu = self.gpu.clone();
        let path = path.to_string();
        let instruction = self.rerank_defaults.instruction.clone();
        let reranker = tokio::task::spawn_blocking(move || -> anyhow::Result<RerankerModel> {
            let probe = gpu::probe_llama_model(&backend, &path)?;
            let candidate_layers = build_layer_candidates(
                gpu.llama_gpu_layers_for(GpuTier::Reranker, probe.size_bytes, probe.n_layer),
                probe.n_layer,
            );
            let ctx_profiles = build_reranker_context_profiles(&gpu);
            let mut last_error: Option<anyhow::Error> = None;

            for trial_layers in candidate_layers {
                let mut model_params = LlamaModelParams::default().with_n_gpu_layers(trial_layers);
                if trial_layers > 0 {
                    if let Some(device_index) = gpu.cuda_device_index() {
                        model_params = model_params
                            .with_devices(&[device_index])
                            .map_err(|err| anyhow::anyhow!(err.to_string()))?;
                    }
                }

                let model = match LlamaModel::load_from_file(&backend, &path, &model_params) {
                    Ok(model) => model,
                    Err(err) => {
                        last_error = Some(anyhow::anyhow!("Failed to load reranker model: {:?}", err));
                        continue;
                    }
                };

                let model_ref: &'static LlamaModel = Box::leak(Box::new(model));
                let yes_token = first_token_or_err(model_ref, "yes")?;
                let no_token = first_token_or_err(model_ref, "no")?;

                for (n_ctx, n_batch, n_ubatch) in &ctx_profiles {
                    let ctx_params = LlamaContextParams::default()
                        .with_n_ctx(Some(NonZeroU32::new(*n_ctx).unwrap()))
                        .with_n_batch(*n_batch)
                        .with_n_ubatch(*n_ubatch);

                    match model_ref.new_context(&backend, ctx_params) {
                        Ok(ctx) => {
                            info!(
                                "Reranker model loaded (ctx={}, gpu_layers={}, device={:?})",
                                n_ctx,
                                trial_layers,
                                gpu.cuda_device_index()
                            );
                            return Ok(RerankerModel {
                                ctx,
                                model: model_ref,
                                yes_token,
                                no_token,
                                instruction: instruction.clone(),
                            });
                        }
                        Err(err) => {
                            last_error = Some(anyhow::anyhow!("Failed to create reranker context: {:?}", err));
                        }
                    }
                }

                unsafe {
                    drop(Box::from_raw(model_ref as *const LlamaModel as *mut LlamaModel));
                }
            }

            Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to load reranker model with auto GPU policy")))
        })
        .await
        .map_err(|err| anyhow::anyhow!("Failed to join reranker loader: {}", err))??;

        let mut guard = self.rerank_model.lock().await;
        *guard = Some(reranker);
        Ok(())
    }

    pub async fn add_documents(&self, texts: &[&str]) {
        let mut emb_guard = self.embed_model.lock().await;
        let emb = match emb_guard.as_mut() {
            Some(e) => e,
            None => return,
        };

        let mut docs = self.documents.lock().await;
        for text in texts {
            let embedding = match encode_text(emb, text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            docs.push(Document {
                text: text.to_string(),
                embedding,
            });
        }
        info!("RAG document count: {}", docs.len());
    }

    pub async fn retrieve(&self, query: &str) -> String {
        self.retrieve_with_config(query, None).await
    }

    pub async fn retrieve_with_config(
        &self,
        query: &str,
        override_config: Option<&RerankConfigPatch>,
    ) -> String {
        let config = self.rerank_defaults.resolve(override_config);
        if config.top_k == 0 {
            return String::new();
        }

        let candidates = {
            let mut emb_guard = self.embed_model.lock().await;
            let emb = match emb_guard.as_mut() {
                Some(e) => e,
                None => return String::new(),
            };

            let docs = self.documents.lock().await;
            if docs.is_empty() {
                return String::new();
            }

            let query_emb = match encode_text(emb, query) {
                Ok(v) => v,
                Err(_) => return String::new(),
            };

            // Cosine similarity search — keep a small candidate pool first, then rerank.
            let mut scored: Vec<(usize, f32)> = docs
                .iter()
                .enumerate()
                .map(|(i, doc)| (i, cosine_similarity(&query_emb, &doc.embedding)))
                .collect();

            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(config.candidate_pool.min(scored.len()));

            let threshold = config.similarity_threshold;
            scored
                .iter()
                .filter(|(_, score)| *score >= threshold)
                .map(|(i, _)| docs[*i].text.clone())
                .collect::<Vec<_>>()
        };

        if candidates.is_empty() {
            return String::new();
        }

        let reranked = self.rerank(query, candidates, &config.instruction).await;
        let top = reranked.into_iter().take(config.top_k).collect::<Vec<_>>();

        if top.is_empty() {
            String::new()
        } else {
            top.join("\n")
        }
    }

    pub async fn rerank(&self, query: &str, docs: Vec<String>, instruction: &str) -> Vec<String> {
        if docs.len() <= 1 {
            return docs;
        }

        let mut guard = self.rerank_model.lock().await;
        let reranker = match guard.as_mut() {
            Some(model) => model,
            None => return docs,
        };

        let mut scored = Vec::with_capacity(docs.len());
        let mut kept = vec![false; docs.len()];

        for (index, doc) in docs.iter().enumerate() {
            match score_reranker_pair(reranker, instruction, query, doc) {
                Ok(score) => {
                    scored.push((index, score));
                    kept[index] = true;
                }
                Err(err) => {
                    warn!("Reranker score failed for candidate {}: {}", index, err);
                }
            }
        }

        if scored.is_empty() {
            return docs;
        }

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut ordered = scored
            .into_iter()
            .map(|(index, _)| docs[index].clone())
            .collect::<Vec<_>>();

        for (index, doc) in docs.into_iter().enumerate() {
            if !kept[index] {
                ordered.push(doc);
            }
        }

        ordered
    }
}

fn build_layer_candidates(best_layers: u32, total_layers: u32) -> Vec<u32> {
    let mut candidates = vec![best_layers];
    let step = (total_layers / 8).max(1);

    if best_layers > step {
        candidates.push(best_layers.saturating_sub(step));
    }
    if best_layers > step * 2 {
        candidates.push(best_layers.saturating_sub(step * 2));
    }
    candidates.push(0);

    candidates.sort_unstable_by(|a, b| b.cmp(a));
    candidates.dedup();
    candidates
}

fn build_context_profiles(gpu: &GpuPlanner, tier: GpuTier) -> Vec<(u32, u32, u32)> {
    let (n_ctx, n_batch, n_ubatch) = gpu.llama_context_profile(tier);
    let mut profiles = vec![(n_ctx, n_batch, n_ubatch)];

    for profile in [
        (512, 256, 64),
        (384, 128, 64),
        (256, 64, 32),
    ] {
        if !profiles.contains(&profile) {
            profiles.push(profile);
        }
    }

    profiles
}

fn build_reranker_context_profiles(gpu: &GpuPlanner) -> Vec<(u32, u32, u32)> {
    let mut profiles = vec![(2048, 256, 128), (1536, 128, 64), (1024, 64, 32)];
    let (n_ctx, n_batch, n_ubatch) = gpu.llama_context_profile(GpuTier::Reranker);
    let first = (n_ctx.min(2048), n_batch.min(256), n_ubatch.min(128));
    if !profiles.contains(&first) {
        profiles.insert(0, first);
    }
    profiles
}

fn first_token_or_err(model: &LlamaModel, text: &str) -> anyhow::Result<LlamaToken> {
    let variants = [text.to_string(), format!(" {}", text)];
    for variant in variants {
        let tokens = model
            .str_to_token(&variant, AddBos::Never)
            .map_err(|err| anyhow::anyhow!("Tokenize {} failed: {:?}", text, err))?;
        if tokens.len() == 1 {
            return Ok(tokens[0]);
        }
    }

    Err(anyhow::anyhow!(
        "Reranker token {} did not map to a single token",
        text
    ))
}

fn build_reranker_prompt(instruction: &str, query: &str, document: &str) -> String {
    format!(
        "<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n<Instruct>: {}\n<Query>: {}\n<Document>: {}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n",
        instruction,
        query.trim(),
        document.trim(),
    )
}

fn score_reranker_pair(
    reranker: &mut RerankerModel,
    instruction: &str,
    query: &str,
    document: &str,
) -> anyhow::Result<f32> {
    let mut doc_text = document.trim().to_string();
    if doc_text.is_empty() {
        return Ok(0.0);
    }

    for _ in 0..3 {
        let instruction = if instruction.trim().is_empty() {
            &reranker.instruction
        } else {
            instruction
        };
        let prompt = build_reranker_prompt(instruction, query, &doc_text);
        let tokens = reranker
            .model
            .str_to_token(&prompt, AddBos::Never)
            .map_err(|err| anyhow::anyhow!("Reranker tokenize failed: {:?}", err))?;

        let ctx_limit = reranker.ctx.n_ctx() as usize;
        if tokens.len() < ctx_limit {
            reranker.ctx.clear_kv_cache();
            let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
            batch
                .add_sequence(&tokens, 0, false)
                .map_err(|err| anyhow::anyhow!("Reranker batch failed: {:?}", err))?;

            reranker
                .ctx
                .decode(&mut batch)
                .map_err(|err| anyhow::anyhow!("Reranker decode failed: {:?}", err))?;

            let logits = reranker.ctx.get_logits();
            let yes_idx = usize::try_from(reranker.yes_token.0)
                .map_err(|_| anyhow::anyhow!("Invalid yes token id"))?;
            let no_idx = usize::try_from(reranker.no_token.0)
                .map_err(|_| anyhow::anyhow!("Invalid no token id"))?;
            let yes_logit = *logits
                .get(yes_idx)
                .ok_or_else(|| anyhow::anyhow!("Yes token logit missing"))?;
            let no_logit = *logits
                .get(no_idx)
                .ok_or_else(|| anyhow::anyhow!("No token logit missing"))?;
            let score = sigmoid_pair(yes_logit, no_logit);
            return Ok(score);
        }

        let keep = doc_text.chars().count().saturating_mul(3) / 4;
        if keep == 0 || keep >= doc_text.chars().count() {
            break;
        }
        doc_text = doc_text.chars().take(keep).collect::<String>();
    }

    Err(anyhow::anyhow!(
        "Reranker prompt too long even after truncation"
    ))
}

fn sigmoid_pair(yes_logit: f32, no_logit: f32) -> f32 {
    let delta = yes_logit - no_logit;
    if delta >= 0.0 {
        let z = (-delta).exp();
        1.0 / (1.0 + z)
    } else {
        let z = delta.exp();
        z / (1.0 + z)
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let (dot, norm_a, norm_b) = a
        .iter()
        .zip(b.iter())
        .fold((0.0f32, 0.0f32, 0.0f32), |(d, na, nb), (&x, &y)| {
            (d + x * y, na + x * x, nb + y * y)
        });
    let denom = (norm_a * norm_b).sqrt();
    if denom < 1e-9 {
        0.0
    } else {
        dot / denom
    }
}

fn encode_text(emb: &mut EmbeddingModel, text: &str) -> anyhow::Result<Vec<f32>> {
    let tokens = emb
        .model
        .str_to_token(text, AddBos::Always)
        .map_err(|e| anyhow::anyhow!("Tokenize error: {:?}", e))?;

    if tokens.is_empty() {
        return Ok(vec![0.0; emb.dim]);
    }

    let n_tokens = tokens.len();
    let mut batch = LlamaBatch::new(512, 1);
    batch
        .add_sequence(&tokens, 0, true)
        .map_err(|e| anyhow::anyhow!("Batch error: {:?}", e))?;

    // Use decode (instead of encode) — Qwen3-Embedding is decoder-only architecture
    emb.ctx.clear_kv_cache_seq(Some(0), None, None).ok();
    emb.ctx
        .decode(&mut batch)
        .map_err(|e| anyhow::anyhow!("Decode error: {:?}", e))?;

    // Mean pool per-token embeddings
    let mut pooled = vec![0.0f32; emb.dim];
    for i in 0..n_tokens {
        let emb_i = emb
            .ctx
            .embeddings_ith(i as i32)
            .map_err(|e| anyhow::anyhow!("Embedding extract error at token {}: {:?}", i, e))?;
        for (p, &v) in pooled.iter_mut().zip(emb_i.iter()) {
            *p += v;
        }
    }
    let n = n_tokens as f32;
    for v in &mut pooled {
        *v /= n;
    }

    Ok(pooled)
}
