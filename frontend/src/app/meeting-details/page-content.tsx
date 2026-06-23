"use client";
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse } from '@/types';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { WorkHubPanel, WorkHubPanelView } from '@/components/MeetingDetails/WorkHubPanel';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BriefcaseBusiness, FileText, PanelRightClose, PanelRightOpen } from 'lucide-react';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';
import { useSummaryPlayback } from '@/hooks/meeting-details/useSummaryPlayback';

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
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
  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [workHubView, setWorkHubView] = useState<WorkHubPanelView>('captured');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log('📝 Registering modal open function in PageContent');
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log('🔔 Opening model settings from PageContent');
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('⚠️ Modal open function not yet registered');
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      // Emit event so ConfigContext and other listeners stay in sync
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
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
    Analytics.trackPageView('meeting_details');
  }, []);

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        console.log(`🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`);
        await summaryGeneration.handleGenerateSummary('');

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-gray-900">{meetingData.meetingTitle}</h1>
          <p className="truncate text-[11px] text-gray-500">
            {meetingData.transcripts.length} transcript segments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsSummaryOpen(true)}
            title="Open meeting summary"
          >
            <FileText className="h-4 w-4" />
            Summary
          </Button>
          <Button
            type="button"
            variant={isRightSidebarOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setIsRightSidebarOpen((open) => !open)}
            title={isRightSidebarOpen ? 'Hide right sidebar' : 'Show right sidebar'}
          >
            {isRightSidebarOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
            <span className="hidden lg:inline">Work Hub</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
          disableAutoScroll={true}
          // Pagination props for efficient loading
          usePagination={true}
          segments={segments}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          // Retranscription props
          meetingId={meeting.id}
          meetingFolderPath={meeting.folder_path}
          onRefetchTranscripts={handleTranscriptDataChanged}
        />
        {isRightSidebarOpen && (
          <aside className="hidden min-w-[360px] max-w-[42vw] flex-col border-l border-gray-200 bg-white lg:flex lg:w-[420px] xl:w-[480px]">
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-200 px-3">
              <div className="flex min-w-0 items-center gap-2">
                <BriefcaseBusiness className="h-4 w-4 shrink-0 text-gray-500" />
                <Select value={workHubView} onValueChange={(value) => setWorkHubView(value as WorkHubPanelView)}>
                  <SelectTrigger className="h-8 w-[190px] border-0 bg-gray-50 px-2 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="captured">Captured Work</SelectItem>
                    <SelectItem value="context">Agent Context</SelectItem>
                    <SelectItem value="brief">Pre-Meeting Brief</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <WorkHubPanel
              meetingId={meeting.id}
              meetingTitle={meetingData.meetingTitle}
              view={workHubView}
              hideHeader
              compact
            />
          </aside>
        )}
      </div>

      <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
        <DialogContent className="flex h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="shrink-0 border-b border-gray-200 px-5 py-3">
            <DialogTitle className="truncate text-base">Meeting Summary</DialogTitle>
            <DialogDescription className="truncate">
              {meetingData.meetingTitle}
            </DialogDescription>
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
    </motion.div>
  );
}
