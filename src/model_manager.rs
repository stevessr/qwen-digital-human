use dashmap::DashMap;
use reqwest::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{error, info};

#[derive(Serialize, Clone)]
pub struct ModelInfo {
    pub name: String,
    pub description: String,
    pub url: String,
    pub size: String,
    pub installed: bool,
    pub progress: Option<f32>,
    pub expected_sha256: String,
}

pub struct ModelManager {
    base_dir: String,
    progress_map: Arc<DashMap<String, f32>>,
    client: Client,
}

impl ModelManager {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        Self {
            base_dir: "models".to_string(),
            progress_map: Arc::new(DashMap::new()),
            client,
        }
    }

    pub async fn init(&self) -> anyhow::Result<()> {
        if !Path::new(&self.base_dir).exists() {
            fs::create_dir_all(&self.base_dir).await?;
        }
        Ok(())
    }

    pub fn get_progress(&self, name: &str) -> Option<f32> {
        self.progress_map.get(name).map(|v| *v.value())
    }

    pub async fn download_model(&self, name: String, url: String) -> anyhow::Result<()> {
        let dest_path = format!("{}/{}", self.base_dir, name);
        if Path::new(&dest_path).exists() {
            return Ok(());
        }

        info!("Attempting to download {}: {}", name, url);
        self.progress_map.insert(name.clone(), 0.01);

        // Try Native Download with UA first
        match self.download_native(&name, &url, &dest_path).await {
            Ok(_) => {
                info!("Native download successful for {}", name);
            }
            Err(e) => {
                error!(
                    "Native download failed ({}): {}. Falling back to wget...",
                    name, e
                );
                self.download_via_wget(&name, &url, &dest_path).await?;
            }
        }

        self.progress_map.remove(&name);
        Ok(())
    }

    async fn download_native(&self, name: &str, url: &str, dest: &str) -> anyhow::Result<()> {
        let response = self.client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("HTTP Error: {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut file = fs::File::create(dest).await?;

        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        while let Some(item) = stream.next().await {
            let chunk = item?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            if total_size > 0 {
                let progress = (downloaded as f32 / total_size as f32) * 100.0;
                self.progress_map
                    .insert(name.to_string(), progress.min(99.9));
            }
        }
        Ok(())
    }

    async fn download_via_wget(&self, name: &str, url: &str, dest: &str) -> anyhow::Result<()> {
        info!("Executing: wget -O {} {}", dest, url);
        let status = Command::new("wget")
            .arg("-O")
            .arg(dest)
            .arg("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .arg(url)
            .status();

        match status {
            Ok(s) if s.success() => {
                info!("Wget download completed for {}", name);
                Ok(())
            }
            Ok(s) => Err(anyhow::anyhow!("Wget failed with exit code: {}", s)),
            Err(e) => Err(anyhow::anyhow!("Failed to spawn wget: {}", e)),
        }
    }

    pub async fn delete_model(&self, name: &str) -> anyhow::Result<()> {
        let dest_path = format!("{}/{}", self.base_dir, name);
        if Path::new(&dest_path).exists() {
            fs::remove_file(dest_path).await?;
            info!("Model {} deleted.", name);
        }
        Ok(())
    }

    pub async fn verify_model(&self, name: &str, expected_sha256: &str) -> bool {
        if expected_sha256.is_empty() {
            return true;
        }
        let dest_path = format!("{}/{}", self.base_dir, name);
        if !Path::new(&dest_path).exists() {
            return false;
        }

        let mut file = match fs::File::open(&dest_path).await {
            Ok(f) => f,
            Err(_) => return false,
        };

        let mut hasher = Sha256::new();
        let mut buffer = [0; 8192];
        loop {
            let n = match file.read(&mut buffer).await {
                Ok(n) if n == 0 => break,
                Ok(n) => n,
                Err(_) => return false,
            };
            hasher.update(&buffer[..n]);
        }
        let result = hasher.finalize();
        let actual_sha256 = hex::encode(result);
        actual_sha256 == expected_sha256
    }

    pub async fn get_model_library(&self) -> Vec<ModelInfo> {
        let library = vec![
            ModelInfo {
                name: "Qwen3.5-0.8B-Q4_K_M.gguf".to_string(),
                description: "LLM (Unsloth): Qwen 3.5 0.8B GGUF 极致优化版".to_string(),
                url: "https://www.modelscope.cn/models/unsloth/Qwen3.5-0.8B-GGUF/resolve/master/Qwen3.5-0.8B-Q4_K_M.gguf".to_string(),
                size: "0.53 GB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517".to_string(),
            },
            ModelInfo {
                name: "Qwen3-ASR-0.6B-Q8_0.gguf".to_string(),
                description: "ASR: Qwen3 0.6B 官方原生语音识别模型 (GGUF 8-bit)".to_string(),
                url: "https://www.modelscope.cn/models/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/master/Qwen3-ASR-0.6B-Q8_0.gguf".to_string(),
                size: "805 MB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "".to_string(),
            },
            ModelInfo {
                name: "qwen3-reranker-0.6b-q8_0.gguf".to_string(),
                description: "Reranker: Qwen3 0.6B 官方重排序模型".to_string(),
                url: "https://www.modelscope.cn/models/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/master/qwen3-reranker-0.6b-q8_0.gguf".to_string(),
                size: "640 MB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "".to_string(),
            },
            ModelInfo {
                name: "Qwen3-Embedding-0.6B-Q8_0.gguf".to_string(),
                description: "Embedding: Qwen3 0.6B 官方原生向量模型".to_string(),
                url: "https://www.modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/master/Qwen3-Embedding-0.6B-Q8_0.gguf".to_string(),
                size: "620 MB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "".to_string(),
            },
            ModelInfo {
                name: "audio2verts.mnn".to_string(),
                description: "A2BS: 语音转顶点姿态模型 (UniTalker-MNN)".to_string(),
                url: "https://www.modelscope.cn/models/MNN/UniTalker-MNN/resolve/master/audio2verts.mnn".to_string(),
                size: "45 MB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "".to_string(),
            },
            ModelInfo {
                name: "render_full.nnr".to_string(),
                description: "NNR: 神经网络高清渲染模型 (TaoAvatar-NNR-MNN)".to_string(),
                url: "https://www.modelscope.cn/models/MNN/TaoAvatar-NNR-MNN/resolve/master/render_full.nnr".to_string(),
                size: "320 MB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "".to_string(),
            },
            ModelInfo {
                name: "chinese_bert.mnn".to_string(),
                description: "TTS: Qwen 官方推荐 Sambert 语音合成模型 (bert-vits2-MNN)".to_string(),
                url: "https://www.modelscope.cn/models/MNN/bert-vits2-MNN/resolve/master/common/mnn_models/chinese_bert.mnn".to_string(),
                size: "95 MB".to_string(),
                installed: false,
                progress: None,
                expected_sha256: "".to_string(),
            },
        ];

        let mut results = Vec::new();
        for mut m in library {
            let path = format!("{}/{}", self.base_dir, m.name);
            m.installed = Path::new(&path).exists();
            m.progress = self.get_progress(&m.name);
            results.push(m);
        }
        results
    }
}
