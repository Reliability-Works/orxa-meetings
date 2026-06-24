import { useState, useCallback } from "react";
import { Transcript, Summary } from "@/types";
import { ModelConfig } from "@/components/ModelSettingsModal";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  buildSummaryTranscriptPayload,
  fetchAllMeetingTranscripts,
  validateSummaryProvider,
} from "./summaryGenerationValidation";
import {
  getSummaryStatusMessage as getSummaryStatusMessageForStatus,
  processSummaryGeneration,
} from "./summaryPollingHandlers";
import type { ProcessSummaryInput, SummaryStatus } from "./summaryGenerationTypes";

interface UseSummaryGenerationProps {
  meeting: any;
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  isModelConfigLoading: boolean;
  selectedTemplate: string;
  onMeetingUpdated?: () => Promise<void>;
  updateMeetingTitle: (title: string) => void;
  setAiSummary: (summary: Summary | null) => void;
  onOpenModelSettings?: () => void;
}

export function useSummaryGeneration({
  meeting,
  transcripts,
  modelConfig,
  isModelConfigLoading,
  selectedTemplate,
  onMeetingUpdated,
  updateMeetingTitle,
  setAiSummary,
  onOpenModelSettings,
}: UseSummaryGenerationProps) {
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>("idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const { startSummaryPolling, stopSummaryPolling } = useSidebar();

  const getSummaryStatusMessage = useCallback(
    (status: SummaryStatus) => getSummaryStatusMessageForStatus(status),
    [],
  );

  const processSummary = useCallback(
    async (input: ProcessSummaryInput) => {
      await processSummaryGeneration({
        ...input,
        meeting,
        modelConfig,
        selectedTemplate,
        startSummaryPolling,
        onMeetingUpdated,
        updateMeetingTitle,
        setAiSummary,
        setSummaryStatus,
        setSummaryError,
        onOpenModelSettings,
      });
    },
    [
      meeting,
      modelConfig,
      selectedTemplate,
      startSummaryPolling,
      onMeetingUpdated,
      updateMeetingTitle,
      setAiSummary,
      onOpenModelSettings,
    ],
  );

  const fetchAllTranscripts = useCallback(fetchAllMeetingTranscripts, []);

  const handleGenerateSummary = useCallback(
    async (customPrompt: string = "") => {
      if (isModelConfigLoading) {
        console.log("⏳ Model configuration is still loading, please wait...");
        toast.info("Loading model configuration, please wait...");
        return;
      }

      console.log("📊 Fetching all transcripts for summary generation...");
      const allTranscripts = await fetchAllTranscripts(meeting.id);
      if (!allTranscripts.length) {
        const error_msg = "No transcripts available for summary";
        console.log(error_msg);
        toast.error(error_msg);
        return;
      }

      console.log(`✅ Proceeding with ${allTranscripts.length} transcripts`);
      console.log("🚀 Starting summary generation with config:", {
        provider: modelConfig.provider,
        model: modelConfig.model,
        template: selectedTemplate,
      });

      const isProviderReady = await validateSummaryProvider({
        modelConfig,
        onOpenModelSettings,
      });
      if (!isProviderReady) return;

      await processSummary({
        ...buildSummaryTranscriptPayload(allTranscripts),
        customPrompt,
      });
    },
    [
      meeting.id,
      fetchAllTranscripts,
      processSummary,
      modelConfig,
      isModelConfigLoading,
      selectedTemplate,
      onOpenModelSettings,
    ],
  );

  const handleRegenerateSummary = useCallback(async () => {
    const allTranscripts = await fetchAllTranscripts(meeting.id);
    if (!allTranscripts.length) {
      console.error("No transcripts available for regeneration");
      toast.error("No transcripts available for summary regeneration");
      return;
    }

    await processSummary({
      ...buildSummaryTranscriptPayload(allTranscripts),
      isRegeneration: true,
    });
  }, [meeting.id, fetchAllTranscripts, processSummary]);

  const handleStopGeneration = useCallback(async () => {
    console.log("Stopping summary generation for meeting:", meeting.id);

    try {
      await invokeTauri("api_cancel_summary", {
        meetingId: meeting.id,
      });
      console.log("✓ Backend cancellation request sent for meeting:", meeting.id);
    } catch (error) {
      console.error("Failed to cancel summary generation:", error);
    }

    stopSummaryPolling(meeting.id);
    setSummaryStatus("idle");
    setSummaryError(null);

    toast.info("Summary generation stopped", {
      description: "You can generate a new summary anytime",
      duration: 3000,
    });
  }, [meeting.id, stopSummaryPolling]);

  return {
    summaryStatus,
    summaryError,
    handleGenerateSummary,
    handleRegenerateSummary,
    handleStopGeneration,
    getSummaryStatusMessage,
  };
}
