use crate::api::{TranscriptDeleteResult, TranscriptTrimResult, TranscriptTrimSegment};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, Sqlite, SqlitePool, Transaction};

type TrimSegmentRow = (String, String, String, Option<f64>, Option<f64>);

pub async fn preview_trim_transcript(
    pool: &SqlitePool,
    meeting_id: &str,
    cutoff_seconds: f64,
) -> Result<TranscriptTrimResult, SqlxError> {
    validate_trim_input(meeting_id, cutoff_seconds)?;

    let mut conn = pool.acquire().await?;
    let mut transaction = conn.begin().await?;
    let result = build_trim_result(
        &mut transaction,
        meeting_id,
        cutoff_seconds,
        false,
        false,
        false,
    )
    .await;

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
    let preview = build_trim_result(
        &mut transaction,
        meeting_id,
        cutoff_seconds,
        false,
        false,
        false,
    )
    .await?;

    if preview.deleted_count == 0 {
        transaction.rollback().await?;
        return Ok(TranscriptTrimResult {
            applied: true,
            ..preview
        });
    }

    let deleted = delete_tail_after(&mut transaction, meeting_id, cutoff_seconds).await?;
    let summary_deleted = invalidate_summary_artifacts(&mut transaction, meeting_id).await?;
    touch_meeting(&mut transaction, meeting_id).await?;

    let mut result = build_trim_result(
        &mut transaction,
        meeting_id,
        cutoff_seconds,
        false,
        true,
        summary_deleted,
    )
    .await?;
    result.deleted_count = deleted;
    result.remaining_count = result.total_count;

    transaction.commit().await?;
    Ok(result)
}

pub async fn trim_transcript_from_segment(
    pool: &SqlitePool,
    meeting_id: &str,
    transcript_id: &str,
) -> Result<TranscriptTrimResult, SqlxError> {
    validate_ids(meeting_id, transcript_id)?;

    let mut conn = pool.acquire().await?;
    let mut transaction = conn.begin().await?;
    let cutoff_seconds =
        fetch_transcript_start(&mut transaction, meeting_id, transcript_id).await?;
    let preview = build_trim_result(
        &mut transaction,
        meeting_id,
        cutoff_seconds,
        true,
        false,
        false,
    )
    .await?;

    if preview.deleted_count == 0 {
        transaction.rollback().await?;
        return Ok(TranscriptTrimResult {
            applied: true,
            ..preview
        });
    }

    let deleted = delete_tail_from(&mut transaction, meeting_id, cutoff_seconds).await?;
    let summary_deleted = invalidate_summary_artifacts(&mut transaction, meeting_id).await?;
    touch_meeting(&mut transaction, meeting_id).await?;

    let mut result = build_trim_result(
        &mut transaction,
        meeting_id,
        cutoff_seconds,
        true,
        true,
        summary_deleted,
    )
    .await?;
    result.deleted_count = deleted;
    result.remaining_count = result.total_count;

    transaction.commit().await?;
    Ok(result)
}

pub async fn delete_transcript_segment(
    pool: &SqlitePool,
    meeting_id: &str,
    transcript_id: &str,
) -> Result<TranscriptDeleteResult, SqlxError> {
    validate_ids(meeting_id, transcript_id)?;

    let mut conn = pool.acquire().await?;
    let mut transaction = conn.begin().await?;
    ensure_transcript_exists(&mut transaction, meeting_id, transcript_id).await?;

    let deleted = sqlx::query("DELETE FROM transcripts WHERE meeting_id = ? AND id = ?")
        .bind(meeting_id)
        .bind(transcript_id)
        .execute(&mut *transaction)
        .await?
        .rows_affected() as i64;

    let summary_invalidated = if deleted > 0 {
        let invalidated = invalidate_summary_artifacts(&mut transaction, meeting_id).await?;
        touch_meeting(&mut transaction, meeting_id).await?;
        invalidated
    } else {
        false
    };

    let remaining_count = count_transcripts(&mut transaction, meeting_id).await?;
    transaction.commit().await?;

    Ok(TranscriptDeleteResult {
        meeting_id: meeting_id.to_string(),
        transcript_id: transcript_id.to_string(),
        deleted_count: deleted,
        remaining_count,
        summary_invalidated,
    })
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

fn validate_ids(meeting_id: &str, transcript_id: &str) -> Result<(), SqlxError> {
    if meeting_id.trim().is_empty() {
        return Err(SqlxError::Protocol(
            "meeting_id cannot be empty".to_string(),
        ));
    }

    if transcript_id.trim().is_empty() {
        return Err(SqlxError::Protocol(
            "transcript_id cannot be empty".to_string(),
        ));
    }

    Ok(())
}

async fn build_trim_result(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
    inclusive: bool,
    applied: bool,
    summary_invalidated: bool,
) -> Result<TranscriptTrimResult, SqlxError> {
    ensure_meeting_exists(transaction, meeting_id).await?;

    let total_count = count_transcripts(transaction, meeting_id).await?;
    let removable_count =
        count_removable_segments(transaction, meeting_id, cutoff_seconds, inclusive).await?;
    let has_summary = has_summary_artifacts(transaction, meeting_id).await?;
    let last_kept_segment =
        fetch_kept_segment(transaction, meeting_id, cutoff_seconds, inclusive).await?;
    let first_removed_segment =
        fetch_removed_segment(transaction, meeting_id, cutoff_seconds, inclusive, "ASC").await?;
    let last_removed_segment =
        fetch_removed_segment(transaction, meeting_id, cutoff_seconds, inclusive, "DESC").await?;

    Ok(TranscriptTrimResult {
        meeting_id: meeting_id.to_string(),
        cutoff_seconds,
        deleted_count: removable_count,
        remaining_count: total_count - removable_count,
        total_count,
        summary_invalidated: if applied {
            summary_invalidated
        } else {
            has_summary && removable_count > 0
        },
        last_kept_segment,
        first_removed_segment,
        last_removed_segment,
        applied,
    })
}

async fn ensure_meeting_exists(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
) -> Result<(), SqlxError> {
    let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut **transaction)
        .await?;

    if meeting_exists.is_none() {
        return Err(SqlxError::RowNotFound);
    }

    Ok(())
}

async fn ensure_transcript_exists(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    transcript_id: &str,
) -> Result<(), SqlxError> {
    let transcript_exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM transcripts WHERE meeting_id = ? AND id = ?")
            .bind(meeting_id)
            .bind(transcript_id)
            .fetch_optional(&mut **transaction)
            .await?;

    if transcript_exists.is_none() {
        return Err(SqlxError::RowNotFound);
    }

    Ok(())
}

async fn fetch_transcript_start(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    transcript_id: &str,
) -> Result<f64, SqlxError> {
    let row: Option<(Option<f64>,)> =
        sqlx::query_as("SELECT audio_start_time FROM transcripts WHERE meeting_id = ? AND id = ?")
            .bind(meeting_id)
            .bind(transcript_id)
            .fetch_optional(&mut **transaction)
            .await?;

    match row.and_then(|(timestamp,)| timestamp) {
        Some(timestamp) if timestamp.is_finite() => Ok(timestamp),
        Some(_) => Err(SqlxError::Protocol(
            "transcript timestamp must be finite".to_string(),
        )),
        None => Err(SqlxError::RowNotFound),
    }
}

async fn count_transcripts(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
) -> Result<i64, SqlxError> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?")
        .bind(meeting_id)
        .fetch_one(&mut **transaction)
        .await?;
    Ok(count.0)
}

async fn count_removable_segments(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
    inclusive: bool,
) -> Result<i64, SqlxError> {
    let comparison = if inclusive { ">=" } else { ">" };
    let query = format!(
        "SELECT COUNT(*) FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time {comparison} ?",
    );

    let count: (i64,) = sqlx::query_as(&query)
        .bind(meeting_id)
        .bind(cutoff_seconds)
        .fetch_one(&mut **transaction)
        .await?;
    Ok(count.0)
}

async fn has_summary_artifacts(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
) -> Result<bool, SqlxError> {
    let summary_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_one(&mut **transaction)
            .await?;
    let chunk_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM transcript_chunks WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_one(&mut **transaction)
            .await?;

    Ok(summary_count.0 > 0 || chunk_count.0 > 0)
}

async fn fetch_kept_segment(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
    inclusive: bool,
) -> Result<Option<TranscriptTrimSegment>, SqlxError> {
    let comparison = if inclusive { "<" } else { "<=" };
    let query = format!(
        "SELECT id, transcript, timestamp, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time {comparison} ?
         ORDER BY audio_start_time DESC
         LIMIT 1",
    );

    fetch_trim_segment(transaction, &query, meeting_id, cutoff_seconds).await
}

async fn fetch_removed_segment(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
    inclusive: bool,
    direction: &str,
) -> Result<Option<TranscriptTrimSegment>, SqlxError> {
    let comparison = if inclusive { ">=" } else { ">" };
    let query = format!(
        "SELECT id, transcript, timestamp, audio_start_time, audio_end_time
         FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time {comparison} ?
         ORDER BY audio_start_time {direction}
         LIMIT 1",
    );

    fetch_trim_segment(transaction, &query, meeting_id, cutoff_seconds).await
}

async fn fetch_trim_segment(
    transaction: &mut Transaction<'_, Sqlite>,
    query: &str,
    meeting_id: &str,
    cutoff_seconds: f64,
) -> Result<Option<TranscriptTrimSegment>, SqlxError> {
    let row: Option<TrimSegmentRow> = sqlx::query_as(query)
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

async fn delete_tail_after(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
) -> Result<i64, SqlxError> {
    let deleted = sqlx::query(
        "DELETE FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time > ?",
    )
    .bind(meeting_id)
    .bind(cutoff_seconds)
    .execute(&mut **transaction)
    .await?
    .rows_affected() as i64;

    Ok(deleted)
}

async fn delete_tail_from(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
    cutoff_seconds: f64,
) -> Result<i64, SqlxError> {
    let deleted = sqlx::query(
        "DELETE FROM transcripts
         WHERE meeting_id = ?
           AND audio_start_time IS NOT NULL
           AND audio_start_time >= ?",
    )
    .bind(meeting_id)
    .bind(cutoff_seconds)
    .execute(&mut **transaction)
    .await?
    .rows_affected() as i64;

    Ok(deleted)
}

async fn invalidate_summary_artifacts(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
) -> Result<bool, SqlxError> {
    let summary_deleted = sqlx::query("DELETE FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut **transaction)
        .await?
        .rows_affected()
        > 0;
    let chunks_deleted = sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut **transaction)
        .await?
        .rows_affected()
        > 0;

    Ok(summary_deleted || chunks_deleted)
}

async fn touch_meeting(
    transaction: &mut Transaction<'_, Sqlite>,
    meeting_id: &str,
) -> Result<(), SqlxError> {
    sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
        .bind(Utc::now())
        .bind(meeting_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}
