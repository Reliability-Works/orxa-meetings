import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  AnthropicModel,
  CLAUDE_FALLBACK_MODELS,
  GROQ_FALLBACK_MODELS,
  GroqModel,
  ModelConfig,
  OPENAI_FALLBACK_MODELS,
  OpenAIModel,
  OpenRouterModel,
  summaryModelPriority,
} from "@/components/model-settings/modelSettingsTypes";

interface UseProviderModelListsProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  apiKey: string | null;
  ollamaModelNames: string[];
  customOpenAIModel: string;
}

export function useProviderModelLists({
  modelConfig,
  setModelConfig,
  apiKey,
  ollamaModelNames,
  customOpenAIModel,
}: UseProviderModelListsProps) {
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [builtinAiModels, setBuiltinAiModels] = useState<any[]>([]);
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [isLoadingOpenRouter, setIsLoadingOpenRouter] = useState<boolean>(false);
  const [isLoadingOpenAI, setIsLoadingOpenAI] = useState<boolean>(false);
  const [isLoadingClaude, setIsLoadingClaude] = useState<boolean>(false);
  const [isLoadingGroq, setIsLoadingGroq] = useState<boolean>(false);

  const modelOptions: Record<string, string[]> = {
    ollama: ollamaModelNames,
    claude: claudeModels.length > 0 ? claudeModels : CLAUDE_FALLBACK_MODELS,
    groq: groqModels.length > 0 ? groqModels : GROQ_FALLBACK_MODELS,
    openai: openaiModels.length > 0 ? openaiModels : OPENAI_FALLBACK_MODELS,
    openrouter: openRouterModels.map((model) => model.id),
    "builtin-ai": builtinAiModels.map((model) => model.name),
    "custom-openai": customOpenAIModel ? [customOpenAIModel] : [],
  };

  const loadOpenRouterModels = async () => {
    if (openRouterModels.length > 0) return;
    try {
      setIsLoadingOpenRouter(true);
      setOpenRouterModels((await invoke("get_openrouter_models")) as OpenRouterModel[]);
    } catch (err) {
      console.error("Error loading OpenRouter models:", err);
    } finally {
      setIsLoadingOpenRouter(false);
    }
  };

  const loadBuiltinAiModels = async () => {
    if (builtinAiModels.length > 0) return;
    try {
      const data = (await invoke("builtin_ai_list_models")) as any[];
      setBuiltinAiModels(data);
      const bestAvailable = data
        .filter((model: any) => model.status?.type === "available")
        .sort(
          (left: any, right: any) =>
            summaryModelPriority(right.name) - summaryModelPriority(left.name),
        )[0];
      if (data.length > 0 && !modelConfig.model && bestAvailable) {
        setModelConfig((prev: ModelConfig) => ({ ...prev, model: bestAvailable.name }));
      }
    } catch (err) {
      console.error("Error loading Built-in AI models:", err);
      toast.error("Failed to load Built-in AI models");
    }
  };

  const loadOpenAIModels = async (key: string | null) => {
    if (!key?.trim()) {
      setOpenaiModels([]);
      return;
    }
    setIsLoadingOpenAI(true);
    try {
      const data = (await invoke("get_openai_models", { apiKey: key })) as OpenAIModel[];
      setOpenaiModels(data.map((model) => model.id));
    } catch (err) {
      console.error("Error loading OpenAI models:", err);
      setOpenaiModels([]);
    } finally {
      setIsLoadingOpenAI(false);
    }
  };

  const loadClaudeModels = async (key: string | null) => {
    if (!key?.trim()) {
      setClaudeModels([]);
      return;
    }
    setIsLoadingClaude(true);
    try {
      const data = (await invoke("get_anthropic_models", { apiKey: key })) as AnthropicModel[];
      setClaudeModels(data.map((model) => model.id));
    } catch (err) {
      console.error("Error loading Claude models:", err);
      setClaudeModels([]);
    } finally {
      setIsLoadingClaude(false);
    }
  };

  const loadGroqModels = async (key: string | null) => {
    if (!key?.trim()) {
      setGroqModels([]);
      return;
    }
    setIsLoadingGroq(true);
    try {
      const data = (await invoke("get_groq_models", { apiKey: key })) as GroqModel[];
      setGroqModels(data.map((model) => model.id));
    } catch (err) {
      console.error("Error loading Groq models:", err);
      setGroqModels([]);
    } finally {
      setIsLoadingGroq(false);
    }
  };

  useEffect(() => {
    if (modelConfig.provider === "openai" && apiKey?.trim()) {
      loadOpenAIModels(apiKey);
    }
  }, [modelConfig.provider, apiKey]);

  useEffect(() => {
    if (modelConfig.provider === "claude" && apiKey?.trim()) {
      loadClaudeModels(apiKey);
    }
  }, [modelConfig.provider, apiKey]);

  useEffect(() => {
    if (modelConfig.provider === "groq" && apiKey?.trim()) {
      loadGroqModels(apiKey);
    }
  }, [modelConfig.provider, apiKey]);

  return {
    modelOptions,
    loadOpenRouterModels,
    loadBuiltinAiModels,
    isLoadingOpenRouter,
    isLoadingOpenAI,
    isLoadingClaude,
    isLoadingGroq,
    modelListDependencies: [
      ollamaModelNames,
      openRouterModels,
      builtinAiModels,
      openaiModels,
      claudeModels,
      groqModels,
    ],
  };
}
