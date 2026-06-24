import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getDownloadTotalMb } from "@/lib/onboarding-summary-model";
import {
  categorizeError,
  getLocalModelDownloadStatus,
  getParakeetDownloadStatus,
  getSummaryDownloadStatus,
} from "./downloadProgressToastHelpers";
import type {
  CleanupDownload,
  DownloadProgress,
  UpdateDownload,
} from "./downloadProgressToastTypes";

interface DownloadProgressToastListenersArgs {
  updateDownload: UpdateDownload;
  cleanupDownload: CleanupDownload;
}

function useParakeetDownloadToastEvents({
  updateDownload,
  cleanupDownload,
}: DownloadProgressToastListenersArgs) {
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
      const downloadData: DownloadProgress = {
        modelName,
        displayName: "Transcription Model (Parakeet)",
        progress,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 670,
        speedMbps: speed_mbps ?? 0,
        status: getParakeetDownloadStatus(status, progress),
      };

      updateDownload(modelName, downloadData);
      if (downloadData.status === "cancelled") {
        cleanupDownload(modelName, 6000);
      }
    });

    const unlistenComplete = listen<{ modelName: string }>(
      "parakeet-model-download-complete",
      (event) => {
        const { modelName } = event.payload;
        updateDownload(modelName, {
          modelName,
          displayName: "Transcription Model (Parakeet)",
          progress: 100,
          downloadedMb: 670,
          totalMb: 670,
          speedMbps: 0,
          status: "completed",
        });
        cleanupDownload(modelName, 4000);
      },
    );

    const unlistenError = listen<{ modelName: string; error: string }>(
      "parakeet-model-download-error",
      (event) => {
        const { modelName, error } = event.payload;
        updateDownload(modelName, {
          modelName,
          displayName: "Transcription Model (Parakeet)",
          progress: 0,
          downloadedMb: 0,
          totalMb: 670,
          speedMbps: 0,
          status: "error",
          error: categorizeError(error),
        });
        cleanupDownload(modelName, 11000);
      },
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [updateDownload, cleanupDownload]);
}

function useSummaryDownloadToastEvents({
  updateDownload,
  cleanupDownload,
}: DownloadProgressToastListenersArgs) {
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
      const downloadData: DownloadProgress = {
        modelName: model,
        displayName: `Summary Model (${model})`,
        progress: progress ?? 0,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: getDownloadTotalMb(total_mb, model),
        speedMbps: speed_mbps ?? 0,
        unitLabel: "MiB",
        status: getSummaryDownloadStatus(status, progress),
        error: status === "error" ? categorizeError(error || "Download failed") : undefined,
      };

      updateDownload(model, downloadData);
      if (downloadData.status === "completed") {
        cleanupDownload(model, 4000);
      } else if (downloadData.status === "error") {
        cleanupDownload(model, 11000);
      } else if (downloadData.status === "cancelled") {
        cleanupDownload(model, 6000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateDownload, cleanupDownload]);
}

function useLocalModelDownloadToastEvents({
  updateDownload,
  cleanupDownload,
}: DownloadProgressToastListenersArgs) {
  useEffect(() => {
    const unlisten = listen<{
      modelId: string;
      modelName: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
      error?: string;
    }>("local-model-download-progress", (event) => {
      const { modelId, modelName, progress, downloaded_mb, total_mb, speed_mbps, status, error } =
        event.payload;
      const downloadKey = `local-${modelId}`;
      const downloadData: DownloadProgress = {
        modelName: downloadKey,
        displayName: modelName,
        progress: progress ?? 0,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 0,
        speedMbps: speed_mbps ?? 0,
        unitLabel: "MiB",
        status: getLocalModelDownloadStatus(status, progress),
        error: status === "error" ? categorizeError(error || "Download failed") : undefined,
      };

      updateDownload(downloadKey, downloadData);
      if (downloadData.status === "completed") {
        cleanupDownload(downloadKey, 4000);
      } else if (downloadData.status === "error") {
        cleanupDownload(downloadKey, 11000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateDownload, cleanupDownload]);
}

export function useDownloadProgressToastListeners(args: DownloadProgressToastListenersArgs) {
  useParakeetDownloadToastEvents(args);
  useSummaryDownloadToastEvents(args);
  useLocalModelDownloadToastEvents(args);
}
