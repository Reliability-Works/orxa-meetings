"use client";

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { MessageSquareText } from 'lucide-react';
import { ModelConfig, ModelSettingsModal } from '@/components/ModelSettingsModal';

export function ChatAgentSettings() {
  const [chatModelConfig, setChatModelConfig] = useState<ModelConfig>({
    provider: 'builtin-ai',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null,
  });

  const loadChatConfig = useCallback(async () => {
    try {
      const config = await invoke<any>('chat_get_agent_config');
      setChatModelConfig({
        provider: config.provider || 'builtin-ai',
        model: config.model || '',
        whisperModel: config.whisperModel || '',
        apiKey: config.apiKey || null,
        ollamaEndpoint: config.ollamaEndpoint || null,
        customOpenAIEndpoint: config.customOpenAIEndpoint || null,
        customOpenAIModel: config.customOpenAIModel || null,
        customOpenAIApiKey: config.customOpenAIApiKey || null,
        maxTokens: config.maxTokens || null,
        temperature: config.temperature || null,
        topP: config.topP || null,
      });
    } catch (error) {
      console.error('Failed to load chat agent settings:', error);
      toast.error('Failed to load chat agent settings');
    }
  }, []);

  useEffect(() => {
    void loadChatConfig();
  }, [loadChatConfig]);

  const saveChatConfig = async (config: ModelConfig) => {
    try {
      const saved = await invoke<any>('chat_save_agent_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel || '',
        apiKey: config.apiKey || null,
        ollamaEndpoint: config.ollamaEndpoint || null,
      });

      setChatModelConfig({
        ...config,
        provider: saved.provider || config.provider,
        model: saved.model || config.model,
        whisperModel: saved.whisperModel || config.whisperModel || '',
        ollamaEndpoint: saved.ollamaEndpoint || config.ollamaEndpoint || null,
      });
      toast.success('Chat agent saved');
    } catch (error) {
      console.error('Failed to save chat agent settings:', error);
      toast.error('Failed to save chat agent settings');
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100 text-gray-700">
            <MessageSquareText className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Chat Agent</h3>
            <p className="text-sm text-gray-600">
              Select the model used for persistent meeting chat.
            </p>
          </div>
        </div>

        <ModelSettingsModal
          modelConfig={chatModelConfig}
          setModelConfig={setChatModelConfig}
          onSave={saveChatConfig}
          skipInitialFetch
          useGlobalConfig={false}
          heading="Agent Model"
          modelLabel="Chat Agent Model"
        />
      </div>
    </div>
  );
}
