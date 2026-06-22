use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const MCP_SCRIPT_FILENAME: &str = "meetily_mcp.py";
const DATABASE_FILENAME: &str = "meeting_minutes.sqlite";
const DATABASE_ENV: &str = "MEETILY_DB_PATH";

#[derive(Serialize)]
pub struct McpSetupInfo {
    pub command: String,
    pub server_script_path: String,
    pub server_script_exists: bool,
    pub database_path: String,
    pub database_exists: bool,
    pub client_config_json: String,
}

#[tauri::command]
pub fn get_mcp_setup_info<R: Runtime>(app: AppHandle<R>) -> Result<McpSetupInfo, String> {
    let server_script_path = resolve_mcp_script_path(&app)?;
    let database_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?
        .join(DATABASE_FILENAME);

    let command = "python3".to_string();
    let config = serde_json::json!({
        "mcpServers": {
            "meetily": {
                "command": command,
                "args": [server_script_path.to_string_lossy()],
                "env": {
                    DATABASE_ENV: database_path.to_string_lossy()
                }
            }
        }
    });

    let client_config_json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to build MCP config: {}", e))?;

    Ok(McpSetupInfo {
        command,
        server_script_exists: server_script_path.exists(),
        server_script_path: server_script_path.to_string_lossy().to_string(),
        database_exists: database_path.exists(),
        database_path: database_path.to_string_lossy().to_string(),
        client_config_json,
    })
}

#[tauri::command]
pub fn open_mcp_server_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let server_script_path = resolve_mcp_script_path(&app)?;
    let folder = server_script_path
        .parent()
        .ok_or_else(|| "MCP server path has no parent folder".to_string())?;
    open_folder(folder)
}

fn resolve_mcp_script_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let direct_candidates = [
            resource_dir.join(MCP_SCRIPT_FILENAME),
            resource_dir.join("mcp").join(MCP_SCRIPT_FILENAME),
        ];

        for candidate in direct_candidates {
            if candidate.exists() {
                return Ok(candidate);
            }
        }

        if let Some(candidate) = find_file_by_name(&resource_dir, MCP_SCRIPT_FILENAME) {
            return Ok(candidate);
        }
    }

    let checkout_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("mcp")
        .join(MCP_SCRIPT_FILENAME);
    if checkout_candidate.exists() {
        return Ok(checkout_candidate);
    }

    Err("Bundled Meetily MCP server script was not found.".to_string())
}

fn find_file_by_name(root: &Path, filename: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().and_then(|name| name.to_str()) == Some(filename) {
            return Some(path);
        }

        if path.is_dir() {
            if let Some(found) = find_file_by_name(&path, filename) {
                return Some(found);
            }
        }
    }

    None
}

fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open MCP folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open MCP folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open MCP folder: {}", e))?;
    }

    Ok(())
}
