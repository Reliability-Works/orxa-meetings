# Building On Linux

Linux builds are available for packaging and compatibility work. macOS remains the primary supported product target because Orxa's Calendar, menu-bar, and system-audio behavior are macOS-first.

## Requirements

Install the standard Tauri Linux dependencies for your distribution, plus Rust, Node.js 20, pnpm, and Bun.

Ubuntu example:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  cmake \
  git \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libasound2-dev \
  libopenblas-dev \
  libx11-dev \
  libxtst-dev \
  libxrandr-dev
```

## Build

```bash
make bootstrap
make validate

cd frontend
pnpm tauri:build
```

## Acceleration

Linux transcription builds can opt into CUDA, Vulkan, HIP/ROCm, or OpenBLAS features:

```bash
cd frontend
pnpm tauri:build:cuda
pnpm tauri:build:vulkan
pnpm tauri:build:hipblas
pnpm tauri:build:openblas
```

See [GPU_ACCELERATION.md](GPU_ACCELERATION.md).

## Known Platform Differences

- macOS Calendar integration uses EventKit and does not apply on Linux.
- menu-bar behavior differs by desktop environment.
- system-audio capture support depends on platform APIs and packaging permissions.
