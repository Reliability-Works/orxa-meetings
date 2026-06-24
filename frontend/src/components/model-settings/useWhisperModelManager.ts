import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ModelInfo, ModelStatus, WhisperAPI } from "@/lib/whisper";
import { getWhisperDisplayName } from "@/components/model-settings/whisperModelGuidance";
import { useWhisperModelDownloadEvents } from "@/components/model-settings/useWhisperModelDownloadEvents";

interface UseWhisperModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  autoSave?: boolean;
}

function persistedDownloadingModels() {
  try {
    const saved = localStorage.getItem("downloading-models");
    return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function shouldClearPersistedDownload(model: ModelInfo, persisted: Set<string>) {
  return (
    persisted.has(model.name) &&
    model.status !== "Available" &&
    (model.status === "Missing" ||
      (typeof model.status === "object" && "Corrupted" in model.status))
  );
}

function withPersistedDownloadState(
  modelList: ModelInfo[],
  persisted: Set<string>,
  clearDownloading: (modelName: string) => void,
) {
  return modelList.map((model) => {
    if (!persisted.has(model.name) || model.status === "Available") {
      return model;
    }

    if (shouldClearPersistedDownload(model, persisted)) {
      clearDownloading(model.name);
      return model;
    }

    return { ...model, status: { Downloading: 0 } as ModelStatus };
  });
}

export function useWhisperModelManager({
  selectedModel,
  onModelSelect,
  autoSave = false,
}: UseWhisperModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(
    new Map(),
  );

  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  const updateDownloadingModels = (updater: (prev: Set<string>) => Set<string>) => {
    setDownloadingModels((prev) => {
      const newSet = updater(prev);
      localStorage.setItem("downloading-models", JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  const clearDownloadingModel = (modelName: string) => {
    updateDownloadingModels((prev) => {
      const newSet = new Set(prev);
      newSet.delete(modelName);
      return newSet;
    });
    progressThrottleRef.current.delete(modelName);
  };

  const updateModelStatus = (modelName: string, status: ModelStatus) => {
    setModels((prevModels) =>
      prevModels.map((model) => (model.name === modelName ? { ...model, status } : model)),
    );
  };

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke("api_save_transcript_config", {
        provider: "localWhisper",
        model: modelName,
        apiKey: null,
      });
    } catch (error) {
      console.error("Failed to save model selection:", error);
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      await WhisperAPI.cancelDownload(modelName);
      clearDownloadingModel(modelName);
      updateModelStatus(modelName, "Missing" as ModelStatus);
      toast.info(`${getWhisperDisplayName(modelName)} download cancelled`, { duration: 3000 });
    } catch (err) {
      console.error("Failed to cancel download:", err);
      toast.error("Failed to cancel download", {
        description: err instanceof Error ? err.message : "Unknown error",
        duration: 4000,
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    try {
      updateDownloadingModels((prev) => new Set([...prev, modelName]));
      updateModelStatus(modelName, { Downloading: 0 } as ModelStatus);
      toast.info(`Downloading ${getWhisperDisplayName(modelName)}...`, {
        description: "This may take a few minutes",
        duration: 5000,
      });
      await WhisperAPI.downloadModel(modelName);
    } catch (err) {
      console.error("Download failed:", err);
      clearDownloadingModel(modelName);
      updateModelStatus(modelName, {
        Error: err instanceof Error ? err.message : "Download failed",
      } as ModelStatus);
    }
  };

  const selectModel = async (modelName: string) => {
    onModelSelect?.(modelName);

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    toast.success(`Switched to ${getWhisperDisplayName(modelName)}`, { duration: 3000 });
  };

  const deleteModel = async (modelName: string) => {
    try {
      await WhisperAPI.deleteCorruptedModel(modelName);
      setModels(await WhisperAPI.getAvailableModels());
      toast.success(`${getWhisperDisplayName(modelName)} deleted`, {
        description: "Model removed to free up space",
        duration: 3000,
      });

      if (selectedModel === modelName) {
        onModelSelect?.("");
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
      toast.error(`Failed to delete ${getWhisperDisplayName(modelName)}`, {
        description: err instanceof Error ? err.message : "Delete failed",
        duration: 4000,
      });
    }
  };

  useWhisperModelDownloadEvents({
    progressThrottleRef,
    updateModelStatus,
    updateDownloadingModels,
    saveModelSelection,
    downloadModel,
    autoSaveRef,
    onModelSelectRef,
  });

  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await WhisperAPI.init();
        const modelList = await WhisperAPI.getAvailableModels();
        const persisted = persistedDownloadingModels();
        setModels(withPersistedDownloadState(modelList, persisted, clearDownloadingModel));
        setInitialized(true);
      } catch (err) {
        console.error("Failed to initialize Whisper:", err);
        setError(err instanceof Error ? err.message : "Failed to load models");
        toast.error("Failed to load transcription models", {
          description: err instanceof Error ? err.message : "Unknown error",
          duration: 5000,
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  return {
    models,
    loading,
    error,
    downloadingModels,
    selectModel,
    downloadModel,
    cancelDownload,
    deleteModel,
  };
}
