use super::*;

/// Emit progress event
pub(super) fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    stage: &str,
    progress: u32,
    message: &str,
) {
    let _ = app.emit(
        "import-progress",
        ImportProgress {
            stage: stage.to_string(),
            progress_percentage: progress,
            message: message.to_string(),
        },
    );
}
