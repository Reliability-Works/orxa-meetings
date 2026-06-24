import type { MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { Transcript } from "@/types";
import { RecordingStatus } from "@/contexts/RecordingStateContext";
import { storageService } from "@/services/storageService";
import { transcriptService } from "@/services/transcriptService";
import Analytics from "@/lib/analytics";
import {
  applyPinnedSummaryLanguageToMeeting,
  detectAndCacheSummaryLanguage,
} from "@/lib/summary-language-preferences";

interface RecordingStopCoreArgs {
  isCallApi: boolean;
  recordingStoppedDataRef: MutableRefObject<Promise<void> | null>;
  stopInProgressRef: MutableRefObject<boolean>;
  setStatus: (status: RecordingStatus, message?: string) => void;
  setIsRecording: (value: boolean) => void;
  setIsRecordingDisabled: (value: boolean) => void;
  transcriptsRef: MutableRefObject<Transcript[]>;
  flushBuffer: () => void;
  clearTranscripts: () => void;
  meetingTitle: string;
  markMeetingAsSaved: () => Promise<void>;
  refetchMeetings: () => Promise<void>;
  setCurrentMeeting: (meeting: { id: string; title: string }) => void;
  setIsMeetingActive: (value: boolean) => void;
  router: { push: (url: string) => void };
}

interface SaveStoppedMeetingArgs {
  freshTranscripts: Transcript[];
  folderPath: string | null;
  savedMeetingName: string | null;
  meetingTitle: string;
  markMeetingAsSaved: () => Promise<void>;
  refetchMeetings: () => Promise<void>;
  setCurrentMeeting: (meeting: { id: string; title: string }) => void;
  setStatus: (status: RecordingStatus, message?: string) => void;
  clearTranscripts: () => void;
  router: { push: (url: string) => void };
}

export async function runRecordingStopPipeline(args: RecordingStopCoreArgs) {
  if (args.recordingStoppedDataRef.current) {
    await args.recordingStoppedDataRef.current;
  }

  if (args.stopInProgressRef.current) return;
  args.stopInProgressRef.current = true;

  args.setStatus(RecordingStatus.STOPPING);
  args.setIsRecording(false);
  args.setIsRecordingDisabled(true);
  const stopStartTime = Date.now();

  try {
    console.log("Post-stop processing (new implementation)...", {
      stop_initiated_at: new Date(stopStartTime).toISOString(),
      current_transcript_count: args.transcriptsRef.current.length,
    });
    console.log("Recording already stopped by RecordingControls, processing transcription...");

    const transcriptionComplete = await waitForTranscriptionCompletion(args.setStatus);
    await flushFinalTranscriptBuffer({
      stopStartTime,
      transcriptsRef: args.transcriptsRef,
      flushBuffer: args.flushBuffer,
      setStatus: args.setStatus,
    });

    console.log("Waiting for transcript state updates to complete...");
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (args.isCallApi && transcriptionComplete) {
      await saveStoppedMeeting({
        freshTranscripts: [...args.transcriptsRef.current],
        folderPath: sessionStorage.getItem("last_recording_folder_path"),
        savedMeetingName: sessionStorage.getItem("last_recording_meeting_name"),
        meetingTitle: args.meetingTitle,
        markMeetingAsSaved: args.markMeetingAsSaved,
        refetchMeetings: args.refetchMeetings,
        setCurrentMeeting: args.setCurrentMeeting,
        setStatus: args.setStatus,
        clearTranscripts: args.clearTranscripts,
        router: args.router,
      });
    } else {
      args.setStatus(RecordingStatus.IDLE);
    }

    args.setIsMeetingActive(false);
    args.setIsRecordingDisabled(false);
  } catch (error) {
    console.error("Error in handleRecordingStop:", error);
    args.setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : "Unknown error");
    args.setIsRecordingDisabled(false);
  } finally {
    args.stopInProgressRef.current = false;
  }
}

async function waitForTranscriptionCompletion(
  setStatus: (status: RecordingStatus, message?: string) => void,
) {
  setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, "Waiting for transcription...");
  console.log("Waiting for transcription to complete...");

  const maxWaitTime = 60000;
  const pollInterval = 500;
  let elapsedTime = 0;
  let transcriptionComplete = false;
  const unlistenComplete = await listen("transcription-complete", () => {
    console.log("Received transcription-complete event");
    transcriptionComplete = true;
  });

  while (elapsedTime < maxWaitTime && !transcriptionComplete) {
    const status = await checkTranscriptionStatus();
    if (status === "complete") {
      transcriptionComplete = true;
      break;
    }
    if (status === "error") break;

    const queueSize = typeof status === "number" ? status : 0;
    if (queueSize > 0) {
      console.log(`Processing ${queueSize} remaining audio chunks...`);
      setStatus(
        RecordingStatus.PROCESSING_TRANSCRIPTS,
        `Processing ${queueSize} remaining chunks...`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsedTime += pollInterval;
  }

  console.log("🧹 CLEANUP: Cleaning up transcription-complete listener");
  unlistenComplete();
  await logTranscriptionWaitResult(transcriptionComplete, elapsedTime, maxWaitTime);
  return transcriptionComplete;
}

async function checkTranscriptionStatus() {
  try {
    const status = await transcriptService.getTranscriptionStatus();
    console.log("Transcription status:", status);

    if (!status.is_processing && status.chunks_in_queue === 0) {
      console.log("Transcription complete - no active processing and no chunks in queue");
      return "complete" as const;
    }

    if (status.last_activity_ms > 8000 && status.chunks_in_queue === 0) {
      console.log("Transcription likely complete - no recent activity and empty queue");
      return "complete" as const;
    }

    return status.chunks_in_queue;
  } catch (error) {
    console.error("Error checking transcription status:", error);
    return "error" as const;
  }
}

async function logTranscriptionWaitResult(
  transcriptionComplete: boolean,
  elapsedTime: number,
  maxWaitTime: number,
) {
  if (!transcriptionComplete && elapsedTime >= maxWaitTime) {
    console.warn("⏰ Transcription wait timeout reached after", elapsedTime, "ms");
    return;
  }

  console.log("✅ Transcription completed after", elapsedTime, "ms");
  console.log("⏳ Waiting for late transcript segments...");
  await new Promise((resolve) => setTimeout(resolve, 4000));
}

async function flushFinalTranscriptBuffer(args: {
  stopStartTime: number;
  transcriptsRef: MutableRefObject<Transcript[]>;
  flushBuffer: () => void;
  setStatus: (status: RecordingStatus, message?: string) => void;
}) {
  const flushStartTime = Date.now();
  console.log("🔄 Final buffer flush: forcing processing of any remaining transcripts...", {
    flush_started_at: new Date(flushStartTime).toISOString(),
    time_since_stop: flushStartTime - args.stopStartTime,
    current_transcript_count: args.transcriptsRef.current.length,
  });
  args.setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, "Flushing transcript buffer...");
  args.flushBuffer();

  const flushEndTime = Date.now();
  console.log("✅ Final buffer flush completed", {
    flush_duration: flushEndTime - flushStartTime,
    total_time_since_stop: flushEndTime - args.stopStartTime,
    final_transcript_count: args.transcriptsRef.current.length,
  });
}

async function saveStoppedMeeting(args: SaveStoppedMeetingArgs) {
  args.setStatus(RecordingStatus.SAVING, "Saving meeting to database...");
  logSaveStart(args);

  try {
    const responseData = await storageService.saveMeeting(
      args.savedMeetingName || args.meetingTitle || "New Meeting",
      args.freshTranscripts,
      args.folderPath,
    );
    const meetingId = responseData.meeting_id;
    if (!meetingId) {
      console.error("No meeting_id in response:", responseData);
      throw new Error("No meeting ID received from save operation");
    }

    await applySummaryLanguagePreferences(meetingId, args.freshTranscripts);
    console.log("✅ Successfully saved COMPLETE meeting with ID:", meetingId);
    console.log("   Transcripts:", args.freshTranscripts.length);
    console.log("   folder_path:", args.folderPath);

    await args.markMeetingAsSaved();
    cleanupRecordingSessionStorage();
    await args.refetchMeetings();
    await setCurrentMeetingFromStorage(meetingId, args);
    args.setStatus(RecordingStatus.COMPLETED);
    showRecordingSavedToast(meetingId, args);
    await trackMeetingCompletion(meetingId, args.freshTranscripts);
  } catch (saveError) {
    console.error("Failed to save meeting to database:", saveError);
    args.setStatus(
      RecordingStatus.ERROR,
      saveError instanceof Error ? saveError.message : "Unknown error",
    );
    toast.error("Failed to save meeting", {
      description: saveError instanceof Error ? saveError.message : "Unknown error",
    });
    throw saveError;
  }
}

function logSaveStart(args: SaveStoppedMeetingArgs) {
  console.log("💾 Saving COMPLETE transcripts to database...", {
    transcript_count: args.freshTranscripts.length,
    meeting_name: args.savedMeetingName || args.meetingTitle,
    folder_path: args.folderPath,
    sample_text:
      args.freshTranscripts.length > 0
        ? args.freshTranscripts[0].text.substring(0, 50) + "..."
        : "none",
    last_transcript:
      args.freshTranscripts.length > 0
        ? args.freshTranscripts[args.freshTranscripts.length - 1].text.substring(0, 30) + "..."
        : "none",
  });
}

async function applySummaryLanguagePreferences(meetingId: string, freshTranscripts: Transcript[]) {
  let shouldDetectSummaryLanguage = false;
  try {
    shouldDetectSummaryLanguage = !(await applyPinnedSummaryLanguageToMeeting(meetingId));
  } catch (error) {
    console.warn("Failed to apply pinned summary language preference for new meeting:", error);
    toast.warning("Could not apply default summary language", {
      description: "The meeting was saved, but the default summary language was not applied.",
    });
  }

  if (!shouldDetectSummaryLanguage) return;

  try {
    await detectAndCacheSummaryLanguage(
      meetingId,
      freshTranscripts.map((t) => t.text),
    );
  } catch (error) {
    console.warn("Failed to detect summary language for new meeting:", error);
    toast.warning("Could not detect summary language", {
      description: "The meeting was saved, but Auto could not detect the summary language.",
    });
  }
}

function cleanupRecordingSessionStorage() {
  sessionStorage.removeItem("last_recording_folder_path");
  sessionStorage.removeItem("last_recording_meeting_name");
  sessionStorage.removeItem("indexeddb_current_meeting_id");
}

async function setCurrentMeetingFromStorage(meetingId: string, args: SaveStoppedMeetingArgs) {
  try {
    const meetingData = await storageService.getMeeting(meetingId);
    if (meetingData) {
      args.setCurrentMeeting({ id: meetingId, title: meetingData.title });
      console.log("✅ Current meeting set:", meetingData.title);
      return;
    }
  } catch (error) {
    console.warn("Could not fetch meeting details, using ID only:", error);
  }

  args.setCurrentMeeting({
    id: meetingId,
    title: args.savedMeetingName || args.meetingTitle || "New Meeting",
  });
}

function showRecordingSavedToast(meetingId: string, args: SaveStoppedMeetingArgs) {
  const completedMeetingUrl = `/meeting-details?id=${meetingId}&source=recording&openSummary=1`;

  toast.success("Recording saved successfully!", {
    description: `${args.freshTranscripts.length} transcript segments saved.`,
    action: {
      label: "Open Summary",
      onClick: () => {
        args.router.push(completedMeetingUrl);
        Analytics.trackButtonClick("open_summary_from_toast", "recording_complete");
      },
    },
    duration: 10000,
  });

  setTimeout(() => {
    args.router.push(completedMeetingUrl);
    args.clearTranscripts();
    Analytics.trackPageView("meeting_details");
    args.setStatus(RecordingStatus.IDLE);
  }, 2000);
}

async function trackMeetingCompletion(meetingId: string, freshTranscripts: Transcript[]) {
  try {
    const durationSeconds = calculateDurationSeconds(freshTranscripts);
    const transcriptWordCount = freshTranscripts
      .map((t) => t.text.split(/\s+/).length)
      .reduce((a, b) => a + b, 0);
    const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;
    const meetingsToday = await Analytics.getMeetingsCountToday();

    await Analytics.trackMeetingCompleted(meetingId, {
      duration_seconds: durationSeconds,
      transcript_segments: freshTranscripts.length,
      transcript_word_count: transcriptWordCount,
      words_per_minute: wordsPerMinute,
      meetings_today: meetingsToday,
    });
    await Analytics.updateMeetingCount();
    await trackFirstMeetingActivation(durationSeconds);
  } catch (analyticsError) {
    console.error("Failed to track meeting completion analytics:", analyticsError);
  }
}

function calculateDurationSeconds(freshTranscripts: Transcript[]) {
  if (freshTranscripts.length === 0 || freshTranscripts[0].audio_start_time === undefined) {
    return 0;
  }

  const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
  return lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
}

async function trackFirstMeetingActivation(durationSeconds: number) {
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load("analytics.json");
  const totalMeetings = await store.get<number>("total_meetings");
  if (totalMeetings !== 1) return;

  const daysSinceInstall = await Analytics.calculateDaysSince("first_launch_date");
  await Analytics.track("user_activated", {
    meetings_count: "1",
    days_since_install: daysSinceInstall?.toString() || "null",
    first_meeting_duration_seconds: durationSeconds.toString(),
  });
}
