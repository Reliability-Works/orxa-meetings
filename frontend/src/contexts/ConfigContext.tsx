"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
import { TranscriptModelProps } from "@/components/TranscriptSettings";
import { SelectedDevices } from "@/components/DeviceSelection";
import { ModelConfig } from "@/services/configService";
import { BetaFeatures, BetaFeatureKey } from "@/types/betaFeatures";
import {
  ProviderApiKeys,
  useAutoSummaryState,
  useBetaFeatureSettings,
  useConfidenceIndicatorState,
  useLanguagePreference,
  useModelConfigState,
  useOllamaModels,
  usePreferenceSettings,
  useProviderApiKeys,
  useSelectedDevicesState,
  useTranscriptModelConfigState,
} from "./configContextHooks";

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export interface StorageLocations {
  database: string;
  models: string;
  recordings: string;
}

export interface NotificationSettings {
  recording_notifications: boolean;
  time_based_reminders: boolean;
  meeting_reminders: boolean;
  respect_do_not_disturb: boolean;
  notification_sound: boolean;
  system_permission_granted: boolean;
  consent_given: boolean;
  manual_dnd_mode: boolean;
  notification_preferences: {
    show_recording_started: boolean;
    show_recording_stopped: boolean;
    show_recording_paused: boolean;
    show_recording_resumed: boolean;
    show_transcription_complete: boolean;
    show_meeting_reminders: boolean;
    show_system_errors: boolean;
    meeting_reminder_minutes: number[];
  };
}

interface ConfigContextType {
  // Model configuration
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;

  // Transcript model configuration
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (
    config: TranscriptModelProps | ((prev: TranscriptModelProps) => TranscriptModelProps),
  ) => void;

  // Device configuration
  selectedDevices: SelectedDevices;
  setSelectedDevices: (devices: SelectedDevices) => void;

  // Language preference
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;

  // UI preferences
  showConfidenceIndicator: boolean;
  toggleConfidenceIndicator: (checked: boolean) => void;

  // Beta features
  betaFeatures: BetaFeatures;
  toggleBetaFeature: (featureKey: BetaFeatureKey, enabled: boolean) => void;

  // Ollama models
  models: OllamaModel[];
  modelOptions: Record<ModelConfig["provider"], string[]>;
  error: string;

  // Summary configuration
  isAutoSummary: boolean;
  toggleIsAutoSummary: (checked: boolean) => void;

  // Provider-specific API keys
  providerApiKeys: ProviderApiKeys;
  updateProviderApiKey: (provider: string, apiKey: string | null) => void;

  // Preference settings (lazy loaded)
  notificationSettings: NotificationSettings | null;
  storageLocations: StorageLocations | null;
  isLoadingPreferences: boolean;
  loadPreferences: () => Promise<void>;
  updateNotificationSettings: (settings: NotificationSettings) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { providerApiKeys, updateProviderApiKey } = useProviderApiKeys();
  const { modelConfig, setModelConfig } = useModelConfigState(updateProviderApiKey);
  const { transcriptModelConfig, setTranscriptModelConfig } = useTranscriptModelConfigState();
  const { selectedDevices, setSelectedDevices } = useSelectedDevicesState();
  const { selectedLanguage, setSelectedLanguage } = useLanguagePreference();
  const { showConfidenceIndicator, toggleConfidenceIndicator } = useConfidenceIndicatorState();
  const { isAutoSummary, toggleIsAutoSummary } = useAutoSummaryState();
  const { betaFeatures, toggleBetaFeature } = useBetaFeatureSettings();
  const { models, error } = useOllamaModels(modelConfig.ollamaEndpoint);
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  } = usePreferenceSettings();

  // Calculate model options based on available models
  const modelOptions: Record<ModelConfig["provider"], string[]> = useMemo(
    () => ({
      ollama: models.map((model) => model.name),
      claude: ["claude-3-5-sonnet-latest"],
      groq: ["llama-3.3-70b-versatile"],
      openrouter: [],
      openai: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
      "builtin-ai": [],
      "custom-openai": [],
    }),
    [models],
  );

  const value: ConfigContextType = useMemo(
    () => ({
      modelConfig,
      setModelConfig,
      isAutoSummary,
      toggleIsAutoSummary,
      providerApiKeys,
      updateProviderApiKey,
      transcriptModelConfig,
      setTranscriptModelConfig,
      selectedDevices,
      setSelectedDevices,
      selectedLanguage,
      setSelectedLanguage,
      showConfidenceIndicator,
      toggleConfidenceIndicator,
      betaFeatures,
      toggleBetaFeature,
      models,
      modelOptions,
      error,
      notificationSettings,
      storageLocations,
      isLoadingPreferences,
      loadPreferences,
      updateNotificationSettings,
    }),
    [
      modelConfig,
      isAutoSummary,
      toggleIsAutoSummary,
      providerApiKeys,
      updateProviderApiKey,
      transcriptModelConfig,
      selectedDevices,
      selectedLanguage,
      setSelectedLanguage,
      showConfidenceIndicator,
      toggleConfidenceIndicator,
      betaFeatures,
      toggleBetaFeature,
      models,
      modelOptions,
      error,
      notificationSettings,
      storageLocations,
      isLoadingPreferences,
      loadPreferences,
      updateNotificationSettings,
    ],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return context;
}
