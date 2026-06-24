import { useEffect, useState } from "react";
import {
  ModelConfig,
  requiresProviderApiKey,
} from "@/components/model-settings/modelSettingsTypes";

interface UseProviderApiKeySettingsProps {
  modelConfig: ModelConfig;
  providerApiKeys?: Record<string, string | null | undefined>;
}

export function useProviderApiKeySettings({
  modelConfig,
  providerApiKeys,
}: UseProviderApiKeySettingsProps) {
  const [apiKey, setApiKey] = useState<string | null>(modelConfig.apiKey || null);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(!!modelConfig.apiKey?.trim());
  const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
  const requiresApiKey = requiresProviderApiKey(modelConfig.provider);

  useEffect(() => {
    if (!apiKey?.trim()) {
      setIsApiKeyLocked(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!providerApiKeys || !requiresApiKey || modelConfig.provider === "custom-openai") {
      return;
    }

    const correctKey = providerApiKeys[modelConfig.provider];
    if (correctKey !== apiKey) {
      setApiKey(correctKey || "");
      setIsApiKeyLocked(!!correctKey?.trim());
    }
  }, [modelConfig.provider, providerApiKeys, requiresApiKey]);

  const handleInputClick = () => {
    if (!isApiKeyLocked) {
      return;
    }

    setIsLockButtonVibrating(true);
    setTimeout(() => setIsLockButtonVibrating(false), 500);
  };

  return {
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    isApiKeyLocked,
    setIsApiKeyLocked,
    isLockButtonVibrating,
    requiresApiKey,
    handleInputClick,
  };
}
