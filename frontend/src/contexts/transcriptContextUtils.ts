import { Transcript, TranscriptUpdate } from "@/types";

export function sortTranscripts(transcripts: Transcript[]) {
  return transcripts.sort((a, b) => {
    const chunkTimeDiff = (a.chunk_start_time || 0) - (b.chunk_start_time || 0);
    if (chunkTimeDiff !== 0) return chunkTimeDiff;
    return (a.sequence_id || 0) - (b.sequence_id || 0);
  });
}

export function createTranscript(update: TranscriptUpdate, id: string): Transcript {
  return {
    id,
    text: update.text,
    timestamp: update.timestamp,
    speaker: update.speaker,
    sequence_id: update.sequence_id,
    chunk_start_time: update.chunk_start_time,
    is_partial: update.is_partial,
    confidence: update.confidence,
    audio_start_time: update.audio_start_time,
    audio_end_time: update.audio_end_time,
    duration: update.duration,
  };
}

export function formatTranscriptTime(seconds: number | undefined): string {
  if (seconds === undefined) return "[--:--]";
  const totalSecs = Math.floor(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `[${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
}

export function formatSpeaker(speaker: string | null | undefined): string {
  return speaker === "me" ? " Me:" : "";
}

export function appendUniqueTranscripts(prev: Transcript[], allNewTranscripts: Transcript[]) {
  const existingSequenceIds = new Set(
    prev.map((t) => t.sequence_id).filter((id) => id !== undefined),
  );
  const uniqueNewTranscripts = allNewTranscripts.filter(
    (transcript) =>
      transcript.sequence_id !== undefined && !existingSequenceIds.has(transcript.sequence_id),
  );

  if (uniqueNewTranscripts.length === 0) {
    console.log("No unique transcripts to add - all were duplicates");
    return prev;
  }

  console.log(
    `Adding ${uniqueNewTranscripts.length} unique transcripts out of ${allNewTranscripts.length} received`,
  );
  return sortTranscripts([...prev, ...uniqueNewTranscripts]);
}
