"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DownloadToastContent } from "./DownloadProgressToastContent";
import { getDownloadToastDuration } from "./downloadProgressToastHelpers";
import type { DownloadProgress } from "./downloadProgressToastTypes";
import { useDownloadProgressToastListeners } from "./useDownloadProgressToastListeners";

export function useDownloadProgressToast() {
  const [downloads, setDownloads] = useState<Map<string, DownloadProgress>>(new Map());
  const [dismissedModels, setDismissedModels] = useState<Set<string>>(new Set());

  const updateDownload = useCallback((modelName: string, data: Partial<DownloadProgress>) => {
    setDownloads((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(modelName) || {
        modelName,
        displayName: modelName,
        progress: 0,
        downloadedMb: 0,
        totalMb: 0,
        speedMbps: 0,
        status: "downloading" as const,
      };

      updated.set(modelName, { ...existing, ...data });
      return updated;
    });
  }, []);

  const cleanupDownload = useCallback((modelName: string, delay: number = 4000) => {
    setTimeout(() => {
      setDownloads((prev) => {
        const updated = new Map(prev);
        updated.delete(modelName);
        return updated;
      });
    }, delay);
  }, []);

  const showDownloadToast = useCallback((download: DownloadProgress) => {
    const toastId = `download-${download.modelName}`;
    const dismissToast = () => {
      toast.dismiss(toastId);
      setDismissedModels((prev) => {
        const next = new Set(prev);
        next.add(download.modelName);
        return next;
      });
    };

    toast.custom(() => <DownloadToastContent download={download} onDismiss={dismissToast} />, {
      position: "top-right",
      id: toastId,
      duration: getDownloadToastDuration(download.status),
    });
  }, []);

  useEffect(() => {
    downloads.forEach((download) => {
      if (dismissedModels.has(download.modelName) && download.status === "downloading") {
        return;
      }

      if (download.status === "completed" || download.status === "error") {
        if (dismissedModels.has(download.modelName)) {
          setDismissedModels((prev) => {
            const next = new Set(prev);
            next.delete(download.modelName);
            return next;
          });
        }
      }

      showDownloadToast(download);
    });
  }, [downloads, dismissedModels, showDownloadToast]);

  useDownloadProgressToastListeners({ updateDownload, cleanupDownload });

  return { downloads };
}

export function DownloadProgressToastProvider() {
  useDownloadProgressToast();
  return null;
}
