import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ModelStatus, ParakeetAPI, ParakeetModelInfo, getModelDisplayInfo } from "@/lib/parakeet";
import { useParakeetModelDownloadEvents } from "@/components/model-settings/useParakeetModelDownloadEvents";

interface UseParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  autoSave?: boolean;
}

function displayNameFor(modelName: string) {
  const displayInfo = getModelDisplayInfo(modelName);
  return displayInfo?.friendlyName || modelName;
}

export function useParakeetModelManager({
  selectedModel,
  onModelSelect,
  autoSave = false,
}: UseParakeetModelManagerProps) {
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
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

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke("api_save_transcript_config", {
        provider: "parakeet",
        model: modelName,
        apiKey: null,
      });
    } catch (error) {
      console.error("Failed to save model selection:", error);
    }
  };

  const updateModelStatus = (modelName: string, status: ModelStatus) => {
    setModels((prevModels) =>
      prevModels.map((model) => (model.name === modelName ? { ...model, status } : model)),
    );
  };

  const removeDownloadingModel = (modelName: string) => {
    setDownloadingModels((prev) => {
      const newSet = new Set(prev);
      newSet.delete(modelName);
      return newSet;
    });
    progressThrottleRef.current.delete(modelName);
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    try {
      setDownloadingModels((prev) => new Set([...prev, modelName]));
      updateModelStatus(modelName, { Downloading: 0 } as ModelStatus);
      toast.info(`Downloading ${displayNameFor(modelName)}...`, {
        description: "This may take a few minutes",
        duration: 5000,
      });
      await ParakeetAPI.downloadModel(modelName);
    } catch (err) {
      console.error("Download failed:", err);
      removeDownloadingModel(modelName);
      updateModelStatus(modelName, {
        Error: err instanceof Error ? err.message : "Download failed",
      } as ModelStatus);
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      await ParakeetAPI.cancelDownload(modelName);
      removeDownloadingModel(modelName);
      updateModelStatus(modelName, "Missing" as ModelStatus);
      toast.info(`${displayNameFor(modelName)} download cancelled`, { duration: 3000 });
    } catch (err) {
      console.error("Failed to cancel download:", err);
      toast.error("Failed to cancel download", {
        description: err instanceof Error ? err.message : "Unknown error",
        duration: 4000,
      });
    }
  };

  const selectModel = async (modelName: string) => {
    onModelSelect?.(modelName);

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    toast.success(`Switched to ${displayNameFor(modelName)}`, { duration: 3000 });
  };

  const deleteModel = async (modelName: string) => {
    try {
      await ParakeetAPI.deleteCorruptedModel(modelName);
      setModels(await ParakeetAPI.getAvailableModels());
      toast.success(`${displayNameFor(modelName)} deleted`, {
        description: "Model removed to free up space",
        duration: 3000,
      });

      if (selectedModel === modelName) {
        onModelSelect?.("");
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
      toast.error(`Failed to delete ${displayNameFor(modelName)}`, {
        description: err instanceof Error ? err.message : "Delete failed",
        duration: 4000,
      });
    }
  };

  useParakeetModelDownloadEvents({
    progressThrottleRef,
    updateModelStatus,
    removeDownloadingModel,
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
        await ParakeetAPI.init();
        setModels(await ParakeetAPI.getAvailableModels());
        setInitialized(true);
      } catch (err) {
        console.error("Failed to initialize Parakeet:", err);
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
