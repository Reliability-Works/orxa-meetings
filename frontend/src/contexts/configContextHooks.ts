"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TranscriptModelProps } from "@/components/TranscriptSettings";
import { SelectedDevices } from "@/components/DeviceSelection";
import { configService, ModelConfig } from "@/services/configService";
import Analytics from "@/lib/analytics";
import { BetaFeatureKey, loadBetaFeatures, saveBetaFeatures } from "@/types/betaFeatures";
import type { BetaFeatures } from "@/types/betaFeatures";
import type { NotificationSettings, OllamaModel, StorageLocations } from "./ConfigContext";

export type ProviderApiKeys = {
  claude: string | null;
  groq: string | null;
  openai: string | null;
  openrouter: string | null;
};

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "ollama",
  model: "llama3.2:latest",
  whisperModel: "large-v3",
  ollamaEndpoint: null,
};

const DEFAULT_TRANSCRIPT_CONFIG: TranscriptModelProps = {
  provider: "parakeet",
  model: "parakeet-tdt-0.6b-v3-int8",
  apiKey: null,
};

const EMPTY_PROVIDER_KEYS: ProviderApiKeys = {
  claude: null,
  groq: null,
  openai: null,
  openrouter: null,
};

const API_KEY_PROVIDERS = ["claude", "groq", "openai", "openrouter"] as const;

function seedProviderModelCache(provider: ModelConfig["provider"], model?: string | null) {
  if (!model || typeof window === "undefined") return;

  const map = JSON.parse(localStorage.getItem("providerModelMap") || "{}");
  map[provider] = model;
  localStorage.setItem("providerModelMap", JSON.stringify(map));
}

function applyBaseModelConfig(
  data: ModelConfig,
  setModelConfig: Dispatch<SetStateAction<ModelConfig>>,
) {
  setModelConfig((prev) => ({
    ...prev,
    provider: data.provider,
    model: data.model || prev.model,
    whisperModel: data.whisperModel || prev.whisperModel,
    ollamaEndpoint: data.ollamaEndpoint,
  }));
  seedProviderModelCache(data.provider, data.model);
}

async function applyCustomOpenAIConfig(
  data: ModelConfig,
  setModelConfig: Dispatch<SetStateAction<ModelConfig>>,
) {
  try {
    const customConfig = await configService.getCustomOpenAIConfig();
    if (!customConfig) return false;

    console.log("[ConfigContext] Loading custom OpenAI config:", {
      endpoint: customConfig.endpoint,
      model: customConfig.model,
    });

    const resolvedModel = customConfig.model || data.model || "";
    setModelConfig((prev) => ({
      ...prev,
      provider: data.provider,
      model: resolvedModel || prev.model,
      whisperModel: data.whisperModel || prev.whisperModel,
      customOpenAIEndpoint: customConfig.endpoint,
      customOpenAIModel: customConfig.model,
      customOpenAIApiKey: customConfig.apiKey,
      maxTokens: customConfig.maxTokens,
      temperature: customConfig.temperature,
      topP: customConfig.topP,
    }));
    seedProviderModelCache(data.provider, resolvedModel);
    return true;
  } catch (err) {
    console.error("[ConfigContext] Failed to fetch custom OpenAI config:", err);
    return false;
  }
}

async function loadSavedModelConfig(setModelConfig: Dispatch<SetStateAction<ModelConfig>>) {
  try {
    const data = await configService.getModelConfig();
    if (!data?.provider) return;

    if (data.provider === "custom-openai") {
      const appliedCustomConfig = await applyCustomOpenAIConfig(data, setModelConfig);
      if (appliedCustomConfig) return;
    }

    applyBaseModelConfig(data, setModelConfig);
  } catch (error) {
    console.error("Failed to fetch saved model config in ConfigContext:", error);
  }
}

export function useModelConfigState(
  updateProviderApiKey: (provider: string, apiKey: string | null) => void,
) {
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);

  useEffect(() => {
    loadSavedModelConfig(setModelConfig);
  }, []);

  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<ModelConfig>("model-config-updated", (event) => {
        console.log("[ConfigContext] Received model-config-updated event:", event.payload);
        setModelConfig(event.payload);

        if (event.payload.apiKey && event.payload.provider !== "custom-openai") {
          updateProviderApiKey(event.payload.provider, event.payload.apiKey);
        }
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then((fn) => (cleanup = fn));

    return () => {
      cleanup?.();
    };
  }, [updateProviderApiKey]);

  return { modelConfig, setModelConfig };
}

export function useTranscriptModelConfigState() {
  const [transcriptModelConfig, setTranscriptModelConfig] =
    useState<TranscriptModelProps>(DEFAULT_TRANSCRIPT_CONFIG);

  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await configService.getTranscriptConfig();
        if (!config) return;

        console.log("[ConfigContext] Loaded saved transcript config:", config);
        setTranscriptModelConfig({
          provider: config.provider || "parakeet",
          model: config.model || "parakeet-tdt-0.6b-v3-int8",
          apiKey: config.apiKey || null,
        });
      } catch (error) {
        console.error("[ConfigContext] Failed to load transcript config:", error);
      }
    };
    loadTranscriptConfig();
  }, []);

  return { transcriptModelConfig, setTranscriptModelConfig };
}

export function useProviderApiKeys() {
  const [providerApiKeys, setProviderApiKeys] = useState<ProviderApiKeys>(EMPTY_PROVIDER_KEYS);

  useEffect(() => {
    const loadAllApiKeys = async () => {
      try {
        const keys = await Promise.all(
          API_KEY_PROVIDERS.map((provider) =>
            invoke<string>("api_get_api_key", { provider }).catch(() => null),
          ),
        );

        setProviderApiKeys({
          claude: keys[0],
          groq: keys[1],
          openai: keys[2],
          openrouter: keys[3],
        });
        console.log("[ConfigContext] Loaded provider API keys");
      } catch (error) {
        console.error("[ConfigContext] Failed to load provider API keys:", error);
      }
    };

    loadAllApiKeys();
  }, []);

  const updateProviderApiKey = useCallback((provider: string, apiKey: string | null) => {
    setProviderApiKeys((prev) => ({ ...prev, [provider]: apiKey }) as ProviderApiKeys);
  }, []);

  return { providerApiKeys, updateProviderApiKey };
}

export function useOllamaModels(ollamaEndpoint: string | null | undefined) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const loadModels = async () => {
      try {
        const endpoint = ollamaEndpoint || null;
        const modelList = await invoke<OllamaModel[]>("get_ollama_models", { endpoint });
        setModels(modelList);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Ollama models");
        console.error("Error loading models:", err);
      }
    };
    loadModels();
  }, [ollamaEndpoint]);

  return { models, error };
}

export function useSelectedDevicesState() {
  const [selectedDevices, setSelectedDevices] = useState<SelectedDevices>({
    micDevice: null,
    systemDevice: null,
  });

  useEffect(() => {
    const loadDevicePreferences = async () => {
      try {
        const prefs = await configService.getRecordingPreferences();
        if (!prefs?.preferred_mic_device && !prefs?.preferred_system_device) return;

        setSelectedDevices({
          micDevice: prefs.preferred_mic_device,
          systemDevice: prefs.preferred_system_device,
        });
        console.log("Loaded device preferences:", prefs);
      } catch (error) {
        console.log("No device preferences found or failed to load:", error);
      }
    };
    loadDevicePreferences();
  }, []);

  return { selectedDevices, setSelectedDevices };
}

export function useLanguagePreference() {
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    if (typeof window === "undefined") return "auto";
    return localStorage.getItem("primaryLanguage") || "auto";
  });

  useEffect(() => {
    if (!selectedLanguage) return;

    invoke("set_language_preference", { language: selectedLanguage })
      .then(() => {
        console.log(
          "[ConfigContext] Synced language preference to Rust on startup:",
          selectedLanguage,
        );
      })
      .catch((err) => {
        console.error(
          "[ConfigContext] Failed to sync language preference to Rust on startup:",
          err,
        );
      });
  }, []);

  const handleSetSelectedLanguage = useCallback((lang: string) => {
    setSelectedLanguage(lang);
    if (typeof window !== "undefined") {
      localStorage.setItem("primaryLanguage", lang);
    }
    invoke("set_language_preference", { language: lang }).catch((err) =>
      console.error("Failed to sync language preference to Rust:", err),
    );
  }, []);

  return { selectedLanguage, setSelectedLanguage: handleSetSelectedLanguage };
}

export function useConfidenceIndicatorState() {
  const [showConfidenceIndicator, setShowConfidenceIndicator] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("showConfidenceIndicator");
    return saved !== null ? saved === "true" : true;
  });

  const toggleConfidenceIndicator = useCallback((checked: boolean) => {
    setShowConfidenceIndicator(checked);
    if (typeof window !== "undefined") {
      localStorage.setItem("showConfidenceIndicator", checked.toString());
      window.dispatchEvent(new CustomEvent("confidenceIndicatorChanged", { detail: checked }));
    }
  }, []);

  return { showConfidenceIndicator, toggleConfidenceIndicator };
}

export function useAutoSummaryState() {
  const [isAutoSummary, setIsAutoSummary] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("isAutoSummary");
    return saved !== null ? saved === "true" : false;
  });

  const toggleIsAutoSummary = useCallback((checked: boolean) => {
    setIsAutoSummary(checked);
    if (typeof window !== "undefined") {
      localStorage.setItem("isAutoSummary", checked.toString());
    }
  }, []);

  return { isAutoSummary, toggleIsAutoSummary };
}

export function useBetaFeatureSettings() {
  const [betaFeatures, setBetaFeatures] = useState<BetaFeatures>(() => loadBetaFeatures());

  const toggleBetaFeature = useCallback((featureKey: BetaFeatureKey, enabled: boolean) => {
    setBetaFeatures((prev) => {
      const updated = { ...prev, [featureKey]: enabled };
      saveBetaFeatures(updated);

      Analytics.track("beta_feature_toggled", {
        feature: featureKey,
        enabled: enabled.toString(),
      }).catch((err) => console.error("Failed to track beta feature toggle:", err));

      return updated;
    });
  }, []);

  return { betaFeatures, toggleBetaFeature };
}

export function usePreferenceSettings() {
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(
    null,
  );
  const [storageLocations, setStorageLocations] = useState<StorageLocations | null>(null);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const preferencesLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);

  const loadPreferences = useCallback(async () => {
    if (preferencesLoadedRef.current || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setIsLoadingPreferences(true);
    try {
      try {
        const settings = await invoke<NotificationSettings>("get_notification_settings");
        setNotificationSettings(settings);
      } catch (notifError) {
        console.error("[ConfigContext] Failed to load notification settings:", notifError);
        setNotificationSettings(null);
      }

      const [dbDir, modelsDir, recordingsDir] = await Promise.all([
        invoke<string>("get_database_directory"),
        invoke<string>("whisper_get_models_directory"),
        invoke<string>("get_default_recordings_folder_path"),
      ]);

      setStorageLocations({
        database: dbDir,
        models: modelsDir,
        recordings: recordingsDir,
      });
      preferencesLoadedRef.current = true;
    } catch (error) {
      console.error("[ConfigContext] Failed to load preferences:", error);
    } finally {
      isLoadingRef.current = false;
      setIsLoadingPreferences(false);
    }
  }, []);

  const updateNotificationSettings = useCallback(async (settings: NotificationSettings) => {
    try {
      await invoke("set_notification_settings", { settings });
      setNotificationSettings(settings);
    } catch (error) {
      console.error("[ConfigContext] Failed to update notification settings:", error);
      throw error;
    }
  }, []);

  return {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  };
}
