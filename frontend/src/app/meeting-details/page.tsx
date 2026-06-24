"use client";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useState, useEffect, useCallback, Suspense } from "react";
import { Transcript, Summary } from "@/types";
import PageContent from "./page-content";
import { useRouter, useSearchParams } from "next/navigation";
import Analytics from "@/lib/analytics";
import { invoke } from "@tauri-apps/api/core";
import { LoaderIcon } from "lucide-react";
import { useConfig } from "@/contexts/ConfigContext";
import { usePaginatedTranscripts } from "@/hooks/usePaginatedTranscripts";

interface MeetingDetailsResponse {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
  folder_path?: string;
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-screen">
      <LoaderIcon className="animate-spin size-6 " />
    </div>
  );
}

function ErrorState({ error, onGoBack }: { error: string; onGoBack: () => void }) {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={onGoBack}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}

function buildMeetingDetails(metadata: any, transcripts: Transcript[]): MeetingDetailsResponse {
  return {
    id: metadata.id,
    title: metadata.title,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    transcripts,
    folder_path: metadata.folder_path,
  };
}

function parseSummaryPayload(summaryData: any) {
  if (typeof summaryData !== "string") return summaryData;

  try {
    return JSON.parse(summaryData);
  } catch (error) {
    return {};
  }
}

function isLegacySummarySection(section: any) {
  return section && typeof section === "object" && "title" in section && "blocks" in section;
}

function formatLegacySection(section: any, key: string) {
  const typedSection = section as { title?: string; blocks?: any[] };

  if (!Array.isArray(typedSection.blocks)) {
    console.warn(`LEGACY FORMAT: Section ${key} has invalid blocks:`, typedSection.blocks);
    return { title: typedSection.title || key, blocks: [] };
  }

  return {
    title: typedSection.title || key,
    blocks: typedSection.blocks.map((block: any) => ({
      ...block,
      color: "default",
      content: block?.content?.trim() || "",
    })),
  };
}

function formatLegacySummary(parsedData: any): Summary {
  const { MeetingName: _MeetingName, _section_order, ...restSummaryData } = parsedData;
  const formattedSummary: Summary = {};
  const sectionKeys = _section_order || Object.keys(restSummaryData);

  console.log("LEGACY FORMAT: Processing sections:", sectionKeys);

  for (const key of sectionKeys) {
    try {
      const section = restSummaryData[key];
      if (isLegacySummarySection(section)) {
        formattedSummary[key] = formatLegacySection(section, key);
      } else {
        console.warn(`LEGACY FORMAT: Skipping invalid section ${key}:`, section);
      }
    } catch (error) {
      console.warn(`LEGACY FORMAT: Error processing section ${key}:`, error);
    }
  }

  return formattedSummary;
}

function normalizeSummaryResponse(summary: any): Summary | null {
  console.log("FETCH SUMMARY: Raw response:", summary);

  if (summary.status === "idle" || (!summary.data && summary.status === "error")) {
    console.warn("Meeting summary not found or no summary generated yet:", summary.error || "idle");
    return null;
  }

  const parsedData = parseSummaryPayload(summary.data || {});
  console.log("🔍 FETCH SUMMARY: Parsed data:", parsedData);

  if (parsedData.summary_json || parsedData.markdown) {
    return parsedData as any;
  }

  console.log("LEGACY FORMAT: Detected legacy format, applying section formatting");
  const formattedSummary = formatLegacySummary(parsedData);
  console.log("LEGACY FORMAT: Formatted summary:", formattedSummary);
  return formattedSummary;
}

async function fetchMeetingSummary(meetingId: string) {
  try {
    const summary = await invoke("api_get_summary", { meetingId });
    return normalizeSummaryResponse(summary);
  } catch (error) {
    console.error("FETCH SUMMARY: Error fetching meeting summary:", error);
    return null;
  }
}

function useAutoGenerationSetup({
  source,
  isAutoSummary,
  hasCheckedAutoGen,
  setHasCheckedAutoGen,
  setShouldAutoGenerate,
}: {
  source: string | null;
  isAutoSummary: boolean;
  hasCheckedAutoGen: boolean;
  setHasCheckedAutoGen: (value: boolean) => void;
  setShouldAutoGenerate: (value: boolean) => void;
}) {
  const checkForGemmaModel = useCallback(async (): Promise<boolean> => {
    try {
      const models = (await invoke("get_ollama_models", { endpoint: null })) as any[];
      const hasGemma = models.some((model: any) => model.name === "gemma3:1b");
      console.log("🔍 Checked for gemma3:1b:", hasGemma);
      return hasGemma;
    } catch (error) {
      console.error("❌ Failed to check Ollama models:", error);
      return false;
    }
  }, []);

  return useCallback(async () => {
    if (hasCheckedAutoGen) return;

    if (source !== "recording") {
      console.log("Not from recording navigation, skipping auto-generation");
      setHasCheckedAutoGen(true);
      return;
    }

    if (!isAutoSummary) {
      console.log("Auto-summary is disabled in settings");
      setHasCheckedAutoGen(true);
      return;
    }

    try {
      const currentConfig = (await invoke("api_get_model_config")) as any;

      if (currentConfig?.model) {
        console.log("Using existing model from DB:", currentConfig.model);
        setShouldAutoGenerate(true);
        setHasCheckedAutoGen(true);
        return;
      }

      if (await checkForGemmaModel()) {
        console.log("💾 DB empty, using gemma3:1b as initial default");
        await invoke("api_save_model_config", {
          provider: "ollama",
          model: "",
          whisperModel: "large-v3",
          apiKey: null,
          ollamaEndpoint: null,
        });
        setShouldAutoGenerate(true);
      } else {
        console.log("⚠️ No model configured and gemma3:1b not found");
      }
    } catch (error) {
      console.error("❌ Failed to setup auto-generation:", error);
    }

    setHasCheckedAutoGen(true);
  }, [
    checkForGemmaModel,
    hasCheckedAutoGen,
    isAutoSummary,
    setHasCheckedAutoGen,
    setShouldAutoGenerate,
    source,
  ]);
}

function MeetingDetailsContent() {
  const searchParams = useSearchParams();
  const meetingId = searchParams.get("id");
  const source = searchParams.get("source"); // Check if navigated from recording
  const shouldOpenSummary = searchParams.get("openSummary") === "1";
  const { setCurrentMeeting, refetchMeetings, stopSummaryPolling } = useSidebar();
  const { isAutoSummary } = useConfig(); // Get auto-summary toggle state
  const router = useRouter();
  const [meetingDetails, setMeetingDetails] = useState<MeetingDetailsResponse | null>(null);
  const [meetingSummary, setMeetingSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [shouldAutoGenerate, setShouldAutoGenerate] = useState<boolean>(false);
  const [hasCheckedAutoGen, setHasCheckedAutoGen] = useState<boolean>(false);

  // Use pagination hook for efficient transcript loading
  const {
    metadata,
    segments,
    transcripts,
    isLoading: isLoadingTranscripts,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    refetch,
    error: transcriptError,
  } = usePaginatedTranscripts({ meetingId: meetingId || "" });

  const setupAutoGeneration = useAutoGenerationSetup({
    source,
    isAutoSummary,
    hasCheckedAutoGen,
    setHasCheckedAutoGen,
    setShouldAutoGenerate,
  });

  // Sync meeting metadata from pagination hook to meeting details state
  useEffect(() => {
    if (metadata && (!meetingId || meetingId === "intro-call")) {
      // If invalid meeting ID, don't sync
      return;
    }

    if (metadata) {
      console.log("Meeting metadata loaded:", metadata);
      setMeetingDetails(buildMeetingDetails(metadata, transcripts));
      setCurrentMeeting({ id: metadata.id, title: metadata.title });
    }
  }, [metadata, transcripts, meetingId, setCurrentMeeting]);

  // Handle transcript loading errors
  useEffect(() => {
    if (transcriptError) {
      console.error("Error loading transcripts:", transcriptError);
      setError(transcriptError);
    }
  }, [transcriptError]);

  // Extract fetchMeetingDetails for use in child components (now refetches via hook)
  const fetchMeetingDetails = useCallback(async () => {
    if (!meetingId || meetingId === "intro-call") {
      return;
    }

    // The usePaginatedTranscripts hook automatically refetches when meetingId changes
    // This function is kept for compatibility with onMeetingUpdated callback
    console.log("fetchMeetingDetails called - pagination hook will handle refetch");
  }, [meetingId]);

  // Reset states when meetingId changes (prevent race conditions)
  useEffect(() => {
    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setIsLoading(true);
    // Reset auto-generation state to allow new meeting to be checked
    setHasCheckedAutoGen(false);
    setShouldAutoGenerate(false);
  }, [meetingId]);

  // Cleanup: Stop polling when navigating away from a meeting
  useEffect(() => {
    return () => {
      if (meetingId) {
        console.log("Cleaning up: Stopping summary polling for meeting:", meetingId);
        stopSummaryPolling(meetingId);
      }
    };
  }, [meetingId, stopSummaryPolling]);

  useEffect(() => {
    console.log("MeetingDetails useEffect triggered - meetingId:", meetingId);

    if (!meetingId || meetingId === "intro-call") {
      console.warn("No valid meeting ID in URL - meetingId:", meetingId);
      setError("No meeting selected");
      setIsLoading(false);
      Analytics.trackPageView("meeting_details");
      return;
    }

    console.log("Valid meeting ID found, fetching details for:", meetingId);

    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setIsLoading(true);

    const loadData = async () => {
      try {
        setMeetingSummary(await fetchMeetingSummary(meetingId));
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [meetingId]);

  // Auto-generation check: runs when meeting is loaded with no summary
  useEffect(() => {
    const checkAutoGen = async () => {
      // Only auto-generate if:
      // 1. We have meeting details
      // 2. No summary exists
      // 3. Meeting has transcripts
      // 4. Haven't checked yet
      if (
        meetingDetails &&
        meetingSummary === null &&
        meetingDetails.transcripts &&
        meetingDetails.transcripts.length > 0 &&
        !hasCheckedAutoGen
      ) {
        console.log("No summary found, checking for auto-generation...");
        await setupAutoGeneration();
      }
    };

    checkAutoGen();
  }, [meetingDetails, meetingSummary, hasCheckedAutoGen, setupAutoGeneration]);

  const handleSummaryOpenHandled = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("openSummary");
    const nextQuery = params.toString();
    router.replace(`/meeting-details${nextQuery ? `?${nextQuery}` : ""}`);
  }, [router, searchParams]);

  if (error) {
    return <ErrorState error={error} onGoBack={() => router.push("/")} />;
  }

  // Show loading spinner while initial data loads
  if (isLoading || isLoadingTranscripts || !meetingDetails) {
    return <LoadingState />;
  }

  return (
    <PageContent
      meeting={meetingDetails}
      summaryData={meetingSummary}
      shouldAutoGenerate={shouldAutoGenerate}
      openSummaryOnLoad={shouldOpenSummary}
      onSummaryOpenHandled={handleSummaryOpenHandled}
      onAutoGenerateComplete={() => setShouldAutoGenerate(false)}
      onMeetingUpdated={async () => {
        // Refetch meeting details to get updated title from backend
        await fetchMeetingDetails();
        // Refetch meetings list to update sidebar
        await refetchMeetings();
      }}
      onRefetchTranscripts={refetch}
      // Pagination props for efficient transcript loading
      segments={segments}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      totalCount={totalCount}
      loadedCount={loadedCount}
      onLoadMore={loadMore}
    />
  );
}

export default function MeetingDetails() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <LoaderIcon className="animate-spin size-6" />
        </div>
      }
    >
      <MeetingDetailsContent />
    </Suspense>
  );
}
