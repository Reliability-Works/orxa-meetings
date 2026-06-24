import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useOllamaDownload } from "@/contexts/OllamaDownloadContext";
import { isOllamaNotInstalledError } from "@/lib/utils";
import { ModelConfig, OllamaModel } from "@/components/model-settings/modelSettingsTypes";

interface UseOllamaModelSettingsProps {
  modelConfig: ModelConfig;
  skipInitialFetch: boolean;
}

export function validateOllamaEndpoint(url: string) {
  if (!url.trim()) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function filterOllamaModels(models: OllamaModel[], searchQuery: string, selectedModel: string) {
  if (!searchQuery.trim()) {
    return models;
  }

  const query = searchQuery.toLowerCase();
  return models.filter((model) => {
    const loadedText = selectedModel === model.name ? "loaded" : "";
    return (
      model.name.toLowerCase().includes(query) ||
      model.size.toLowerCase().includes(query) ||
      loadedText.includes(query)
    );
  });
}

export function useOllamaModelSettings({
  modelConfig,
  skipInitialFetch,
}: UseOllamaModelSettingsProps) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>("");
  const [endpoint, setEndpoint] = useState<string>(modelConfig.ollamaEndpoint || "");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lastFetchedEndpoint, setLastFetchedEndpoint] = useState<string>(
    modelConfig.ollamaEndpoint || "",
  );
  const [endpointValidationState, setEndpointValidationState] = useState<
    "valid" | "invalid" | "none"
  >("none");
  const [hasAutoFetched, setHasAutoFetched] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isEndpointSectionCollapsed, setIsEndpointSectionCollapsed] = useState<boolean>(true);
  const [ollamaNotInstalled, setOllamaNotInstalled] = useState<boolean>(false);
  const modelsCache = useRef<Map<string, OllamaModel[]>>(new Map());
  const previousDownloadingRef = useRef<Set<string>>(new Set());
  const { isDownloading, getProgress, downloadingModels } = useOllamaDownload();
  const endpointChanged =
    modelConfig.provider === "ollama" && endpoint.trim() !== lastFetchedEndpoint.trim();

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = endpoint.trim();
      setEndpointValidationState(
        !trimmed ? "none" : validateOllamaEndpoint(trimmed) ? "valid" : "invalid",
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [endpoint]);

  useEffect(() => {
    const nextEndpoint = modelConfig.ollamaEndpoint || "";
    if (nextEndpoint !== endpoint) {
      setEndpoint(nextEndpoint);
    }
  }, [modelConfig.ollamaEndpoint, modelConfig.provider]);

  useEffect(() => {
    if (modelConfig.provider !== "ollama") {
      setHasAutoFetched(false);
      setModels([]);
      setError("");
      setOllamaNotInstalled(false);
    }
  }, [modelConfig.provider]);

  useEffect(() => {
    if (modelConfig.provider !== "ollama" || endpoint.trim() === lastFetchedEndpoint.trim()) {
      return;
    }

    const cachedModels = modelsCache.current.get(endpoint.trim());
    if (cachedModels && cachedModels.length > 0) {
      setModels(cachedModels);
      setLastFetchedEndpoint(endpoint.trim());
      setError("");
      return;
    }

    setHasAutoFetched(false);
    setModels([]);
    setError("");
  }, [endpoint, lastFetchedEndpoint, modelConfig.provider]);

  const fetchModels = async (silent = false) => {
    const trimmedEndpoint = endpoint.trim();
    if (trimmedEndpoint && !validateOllamaEndpoint(trimmedEndpoint)) {
      const errorMsg = "Invalid Ollama endpoint URL. Must start with http:// or https://";
      setError(errorMsg);
      if (!silent) toast.error(errorMsg);
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const modelList = (await invoke("get_ollama_models", {
        endpoint: trimmedEndpoint || null,
      })) as OllamaModel[];
      setModels(modelList);
      setLastFetchedEndpoint(trimmedEndpoint);
      modelsCache.current.set(trimmedEndpoint, modelList);
      setOllamaNotInstalled(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to load Ollama models";
      setError(errorMsg);
      setOllamaNotInstalled(isOllamaNotInstalledError(errorMsg));
      if (!silent) toast.error(errorMsg);
      console.error("Error loading models:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initialLoad = async () => {
      if (modelConfig.provider === "ollama" && !hasAutoFetched && mounted) {
        await fetchModels(skipInitialFetch);
        setHasAutoFetched(true);
      }
    };

    initialLoad();
    return () => {
      mounted = false;
    };
  }, [modelConfig.provider]);

  useEffect(() => {
    const current = downloadingModels;
    const previous = previousDownloadingRef.current;

    for (const modelName of previous) {
      if (!current.has(modelName)) {
        fetchModels(true);
        break;
      }
    }

    previousDownloadingRef.current = new Set(current);
  }, [downloadingModels]);

  const handleEndpointChange = (value: string) => {
    setEndpoint(value);
    if (value.trim() !== lastFetchedEndpoint.trim()) {
      setModels([]);
      setError("");
    }
  };

  const downloadRecommendedModel = async () => {
    const recommendedModel = "gemma3:1b";
    if (isDownloading(recommendedModel)) {
      toast.info(`${recommendedModel} is already downloading`, {
        description: `Progress: ${Math.round(getProgress(recommendedModel) || 0)}%`,
      });
      return;
    }

    try {
      await invoke("pull_ollama_model", {
        modelName: recommendedModel,
        endpoint: endpoint.trim() || null,
      });
      await fetchModels(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to download model";
      console.error("Error downloading model:", err);
      if (isOllamaNotInstalledError(errorMsg)) {
        setOllamaNotInstalled(true);
        toast.error("Ollama is not installed", {
          description: "Please download and install Ollama before downloading models.",
          duration: 7000,
          action: {
            label: "Download",
            onClick: () => invoke("open_external_url", { url: "https://ollama.com/download" }),
          },
        });
      }
    }
  };

  const filteredModels = filterOllamaModels(models, searchQuery, modelConfig.model);

  return {
    models,
    error,
    setError,
    endpoint,
    isLoading,
    lastFetchedEndpoint,
    endpointValidationState,
    searchQuery,
    setSearchQuery,
    isEndpointSectionCollapsed,
    setIsEndpointSectionCollapsed,
    ollamaNotInstalled,
    endpointChanged,
    filteredModels,
    isDownloading,
    getProgress,
    fetchModels,
    handleEndpointChange,
    downloadRecommendedModel,
  };
}
