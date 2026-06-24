import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import {
  ModelConfig,
  ModelProvider,
  getProviderGuidance,
} from "@/components/model-settings/modelSettingsTypes";
import { useCustomOpenAISettings } from "@/components/model-settings/useCustomOpenAISettings";
import { useOllamaModelSettings } from "@/components/model-settings/useOllamaModelSettings";
import { useProviderApiKeySettings } from "@/components/model-settings/useProviderApiKeySettings";
import { useProviderModelLists } from "@/components/model-settings/useProviderModelLists";

interface UseModelSettingsControllerProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSave: (config: ModelConfig) => void;
  skipInitialFetch?: boolean;
  layout?: "inline" | "dialog";
  useGlobalConfig?: boolean;
  heading?: string;
  modelLabel?: string;
  usage?: "summary" | "chat";
}

async function withApiKeyIfNeeded(data: any) {
  if (!data || data.provider === "ollama" || data.provider === "builtin-ai" || data.apiKey) {
    return data;
  }

  try {
    return {
      ...data,
      apiKey: await invoke("api_get_api_key", { provider: data.provider }),
    };
  } catch (err) {
    console.error("Failed to fetch API key:", err);
    return data;
  }
}

function readProviderModelMap() {
  return JSON.parse(localStorage.getItem("providerModelMap") || "{}");
}

function persistProviderModel(provider: ModelProvider, model: string) {
  const map = readProviderModelMap();
  map[provider] = model;
  localStorage.setItem("providerModelMap", JSON.stringify(map));
}

function buildSavedConfig({ modelConfig, apiKey, ollama, custom }: any): ModelConfig {
  const isCustom = modelConfig.provider === "custom-openai";

  return {
    ...modelConfig,
    apiKey: typeof apiKey === "string" ? apiKey.trim() || null : null,
    ollamaEndpoint:
      modelConfig.provider === "ollama"
        ? ollama.endpoint.trim() || null
        : modelConfig.ollamaEndpoint || null,
    customOpenAIEndpoint: isCustom ? custom.endpoint.trim() : null,
    customOpenAIModel: isCustom ? custom.model.trim() : null,
    customOpenAIApiKey: isCustom && custom.apiKey.trim() ? custom.apiKey.trim() : null,
    maxTokens: isCustom && custom.maxTokens ? parseInt(custom.maxTokens, 10) : null,
    temperature: isCustom && custom.temperature ? parseFloat(custom.temperature) : null,
    topP: isCustom && custom.topP ? parseFloat(custom.topP) : null,
    model: isCustom ? custom.model.trim() : modelConfig.model,
  };
}

export function useModelSettingsController({
  modelConfig: propsModelConfig,
  setModelConfig: propsSetModelConfig,
  onSave,
  skipInitialFetch = false,
  layout = "inline",
  useGlobalConfig = true,
  heading = "Model Settings",
  modelLabel = "Summarization Model",
  usage = "summary",
}: UseModelSettingsControllerProps) {
  const configContext = useConfig();
  const shouldUseGlobalConfig = useGlobalConfig && !!configContext;
  const modelConfig = shouldUseGlobalConfig ? configContext.modelConfig : propsModelConfig;
  const setModelConfig = shouldUseGlobalConfig ? configContext.setModelConfig : propsSetModelConfig;
  const providerApiKeys = shouldUseGlobalConfig ? configContext.providerApiKeys : undefined;
  const updateProviderApiKey = shouldUseGlobalConfig
    ? configContext.updateProviderApiKey
    : undefined;
  const [modelComboboxOpen, setModelComboboxOpen] = useState<boolean>(false);
  const [isProviderGuidanceOpen, setIsProviderGuidanceOpen] = useState<boolean>(false);
  const custom = useCustomOpenAISettings(modelConfig);
  const apiKeySettings = useProviderApiKeySettings({ modelConfig, providerApiKeys });
  const ollama = useOllamaModelSettings({ modelConfig, skipInitialFetch });
  const cloud = useProviderModelLists({
    modelConfig,
    setModelConfig,
    apiKey: apiKeySettings.apiKey,
    ollamaModelNames: ollama.models.map((model) => model.name),
    customOpenAIModel: custom.model,
  });

  const providerGuidance = getProviderGuidance(modelConfig.provider, usage);
  const isCustomOpenAIInvalid =
    modelConfig.provider === "custom-openai" && (!custom.endpoint.trim() || !custom.model.trim());
  const isDoneDisabled =
    (apiKeySettings.requiresApiKey && !apiKeySettings.apiKey?.trim()) ||
    (modelConfig.provider === "ollama" && ollama.endpointChanged) ||
    isCustomOpenAIInvalid;

  useEffect(() => {
    if (skipInitialFetch) {
      return;
    }

    const fetchModelConfig = async () => {
      try {
        const data = await withApiKeyIfNeeded(await invoke("api_get_model_config"));
        if (!data || data.provider === null) {
          return;
        }

        setModelConfig(data);
        if (data.apiKey) {
          apiKeySettings.setApiKey(data.apiKey);
        }
        if (data.provider === "custom-openai") {
          custom.applyCustomConfig(await invoke("api_get_custom_openai_config"));
        }
      } catch (error) {
        console.error("Failed to fetch model config:", error);
      }
    };

    fetchModelConfig();
  }, [skipInitialFetch]);

  useEffect(() => {
    const providerModels = cloud.modelOptions[modelConfig.provider];
    if (!providerModels?.length || providerModels.includes(modelConfig.model)) {
      return;
    }

    const cachedModel = readProviderModelMap()[modelConfig.provider];
    if (cachedModel && providerModels.includes(cachedModel)) {
      setModelConfig((prev: ModelConfig) => ({ ...prev, model: cachedModel }));
    }
  });

  const handleProviderChange = (provider: ModelProvider) => {
    ollama.setError("");
    if (modelConfig.model) {
      persistProviderModel(modelConfig.provider, modelConfig.model);
    }

    const savedModel = readProviderModelMap()[provider];
    const providerModels = cloud.modelOptions[provider];
    const defaultModel = providerModels && providerModels.length > 0 ? providerModels[0] : "";
    const model = savedModel && providerModels?.includes(savedModel) ? savedModel : defaultModel;
    setModelConfig({ ...modelConfig, provider, model });

    if (provider === "openrouter") cloud.loadOpenRouterModels();
    if (provider === "builtin-ai") cloud.loadBuiltinAiModels();
    if (provider === "custom-openai") custom.loadCustomConfig();
  };

  const handleSave = async () => {
    if (modelConfig.provider === "custom-openai") {
      try {
        await custom.saveCustomConfig();
      } catch (err) {
        console.error("Failed to save custom OpenAI config:", err);
        toast.error("Failed to save custom OpenAI configuration");
        return;
      }
    }

    const updatedConfig = buildSavedConfig({
      modelConfig,
      apiKey: apiKeySettings.apiKey,
      ollama,
      custom,
    });
    setModelConfig(updatedConfig);

    if (updatedConfig.model) {
      persistProviderModel(updatedConfig.provider, updatedConfig.model);
    }
    if (
      updateProviderApiKey &&
      updatedConfig.apiKey &&
      updatedConfig.provider !== "custom-openai"
    ) {
      updateProviderApiKey(updatedConfig.provider, updatedConfig.apiKey);
    }

    onSave(updatedConfig);
  };

  return {
    modelConfig,
    setModelConfig,
    heading,
    modelLabel,
    layout,
    usage,
    modelOptions: cloud.modelOptions,
    modelComboboxOpen,
    setModelComboboxOpen,
    cloud,
    custom,
    apiKeySettings,
    ollama,
    providerGuidance,
    isProviderGuidanceOpen,
    setIsProviderGuidanceOpen,
    isDoneDisabled,
    handleProviderChange,
    handleSave,
  };
}
