"use client";

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  PARAKEET_MODEL,
  ParakeetProgressInfo,
  SummaryModelProgressInfo,
} from "./onboardingContextTypes";

export function useDownloadProgressListeners(args: {
  selectedSummaryModel: string;
  setParakeetDownloaded: (value: boolean) => void;
  setParakeetProgress: (value: number) => void;
  setParakeetProgressInfo: (value: ParakeetProgressInfo) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
  setSummaryModelProgress: (value: number) => void;
  setSummaryModelProgressInfo: (value: SummaryModelProgressInfo) => void;
}) {
  useEffect(() => {
    const unlisten = listen<{
      modelName: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status?: string;
    }>("parakeet-model-download-progress", (event) => {
      const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
      if (modelName !== PARAKEET_MODEL) return;

      args.setParakeetProgress(progress);
      args.setParakeetProgressInfo({
        percent: progress,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 0,
        speedMbps: speed_mbps ?? 0,
      });
      if (status === "completed" || progress >= 100) {
        args.setParakeetDownloaded(true);
      }
    });

    const unlistenComplete = listen<{ modelName: string }>(
      "parakeet-model-download-complete",
      (event) => {
        if (event.payload.modelName !== PARAKEET_MODEL) return;
        args.setParakeetDownloaded(true);
        args.setParakeetProgress(100);
      },
    );

    const unlistenError = listen<{ modelName: string; error: string }>(
      "parakeet-model-download-error",
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          console.error("Parakeet download error:", event.payload.error);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [args]);

  useEffect(() => {
    const unlisten = listen<{
      model: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
    }>("builtin-ai-download-progress", (event) => {
      const { model, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
      if (!args.selectedSummaryModel || model !== args.selectedSummaryModel) return;

      args.setSummaryModelProgress(progress);
      args.setSummaryModelProgressInfo({
        percent: progress,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 0,
        speedMbps: speed_mbps ?? 0,
      });
      if (status === "completed" || progress >= 100) {
        args.setSummaryModelDownloaded(true);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [args]);
}
