'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Settings2, Mic, Database as DatabaseIcon, SparkleIcon, FlaskConical, Volume2, MessageSquareText, SearchIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { PlaybackSettings } from '@/components/PlaybackSettings';
import { ChatAgentSettings } from '@/components/ChatAgentSettings';
import { useConfig } from '@/contexts/ConfigContext';

const SETTINGS_ITEMS = [
  { value: 'general', label: 'General', icon: Settings2, keywords: 'preferences privacy analytics language' },
  { value: 'recording', label: 'Recordings', icon: Mic, keywords: 'microphone audio capture recording' },
  { value: 'Transcriptionmodels', label: 'Transcription', icon: DatabaseIcon, keywords: 'parakeet whisper models transcript speech' },
  { value: 'summaryModels', label: 'Summary', icon: SparkleIcon, keywords: 'summary model ai actions todos decisions' },
  { value: 'chat', label: 'Chat', icon: MessageSquareText, keywords: 'agent ask model meeting chat' },
  { value: 'playback', label: 'Playback', icon: Volume2, keywords: 'voice tts audio read aloud' },
  { value: 'beta', label: 'Beta', icon: FlaskConical, keywords: 'experimental features preview' },
] as const;

type SettingsTab = typeof SETTINGS_ITEMS[number]['value'];

const SETTINGS_GROUPS: { title: string; values: SettingsTab[] }[] = [
  { title: 'Personal', values: ['general', 'recording'] },
  { title: 'Models', values: ['Transcriptionmodels', 'summaryModels', 'chat', 'playback'] },
  { title: 'Advanced', values: ['beta'] },
];

export default function SettingsPage() {
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settingsSearch, setSettingsSearch] = useState('');

  // Load saved transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await invoke('api_get_transcript_config') as any;
        if (config) {
          console.log('Loaded saved transcript config:', config);
          setTranscriptModelConfig({
            provider: config.provider || 'localWhisper',
            model: config.model || 'large-v3',
            apiKey: config.apiKey || null
          });
        }
      } catch (error) {
        console.error('Failed to load transcript config:', error);
      }
    };
    loadTranscriptConfig();
  }, [setTranscriptModelConfig]);

  const filteredGroups = useMemo(() => {
    const query = settingsSearch.trim().toLowerCase();
    return SETTINGS_GROUPS.map((group) => {
      const items = group.values
        .map((value) => SETTINGS_ITEMS.find((item) => item.value === value))
        .filter((item): item is typeof SETTINGS_ITEMS[number] => Boolean(item))
        .filter((item) => {
          if (!query) return true;
          return `${item.label} ${item.keywords} ${group.title}`.toLowerCase().includes(query);
        });
      return { ...group, items };
    }).filter((group) => group.items.length > 0);
  }, [settingsSearch]);

  const renderActiveSettings = () => {
    switch (activeTab) {
      case 'general':
        return <PreferenceSettings />;
      case 'recording':
        return <RecordingSettings />;
      case 'Transcriptionmodels':
        return (
          <TranscriptSettings
            transcriptModelConfig={transcriptModelConfig}
            setTranscriptModelConfig={setTranscriptModelConfig}
          />
        );
      case 'summaryModels':
        return <SummaryModelSettings />;
      case 'chat':
        return <ChatAgentSettings />;
      case 'playback':
        return <PlaybackSettings />;
      case 'beta':
        return <BetaSettings />;
      default:
        return <PreferenceSettings />;
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-white">
      <aside className="flex w-[304px] shrink-0 flex-col border-r border-gray-200 bg-white px-4 pb-5 pt-16">
        <div className="relative mb-6">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={settingsSearch}
            onChange={(event) => setSettingsSearch(event.target.value)}
            placeholder="Search settings..."
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
          />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto pb-6">
          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <div key={group.title} className="mb-6">
                <h2 className="mb-2 px-3 text-[15px] font-medium text-gray-400">{group.title}</h2>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setActiveTab(item.value)}
                        className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[16px] transition-colors ${
                          active ? 'bg-gray-100 text-gray-950' : 'text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-8 text-sm text-gray-400">No settings found</div>
          )}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto bg-white">
        <div className="mx-auto max-w-5xl px-8 pb-12 pt-16">
          {renderActiveSettings()}
        </div>
      </section>
    </div>
  );
};
