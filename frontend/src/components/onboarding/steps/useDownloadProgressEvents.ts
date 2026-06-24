import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getSummaryModelSizeMb } from "@/lib/onboarding-summary-model";
import {
  PARAKEET_MODEL,
  type DownloadStatus,
  type SetDownloadState,
} from "./downloadProgressStepTypes";

interface DownloadProgressEventsArgs {
  selectedSummaryModel: string;
  setParakeetState: SetDownloadState;
  setSummaryState: SetDownloadState;
  setParakeetDownloaded: (value: boolean) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
}

function getSummaryStatus(status: string): DownloadStatus {
  if (status === "completed") return "completed";
  if (status === "error") return "error";
  return "downloading";
}

export function useDownloadProgressEvents({
  selectedSummaryModel,
  setParakeetState,
  setSummaryState,
  setParakeetDownloaded,
  setSummaryModelDownloaded,
}: DownloadProgressEventsArgs) {
  useEffect(() => {
    const unlistenProgress = listen<{
      modelName: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status?: string;
    }>("parakeet-model-download-progress", (event) => {
      const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
      if (modelName !== PARAKEET_MODEL) return;

      setParakeetState((prev) => ({
        ...prev,
        status: status === "completed" ? "completed" : "downloading",
        progress,
        downloadedMb: downloaded_mb ?? prev.downloadedMb,
        totalMb: total_mb ?? prev.totalMb,
        speedMbps: speed_mbps ?? prev.speedMbps,
      }));

      if (status === "completed" || progress >= 100) {
        setParakeetDownloaded(true);
      }
    });

    const unlistenComplete = listen<{ modelName: string }>(
      "parakeet-model-download-complete",
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          setParakeetState((prev) => ({ ...prev, status: "completed", progress: 100 }));
          setParakeetDownloaded(true);
        }
      },
    );

    const unlistenError = listen<{ modelName: string; error: string }>(
      "parakeet-model-download-error",
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          setParakeetState((prev) => ({
            ...prev,
            status: "error",
            error: event.payload.error,
          }));
        }
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{
      model: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
      error?: string;
    }>("builtin-ai-download-progress", (event) => {
      const { model, progress, downloaded_mb, total_mb, speed_mbps, status, error } = event.payload;
      if (!selectedSummaryModel || model !== selectedSummaryModel) return;

      setSummaryState((prev) => ({
        ...prev,
        status: getSummaryStatus(status),
        progress,
        downloadedMb: downloaded_mb ?? prev.downloadedMb,
        totalMb: (total_mb ?? prev.totalMb) || getSummaryModelSizeMb(model),
        speedMbps: speed_mbps ?? prev.speedMbps,
        error: status === "error" ? error : undefined,
      }));

      if (status === "completed" || progress >= 100) {
        setSummaryModelDownloaded(true);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [selectedSummaryModel]);
}
