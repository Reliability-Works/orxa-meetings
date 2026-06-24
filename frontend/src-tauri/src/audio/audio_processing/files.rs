use super::*;

/// Sanitize a filename to be safe for filesystem use
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Create a meeting folder with timestamp and return the path
/// Creates structure: base_path/MeetingName_YYYY-MM-DD_HH-MM/
///                    ├── .checkpoints/  (for incremental saves, optional)
///
/// # Arguments
/// * `base_path` - Base directory for meetings
/// * `meeting_name` - Name of the meeting
/// * `create_checkpoints_dir` - Whether to create .checkpoints/ subdirectory (only needed when auto_save is true)
pub fn create_meeting_folder(
    base_path: &Path,
    meeting_name: &str,
    create_checkpoints_dir: bool,
) -> Result<PathBuf> {
    let timestamp = Utc::now().format("%Y-%m-%d_%H-%M").to_string();
    let sanitized_name = sanitize_filename(meeting_name);
    let folder_name = format!("{}_{}", sanitized_name, timestamp);
    let meeting_folder = base_path.join(folder_name);

    // Create main meeting folder
    std::fs::create_dir_all(&meeting_folder)?;

    // Only create .checkpoints subdirectory if requested (when auto_save is true)
    if create_checkpoints_dir {
        let checkpoints_dir = meeting_folder.join(".checkpoints");
        std::fs::create_dir_all(&checkpoints_dir)?;
        log::info!(
            "Created meeting folder with checkpoints: {}",
            meeting_folder.display()
        );
    } else {
        log::info!(
            "Created meeting folder without checkpoints: {}",
            meeting_folder.display()
        );
    }

    Ok(meeting_folder)
}
