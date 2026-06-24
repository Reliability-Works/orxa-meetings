import { useEffect, type MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { ModelStatus, getModelDisplayInfo } from "@/lib/parakeet";

interface UseParakeetModelDownloadEventsProps {
  progressThrottleRef: MutableRefObject<Map<string, { progress: number; timestamp: number }>>;
  updateModelStatus: (modelName: string, status: ModelStatus) => void;
  removeDownloadingModel: (modelName: string) => void;
  saveModelSelection: (modelName: string) => Promise<void>;
  downloadModel: (modelName: string) => Promise<void>;
  autoSaveRef: MutableRefObject<boolean>;
  onModelSelectRef: MutableRefObject<((modelName: string) => void) | undefined>;
}

function displayNameFor(modelName: string) {
  return getModelDisplayInfo(modelName)?.friendlyName || modelName;
}

export function useParakeetModelDownloadEvents({
  progressThrottleRef,
  updateModelStatus,
  removeDownloadingModel,
  saveModelSelection,
  downloadModel,
  autoSaveRef,
  onModelSelectRef,
}: UseParakeetModelDownloadEventsProps) {
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        "parakeet-model-download-progress",
        ({ payload }) => {
          const { modelName, progress } = payload;
          const previous = progressThrottleRef.current.get(modelName);
          const shouldUpdate =
            !previous ||
            Date.now() - previous.timestamp > 300 ||
            Math.abs(progress - previous.progress) >= 5;

          if (shouldUpdate) {
            progressThrottleRef.current.set(modelName, { progress, timestamp: Date.now() });
            updateModelStatus(modelName, { Downloading: progress } as ModelStatus);
          }
        },
      );

      unlistenComplete = await listen<{ modelName: string }>(
        "parakeet-model-download-complete",
        ({ payload }) => {
          const displayInfo = getModelDisplayInfo(payload.modelName);
          updateModelStatus(payload.modelName, "Available" as ModelStatus);
          removeDownloadingModel(payload.modelName);
          toast.success(`${displayInfo?.icon || "✓"} ${displayNameFor(payload.modelName)} ready!`, {
            description: "Model downloaded and ready to use",
            duration: 4000,
          });

          onModelSelectRef.current?.(payload.modelName);
          if (autoSaveRef.current) {
            saveModelSelection(payload.modelName);
          }
        },
      );

      unlistenError = await listen<{ modelName: string; error: string }>(
        "parakeet-model-download-error",
        ({ payload }) => {
          updateModelStatus(payload.modelName, { Error: payload.error } as ModelStatus);
          removeDownloadingModel(payload.modelName);
          toast.error(`Failed to download ${displayNameFor(payload.modelName)}`, {
            description: payload.error,
            duration: 6000,
            action: { label: "Retry", onClick: () => downloadModel(payload.modelName) },
          });
        },
      );
    };

    setupListeners();

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, []);
}
