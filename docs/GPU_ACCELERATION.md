# GPU Acceleration

Orxa uses local transcription engines and local summary/chat models. Acceleration depends on the model surface being used.

## Transcription

The Rust app supports Whisper through `whisper-rs` and Parakeet through ONNX Runtime.

Whisper acceleration features are declared in `frontend/src-tauri/Cargo.toml`:

- `metal` for Apple Metal
- `coreml` for Apple Core ML
- `cuda` for NVIDIA CUDA
- `vulkan` for Vulkan-capable GPUs
- `hipblas` for AMD ROCm
- `openblas` for optimized CPU builds

macOS builds enable Metal and Core ML through the macOS target dependency. Other platforms can opt into the matching feature at build time.

```bash
cd frontend
pnpm tauri:build:cuda
pnpm tauri:build:vulkan
pnpm tauri:build:openblas
```

The helper script `frontend/scripts/tauri-auto.js` delegates to Tauri while preserving the existing feature-specific scripts in `frontend/package.json`.

## Local Summary And Chat Models

Summary and chat models run through the local model manager and `llama-helper` sidecar when a built-in local model is selected. Larger models retain more meeting detail but need more memory. See [MODELS.md](MODELS.md).

## Platform Notes

macOS is the primary supported target for Orxa's current product experience because Calendar access, menu-bar behavior, system audio capture, and app packaging are macOS-first.

Linux and Windows build scripts remain available for packaging work, but some system-audio and Calendar behavior is platform-specific.
