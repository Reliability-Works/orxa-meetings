export interface ModelConfig {
  provider: "ollama" | "groq" | "claude" | "openai" | "openrouter" | "builtin-ai" | "custom-openai";
  model: string;
  whisperModel: string;
  apiKey?: string | null;
  ollamaEndpoint?: string | null;
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  customOpenAIApiKey?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
}

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  prompt_price?: string;
  completion_price?: string;
}

export interface OpenAIModel {
  id: string;
}

export interface AnthropicModel {
  id: string;
  display_name?: string;
}

export interface GroqModel {
  id: string;
  owned_by?: string;
}

export type ModelProvider = ModelConfig["provider"];

export type ProviderGuidance = {
  label: string;
  pros: string[];
  cons: string[];
};

export const OPENAI_FALLBACK_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
];

export const CLAUDE_FALLBACK_MODELS = [
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5-20251101",
  "claude-3-5-sonnet-latest",
];

export const GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];

export function summaryModelPriority(modelName: string) {
  if (modelName === "qwen3.5:4b") return 40;
  if (modelName === "qwen3.5:2b") return 30;
  if (modelName === "gemma3:4b") return 20;
  if (modelName === "gemma3:1b") return 10;
  return 0;
}

export function requiresProviderApiKey(provider: ModelProvider) {
  return (
    provider === "claude" ||
    provider === "groq" ||
    provider === "openai" ||
    provider === "openrouter"
  );
}

export function getProviderGuidance(provider: ModelProvider, usage: "summary" | "chat") {
  if (usage === "chat") {
    return getChatProviderGuidance(provider);
  }

  return getSummaryProviderGuidance(provider);
}

function getChatProviderGuidance(provider: ModelProvider): ProviderGuidance {
  if (provider === "builtin-ai") {
    return {
      label: "Best private meeting chat path",
      pros: ["No API key required.", "Works against local meeting transcripts and summaries."],
      cons: [
        "Local models are slower than cloud agents.",
        "Reasoning quality depends on the selected built-in model.",
      ],
    };
  }

  if (provider === "custom-openai") {
    return {
      label: "Best self-hosted agent path",
      pros: [
        "Can point at a private OpenAI-compatible agent server.",
        "Good when you want stronger local/server-side chat models.",
      ],
      cons: [
        "You manage endpoint uptime and context limits.",
        "Tool behavior depends on the server model.",
      ],
    };
  }

  if (provider === "ollama") {
    return {
      label: "Best simple local agent server path",
      pros: [
        "Works with an existing Ollama setup.",
        "Easy to test chat-oriented models for meeting Q&A.",
      ],
      cons: [
        "Ollama must stay running while chatting.",
        "Some models may ignore evidence more than built-in Qwen.",
      ],
    };
  }

  return {
    label: "Best high-capability remote agent path",
    pros: [
      "Can use stronger remote reasoning models.",
      "Usually better for complex follow-up questions.",
    ],
    cons: ["Requires API configuration.", "Meeting content leaves the fully local path."],
  };
}

function getSummaryProviderGuidance(provider: ModelProvider): ProviderGuidance {
  if (provider === "builtin-ai") {
    return {
      label: "Best private/offline path",
      pros: ["No API key required.", "Best local quality is Qwen 3.5 4B when available."],
      cons: ["Limited by local model size and hardware.", "Large models take disk and memory."],
    };
  }

  if (provider === "custom-openai") {
    return {
      label: "Best for local or self-hosted experiments",
      pros: [
        "Can point at a private OpenAI-compatible server.",
        "Good for testing newer local LLM runtimes.",
      ],
      cons: [
        "You manage endpoint reliability and model limits.",
        "Quality depends entirely on the server model.",
      ],
    };
  }

  if (provider === "ollama") {
    return {
      label: "Best simple local server path",
      pros: ["Works with an existing Ollama setup.", "Easy to swap models for experiments."],
      cons: ["Requires Ollama to be installed and running.", "Model quality varies widely."],
    };
  }

  return {
    label: "Best when you already use this cloud provider",
    pros: ["Can use stronger remote models.", "Less local disk and memory pressure."],
    cons: ["Requires API configuration.", "Meeting content leaves the fully local path."],
  };
}
