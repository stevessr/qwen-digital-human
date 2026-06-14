use futures_util::StreamExt;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::gpu::{self, GpuPlanner, GpuTier};

struct LoadedModel {
    model: &'static LlamaModel,
    ctx: LlamaContext<'static>,
}

impl Drop for LoadedModel {
    fn drop(&mut self) {
        unsafe {
            let ptr = self.model as *const LlamaModel;
            drop(Box::from_raw(ptr as *mut LlamaModel));
        }
    }
}

// SAFETY: llama-cpp-2 uses raw C pointers internally; Send/Sync is safe.
unsafe impl Send for LoadedModel {}
unsafe impl Sync for LoadedModel {}

struct ThinkFilter {
    buffer: String,
    in_think: bool,
}

impl ThinkFilter {
    const OPEN_TAG: &'static str = "<think>";
    const CLOSE_TAG: &'static str = "</think>";

    fn new() -> Self {
        Self {
            buffer: String::new(),
            in_think: false,
        }
    }

    fn push(&mut self, chunk: &str) -> String {
        self.buffer.push_str(chunk);
        let mut visible = String::new();

        loop {
            if self.in_think {
                if let Some(end_idx) = self.buffer.find(Self::CLOSE_TAG) {
                    self.buffer.drain(..end_idx + Self::CLOSE_TAG.len());
                    self.in_think = false;
                    continue;
                }

                let keep = suffix_prefix_len(&self.buffer, Self::CLOSE_TAG);
                if self.buffer.len() > keep {
                    let drain_len = self.buffer.len() - keep;
                    self.buffer.drain(..drain_len);
                }
                break;
            }

            if let Some(start_idx) = self.buffer.find(Self::OPEN_TAG) {
                visible.push_str(&self.buffer[..start_idx]);
                self.buffer.drain(..start_idx + Self::OPEN_TAG.len());
                self.in_think = true;
                continue;
            }

            let keep = suffix_prefix_len(&self.buffer, Self::OPEN_TAG);
            if self.buffer.len() > keep {
                let emit_len = self.buffer.len() - keep;
                visible.push_str(&self.buffer[..emit_len]);
                self.buffer.drain(..emit_len);
            }
            break;
        }

        if visible.contains(Self::CLOSE_TAG) {
            visible = visible.replace(Self::CLOSE_TAG, "");
        }

        visible
    }

    fn finish(&mut self) -> String {
        if self.in_think {
            self.buffer.clear();
            self.in_think = false;
            return String::new();
        }

        let keep = suffix_prefix_len(&self.buffer, Self::OPEN_TAG);
        let visible = if keep > 0 && self.buffer.len() > keep {
            self.buffer[..self.buffer.len() - keep].to_string()
        } else if keep == self.buffer.len() {
            String::new()
        } else {
            std::mem::take(&mut self.buffer)
        };
        self.buffer.clear();
        visible
    }
}

fn suffix_prefix_len(text: &str, tag: &str) -> usize {
    let text_bytes = text.as_bytes();
    let tag_bytes = tag.as_bytes();
    let max_len = text_bytes.len().min(tag_bytes.len().saturating_sub(1));

    for len in (1..=max_len).rev() {
        if text_bytes[text_bytes.len() - len..] == tag_bytes[..len] {
            return len;
        }
    }

    0
}

fn compose_system_prompt(system_prompt: &str, memory: &str, context: &str) -> Option<String> {
    let system_prompt = system_prompt.trim();
    let memory = memory.trim();
    let context = context.trim();

    let mut sections = Vec::new();
    if !system_prompt.is_empty() {
        sections.push(system_prompt.to_string());
    }
    if !memory.is_empty() {
        sections.push(format!("记忆:\n{}", memory));
    }
    if !context.is_empty() {
        sections.push(format!("上下文:\n{}", context));
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
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
        (3072, 256, 128),
        (2048, 128, 64),
        (1536, 64, 32),
        (1024, 32, 16),
    ] {
        if !profiles.contains(&profile) {
            profiles.push(profile);
        }
    }

    profiles
}

pub struct LlmEngine {
    backend: Arc<LlamaBackend>,
    gpu: Arc<GpuPlanner>,
    loaded: Arc<Mutex<Option<LoadedModel>>>,
}

impl LlmEngine {
    pub fn new(backend: Arc<LlamaBackend>, gpu: Arc<GpuPlanner>) -> Self {
        Self {
            backend,
            gpu,
            loaded: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn load_model(&self, model_path: &str) -> anyhow::Result<()> {
        if !Path::new(model_path).exists() {
            return Err(anyhow::anyhow!("Model file not found: {}", model_path));
        }

        let backend = self.backend.clone();
        let gpu = self.gpu.clone();
        let model_path = model_path.to_string();
        let loaded = tokio::task::spawn_blocking(move || -> anyhow::Result<LoadedModel> {
            let probe = gpu::probe_llama_model(&backend, &model_path)?;
            let mut candidate_layers = build_layer_candidates(
                gpu.llama_gpu_layers_for(GpuTier::Llm, probe.size_bytes, probe.n_layer),
                probe.n_layer,
            );
            if candidate_layers.is_empty() {
                candidate_layers.push(0);
            }

            let ctx_profiles = build_context_profiles(&gpu, GpuTier::Llm);
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

                let model = match LlamaModel::load_from_file(&backend, &model_path, &model_params) {
                    Ok(model) => model,
                    Err(err) => {
                        last_error = Some(anyhow::anyhow!("Failed to load LLM: {:?}", err));
                        continue;
                    }
                };

                let model_ref: &'static LlamaModel = Box::leak(Box::new(model));
                for (n_ctx, n_batch, n_ubatch) in &ctx_profiles {
                    let ctx_params = LlamaContextParams::default()
                        .with_n_ctx(Some(NonZeroU32::new(*n_ctx).unwrap()))
                        .with_n_batch(*n_batch)
                        .with_n_ubatch(*n_ubatch);

                    match model_ref.new_context(&backend, ctx_params) {
                        Ok(ctx) => {
                            let n_vocab = model_ref.n_vocab();
                            info!(
                                "LLM loaded (vocab={}, ctx={}, gpu_layers={}, device={:?})",
                                n_vocab,
                                n_ctx,
                                trial_layers,
                                gpu.cuda_device_index()
                            );
                            return Ok(LoadedModel {
                                model: model_ref,
                                ctx,
                            });
                        }
                        Err(err) => {
                            last_error = Some(anyhow::anyhow!("Failed to create context: {:?}", err));
                        }
                    }
                }

                unsafe {
                    drop(Box::from_raw(model_ref as *const LlamaModel as *mut LlamaModel));
                }
            }

            Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Failed to load LLM with auto GPU policy")))
        })
        .await
        .map_err(|err| anyhow::anyhow!("Failed to join LLM loader: {}", err))??;

        let mut guard = self.loaded.lock().await;
        // Drop previous model if any (Drop impl frees leaked box)
        *guard = Some(loaded);
        Ok(())
    }

    pub async fn generate(
        &self,
        message: &str,
        system_prompt: &str,
        memory: &str,
        context: &str,
        fast_mode: bool,
    ) -> anyhow::Result<String> {
        self.generate_with_callback(message, system_prompt, memory, context, fast_mode, |_| {
            Ok(())
        })
        .await
    }

    pub async fn generate_with_callback<F>(
        &self,
        message: &str,
        system_prompt: &str,
        memory: &str,
        context: &str,
        fast_mode: bool,
        mut on_chunk: F,
    ) -> anyhow::Result<String>
    where
        F: FnMut(String) -> anyhow::Result<()> + Send,
    {
        if fast_mode {
            self.generate_local(message, system_prompt, memory, context, &mut on_chunk)
                .await
        } else {
            self.generate_cloud(message, system_prompt, memory, context, &mut on_chunk)
                .await
        }
    }

    fn build_prompt(message: &str, system_prompt: &str, memory: &str, context: &str) -> String {
        match compose_system_prompt(system_prompt, memory, context) {
            Some(system_prompt) => format!(
                "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
                system_prompt, message
            ),
            None => format!(
                "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
                message
            ),
        }
    }

    fn append_visible_chunk<F>(
        think_filter: &mut ThinkFilter,
        chunk: String,
        on_chunk: &mut F,
        output: &mut String,
    ) -> anyhow::Result<()>
    where
        F: FnMut(String) -> anyhow::Result<()> + Send,
    {
        let visible = think_filter.push(&chunk);
        if !visible.is_empty() {
            on_chunk(visible.clone())?;
            output.push_str(&visible);
        }
        Ok(())
    }

    async fn generate_local<F>(
        &self,
        message: &str,
        system_prompt: &str,
        memory: &str,
        context: &str,
        on_chunk: &mut F,
    ) -> anyhow::Result<String>
    where
        F: FnMut(String) -> anyhow::Result<()> + Send,
    {
        let mut guard = self.loaded.lock().await;
        let loaded = guard.as_mut().ok_or_else(|| {
            anyhow::anyhow!("Local model not loaded. Download Qwen3.5-0.8B-Q4_K_M.gguf first.")
        })?;

        // The context is shared between requests, so clear the KV cache before
        // each generation. Otherwise the next prompt would start at position 0
        // while the previous request may have left tokens in the cache.
        loaded.ctx.clear_kv_cache();

        let prompt = Self::build_prompt(message, system_prompt, memory, context);

        // Tokenize the prompt.
        let tokens = loaded
            .model
            .str_to_token(&prompt, AddBos::Never)
            .map_err(|e| anyhow::anyhow!("Tokenization failed: {:?}", e))?;

        if tokens.is_empty() {
            return Err(anyhow::anyhow!("Empty token sequence"));
        }

        let n_prompt_tokens =
            i32::try_from(tokens.len()).map_err(|_| anyhow::anyhow!("Prompt is too long"))?;
        let n_ctx = i32::try_from(loaded.ctx.n_ctx())
            .map_err(|_| anyhow::anyhow!("Context size is too large"))?;
        anyhow::ensure!(
            n_prompt_tokens < n_ctx,
            "Prompt is too long for the current context window (prompt={}, ctx={})",
            n_prompt_tokens,
            n_ctx
        );

        // Leave one token of headroom so the generated token can still be
        // inserted into the KV cache.
        const DEFAULT_MAX_NEW_TOKENS: i32 = 2048;
        let available = n_ctx - n_prompt_tokens - 1;
        let max_tokens = available.min(DEFAULT_MAX_NEW_TOKENS).max(1);

        // Process the prompt.
        let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
        batch
            .add_sequence(&tokens, 0, false)
            .map_err(|e| anyhow::anyhow!("Batch add failed: {:?}", e))?;

        loaded
            .ctx
            .decode(&mut batch)
            .map_err(|e| anyhow::anyhow!("Initial decode failed: {:?}", e))?;

        // Sampler chain.
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::temp(0.7),
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::dist(42),
        ]);

        // Sample first token from the last prompt position.
        let last_prompt_idx = n_prompt_tokens - 1;
        let first_token = sampler.sample(&loaded.ctx, last_prompt_idx);

        let mut output = String::new();
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut think_filter = ThinkFilter::new();

        // Decode first sampled token so the next sample() has logits available.
        batch.clear();
        batch
            .add(first_token, n_prompt_tokens, &[0], true)
            .map_err(|e| anyhow::anyhow!("Batch add first token failed: {:?}", e))?;
        loaded
            .ctx
            .decode(&mut batch)
            .map_err(|e| anyhow::anyhow!("Decode first token failed: {:?}", e))?;

        if loaded.model.is_eog_token(first_token) || first_token == loaded.model.token_eos() {
            return Ok(String::new());
        }

        let piece = loaded
            .model
            .token_to_piece(first_token, &mut decoder, false, None)
            .map_err(|e| anyhow::anyhow!("Token decode failed: {:?}", e))?;
        Self::append_visible_chunk(&mut think_filter, piece, on_chunk, &mut output)?;
        sampler.accept(first_token);

        for pos in 1..max_tokens {
            let token = sampler.sample(&loaded.ctx, 0);

            if loaded.model.is_eog_token(token) || token == loaded.model.token_eos() {
                break;
            }

            let piece = loaded
                .model
                .token_to_piece(token, &mut decoder, false, None)
                .map_err(|e| anyhow::anyhow!("Token decode failed: {:?}", e))?;
            Self::append_visible_chunk(&mut think_filter, piece, on_chunk, &mut output)?;

            batch.clear();
            batch
                .add(token, n_prompt_tokens + pos, &[0], true)
                .map_err(|e| anyhow::anyhow!("Batch add token failed: {:?}", e))?;

            loaded
                .ctx
                .decode(&mut batch)
                .map_err(|e| anyhow::anyhow!("Decode failed at pos {}: {:?}", pos, e))?;

            sampler.accept(token);
        }

        output.push_str(&think_filter.finish());

        info!(
            "Generated {} chars (prompt_tokens={}, max_new_tokens={})",
            output.chars().count(),
            n_prompt_tokens,
            max_tokens
        );
        Ok(output.trim().to_string())
    }

    async fn generate_cloud<F>(
        &self,
        message: &str,
        system_prompt: &str,
        memory: &str,
        context: &str,
        on_chunk: &mut F,
    ) -> anyhow::Result<String>
    where
        F: FnMut(String) -> anyhow::Result<()> + Send,
    {
        info!("Using Cloud Qwen Omni/Max API");
        let api_key = std::env::var("DASHSCOPE_API_KEY").unwrap_or_default();
        if api_key.is_empty() {
            return Err(anyhow::anyhow!("DASHSCOPE_API_KEY not set. Set it for cloud mode or enable fast mode for local inference."));
        }

        let client = reqwest::Client::new();
        let mut messages = Vec::new();
        if let Some(system_prompt) = compose_system_prompt(system_prompt, memory, context) {
            messages.push(serde_json::json!({
                "role": "system",
                "content": system_prompt,
            }));
        }
        messages.push(serde_json::json!({
            "role": "user",
            "content": message,
        }));

        let res = client
            .post("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Accept", "text/event-stream")
            .json(&serde_json::json!({
                "model": "qwen-max",
                "stream": true,
                "messages": messages
            }))
            .send()
            .await?;

        let mut stream = res.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut output = String::new();
        let mut think_filter = ThinkFilter::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buffer.extend_from_slice(&chunk);

            while let Some(line_end) = buffer.iter().position(|b| *b == b'\n') {
                let line_bytes = buffer.drain(..=line_end).collect::<Vec<u8>>();
                let line = match std::str::from_utf8(&line_bytes) {
                    Ok(line) => line.trim(),
                    Err(err) => {
                        warn!("Skipping non-UTF8 cloud stream line: {}", err);
                        continue;
                    }
                };

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if !line.starts_with("data:") {
                    continue;
                }

                let data = line.strip_prefix("data:").unwrap_or(&line).trim();
                if data == "[DONE]" {
                    output.push_str(&think_filter.finish());
                    info!("Cloud stream completed ({} chars)", output.chars().count());
                    return Ok(output.trim().to_string());
                }

                let event: serde_json::Value = match serde_json::from_str(data) {
                    Ok(value) => value,
                    Err(err) => {
                        warn!(
                            "Failed to parse cloud streaming chunk: {} | raw={}",
                            err, data
                        );
                        continue;
                    }
                };

                if let Some(content) = event["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        Self::append_visible_chunk(
                            &mut think_filter,
                            content.to_string(),
                            on_chunk,
                            &mut output,
                        )?;
                    }
                }
            }
        }

        output.push_str(&think_filter.finish());
        Ok(output.trim().to_string())
    }
}
