use crate::api::{MeetingDetails, MeetingTranscript, TranscriptTrimResult, TranscriptTrimSegment};
use crate::database::models::{MeetingModel, Transcript};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqliteConnection, SqlitePool};
use tracing::{error, info};

pub struct MeetingsRepository;

impl MeetingsRepository {
    pub async fn get_meetings(pool: &SqlitePool) -> Result<Vec<MeetingModel>, sqlx::Error> {
        let meetings =
            sqlx::query_as::<_, MeetingModel>("SELECT * FROM meetings ORDER BY created_at DESC")
                .fetch_all(pool)
                .await?;
        Ok(meetings)
    }

    pub async fn delete_meeting(pool: &SqlitePool, meeting_id: &str) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        match delete_meeting_with_transaction(&mut transaction, meeting_id).await {
            Ok(success) => {
                if success {
                    transaction.commit().await?;
                    info!(
                        "Successfully deleted meeting {} and all associated data",
                        meeting_id
                    );
                    Ok(true)
                } else {
                    transaction.rollback().await?;
                    Ok(false)
                }
            }
            Err(e) => {
                let _ = transaction.rollback().await;
                error!("Failed to delete meeting {}: {}", meeting_id, e);
                Err(e)
            }
        }
    }

    pub async fn get_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingDetails>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        // Get meeting details
        let meeting: Option<MeetingModel> =
            sqlx::query_as("SELECT id, title, created_at, updated_at, folder_path FROM meetings WHERE id = ?")
                .bind(meeting_id)
                .fetch_optional(&mut *transaction)
                .await?;

        if meeting.is_none() {
            transaction.rollback().await?;
            return Err(SqlxError::RowNotFound);
        }

        if let Some(meeting) = meeting {
            // Get all transcripts for this meeting
            let transcripts =
                sqlx::query_as::<_, Transcript>("SELECT * FROM transcripts WHERE meeting_id = ?")
                    .bind(meeting_id)
                    .fetch_all(&mut *transaction)
                    .await?;

            transaction.commit().await?;

            // Convert Transcript to MeetingTranscript
            let meeting_transcripts = transcripts
                .into_iter()
                .map(|t| MeetingTranscript {
                    id: t.id,
                    text: t.transcript,
                    timestamp: t.timestamp,
                    audio_start_time: t.audio_start_time,
                    audio_end_time: t.audio_end_time,
                    duration: t.duration,
                })
                .collect::<Vec<_>>();

            Ok(Some(MeetingDetails {
                id: meeting.id,
                title: meeting.title,
                created_at: meeting.created_at.0.to_rfc3339(),
                updated_at: meeting.updated_at.0.to_rfc3339(),
                transcripts: meeting_transcripts,
            }))
        } else {
            transaction.rollback().await?;
            Ok(None)
        }
    }

    /// Get meeting metadata without transcripts (for pagination)
    pub async fn get_meeting_metadata(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let meeting: Option<MeetingModel> =
            sqlx::query_as("SELECT id, title, created_at, updated_at, folder_path FROM meetings WHERE id = ?")
                .bind(meeting_id)
                .fetch_optional(pool)
                .await?;

        Ok(meeting)
    }

    /// Get meeting transcripts with pagination support
    pub async fn get_meeting_transcripts_paginated(
        pool: &SqlitePool,
        meeting_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Transcript>, i64), SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        // Get total count of transcripts for this meeting
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?"
        )
        .bind(meeting_id)
        .fetch_one(pool)
        .await?;

        // Get paginated transcripts ordered by audio_start_time
        let transcripts = sqlx::query_as::<_, Transcript>(
            "SELECT * FROM transcripts
             WHERE meeting_id = ?
             ORDER BY audio_start_time ASC
             LIMIT ? OFFSET ?"
        )
        .bind(meeting_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

        Ok((transcripts, total.0))
    }

    pub async fn preview_trim_transcript(
        pool: &SqlitePool,
        meeting_id: &str,
        cutoff_seconds: f64,
    ) -> Result<TranscriptTrimResult, SqlxError> {
        validate_trim_input(meeting_id, cutoff_seconds)?;

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let result =
            build_trim_result(&mut transaction, meeting_id, cutoff_seconds, false, false).await;

        transaction.rollback().await?;
        result
    }

    pub async fn trim_transcript_after(
        pool: &SqlitePool,
        meeting_id: &str,
        cutoff_seconds: f64,
    ) -> Result<TranscriptTrimResult, SqlxError> {
        validate_trim_input(meeting_id, cutoff_seconds)?;

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let preview =
            build_trim_result(&mut transaction, meeting_id, cutoff_seconds, false, false).await?;

        if preview.deleted_count == 0 {
            transaction.rollback().await?;
            return Ok(TranscriptTrimResult {
                applied: true,
                ..preview
            });
        }

        let deleted = sqlx::query(
            "DELETE FROM transcripts
             WHERE meeting_id = ?
               AND audio_start_time IS NOT NULL
               AND audio_start_time > ?",
        )
        .bind(meeting_id)
        .bind(cutoff_seconds)
        .execute(&mut *transaction)
        .await?
        .rows_affected() as i64;

        let summary_deleted = sqlx::query("DELETE FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
            > 0;

        // transcript_chunks are whole-transcript summary cache rows without per-segment timing.
        // Clear them after a successful trim so no older summary path can reuse stale content.
        sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        let now = Utc::now();
        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        let mut result =
            build_trim_result(&mut transaction, meeting_id, cutoff_seconds, true, summary_deleted)
                .await?;
        result.deleted_count = deleted;
        result.remaining_count = result.total_count;

        transaction.commit().await?;
        Ok(result)
    }

    pub async fn update_meeting_title(
        pool: &SqlitePool,
        meeting_id: &str,
        new_title: &str,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now().naive_utc();

        let rows_affected =
            sqlx::query("UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?")
                .bind(new_title)
                .bind(now)
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;
        if rows_affected.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false);
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn update_meeting_name(
        pool: &SqlitePool,
        meeting_id: &str,
        new_title: &str,
    ) -> Result<bool, SqlxError> {
        let mut transaction = pool.begin().await?;
        let now = Utc::now();

        // Update meetings table
        let meeting_update =
            sqlx::query("UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?")
                .bind(new_title)
                .bind(now)
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;

        if meeting_update.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false); // Meeting not found
        }

        // Update transcript_chunks table
        sqlx::query("UPDATE transcript_chunks SET meeting_name = ? WHERE meeting_id = ?")
            .bind(new_title)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;
        Ok(true)
    }
}

fn validate_trim_input(meeting_id: &str, cutoff_seconds: f64) -> Result<(), SqlxError> {
    if meeting_id.trim().is_empty() {
        return Err(SqlxError::Protocol(
            "meeting_id cannot be empty".to_string(),
        ));
    }

    if !cutoff_seconds.is_finite() || cutoff_seconds < 0.0 {
        return Err(SqlxError::Protocol(
            "cutoff_seconds must be a finite non-negative number".to_string(),
        ));
    }

    Ok(())
}

async fn build_trim_result(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
    applied: bool,
    summary_invalidated: bool,
) -> Result<TranscriptTrimResult, SqlxError> {
    let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut **transaction)
        .await?;

    if meeting_exists.is_none() {
        return Err(SqlxError::RowNotFound);
    }

    let total_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_one(&mut **transaction)
            .await?;

    let removable_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)
         FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time > ?",
    )
    .bind(meeting_id)
    .bind(cutoff_seconds)
    .fetch_one(&mut **transaction)
    .await?;

    let has_summary: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_one(&mut **transaction)
            .await?;

    let last_kept_segment = fetch_trim_segment(
        transaction,
        "SELECT id, transcript, timestamp, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time <= ?
         ORDER BY audio_start_time DESC
         LIMIT 1",
        meeting_id,
        cutoff_seconds,
    )
    .await?;

    let first_removed_segment = fetch_trim_segment(
        transaction,
        "SELECT id, transcript, timestamp, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time > ?
         ORDER BY audio_start_time ASC
         LIMIT 1",
        meeting_id,
        cutoff_seconds,
    )
    .await?;

    let last_removed_segment = fetch_trim_segment(
        transaction,
        "SELECT id, transcript, timestamp, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time > ?
         ORDER BY audio_start_time DESC
         LIMIT 1",
        meeting_id,
        cutoff_seconds,
    )
    .await?;

    Ok(TranscriptTrimResult {
        meeting_id: meeting_id.to_string(),
        cutoff_seconds,
        deleted_count: removable_count.0,
        remaining_count: total_count.0 - removable_count.0,
        total_count: total_count.0,
        summary_invalidated: if applied {
            summary_invalidated
        } else {
            has_summary.0 > 0 && removable_count.0 > 0
        },
        last_kept_segment,
        first_removed_segment,
        last_removed_segment,
        applied,
    })
}

async fn fetch_trim_segment(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    query: &str,
    meeting_id: &str,
    cutoff_seconds: f64,
) -> Result<Option<TranscriptTrimSegment>, SqlxError> {
    let row: Option<(String, String, String, Option<f64>, Option<f64>)> = sqlx::query_as(query)
        .bind(meeting_id)
        .bind(cutoff_seconds)
        .fetch_optional(&mut **transaction)
        .await?;

    Ok(row.map(
        |(id, text, timestamp, audio_start_time, audio_end_time)| TranscriptTrimSegment {
            id,
            text,
            timestamp,
            audio_start_time,
            audio_end_time,
        },
    ))
}

async fn delete_meeting_with_transaction(
    transaction: &mut SqliteConnection,
    meeting_id: &str,
) -> Result<bool, SqlxError> {
    // Check if meeting exists
    let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?;

    if meeting_exists.is_none() {
        error!("Meeting {} not found for deletion", meeting_id);
        return Ok(false);
    }

    // Delete from related tables in proper order
    // 1. Delete from transcript_chunks
    sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 2. Delete from summary_processes
    sqlx::query("DELETE FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 3. Delete from transcripts
    sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 4. Finally, delete the meeting
    let result = sqlx::query("DELETE FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    Ok(result.rows_affected() > 0)
}
