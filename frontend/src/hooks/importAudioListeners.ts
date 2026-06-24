import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import Analytics from "@/lib/analytics";
import { applyPinnedSummaryLanguageToMeeting } from "@/lib/summary-language-preferences";
import type { ImportError, ImportProgress, ImportResult, ImportStatus } from "./useImportAudio";

export function useImportAudioListeners(args: {
  isCancelledRef: MutableRefObject<boolean>;
  onCompleteRef: MutableRefObject<((result: ImportResult) => void) | undefined>;
  onErrorRef: MutableRefObject<((error: string) => void) | undefined>;
  setProgress: (progress: ImportProgress | null) => void;
  setStatus: (status: ImportStatus) => void;
  setError: (error: string | null) => void;
}) {
  const { isCancelledRef, onCompleteRef, onErrorRef, setError, setProgress, setStatus } = args;

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      const unlistenProgress = await listen<ImportProgress>("import-progress", (event) => {
        if (isCancelledRef.current) return;
        setProgress(event.payload);
        setStatus("processing");
      });
      if (cleanedUpRef.current) {
        unlistenProgress();
        return;
      }
      unlisteners.push(unlistenProgress);

      const unlistenComplete = await listen<ImportResult>("import-complete", async (event) => {
        if (isCancelledRef.current) return;

        await Analytics.track("import_audio_completed", {
          success: "true",
          duration_seconds: event.payload.duration_seconds.toString(),
          segments_count: event.payload.segments_count.toString(),
        });

        setStatus("complete");
        setProgress(null);
        try {
          await applyPinnedSummaryLanguageToMeeting(event.payload.meeting_id);
        } catch (error) {
          console.warn("Failed to apply pinned summary language to imported meeting:", error);
          toast.warning("Could not apply default summary language", {
            description:
              "The imported meeting was saved, but the default summary language was not applied.",
          });
        }
        onCompleteRef.current?.(event.payload);
      });
      if (cleanedUpRef.current) {
        unlistenComplete();
        unlisteners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(unlistenComplete);

      const unlistenError = await listen<ImportError>("import-error", async (event) => {
        if (isCancelledRef.current) return;

        await Analytics.trackError("import_audio_failed", event.payload.error);
        setStatus("error");
        setError(event.payload.error);
        onErrorRef.current?.(event.payload.error);
      });
      if (cleanedUpRef.current) {
        unlistenError();
        unlisteners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(unlistenError);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [isCancelledRef, onCompleteRef, onErrorRef, setError, setProgress, setStatus]);
}
