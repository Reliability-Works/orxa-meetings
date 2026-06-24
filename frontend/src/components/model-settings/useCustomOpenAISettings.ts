import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ModelConfig } from "@/components/model-settings/modelSettingsTypes";

export function useCustomOpenAISettings(modelConfig: ModelConfig) {
  const [endpoint, setEndpoint] = useState<string>(modelConfig.customOpenAIEndpoint || "");
  const [model, setModel] = useState<string>(modelConfig.customOpenAIModel || "");
  const [apiKey, setApiKey] = useState<string>(modelConfig.customOpenAIApiKey || "");
  const [maxTokens, setMaxTokens] = useState<string>(modelConfig.maxTokens?.toString() || "");
  const [temperature, setTemperature] = useState<string>(modelConfig.temperature?.toString() || "");
  const [topP, setTopP] = useState<string>(modelConfig.topP?.toString() || "");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);

  const applyCustomConfig = (config: any) => {
    setEndpoint(config?.endpoint || "");
    setModel(config?.model || "");
    setApiKey(config?.apiKey || "");
    setMaxTokens(config?.maxTokens?.toString() || "");
    setTemperature(config?.temperature?.toString() || "");
    setTopP(config?.topP?.toString() || "");
  };

  useEffect(() => {
    if (modelConfig.provider !== "custom-openai") {
      return;
    }

    setEndpoint(modelConfig.customOpenAIEndpoint || "");
    setModel(modelConfig.customOpenAIModel || "");
    setApiKey(modelConfig.customOpenAIApiKey || "");
    setMaxTokens(modelConfig.maxTokens?.toString() || "");
    setTemperature(modelConfig.temperature?.toString() || "");
    setTopP(modelConfig.topP?.toString() || "");
  }, [
    modelConfig.provider,
    modelConfig.customOpenAIEndpoint,
    modelConfig.customOpenAIModel,
    modelConfig.customOpenAIApiKey,
    modelConfig.maxTokens,
    modelConfig.temperature,
    modelConfig.topP,
  ]);

  const loadCustomConfig = async () => {
    try {
      applyCustomConfig(await invoke<any>("api_get_custom_openai_config"));
    } catch (err) {
      console.error("Failed to load custom OpenAI config:", err);
    }
  };

  const saveCustomConfig = async () => {
    await invoke("api_save_custom_openai_config", {
      endpoint: endpoint.trim(),
      apiKey: apiKey.trim() || null,
      model: model.trim(),
      maxTokens: maxTokens ? parseInt(maxTokens, 10) : null,
      temperature: temperature ? parseFloat(temperature) : null,
      topP: topP ? parseFloat(topP) : null,
    });
  };

  const testConnection = async () => {
    if (!endpoint.trim() || !model.trim()) {
      toast.error("Please enter endpoint URL and model name first");
      return;
    }

    setIsTestingConnection(true);
    try {
      const result = await invoke<{ status: string; message: string }>(
        "api_test_custom_openai_connection",
        {
          endpoint: endpoint.trim(),
          apiKey: apiKey.trim() || null,
          model: model.trim(),
        },
      );
      toast.success(result.message || "Connection successful!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTestingConnection(false);
    }
  };

  return {
    endpoint,
    setEndpoint,
    model,
    setModel,
    apiKey,
    setApiKey,
    maxTokens,
    setMaxTokens,
    temperature,
    setTemperature,
    topP,
    setTopP,
    isAdvancedOpen,
    setIsAdvancedOpen,
    isTestingConnection,
    applyCustomConfig,
    loadCustomConfig,
    saveCustomConfig,
    testConnection,
  };
}
