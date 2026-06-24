import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  BuiltInDownloadProgressInfo,
  BuiltInModelInfo,
} from "@/components/model-settings/builtinModelTypes";
import { summaryModelPriority } from "@/components/model-settings/builtinModelGuidance";

type DownloadProgressEvent = {
  model: string;
  progress: number;
  downloaded_mb?: number;
  total_mb?: number;
  speed_mbps?: number;
  status?: "downloading" | "completed" | "cancelled" | "error";
};

interface UseBuiltInModelManagerProps {
  selectedModel: string;
  onModelSelect: (model: string) => void;
}

function withoutModel<T>(items: Record<string, T>, modelName: string) {
  const { [modelName]: _, ...rest } = items;
  return rest;
}

export function useBuiltInModelManager({
  selectedModel,
  onModelSelect,
}: UseBuiltInModelManagerProps) {
  const [models, setModels] = useState<BuiltInModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasFetched, setHasFetched] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadProgressInfo, setDownloadProgressInfo] = useState<
    Record<string, BuiltInDownloadProgressInfo>
  >({});
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      setIsLoading(true);
      const data = (await invoke("builtin_ai_list_models")) as BuiltInModelInfo[];
      setModels(data);

      const bestAvailable = data
        .filter((model) => model.status.type === "available")
        .sort((a, b) => summaryModelPriority(b.name) - summaryModelPriority(a.name))[0];

      if (data.length > 0 && !selectedModel && bestAvailable) {
        onModelSelect(bestAvailable.name);
      }
    } catch (error) {
      console.error("Failed to fetch built-in AI models:", error);
      toast.error("Failed to load models");
    } finally {
      setIsLoading(false);
      setHasFetched(true);
    }
  };

  const clearDownloadState = (modelName: string) => {
    setDownloadingModels((prev) => {
      const newSet = new Set(prev);
      newSet.delete(modelName);
      return newSet;
    });
    setDownloadProgress((prev) => withoutModel(prev, modelName));
    setDownloadProgressInfo((prev) => withoutModel(prev, modelName));
  };

  const markDownloadErrored = (modelName: string) => {
    setModels((prevModels) =>
      prevModels.map((model) =>
        model.name === modelName
          ? { ...model, status: { type: "error", progress: 0 } as BuiltInModelInfo["status"] }
          : model,
      ),
    );
  };

  const applyProgressEvent = (payload: DownloadProgressEvent) => {
    const { model, progress, downloaded_mb, total_mb, speed_mbps, status } = payload;

    setDownloadProgress((prev) => ({ ...prev, [model]: progress }));
    setDownloadProgressInfo((prev) => ({
      ...prev,
      [model]: {
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 0,
        speedMbps: speed_mbps ?? 0,
      },
    }));

    if (status === "downloading") {
      setDownloadingModels((prev) => (prev.has(model) ? prev : new Set([...prev, model])));
      return;
    }

    if (status === "completed") {
      clearDownloadState(model);
      fetchModels();
      toast.success(`Model ${model} downloaded successfully`);
      return;
    }

    if (status === "cancelled") {
      clearDownloadState(model);
      fetchModels();
      return;
    }

    if (status === "error") {
      clearDownloadState(model);
      markDownloadErrored(model);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen("builtin-ai-download-progress", (event: any) => {
        applyProgressEvent(event.payload as DownloadProgressEvent);
      });
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, []);

  const downloadModel = async (modelName: string) => {
    try {
      setDownloadingModels((prev) => new Set([...prev, modelName]));
      await invoke("builtin_ai_download_model", { modelName });
    } catch (error) {
      console.error("Failed to download model:", error);

      if (String(error).startsWith("CANCELLED:")) {
        return;
      }

      toast.error(`Failed to download ${modelName}`);
      clearDownloadState(modelName);
      fetchModels();
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      await invoke("builtin_ai_cancel_download", { modelName });
      toast.info(`Download of ${modelName} cancelled`);
      clearDownloadState(modelName);
    } catch (error) {
      console.error("Failed to cancel download:", error);
    }
  };

  const deleteModel = async (modelName: string) => {
    try {
      await invoke("builtin_ai_delete_model", { modelName });
      toast.success(`Model ${modelName} deleted`);
      fetchModels();
    } catch (error) {
      console.error("Failed to delete model:", error);
      toast.error(`Failed to delete ${modelName}`);
    }
  };

  return {
    models,
    isLoading,
    hasFetched,
    downloadProgress,
    downloadProgressInfo,
    downloadingModels,
    expandedModel,
    setExpandedModel,
    downloadModel,
    cancelDownload,
    deleteModel,
  };
}
