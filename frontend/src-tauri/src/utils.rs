pub fn format_timestamp(seconds: f64) -> String {
    let total_seconds = seconds as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let secs = total_seconds % 60;
    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

pub fn open_folder(path: &std::path::Path) -> Result<(), String> {
    let folder_path = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// Opens macOS System Settings to a specific privacy preference pane
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn open_system_settings(preference_pane: String) -> Result<(), String> {
    use std::process::Command;

    // Construct the URL for System Settings
    let url = format!(
        "x-apple.systempreferences:com.apple.preference.security?{}",
        preference_pane
    );

    // Use the 'open' command on macOS to open the URL
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open system settings: {}", e))?;

    Ok(())
}
