use super::*;

/// Simplified audio capture without broadcast channels
#[derive(Clone)]
pub struct AudioCapture {
    pub(super) device: Arc<AudioDevice>,
    pub(super) state: Arc<RecordingState>,
    pub(super) sample_rate: u32, // Original device sample rate
    pub(super) channels: u16,
    pub(super) chunk_counter: Arc<std::sync::atomic::AtomicU64>,
    pub(super) device_type: DeviceType,
    pub(super) needs_resampling: bool, // Flag if resampling is required
    // CRITICAL FIX: Persistent resampler to preserve energy across chunks
    pub(super) resampler: Arc<std::sync::Mutex<Option<SincFixedIn<f32>>>>,
    // Buffering for variable-size chunks → fixed-size resampler input
    pub(super) resampler_input_buffer: Arc<std::sync::Mutex<Vec<f32>>>,
    pub(super) resampler_chunk_size: usize, // Fixed chunk size for resampler (512 samples)
    // Audio enhancement processors (microphone only)
    pub(super) noise_suppressor: Arc<std::sync::Mutex<Option<NoiseSuppressionProcessor>>>,
    pub(super) high_pass_filter: Arc<std::sync::Mutex<Option<HighPassFilter>>>,
    // EBU R128 normalizer for microphone audio (per-device, stateful)
    pub(super) normalizer: Arc<std::sync::Mutex<Option<LoudnessNormalizer>>>,
    // Note: Using global recording timestamp for synchronization
}

impl AudioCapture {
    pub fn new(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        sample_rate: u32,
        channels: u16,
        device_type: DeviceType,
    ) -> Self {
        // CRITICAL FIX: Detect if resampling is needed
        // Pipeline expects 48kHz, but Bluetooth devices often report 8kHz, 16kHz, or 44.1kHz
        const TARGET_SAMPLE_RATE: u32 = 48000;
        let needs_resampling = sample_rate != TARGET_SAMPLE_RATE;

        // Detect device kind (Bluetooth vs Wired) for adaptive processing
        // Use reasonable defaults for buffer size (512 samples is typical)
        let device_kind =
            crate::audio::device_detection::InputDeviceKind::detect(&device.name, 512, sample_rate);

        if needs_resampling {
            warn!("⚠️ SAMPLE RATE MISMATCH DETECTED ⚠️");
            warn!(
                "🔄 [{:?}] Audio device '{}' ({:?}) reports {} Hz (pipeline expects {} Hz)",
                device_type, device.name, device_kind, sample_rate, TARGET_SAMPLE_RATE
            );
            warn!(
                "🔄 Automatic resampling will be applied: {} Hz → {} Hz",
                sample_rate, TARGET_SAMPLE_RATE
            );

            // Log which resampling strategy will be used
            let ratio = TARGET_SAMPLE_RATE as f64 / sample_rate as f64;
            let strategy = if ratio >= 2.0 {
                "High-quality upsampling (sinc_len=512, Cubic interpolation)"
            } else if ratio >= 1.5 {
                "Moderate upsampling (sinc_len=384, Cubic)"
            } else if ratio > 1.0 {
                "Small upsampling (sinc_len=256, Linear)"
            } else if ratio <= 0.5 {
                "Anti-aliased downsampling (sinc_len=512, Cubic)"
            } else {
                "Moderate downsampling (sinc_len=384, Linear)"
            };
            info!("   Resampling strategy: {}", strategy);
        } else {
            info!(
                "✅ [{:?}] Audio device '{}' ({:?}) uses {} Hz (matches pipeline)",
                device_type, device.name, device_kind, sample_rate
            );
        }

        // Initialize audio enhancement processors for MICROPHONE ONLY
        // System audio doesn't need enhancement (already clean)
        let (noise_suppressor, high_pass_filter, normalizer) = if matches!(
            device_type,
            DeviceType::Microphone
        ) {
            // Initialize noise suppression (RNNoise) at 48kHz - CONDITIONAL based on flag
            let ns = if crate::audio::ffmpeg_mixer::RNNOISE_APPLY_ENABLED {
                match NoiseSuppressionProcessor::new(TARGET_SAMPLE_RATE) {
                    Ok(processor) => {
                        info!("✅ RNNoise noise suppression ENABLED for microphone '{}' (10-15 dB reduction)", device.name);
                        Some(processor)
                    }
                    Err(e) => {
                        warn!("⚠️ Failed to create noise suppressor: {}, continuing without noise suppression", e);
                        None
                    }
                }
            } else {
                info!("ℹ️ RNNoise noise suppression DISABLED for microphone '{}' (flag: RNNOISE_APPLY_ENABLED=false)", device.name);
                info!("   Whisper handles noise well internally - RNNoise is optional");
                None
            };

            // Initialize high-pass filter (removes rumble below 80 Hz)
            let hpf = {
                let filter = HighPassFilter::new(TARGET_SAMPLE_RATE, 80.0);
                info!(
                    "✅ High-pass filter initialized for microphone '{}' (cutoff: 80 Hz)",
                    device.name
                );
                Some(filter)
            };

            // Initialize EBU R128 normalizer (professional loudness standard)
            let norm = match LoudnessNormalizer::new(1, TARGET_SAMPLE_RATE) {
                Ok(normalizer) => {
                    info!(
                        "✅ EBU R128 normalizer initialized for microphone '{}' (target: -23 LUFS)",
                        device.name
                    );
                    Some(normalizer)
                }
                Err(e) => {
                    warn!(
                        "⚠️ Failed to create normalizer for microphone: {}, normalization disabled",
                        e
                    );
                    None
                }
            };

            (ns, hpf, norm)
        } else {
            // System audio: no enhancement needed
            info!(
                "ℹ️ System audio '{}' captured raw (no enhancement)",
                device.name
            );
            (None, None, None)
        };

        // CRITICAL FIX: Initialize persistent resampler to preserve energy across chunks
        // Creating a new resampler per chunk causes energy amplification and incorrect output sizes
        // Use fixed chunk size of 512 samples with buffering for variable-size input
        const RESAMPLER_CHUNK_SIZE: usize = 512;

        let resampler = if needs_resampling {
            let ratio = TARGET_SAMPLE_RATE as f64 / sample_rate as f64;

            // Adaptive parameters based on sample rate ratio (same logic as resample_audio)
            let (sinc_len, interpolation_type, oversampling) = if ratio >= 2.0 {
                (512, SincInterpolationType::Cubic, 512)
            } else if ratio >= 1.5 {
                (384, SincInterpolationType::Cubic, 384)
            } else if ratio > 1.0 {
                (256, SincInterpolationType::Linear, 256)
            } else if ratio <= 0.5 {
                (512, SincInterpolationType::Cubic, 512)
            } else {
                (384, SincInterpolationType::Linear, 384)
            };

            let params = SincInterpolationParameters {
                sinc_len,
                f_cutoff: 0.95,
                interpolation: interpolation_type,
                oversampling_factor: oversampling,
                window: WindowFunction::BlackmanHarris2,
            };

            match SincFixedIn::<f32>::new(
                ratio,
                2.0, // Maximum relative deviation
                params,
                RESAMPLER_CHUNK_SIZE,
                1, // Mono
            ) {
                Ok(resampler) => {
                    info!(
                        "✅ Persistent resampler initialized for '{}' ({}Hz → {}Hz, chunk_size={})",
                        device.name, sample_rate, TARGET_SAMPLE_RATE, RESAMPLER_CHUNK_SIZE
                    );
                    info!("   Buffering enabled for variable-size chunks (e.g., 320, 512, 1024, etc.)");
                    Some(resampler)
                }
                Err(e) => {
                    warn!(
                        "⚠️ Failed to create persistent resampler: {}, will use fallback",
                        e
                    );
                    None
                }
            }
        } else {
            None
        };

        Self {
            device,
            state,
            sample_rate,
            channels,
            chunk_counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            device_type,
            needs_resampling,
            resampler: Arc::new(std::sync::Mutex::new(resampler)),
            resampler_input_buffer: Arc::new(std::sync::Mutex::new(Vec::with_capacity(
                RESAMPLER_CHUNK_SIZE * 2,
            ))),
            resampler_chunk_size: RESAMPLER_CHUNK_SIZE,
            noise_suppressor: Arc::new(std::sync::Mutex::new(noise_suppressor)),
            high_pass_filter: Arc::new(std::sync::Mutex::new(high_pass_filter)),
            normalizer: Arc::new(std::sync::Mutex::new(normalizer)),
            // Using global recording time for sync
        }
    }
}
