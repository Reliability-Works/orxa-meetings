import { useEffect, type MutableRefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { ModelStatus, getModelIcon } from "@/lib/whisper";
import { getWhisperDisplayName } from "@/components/model-settings/whisperModelGuidance";

interface UseWhisperModelDownloadEventsProps {
  progressThrottleRef: MutableRefObject<Map<string, { progress: number; timestamp: number }>>;
  updateModelStatus: (modelName: string, status: ModelStatus) => void;
  updateDownloadingModels: (updater: (prev: Set<string>) => Set<string>) => void;
  saveModelSelection: (modelName: string) => Promise<void>;
  downloadModel: (modelName: string) => Promise<void>;
  autoSaveRef: MutableRefObject<boolean>;
  onModelSelectRef: MutableRefObject<((modelName: string) => void) | undefined>;
}

function removeDownloading(
  updater: (updater: (prev: Set<string>) => Set<string>) => void,
  modelName: string,
) {
  updater((prev) => {
    const newSet = new Set(prev);
    newSet.delete(modelName);
    return newSet;
  });
}

export function useWhisperModelDownloadEvents({
  progressThrottleRef,
  updateModelStatus,
  updateDownloadingModels,
  saveModelSelection,
  downloadModel,
  autoSaveRef,
  onModelSelectRef,
}: UseWhisperModelDownloadEventsProps) {
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        "model-download-progress",
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
        "model-download-complete",
        ({ payload }) => {
          const { modelName } = payload;
          updateModelStatus(modelName, "Available" as ModelStatus);
          removeDownloading(updateDownloadingModels, modelName);
          progressThrottleRef.current.delete(modelName);

          toast.success(`${getModelIcon("Good")} ${getWhisperDisplayName(modelName)} ready!`, {
            description: "Model downloaded and ready to use",
            duration: 4000,
          });

          onModelSelectRef.current?.(modelName);
          if (autoSaveRef.current) {
            saveModelSelection(modelName);
          }
        },
      );

      unlistenError = await listen<{ modelName: string; error: string }>(
        "model-download-error",
        ({ payload }) => {
          updateModelStatus(payload.modelName, { Error: payload.error } as ModelStatus);
          removeDownloading(updateDownloadingModels, payload.modelName);
          progressThrottleRef.current.delete(payload.modelName);

          toast.error(`Failed to download ${getWhisperDisplayName(payload.modelName)}`, {
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
