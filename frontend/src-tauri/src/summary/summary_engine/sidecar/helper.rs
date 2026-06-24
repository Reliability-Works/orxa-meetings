use super::SidecarManager;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

impl SidecarManager {
    fn helper_target_triple() -> String {
        std::env::var("TARGET").unwrap_or_else(|_| {
            #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
            {
                "x86_64-unknown-linux-gnu".to_string()
            }
            #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
            {
                "aarch64-unknown-linux-gnu".to_string()
            }
            #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
            {
                "x86_64-apple-darwin".to_string()
            }
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                "aarch64-apple-darwin".to_string()
            }
            #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
            {
                "x86_64-pc-windows-msvc".to_string()
            }
            #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
            {
                "aarch64-pc-windows-msvc".to_string()
            }
            #[cfg(not(any(
                all(
                    target_os = "linux",
                    any(target_arch = "x86_64", target_arch = "aarch64")
                ),
                all(
                    target_os = "macos",
                    any(target_arch = "x86_64", target_arch = "aarch64")
                ),
                all(
                    target_os = "windows",
                    any(target_arch = "x86_64", target_arch = "aarch64")
                )
            )))]
            {
                "unknown".to_string()
            }
        })
    }

    fn helper_binary_name() -> String {
        let target_triple = Self::helper_target_triple();
        if cfg!(windows) {
            format!("llama-helper-{}.exe", target_triple)
        } else {
            format!("llama-helper-{}", target_triple)
        }
    }

    fn find_helper_in_dir(dir: &Path, label: &str) -> Option<PathBuf> {
        let binary_name = Self::helper_binary_name();
        let bundled = dir.join(&binary_name);
        if bundled.exists() {
            log::info!("Found exact match {}: {}", label, bundled.display());
            return Some(bundled);
        }

        log::info!("Attempting fuzzy match {}: {}", label, dir.display());
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("llama-helper") && !name.ends_with(".d") {
                        log::info!("Found fuzzy match {}: {}", label, path.display());
                        return Some(path);
                    }
                }
            }
        }

        None
    }

    /// Resolve the path to llama-helper binary
    pub(super) fn resolve_helper_binary() -> Result<PathBuf> {
        // 1. Check environment variable (dev mode or manual override)
        if let Ok(env_path) = std::env::var("ORXA_LLAMA_HELPER") {
            if !env_path.is_empty() {
                let path = PathBuf::from(env_path);
                if path.exists() {
                    log::info!(
                        "Using llama-helper from ORXA_LLAMA_HELPER: {}",
                        path.display()
                    );
                    return Ok(path);
                }
            }
        }

        // In production, Tauri bundles the binary with target triple suffix
        // 2. Check relative to current executable (most reliable for AppImage/bundled apps)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                log::info!(
                    "Searching for llama-helper relative to executable: {}",
                    exe_dir.display()
                );

                if let Some(path) = Self::find_helper_in_dir(exe_dir, "next to executable") {
                    return Ok(path);
                }
            }
        }

        // 3. Check bundled resources (RESOURCE_DIR) - Fallback
        if let Ok(resource_dir) = std::env::var("RESOURCE_DIR") {
            log::info!(
                "Searching for llama-helper in RESOURCE_DIR: {}",
                resource_dir
            );
            let resource_path = PathBuf::from(&resource_dir);
            if let Some(path) = Self::find_helper_in_dir(&resource_path, "in RESOURCE_DIR") {
                return Ok(path);
            }
        } else {
            log::warn!("RESOURCE_DIR environment variable not set");
        }

        // 3. Fallback for dev: try relative paths from workspace (no target triple in dev builds)
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let project_root = PathBuf::from(&manifest_dir)
                .parent()
                .and_then(|p| p.parent())
                .ok_or_else(|| anyhow!("Failed to determine project root"))?
                .to_path_buf();

            let candidates = vec![
                project_root.join("target/release/llama-helper"),
                project_root.join("target/debug/llama-helper"),
                project_root.join("target/release/llama-helper.exe"),
                project_root.join("target/debug/llama-helper.exe"),
            ];

            for candidate in candidates {
                if candidate.exists() {
                    log::info!("Using dev llama-helper: {}", candidate.display());
                    return Ok(candidate);
                }
            }
        }

        Err(anyhow!(
            "llama-helper binary not found. Build with 'cd llama-helper && cargo build --release' or set ORXA_LLAMA_HELPER env var."
        ))
    }
}
