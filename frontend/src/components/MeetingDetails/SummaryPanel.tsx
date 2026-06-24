"use client";

import { Summary, SummaryResponse, Transcript } from "@/types";
import { BlockNoteSummaryViewRef } from "@/components/AISummary/BlockNoteSummaryView";
import { ModelConfig } from "@/components/ModelSettingsModal";
import { RefObject } from "react";
import { SummaryPanelBody, SummaryToolbar } from "./SummaryPanelViews";
import { useSummaryPanelLanguage } from "./useSummaryPanelLanguage";

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onPlaySummary?: () => Promise<void>;
  onStopSummaryPlayback?: () => void;
  onOpenFolder: () => Promise<void>;
  aiSummary: Summary | null;
  summaryStatus: "idle" | "processing" | "summarizing" | "regenerating" | "completed" | "error";
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown?: string; summary_json?: any[] }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (
    status: "idle" | "processing" | "summarizing" | "regenerating" | "completed" | "error",
  ) => string;
  availableTemplates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  isPlayingSummary?: boolean;
  isSummaryPlaybackSupported?: boolean;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  onTitleChange,
  isEditingTitle,
  onStartEditTitle,
  onFinishEditTitle,
  isTitleDirty,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onPlaySummary,
  onStopSummaryPlayback,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryResponse,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
  isPlayingSummary = false,
  isSummaryPlaybackSupported = false,
}: SummaryPanelProps) {
  const isSummaryLoading =
    summaryStatus === "processing" ||
    summaryStatus === "summarizing" ||
    summaryStatus === "regenerating";
  const { languageSlot } = useSummaryPanelLanguage(meeting.id);

  const bodyProps = {
    modelConfig,
    setModelConfig,
    onSaveModelConfig,
    onGenerateSummary,
    onStopGeneration,
    customPrompt,
    summaryStatus,
    availableTemplates,
    selectedTemplate,
    onTemplateSelect,
    isModelConfigLoading,
    onOpenModelSettings,
    languageSlot,
    summaryResponse,
    summaryRef,
    onSaveSummary,
    onSummaryChange,
    onDirtyChange,
    summaryError,
    onRegenerateSummary,
    meeting,
    meetingTitle,
    getSummaryStatusMessage,
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white overflow-hidden">
      <SummaryToolbar
        aiSummary={aiSummary}
        isSummaryLoading={isSummaryLoading}
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        onSaveModelConfig={onSaveModelConfig}
        onGenerateSummary={onGenerateSummary}
        onStopGeneration={onStopGeneration}
        customPrompt={customPrompt}
        summaryStatus={summaryStatus}
        availableTemplates={availableTemplates}
        selectedTemplate={selectedTemplate}
        onTemplateSelect={onTemplateSelect}
        transcripts={transcripts}
        isModelConfigLoading={isModelConfigLoading}
        onOpenModelSettings={onOpenModelSettings}
        languageSlot={languageSlot}
        isSaving={isSaving}
        isTitleDirty={isTitleDirty}
        summaryRef={summaryRef}
        onSaveAll={onSaveAll}
        onCopySummary={onCopySummary}
        onPlaySummary={onPlaySummary}
        onStopSummaryPlayback={onStopSummaryPlayback}
        onOpenFolder={onOpenFolder}
        isPlayingSummary={isPlayingSummary}
        isSummaryPlaybackSupported={isSummaryPlaybackSupported}
      />
      <SummaryPanelBody
        isSummaryLoading={isSummaryLoading}
        aiSummary={aiSummary}
        transcripts={transcripts}
        bodyProps={bodyProps}
      />
    </div>
  );
}
