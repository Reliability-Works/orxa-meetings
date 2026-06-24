use super::*;

pub(super) async fn save_retranscription_segments<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    segments: &[TranscriptSegment],
) -> Result<()> {
    let app_state = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow!("App state not available"))?;
    let pool = app_state.db_manager.pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| anyhow!("DB error: {}", e))?;
    let mut tx = sqlx::Connection::begin(&mut *conn)
        .await
        .map_err(|e| anyhow!("Failed to start transaction: {}", e))?;

    sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| anyhow!("Failed to delete existing transcripts: {}", e))?;

    for segment in segments {
        insert_retranscription_segment(&mut tx, meeting_id, segment).await?;
    }

    tx.commit()
        .await
        .map_err(|e| anyhow!("Failed to commit transaction: {}", e))?;

    info!(
        "Updated {} transcripts for meeting {} in transaction",
        segments.len(),
        meeting_id
    );
    Ok(())
}

pub(super) async fn insert_retranscription_segment(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    meeting_id: &str,
    segment: &TranscriptSegment,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&segment.id)
    .bind(meeting_id)
    .bind(&segment.text)
    .bind(&segment.timestamp)
    .bind(segment.audio_start_time)
    .bind(segment.audio_end_time)
    .bind(segment.duration)
    .execute(&mut **tx)
    .await
    .map_err(|e| anyhow!("Failed to insert transcript: {}", e))?;
    Ok(())
}

pub(super) fn write_retranscription_outputs(
    folder_path: &Path,
    meeting_id: &str,
    duration_seconds: f64,
    audio_path: &Path,
    segments: &[TranscriptSegment],
) {
    if let Err(e) = write_transcripts_json(folder_path, segments) {
        warn!("Failed to write transcripts.json: {}", e);
    }

    let audio_filename = audio_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.mp4")
        .to_string();

    if let Err(e) =
        write_retranscription_metadata(folder_path, meeting_id, duration_seconds, &audio_filename)
    {
        warn!("Failed to update metadata.json: {}", e);
    }
}

/// Emit progress event
pub(super) fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    stage: &str,
    progress: u32,
    message: &str,
) {
    let _ = app.emit(
        "retranscription-progress",
        RetranscriptionProgress {
            meeting_id: meeting_id.to_string(),
            stage: stage.to_string(),
            progress_percentage: progress,
            message: message.to_string(),
        },
    );
}

/// Get or initialize the Whisper engine, auto-loading the model if needed
/// If `requested_model` is provided, ensures that specific model is loaded
/// Write or update metadata.json for retranscription (preserves existing fields, adds retranscribed_at)
pub(super) fn write_retranscription_metadata(
    folder: &Path,
    meeting_id: &str,
    duration_seconds: f64,
    audio_filename: &str,
) -> Result<()> {
    let metadata_path = folder.join("metadata.json");
    let temp_path = folder.join(".metadata.json.tmp");
    let now = chrono::Utc::now().to_rfc3339();

    // Try to read existing metadata and update it
    let json = if metadata_path.exists() {
        let existing = std::fs::read_to_string(&metadata_path)?;
        let mut value: serde_json::Value = serde_json::from_str(&existing)?;
        if let Some(obj) = value.as_object_mut() {
            obj.insert("retranscribed_at".to_string(), serde_json::json!(now));
            obj.insert("status".to_string(), serde_json::json!("completed"));
            obj.insert(
                "transcript_file".to_string(),
                serde_json::json!("transcripts.json"),
            );
            obj.remove("detected_summary_language");
        }
        value
    } else {
        serde_json::json!({
            "version": "1.0",
            "meeting_id": meeting_id,
            "created_at": now,
            "completed_at": now,
            "retranscribed_at": now,
            "duration_seconds": duration_seconds,
            "audio_file": audio_filename,
            "transcript_file": "transcripts.json",
            "status": "completed",
            "source": "retranscription"
        })
    };

    let json_string = serde_json::to_string_pretty(&json)?;
    std::fs::write(&temp_path, &json_string)?;
    std::fs::rename(&temp_path, &metadata_path)?;

    info!("Wrote metadata.json to {}", metadata_path.display());
    Ok(())
}

// Tauri commands
