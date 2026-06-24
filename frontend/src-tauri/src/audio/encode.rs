use super::ffmpeg::find_ffmpeg_path; // Correct path to encode module
use super::AudioDevice;
use std::io::Write;
use std::sync::Arc;
use std::{
    path::Path,
    process::{Command, Output, Stdio},
};
use tracing::{debug, error};

pub struct AudioInput {
    pub data: Arc<Vec<f32>>,
    pub sample_rate: u32,
    pub channels: u16,
    pub device: Arc<AudioDevice>,
}

pub fn encode_single_audio(
    data: &[u8],
    sample_rate: u32,
    channels: u16,
    output_path: &Path,
) -> anyhow::Result<()> {
    debug!(
        "Starting FFmpeg process for {} bytes of audio data",
        data.len()
    );

    validate_audio_input(data)?;
    let ffmpeg_path = find_encoder_ffmpeg_path()?;
    let command = build_ffmpeg_command(&ffmpeg_path, sample_rate, channels, output_path);
    let output = run_ffmpeg_command(command, data)?;
    ensure_ffmpeg_success(&output)?;

    Ok(())
}

fn validate_audio_input(data: &[u8]) -> anyhow::Result<()> {
    if data.is_empty() {
        return Err(anyhow::anyhow!("No audio data provided for encoding"));
    }

    Ok(())
}

fn find_encoder_ffmpeg_path() -> anyhow::Result<std::path::PathBuf> {
    let ffmpeg_path = find_ffmpeg_path().ok_or_else(|| {
        anyhow::anyhow!("FFmpeg not found. Please install FFmpeg to save recordings.")
    })?;

    debug!("Using FFmpeg at: {:?}", ffmpeg_path);
    Ok(ffmpeg_path)
}

fn build_ffmpeg_command(
    ffmpeg_path: &Path,
    sample_rate: u32,
    channels: u16,
    output_path: &Path,
) -> Command {
    let mut command = Command::new(ffmpeg_path);
    command
        .args([
            "-f",
            "f32le",
            "-ar",
            &sample_rate.to_string(),
            "-ac",
            &channels.to_string(),
            "-i",
            "pipe:0",
            "-c:a",
            "aac",
            "-b:a",
            "192k", // Increased from 64k for better audio quality (especially for speech)
            "-profile:a",
            "aac_low", // Use AAC-LC profile for better compatibility
            "-movflags",
            "+faststart", // Optimize for web streaming
            "-f",
            "mp4",
            output_path.to_str().unwrap(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    hide_ffmpeg_console_window(&mut command);
    debug!("FFmpeg command: {:?}", command);

    command
}

fn hide_ffmpeg_console_window(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        _command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn run_ffmpeg_command(mut command: Command, data: &[u8]) -> anyhow::Result<Output> {
    #[allow(clippy::zombie_processes)]
    let mut ffmpeg = command.spawn().expect("Failed to spawn FFmpeg process");
    debug!("FFmpeg process spawned");
    let mut stdin = ffmpeg.stdin.take().expect("Failed to open stdin");

    stdin.write_all(data)?;

    debug!("Dropping stdin");
    drop(stdin);
    debug!("Waiting for FFmpeg process to exit");
    Ok(ffmpeg.wait_with_output().unwrap())
}

fn ensure_ffmpeg_success(output: &Output) -> anyhow::Result<()> {
    let status = output.status;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    log_ffmpeg_output(status, &stdout, &stderr);
    if status.success() {
        return Ok(());
    }

    Err(ffmpeg_status_error(status, &stderr))
}

fn log_ffmpeg_output(status: std::process::ExitStatus, stdout: &str, stderr: &str) {
    debug!("FFmpeg process exited with status: {}", status);
    debug!("FFmpeg stdout: {}", stdout);
    debug!("FFmpeg stderr: {}", stderr);
}

fn ffmpeg_status_error(status: std::process::ExitStatus, stderr: &str) -> anyhow::Error {
    error!("FFmpeg process failed with status: {}", status);
    error!("FFmpeg stderr: {}", stderr);
    anyhow::anyhow!("FFmpeg process failed with status: {}", status)
}
