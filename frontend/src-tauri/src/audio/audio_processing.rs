use anyhow::Result;
use chrono::Utc;
use log::{debug, info, warn};
use nnnoiseless::DenoiseState;
use realfft::num_complex::{Complex32, ComplexFloat};
use realfft::RealFftPlanner;
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::path::{Path, PathBuf};

use super::encode::encode_single_audio; // Correct path to encode module

mod conversion;
mod enhancement;
mod files;
mod writers;

pub use self::conversion::{
    audio_to_mono, average_noise_spectrum, resample, resample_audio, spectral_subtraction,
};
pub use self::enhancement::{
    normalize_v2, HighPassFilter, LoudnessNormalizer, NoiseSuppressionProcessor,
};
pub use self::files::{create_meeting_folder, sanitize_filename};
pub use self::writers::{
    write_audio_to_file, write_audio_to_file_with_meeting_name, write_transcript_json_to_file,
    write_transcript_to_file,
};
