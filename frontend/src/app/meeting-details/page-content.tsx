"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Summary, SummaryResponse } from "@/types";
import Analytics from "@/lib/analytics";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { TranscriptPanel } from "@/components/MeetingDetails/TranscriptPanel";
import { SummaryPanel } from "@/components/MeetingDetails/SummaryPanel";
import { ModelConfig } from "@/components/ModelSettingsModal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText } from "lucide-react";

// Custom hooks
import { useMeetingData } from "@/hooks/meeting-details/useMeetingData";
import { useSummaryGeneration } from "@/hooks/meeting-details/useSummaryGeneration";
import { useTemplates } from "@/hooks/meeting-details/useTemplates";
import { useCopyOperations } from "@/hooks/meeting-details/useCopyOperations";
import { useMeetingOperations } from "@/hooks/meeting-details/useMeetingOperations";
import { useConfig } from "@/contexts/ConfigContext";
import { useSummaryPlayback } from "@/hooks/meeting-details/useSummaryPlayback";

function MeetingDetailsHeader({
  title,
  transcriptCount,
  onOpenSummary,
}: {
  title: string;
  transcriptCount: number;
  onOpenSummary: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium text-gray-900">{title}</h1>
        <p className="truncate text-[11px] text-gray-500">{transcriptCount} transcript segments</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenSummary}
          title="Open meeting summary"
        >
          <FileText className="h-4 w-4" />
          Summary
        </Button>
      </div>
    </div>
  );
}

function MeetingTranscriptArea({
  meeting,
  meetingData,
  customPrompt,
  setCustomPrompt,
  copyOperations,
  meetingOperations,
  isRecording,
  pagination,
  onTranscriptDataChanged,
}: any) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <TranscriptPanel
        transcripts={meetingData.transcripts}
        customPrompt={customPrompt}
        onPromptChange={setCustomPrompt}
        onCopyTranscript={copyOperations.handleCopyTranscript}
        onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
        isRecording={isRecording}
        disableAutoScroll={true}
        usePagination={true}
        segments={pagination.segments}
        hasMore={pagination.hasMore}
        isLoadingMore={pagination.isLoadingMore}
        totalCount={pagination.totalCount}
        loadedCount={pagination.loadedCount}
        onLoadMore={pagination.onLoadMore}
        meetingId={meeting.id}
        meetingFolderPath={meeting.folder_path}
        onRefetchTranscripts={onTranscriptDataChanged}
      />
    </div>
  );
}

function MeetingSummaryDialog({
  isOpen,
  onOpenChange,
  meeting,
  meetingData,
  modelConfig,
  setModelConfig,
  handleSaveModelConfig,
  copyOperations,
  meetingOperations,
  summaryGeneration,
  templates,
  summaryPlayback,
  customPrompt,
  summaryResponse,
  handleRegisterModalOpen,
}: any) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-gray-200 px-5 py-3">
          <DialogTitle className="truncate text-base">Meeting Summary</DialogTitle>
          <DialogDescription className="truncate">{meetingData.meetingTitle}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SummaryPanel
            meeting={meeting}
            meetingTitle={meetingData.meetingTitle}
            onTitleChange={meetingData.handleTitleChange}
            isEditingTitle={meetingData.isEditingTitle}
            onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
            onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
            isTitleDirty={meetingData.isTitleDirty}
            summaryRef={meetingData.blockNoteSummaryRef}
            isSaving={meetingData.isSaving}
            onSaveAll={meetingData.saveAllChanges}
            onCopySummary={copyOperations.handleCopySummary}
            onPlaySummary={summaryPlayback.playSummary}
            onStopSummaryPlayback={summaryPlayback.stopSummaryPlayback}
            onOpenFolder={meetingOperations.handleOpenMeetingFolder}
            aiSummary={meetingData.aiSummary}
            summaryStatus={summaryGeneration.summaryStatus}
            transcripts={meetingData.transcripts}
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            onSaveModelConfig={handleSaveModelConfig}
            onGenerateSummary={summaryGeneration.handleGenerateSummary}
            onStopGeneration={summaryGeneration.handleStopGeneration}
            customPrompt={customPrompt}
            summaryResponse={summaryResponse}
            onSaveSummary={meetingData.handleSaveSummary}
            onSummaryChange={meetingData.handleSummaryChange}
            onDirtyChange={meetingData.setIsSummaryDirty}
            summaryError={summaryGeneration.summaryError}
            onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
            getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
            availableTemplates={templates.availableTemplates}
            selectedTemplate={templates.selectedTemplate}
            onTemplateSelect={templates.handleTemplateSelection}
            isModelConfigLoading={false}
            onOpenModelSettings={handleRegisterModalOpen}
            isPlayingSummary={summaryPlayback.isPlayingSummary}
            isSummaryPlaybackSupported={summaryPlayback.isSummaryPlaybackSupported}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function saveModelConfig(config?: ModelConfig) {
  if (!config) return;
  try {
    await invoke("api_save_model_config", {
      provider: config.provider,
      model: config.model,
      whisperModel: config.whisperModel,
      apiKey: config.apiKey ?? null,
      ollamaEndpoint: config.ollamaEndpoint ?? null,
    });

    const { emit } = await import("@tauri-apps/api/event");
    await emit("model-config-updated", config);

    toast.success("Model settings saved successfully");
  } catch (error) {
    console.error("Failed to save model config:", error);
    toast.error("Failed to save model settings");
  }
}

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  openSummaryOnLoad = false,
  onSummaryOpenHandled,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  openSummaryOnLoad?: boolean;
  onSummaryOpenHandled?: () => void;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  console.log("📄 PAGE CONTENT: Initializing with data:", {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length,
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const summaryAutoOpenHandledRef = useRef<string | null>(null);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log("📝 Registering modal open function in PageContent");
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log("🔔 Opening model settings from PageContent");
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn("⚠️ Modal open function not yet registered");
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const summaryPlayback = useSummaryPlayback({
    meetingId: meeting.id,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  const handleTranscriptDataChanged = async () => {
    await onRefetchTranscripts?.();
    meetingData.setAiSummary(null);
    await onMeetingUpdated?.();
  };

  // Track page view
  useEffect(() => {
    Analytics.trackPageView("meeting_details");
  }, []);

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        console.log(
          `🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`,
        );
        await summaryGeneration.handleGenerateSummary("");

        // Notify parent that auto-generation is complete (only if not cancelled)
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    // Cleanup: cancel if component unmounts or meeting changes
    return () => {
      cancelled = true;
    };
  }, [shouldAutoGenerate, meeting.id]); // Re-run if meeting changes

  useEffect(() => {
    if (!openSummaryOnLoad) return;
    if (summaryAutoOpenHandledRef.current === meeting.id) return;
    if (meetingData.transcripts.length === 0) return;

    summaryAutoOpenHandledRef.current = meeting.id;
    setIsSummaryOpen(true);
    onSummaryOpenHandled?.();
  }, [meeting.id, meetingData.transcripts.length, onSummaryOpenHandled, openSummaryOnLoad]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex h-full flex-col bg-white"
    >
      <MeetingDetailsHeader
        title={meetingData.meetingTitle}
        transcriptCount={meetingData.transcripts.length}
        onOpenSummary={() => setIsSummaryOpen(true)}
      />
      <MeetingTranscriptArea
        meeting={meeting}
        meetingData={meetingData}
        customPrompt={customPrompt}
        setCustomPrompt={setCustomPrompt}
        copyOperations={copyOperations}
        meetingOperations={meetingOperations}
        isRecording={isRecording}
        pagination={{ segments, hasMore, isLoadingMore, totalCount, loadedCount, onLoadMore }}
        onTranscriptDataChanged={handleTranscriptDataChanged}
      />
      <MeetingSummaryDialog
        isOpen={isSummaryOpen}
        onOpenChange={setIsSummaryOpen}
        meeting={meeting}
        meetingData={meetingData}
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        handleSaveModelConfig={saveModelConfig}
        copyOperations={copyOperations}
        meetingOperations={meetingOperations}
        summaryGeneration={summaryGeneration}
        templates={templates}
        summaryPlayback={summaryPlayback}
        customPrompt={customPrompt}
        summaryResponse={summaryResponse}
        handleRegisterModalOpen={handleRegisterModalOpen}
      />
    </motion.div>
  );
}
