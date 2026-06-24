import { useEffect, MutableRefObject } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import Analytics from "@/lib/analytics";

export interface RetranscriptionProgress {
  meeting_id: string;
  stage: string;
  progress_percentage: number;
  message: string;
}

interface RetranscriptionResult {
  meeting_id: string;
  segments_count: number;
  duration_seconds: number;
  language: string | null;
}

interface RetranscriptionError {
  meeting_id: string;
  error: string;
}

interface UseRetranscriptionEventsOptions {
  meetingId: string;
  onCompleteRef: MutableRefObject<(() => void) | undefined>;
  onOpenChangeRef: MutableRefObject<(open: boolean) => void>;
  open: boolean;
  setError: (error: string | null) => void;
  setIsProcessing: (processing: boolean) => void;
  setProgress: (progress: RetranscriptionProgress | null) => void;
}

export function useRetranscriptionEvents({
  meetingId,
  onCompleteRef,
  onOpenChangeRef,
  open,
  setError,
  setIsProcessing,
  setProgress,
}: UseRetranscriptionEventsOptions) {
  useEffect(() => {
    if (!open) return;

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const register = async () => {
      const unlistenProgress = await listen<RetranscriptionProgress>(
        "retranscription-progress",
        (event) => {
          if (event.payload.meeting_id === meetingId) {
            setProgress(event.payload);
          }
        },
      );
      if (stopIfCleaned(cleanedUpRef.current, unlistenProgress, unlisteners)) return;
      unlisteners.push(unlistenProgress);

      const unlistenComplete = await listen<RetranscriptionResult>(
        "retranscription-complete",
        async (event) => {
          if (event.payload.meeting_id === meetingId) {
            await trackCompletion(event.payload);
            setIsProcessing(false);
            toast.success(
              `Retranscription complete! ${event.payload.segments_count} segments created.`,
            );
            onCompleteRef.current?.();
            onOpenChangeRef.current(false);
          }
        },
      );
      if (stopIfCleaned(cleanedUpRef.current, unlistenComplete, unlisteners)) return;
      unlisteners.push(unlistenComplete);

      const unlistenError = await listen<RetranscriptionError>(
        "retranscription-error",
        async (event) => {
          if (event.payload.meeting_id === meetingId) {
            await Analytics.trackError("enhance_transcript_failed", event.payload.error);
            setIsProcessing(false);
            setError(event.payload.error);
          }
        },
      );
      if (stopIfCleaned(cleanedUpRef.current, unlistenError, unlisteners)) return;
      unlisteners.push(unlistenError);
    };

    register();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [meetingId, onCompleteRef, onOpenChangeRef, open, setError, setIsProcessing, setProgress]);
}

function stopIfCleaned(isCleanedUp: boolean, unlisten: UnlistenFn, unlisteners: UnlistenFn[]) {
  if (!isCleanedUp) return false;
  unlisten();
  unlisteners.forEach((currentUnlisten) => currentUnlisten());
  return true;
}

async function trackCompletion(payload: RetranscriptionResult) {
  await Analytics.track("enhance_transcript_completed", {
    success: "true",
    duration_seconds: payload.duration_seconds.toString(),
    segments_count: payload.segments_count.toString(),
  });
}
