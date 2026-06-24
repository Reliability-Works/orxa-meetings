import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { listen } from "@tauri-apps/api/event";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useRecordingState, RecordingStatus } from "@/contexts/RecordingStateContext";
import { runRecordingStopPipeline } from "./recordingStopHelpers";

type SummaryStatus = "idle" | "processing" | "summarizing" | "regenerating" | "completed" | "error";

interface UseRecordingStopReturn {
  handleRecordingStop: (callApi: boolean) => Promise<void>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

/**
 * Custom hook for managing recording stop lifecycle.
 * Handles the complex stop sequence: transcription wait → buffer flush → SQLite save → navigation.
 *
 * Features:
 * - Transcription completion polling (60s max, 500ms interval)
 * - Transcript buffer flush coordination
 * - SQLite meeting save with folder_path from sessionStorage
 * - Comprehensive analytics tracking (duration, word count, activation)
 * - Auto-navigation to meeting details
 * - Toast notifications for success/error
 * - Window exposure for Rust callbacks
 */
export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
  setIsRecordingDisabled: (value: boolean) => void,
): UseRecordingStopReturn {
  // USE global state instead
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript,
  } = recordingState;

  const { transcriptsRef, flushBuffer, clearTranscripts, meetingTitle, markMeetingAsSaved } =
    useTranscripts();

  const { refetchMeetings, setCurrentMeeting, setIsMeetingActive } = useSidebar();

  const router = useRouter();

  // Guard to prevent duplicate/concurrent stop calls (e.g., from UI and tray simultaneously)
  const stopInProgressRef = useRef(false);

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupRecordingStoppedListener = async () => {
      try {
        console.log("Setting up recording-stopped listener for navigation...");
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
        }>("recording-stopped", async (event) => {
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem("last_recording_folder_path", folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem("last_recording_meeting_name", meeting_name);
            }
          })();
        });
        console.log("Recording stopped listener setup complete");
      } catch (error) {
        console.error("Failed to setup recording stopped listener:", error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      console.log("Cleaning up recording stopped listener...");
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler
  const handleRecordingStop = useCallback(
    async (isCallApi: boolean) => {
      await runRecordingStopPipeline({
        isCallApi,
        recordingStoppedDataRef,
        stopInProgressRef,
        setStatus,
        setIsRecording,
        setIsRecordingDisabled,
        transcriptsRef,
        flushBuffer,
        clearTranscripts,
        meetingTitle,
        markMeetingAsSaved,
        refetchMeetings,
        setCurrentMeeting,
        setIsMeetingActive,
        router,
      });
    },
    [
      setIsRecording,
      setIsRecordingDisabled,
      setStatus,
      transcriptsRef,
      flushBuffer,
      clearTranscripts,
      meetingTitle,
      markMeetingAsSaved,
      refetchMeetings,
      setCurrentMeeting,
      setIsMeetingActive,
      router,
    ],
  );

  // Expose handleRecordingStop function to window for Rust callbacks
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    (window as any).handleRecordingStop = (callApi: boolean = true) => {
      handleRecordingStopRef.current(callApi);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).handleRecordingStop;
    };
  }, []);

  // Derive summaryStatus from RecordingStatus for backward compatibility
  const summaryStatus: SummaryStatus =
    status === RecordingStatus.PROCESSING_TRANSCRIPTS ? "processing" : "idle";

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
