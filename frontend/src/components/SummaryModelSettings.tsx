"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ModelConfig, ModelSettingsModal } from "@/components/ModelSettingsModal";
import { SummaryLanguageSettings } from "@/components/SummaryLanguageSettings";
import { Switch } from "./ui/switch";
import { useConfig } from "@/contexts/ConfigContext";

interface SummaryModelSettingsProps {
  refetchTrigger?: number; // Change this to trigger refetch
}

function providerNeedsApiKey(provider: ModelConfig["provider"]) {
  return provider !== "ollama" && provider !== "builtin-ai";
}

async function withProviderApiKey(data: any) {
  if (!providerNeedsApiKey(data.provider) || data.apiKey) {
    return data;
  }

  try {
    const apiKeyData = (await invoke("api_get_api_key", {
      provider: data.provider,
    })) as string;
    return { ...data, apiKey: apiKeyData };
  } catch (err) {
    console.error("Failed to fetch API key:", err);
    return data;
  }
}

async function withCustomOpenAIConfig(data: any) {
  if (data.provider !== "custom-openai") {
    return data;
  }

  try {
    const customConfig = (await invoke("api_get_custom_openai_config")) as any;
    if (!customConfig) {
      return data;
    }

    return {
      ...data,
      customOpenAIDisplayName: customConfig.displayName || null,
      customOpenAIEndpoint: customConfig.endpoint || null,
      customOpenAIModel: customConfig.model || null,
      customOpenAIApiKey: customConfig.apiKey || null,
      maxTokens: customConfig.maxTokens || null,
      temperature: customConfig.temperature || null,
      topP: customConfig.topP || null,
      model: customConfig.model || data.model,
    };
  } catch (err) {
    console.error("Failed to fetch custom OpenAI config:", err);
    return data;
  }
}

export function SummaryModelSettings({ refetchTrigger }: SummaryModelSettingsProps) {
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: "ollama",
    model: "llama3.2:latest",
    whisperModel: "large-v3",
    apiKey: null,
    ollamaEndpoint: null,
  });

  const { isAutoSummary, toggleIsAutoSummary } = useConfig();

  // Reusable fetch function
  const fetchModelConfig = useCallback(async () => {
    try {
      const data = (await invoke("api_get_model_config")) as any;
      if (!data || data.provider === null) {
        return;
      }

      const configWithKey = await withProviderApiKey(data);
      const config = await withCustomOpenAIConfig(configWithKey);
      setModelConfig(config);
    } catch (error) {
      console.error("Failed to fetch model config:", error);
      toast.error("Failed to load model settings");
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchModelConfig();
  }, [fetchModelConfig]);

  // Refetch when trigger changes (optional external control)
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      fetchModelConfig();
    }
  }, [refetchTrigger, fetchModelConfig]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<ModelConfig>("model-config-updated", (event) => {
        console.log("SummaryModelSettings received model-config-updated event:", event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then((fn) => (cleanup = fn));

    return () => {
      cleanup?.();
    };
  }, []);

  // Save handler
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke("api_save_model_config", {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);

      // Emit event to sync other components
      const { emit } = await import("@tauri-apps/api/event");
      await emit("model-config-updated", config);

      toast.success("Model settings saved successfully");
    } catch (error) {
      console.error("Error saving model config:", error);
      toast.error("Failed to save model settings");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex min-h-20 items-center justify-between gap-6 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-medium text-gray-950">Auto summary</h3>
            <p className="mt-1 text-sm text-gray-500">
              Generate a summary when meeting recording stops.
            </p>
          </div>
          <Switch checked={isAutoSummary} onCheckedChange={toggleIsAutoSummary} />
        </div>
      </section>

      <SummaryLanguageSettings />

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Summary model</h2>
        <p className="mb-4 text-sm text-gray-500">
          Configure the AI model used for generating meeting summaries.
        </p>

        <ModelSettingsModal
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSave={handleSaveModelConfig}
          skipInitialFetch={true}
        />
      </section>
    </div>
  );
}
