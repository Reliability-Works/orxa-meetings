import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { ModelManager } from "./WhisperModelManager";
import { ParakeetModelManager } from "./ParakeetModelManager";
import { ExperimentalTranscriptionModels } from "./ExperimentalTranscriptionModels";

export interface TranscriptModelProps {
  provider: "localWhisper" | "parakeet" | "deepgram" | "elevenLabs" | "groq" | "openai";
  model: string;
  apiKey?: string | null;
}

export interface TranscriptSettingsProps {
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
  onModelSelect?: () => void;
}

const TRANSCRIPT_PROVIDER_GUIDANCE: Record<
  "localWhisper" | "parakeet",
  {
    label: string;
    pros: string[];
    cons: string[];
  }
> = {
  parakeet: {
    label: "Best live-meeting default",
    pros: [
      "Realtime capture with low latency.",
      "Good accuracy for continuous meeting transcription.",
    ],
    cons: [
      "Automatic language detection only.",
      "Use offline cleanup when raw transcript quality matters more than speed.",
    ],
  },
  localWhisper: {
    label: "Best offline accuracy path",
    pros: [
      "Strong option for retranscribing imported or recorded audio.",
      "Manual language selection is available outside Parakeet flows.",
    ],
    cons: [
      "Slower and heavier than the live Parakeet path.",
      "Large models take more disk and memory.",
    ],
  },
};

function ProviderGuidance({ provider, isOpen, onToggle }: any) {
  if (provider !== "parakeet" && provider !== "localWhisper") return null;
  const guidance = TRANSCRIPT_PROVIDER_GUIDANCE[provider as "parakeet" | "localWhisper"];

  return (
    <div className="mx-1 mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{guidance.label}</span>
        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
          Best
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-3">
          <div className="grid gap-3 text-xs text-gray-600 sm:grid-cols-2">
            <GuidanceList
              title="Pros"
              items={guidance.pros}
              className="bg-emerald-50 text-emerald-900"
            />
            <GuidanceList title="Cons" items={guidance.cons} className="bg-gray-50 text-gray-700" />
          </div>
        </div>
      )}
    </div>
  );
}

function GuidanceList({ title, items, className }: any) {
  return (
    <div className={`rounded-md p-3 ${className}`}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item: string) => (
          <li key={item}>
            {title === "Pros" ? "+" : "-"} {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderSelect({
  uiProvider,
  setUiProvider,
  fetchApiKey,
  transcriptModelConfig,
  setTranscriptModelConfig,
  modelOptions,
}: any) {
  return (
    <div>
      <Label className="block text-sm font-medium text-gray-700 mb-1">Transcript Model</Label>
      <div className="flex space-x-2 mx-1">
        <Select
          value={uiProvider}
          onValueChange={(value) => {
            const provider = value as TranscriptModelProps["provider"];
            setUiProvider(provider);
            if (provider !== "localWhisper" && provider !== "parakeet") fetchApiKey(provider);
          }}
        >
          <SelectTrigger className="focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="parakeet">⚡ Parakeet (Best live-meeting default)</SelectItem>
            <SelectItem value="localWhisper">🏠 Local Whisper (Best offline accuracy)</SelectItem>
          </SelectContent>
        </Select>

        {uiProvider !== "localWhisper" && uiProvider !== "parakeet" && (
          <Select
            value={transcriptModelConfig.model}
            onValueChange={(value) => {
              const model = value as TranscriptModelProps["model"];
              setTranscriptModelConfig({ ...transcriptModelConfig, provider: uiProvider, model });
            }}
          >
            <SelectTrigger className="focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {modelOptions[uiProvider].map((model: string) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

function TranscriptModelManagers({
  uiProvider,
  transcriptModelConfig,
  onWhisperSelect,
  onParakeetSelect,
}: any) {
  return (
    <>
      {uiProvider === "localWhisper" && (
        <div className="mt-6">
          <ModelManager
            selectedModel={
              transcriptModelConfig.provider === "localWhisper"
                ? transcriptModelConfig.model
                : undefined
            }
            onModelSelect={onWhisperSelect}
            autoSave={true}
          />
        </div>
      )}

      {uiProvider === "parakeet" && (
        <div className="mt-6">
          <ParakeetModelManager
            selectedModel={
              transcriptModelConfig.provider === "parakeet"
                ? transcriptModelConfig.model
                : undefined
            }
            onModelSelect={onParakeetSelect}
            autoSave={true}
          />
        </div>
      )}
    </>
  );
}

function ApiKeyField({
  requiresApiKey,
  showApiKey,
  setShowApiKey,
  isApiKeyLocked,
  setIsApiKeyLocked,
  isLockButtonVibrating,
  apiKey,
  setApiKey,
  handleInputClick,
}: any) {
  if (!requiresApiKey) return null;

  return (
    <div>
      <Label className="block text-sm font-medium text-gray-700 mb-1">API Key</Label>
      <div className="relative mx-1">
        <Input
          type={showApiKey ? "text" : "password"}
          className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${
            isApiKeyLocked ? "bg-gray-100 cursor-not-allowed" : ""
          }`}
          value={apiKey || ""}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={isApiKeyLocked}
          onClick={handleInputClick}
          placeholder="Enter your API key"
        />
        {isApiKeyLocked && (
          <div
            onClick={handleInputClick}
            className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 rounded-md cursor-not-allowed"
          />
        )}
        <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
            className={`transition-colors duration-200 ${
              isLockButtonVibrating ? "animate-vibrate text-red-500" : ""
            }`}
            title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
          >
            {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TranscriptSettings({
  transcriptModelConfig,
  setTranscriptModelConfig,
  onModelSelect,
}: TranscriptSettingsProps) {
  const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
  const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
  const [uiProvider, setUiProvider] = useState<TranscriptModelProps["provider"]>(
    transcriptModelConfig.provider,
  );
  const [providerGuidanceOpen, setProviderGuidanceOpen] = useState<boolean>(false);

  // Sync uiProvider when backend config changes (e.g., after model selection or initial load)
  useEffect(() => {
    setUiProvider(transcriptModelConfig.provider);
  }, [transcriptModelConfig.provider]);

  useEffect(() => {
    if (
      transcriptModelConfig.provider === "localWhisper" ||
      transcriptModelConfig.provider === "parakeet"
    ) {
      setApiKey(null);
    }
  }, [transcriptModelConfig.provider]);

  const fetchApiKey = async (provider: string) => {
    try {
      const data = (await invoke("api_get_transcript_api_key", { provider })) as string;

      setApiKey(data || "");
    } catch (err) {
      console.error("Error fetching API key:", err);
      setApiKey(null);
    }
  };
  const modelOptions = {
    localWhisper: [], // Model selection handled by ModelManager component
    parakeet: [], // Model selection handled by ParakeetModelManager component
    deepgram: ["nova-2-phonecall"],
    elevenLabs: ["eleven_multilingual_v2"],
    groq: ["llama-3.3-70b-versatile"],
    openai: ["gpt-4o"],
  };
  const requiresApiKey =
    transcriptModelConfig.provider === "deepgram" ||
    transcriptModelConfig.provider === "elevenLabs" ||
    transcriptModelConfig.provider === "openai" ||
    transcriptModelConfig.provider === "groq";

  const handleInputClick = () => {
    if (isApiKeyLocked) {
      setIsLockButtonVibrating(true);
      setTimeout(() => setIsLockButtonVibrating(false), 500);
    }
  };

  const handleWhisperModelSelect = (modelName: string) => {
    // Always update config when model is selected, regardless of current provider
    // This ensures the model is set when user switches back
    setTranscriptModelConfig({
      ...transcriptModelConfig,
      provider: "localWhisper", // Ensure provider is set correctly
      model: modelName,
    });
    // Close modal after selection
    if (onModelSelect) {
      onModelSelect();
    }
  };

  const handleParakeetModelSelect = (modelName: string) => {
    // Always update config when model is selected, regardless of current provider
    // This ensures the model is set when user switches back
    setTranscriptModelConfig({
      ...transcriptModelConfig,
      provider: "parakeet", // Ensure provider is set correctly
      model: modelName,
    });
    // Close modal after selection
    if (onModelSelect) {
      onModelSelect();
    }
  };

  return (
    <div>
      <div>
        <div className="space-y-4 pb-6">
          <ProviderSelect
            uiProvider={uiProvider}
            setUiProvider={setUiProvider}
            fetchApiKey={fetchApiKey}
            transcriptModelConfig={transcriptModelConfig}
            setTranscriptModelConfig={setTranscriptModelConfig}
            modelOptions={modelOptions}
          />
          <ProviderGuidance
            provider={uiProvider}
            isOpen={providerGuidanceOpen}
            onToggle={() => setProviderGuidanceOpen((open) => !open)}
          />
          <TranscriptModelManagers
            uiProvider={uiProvider}
            transcriptModelConfig={transcriptModelConfig}
            onWhisperSelect={handleWhisperModelSelect}
            onParakeetSelect={handleParakeetModelSelect}
          />

          <ExperimentalTranscriptionModels />

          <ApiKeyField
            requiresApiKey={requiresApiKey}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            isApiKeyLocked={isApiKeyLocked}
            setIsApiKeyLocked={setIsApiKeyLocked}
            isLockButtonVibrating={isLockButtonVibrating}
            apiKey={apiKey}
            setApiKey={setApiKey}
            handleInputClick={handleInputClick}
          />
        </div>
      </div>
    </div>
  );
}
