use super::super::{DownloadProgress, ModelInfo, QuantizationType};
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::io::BufWriter;

pub(super) struct ParakeetDownloadPlan {
    pub(super) model_info: ModelInfo,
    pub(super) base_url: &'static str,
    pub(super) files: Vec<&'static str>,
    pub(super) file_sizes: HashMap<&'static str, u64>,
    pub(super) total_size_bytes: u64,
    pub(super) already_downloaded: u64,
}

pub(super) struct ParakeetFileRequest<'a> {
    pub(super) model_name: &'a str,
    pub(super) base_url: &'a str,
    pub(super) model_dir: &'a Path,
    pub(super) filename: &'a str,
    pub(super) index: usize,
    pub(super) expected_size: u64,
}

pub(super) struct StartedFileDownload {
    pub(super) response: reqwest::Response,
    pub(super) file_total_size: u64,
    pub(super) resuming: bool,
}

pub(super) struct ParakeetStreamContext<'a> {
    pub(super) model_name: &'a str,
    pub(super) index: usize,
    pub(super) file_total_size: u64,
    pub(super) existing_size: u64,
}

pub(super) struct ProgressTracker {
    pub(super) total_downloaded: u64,
    pub(super) total_size_bytes: u64,
    pub(super) total_files: usize,
    progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    already_downloaded: u64,
    download_start_time: Instant,
    last_report_time: Instant,
    bytes_since_last_report: u64,
    last_reported_progress: u8,
}

impl ProgressTracker {
    pub(super) fn new(
        total_size_bytes: u64,
        already_downloaded: u64,
        total_files: usize,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Self {
        Self {
            total_downloaded: already_downloaded,
            total_size_bytes,
            total_files,
            progress_callback,
            already_downloaded,
            download_start_time: Instant::now(),
            last_report_time: Instant::now(),
            bytes_since_last_report: 0,
            last_reported_progress: 0,
        }
    }

    pub(super) fn record_chunk(&mut self, chunk_len: u64) {
        self.total_downloaded += chunk_len;
        self.bytes_since_last_report += chunk_len;
    }

    pub(super) fn overall_progress(
        &self,
        file_downloaded: u64,
        file_total_size: u64,
        index: usize,
    ) -> u8 {
        if self.total_size_bytes > 0 {
            ((self.total_downloaded as f64 / self.total_size_bytes as f64) * 100.0).min(99.0) as u8
        } else {
            ((index as f64 + (file_downloaded as f64 / file_total_size.max(1) as f64))
                / self.total_files as f64
                * 100.0) as u8
        }
    }

    pub(super) fn should_report(&self, progress: u8, complete: bool) -> bool {
        progress > self.last_reported_progress
            || self.last_report_time.elapsed() >= Duration::from_millis(500)
            || complete
    }

    pub(super) fn current_speed_mbps(&self) -> f64 {
        let elapsed = self.last_report_time.elapsed();
        if elapsed.as_secs_f64() >= 0.1 {
            (self.bytes_since_last_report as f64 / (1024.0 * 1024.0)) / elapsed.as_secs_f64()
        } else {
            self.final_speed_mbps()
        }
    }

    pub(super) fn final_speed_mbps(&self) -> f64 {
        let elapsed = self.download_start_time.elapsed().as_secs_f64();
        if elapsed > 0.0 {
            ((self.total_downloaded - self.already_downloaded) as f64 / (1024.0 * 1024.0)) / elapsed
        } else {
            0.0
        }
    }

    pub(super) fn mark_reported(&mut self, progress: u8) {
        self.last_reported_progress = progress;
        self.last_report_time = Instant::now();
        self.bytes_since_last_report = 0;
    }

    pub(super) fn emit_progress(&self, speed_mbps: f64) {
        if let Some(callback) = &self.progress_callback {
            callback(DownloadProgress::new(
                self.total_downloaded,
                self.total_size_bytes,
                speed_mbps,
            ));
        }
    }

    pub(super) fn emit_final_progress(&self) {
        if let Some(callback) = &self.progress_callback {
            callback(DownloadProgress::new(
                self.total_size_bytes,
                self.total_size_bytes,
                self.final_speed_mbps(),
            ));
        }
    }
}

pub(super) fn download_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .tcp_nodelay(true)
        .pool_max_idle_per_host(1)
        .timeout(Duration::from_secs(3600))
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))
}

pub(super) fn files_for_quantization(quantization: &QuantizationType) -> Vec<&'static str> {
    match quantization {
        QuantizationType::Int8 => vec![
            "encoder-model.int8.onnx",
            "decoder_joint-model.int8.onnx",
            "nemo128.onnx",
            "vocab.txt",
        ],
        QuantizationType::FP32 => vec![
            "encoder-model.onnx",
            "decoder_joint-model.onnx",
            "nemo128.onnx",
            "vocab.txt",
        ],
    }
}

pub(super) fn file_sizes_for_model(
    model_name: &str,
    quantization: &QuantizationType,
) -> HashMap<&'static str, u64> {
    match quantization {
        QuantizationType::Int8 if model_name.contains("-v2-") => [
            ("encoder-model.int8.onnx", 652_000_000),
            ("decoder_joint-model.int8.onnx", 9_000_000),
            ("nemo128.onnx", 140_000),
            ("vocab.txt", 9_380),
        ]
        .into_iter()
        .collect(),
        QuantizationType::Int8 => [
            ("encoder-model.int8.onnx", 652_000_000),
            ("decoder_joint-model.int8.onnx", 18_200_000),
            ("nemo128.onnx", 140_000),
            ("vocab.txt", 93_900),
        ]
        .into_iter()
        .collect(),
        QuantizationType::FP32 => [
            ("encoder-model.onnx", 41_800_000 + 2_440_000_000),
            ("decoder_joint-model.onnx", 72_500_000),
            ("nemo128.onnx", 140_000),
            ("vocab.txt", 93_900),
        ]
        .into_iter()
        .collect(),
    }
}

pub(super) async fn existing_downloaded_bytes(
    model_dir: &Path,
    files: &[&str],
    file_sizes: &HashMap<&str, u64>,
) -> u64 {
    let mut already_downloaded = 0;
    for filename in files {
        let file_path = model_dir.join(filename);
        if let Ok(metadata) = fs::metadata(&file_path).await {
            let expected_size = file_sizes.get(filename).copied().unwrap_or(0);
            already_downloaded += metadata.len().min(expected_size);
        }
    }
    already_downloaded
}

pub(super) async fn existing_file_size(file_path: &Path) -> u64 {
    fs::metadata(file_path).await.map(|m| m.len()).unwrap_or(0)
}

pub(super) async fn send_download_request(
    client: &reqwest::Client,
    file_url: &str,
    existing_size: u64,
    filename: &str,
) -> Result<reqwest::Response> {
    let mut request = client.get(file_url);
    if existing_size > 0 {
        request = request.header("Range", format!("bytes={}-", existing_size));
        log::info!("Resuming download from byte {}", existing_size);
    }
    request
        .send()
        .await
        .map_err(|e| anyhow!("Failed to start download for {}: {}", filename, e))
}

pub(super) async fn open_download_file(
    file_path: &Path,
    filename: &str,
    resuming: bool,
) -> Result<BufWriter<fs::File>> {
    let file = if resuming {
        fs::OpenOptions::new()
            .append(true)
            .open(file_path)
            .await
            .map_err(|e| anyhow!("Failed to open file for resume {}: {}", filename, e))?
    } else {
        fs::File::create(file_path)
            .await
            .map_err(|e| anyhow!("Failed to create file {}: {}", filename, e))?
    };
    Ok(BufWriter::with_capacity(8 * 1024 * 1024, file))
}

pub(super) fn file_is_complete(existing_size: u64, expected_size: u64) -> bool {
    let size_tolerance = (expected_size as f64 * 0.99) as u64;
    existing_size >= size_tolerance && expected_size > 0
}

pub(super) fn download_error_label(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "Connection timeout - Check your internet"
    } else if error.is_connect() {
        "Connection failed - Check your internet"
    } else if error.is_body() {
        "Stream interrupted - Network unstable"
    } else {
        "Download error"
    }
}
