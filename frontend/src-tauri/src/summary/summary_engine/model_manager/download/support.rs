use super::super::DownloadProgress;
use anyhow::{anyhow, Result};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncReadExt, BufWriter};

pub(super) struct StartedDownload {
    pub(super) response: reqwest::Response,
    pub(super) total_size: u64,
    pub(super) resuming: bool,
}

pub(super) struct DownloadProgressState {
    pub(super) downloaded: u64,
    pub(super) total_size: u64,
    progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    start_downloaded: u64,
    last_progress_percent: u8,
    last_report_time: Instant,
    bytes_since_last_report: u64,
    download_start_time: Instant,
}

impl DownloadProgressState {
    pub(super) fn new(
        downloaded: u64,
        total_size: u64,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Self {
        Self {
            downloaded,
            total_size,
            progress_callback,
            start_downloaded: downloaded,
            last_progress_percent: progress_percent(downloaded, total_size),
            last_report_time: Instant::now(),
            bytes_since_last_report: 0,
            download_start_time: Instant::now(),
        }
    }

    pub(super) fn record_chunk(&mut self, chunk_len: u64) {
        self.downloaded += chunk_len;
        self.bytes_since_last_report += chunk_len;
    }

    pub(super) fn should_report(&self) -> bool {
        let progress = progress_percent(self.downloaded, self.total_size);
        progress > self.last_progress_percent
            || self.downloaded >= self.total_size
            || self.last_report_time.elapsed().as_millis() >= 500
    }

    pub(super) fn speed_mbps(&self) -> f64 {
        let elapsed = self.last_report_time.elapsed();
        if elapsed.as_secs_f64() > 0.0 {
            (self.bytes_since_last_report as f64 / (1024.0 * 1024.0)) / elapsed.as_secs_f64()
        } else {
            let total_elapsed = self.download_start_time.elapsed().as_secs_f64();
            if total_elapsed > 0.0 {
                ((self.downloaded - self.start_downloaded) as f64 / (1024.0 * 1024.0))
                    / total_elapsed
            } else {
                0.0
            }
        }
    }

    pub(super) fn mark_reported(&mut self) {
        self.last_progress_percent = progress_percent(self.downloaded, self.total_size);
        self.last_report_time = Instant::now();
        self.bytes_since_last_report = 0;
    }

    pub(super) fn emit_initial_progress(&self) {
        if let Some(callback) = &self.progress_callback {
            callback(DownloadProgress::new(self.downloaded, self.total_size, 0.0));
        }
    }

    pub(super) fn emit_progress(&self, speed_mbps: f64) {
        if let Some(callback) = &self.progress_callback {
            callback(DownloadProgress::new(
                self.downloaded,
                self.total_size,
                speed_mbps,
            ));
        }
    }

    pub(super) fn emit_final_progress(&self) {
        if let Some(callback) = &self.progress_callback {
            callback(DownloadProgress::new(self.total_size, self.total_size, 0.0));
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

pub(super) async fn existing_file_size(path: &Path) -> u64 {
    fs::metadata(path).await.map(|m| m.len()).unwrap_or(0)
}

pub(super) async fn open_model_file(path: &Path, resuming: bool) -> Result<BufWriter<fs::File>> {
    let file = if resuming {
        OpenOptions::new()
            .write(true)
            .append(true)
            .open(path)
            .await
            .map_err(|e| anyhow!("Failed to open file for append: {}", e))?
    } else {
        fs::File::create(path)
            .await
            .map_err(|e| anyhow!("Failed to create file: {}", e))?
    };
    Ok(BufWriter::with_capacity(8 * 1024 * 1024, file))
}

pub(super) async fn validate_gguf_file(path: &Path) -> Result<()> {
    let mut file = fs::File::open(path).await?;
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic).await?;

    if &magic == b"GGUF" || &magic == b"ggjt" || &magic == b"ggla" || &magic == b"ggml" {
        Ok(())
    } else {
        Err(anyhow!(
            "Invalid model file: magic number {:?} doesn't match GGUF/GGML",
            magic
        ))
    }
}

pub(super) fn progress_percent(downloaded: u64, total_size: u64) -> u8 {
    if total_size > 0 {
        ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8
    } else {
        0
    }
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
