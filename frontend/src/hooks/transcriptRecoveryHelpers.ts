import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { indexedDBService, StoredTranscript } from "@/services/indexedDBService";
import { storageService } from "@/services/storageService";
import { applyPinnedSummaryLanguageToMeeting } from "@/lib/summary-language-preferences";
import type { AudioRecoveryStatus } from "./useTranscriptRecovery";

export async function recoverMeetingFromIndexedDB(
  meetingId: string,
  loadMeetingTranscripts: (meetingId: string) => Promise<StoredTranscript[]>,
): Promise<{
  success: boolean;
  audioRecoveryStatus?: AudioRecoveryStatus | null;
  meetingId?: string;
}> {
  const metadata = await indexedDBService.getMeetingMetadata(meetingId);
  if (!metadata) {
    throw new Error("Meeting metadata not found");
  }

  const transcripts = await loadMeetingTranscripts(meetingId);
  if (transcripts.length === 0) {
    throw new Error("No transcripts found for this meeting");
  }

  const folderPath = await resolveRecoveryFolderPath(metadata.folderPath);
  const audioRecoveryStatus = await recoverAudio(folderPath);
  const saveResponse = await storageService.saveMeeting(
    metadata.title,
    formatStoredTranscripts(transcripts),
    folderPath ?? null,
  );
  const savedMeetingId = saveResponse.meeting_id;

  await applyPinnedLanguage(savedMeetingId);
  await indexedDBService.markMeetingSaved(meetingId);
  await cleanupCheckpoints(folderPath);

  return {
    success: true,
    audioRecoveryStatus,
    meetingId: savedMeetingId,
  };
}

async function resolveRecoveryFolderPath(folderPath: string | undefined) {
  if (folderPath) return folderPath;

  try {
    return await invoke<string>("get_meeting_folder_path");
  } catch (error) {
    return undefined;
  }
}

async function recoverAudio(folderPath: string | undefined): Promise<AudioRecoveryStatus | null> {
  if (!folderPath) {
    return {
      status: "none",
      chunk_count: 0,
      estimated_duration_seconds: 0,
      message: "No folder path available",
    };
  }

  try {
    return await invoke<AudioRecoveryStatus>("recover_audio_from_checkpoints", {
      meetingFolder: folderPath,
      sampleRate: 48000,
    });
  } catch (error) {
    console.error("Audio recovery failed:", error);
    return {
      status: "failed",
      chunk_count: 0,
      estimated_duration_seconds: 0,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function formatStoredTranscripts(transcripts: StoredTranscript[]) {
  return transcripts.map((t, index) => ({
    id: t.id?.toString() || `${Date.now()}-${index}`,
    text: t.text,
    timestamp: t.timestamp,
    sequence_id: t.sequenceId || index,
    chunk_start_time: (t as any).chunk_start_time,
    is_partial: (t as any).is_partial || false,
    confidence: t.confidence,
    audio_start_time: (t as any).audio_start_time,
    audio_end_time: (t as any).audio_end_time,
    duration: (t as any).duration,
  }));
}

async function applyPinnedLanguage(savedMeetingId: string) {
  try {
    await applyPinnedSummaryLanguageToMeeting(savedMeetingId);
  } catch (error) {
    console.warn("Failed to apply pinned summary language to recovered meeting:", error);
    toast.warning("Could not apply default summary language", {
      description:
        "The recovered meeting was saved, but the default summary language was not applied.",
    });
  }
}

async function cleanupCheckpoints(folderPath: string | undefined) {
  if (!folderPath) return;

  try {
    await invoke("cleanup_checkpoints", { meetingFolder: folderPath });
  } catch (error) {
    console.warn("Checkpoint cleanup failed (non-fatal):", error);
  }
}
