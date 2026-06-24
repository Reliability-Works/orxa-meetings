import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Transcript } from "@/types";
import type { ModelConfig } from "@/components/ModelSettingsModal";
import { BuiltInModelInfo } from "@/lib/builtin-ai";
import { isOllamaNotInstalledError } from "@/lib/utils";
import {
  detectAndCacheSummaryLanguage,
  readCachedDetectedSummaryLanguage,
  readMeetingSummaryLanguage,
} from "@/lib/summary-language-preferences";
import type { SummaryTranscriptPayload } from "./summaryGenerationTypes";

export async function resolveSummaryLanguage(
  meetingId: string,
  transcriptTexts: string[],
): Promise<string | null> {
  try {
    const perMeeting = await readMeetingSummaryLanguage(meetingId);
    if (perMeeting.language) return perMeeting.language;
  } catch (err) {
    console.warn("Failed to load meeting summary language:", err);
    toast.warning("Could not load saved summary language", {
      description: "Using Auto for this generation.",
    });
  }

  try {
    const cachedDetected = await readCachedDetectedSummaryLanguage(meetingId);
    if (cachedDetected) return cachedDetected;
  } catch (err) {
    console.warn("Failed to load cached detected summary language:", err);
  }

  try {
    const detection = await detectAndCacheSummaryLanguage(meetingId, transcriptTexts);
    if (detection.reason === "tie") {
      toast.warning("Bilingual transcript detected", {
        description: "Pick a summary language manually if Auto chooses the wrong fallback.",
      });
    }
    return detection.language;
  } catch (err) {
    console.warn("Failed to detect transcript summary language:", err);
    return null;
  }
}

export async function fetchAllMeetingTranscripts(meetingId: string): Promise<Transcript[]> {
  try {
    console.log("📊 Fetching all transcripts for meeting:", meetingId);
    const firstPage = (await invokeTauri("api_get_meeting_transcripts", {
      meetingId,
      limit: 1,
      offset: 0,
    })) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

    const totalCount = firstPage.total_count;
    console.log(`📊 Total transcripts in database: ${totalCount}`);
    if (totalCount === 0) return [];

    const allData = (await invokeTauri("api_get_meeting_transcripts", {
      meetingId,
      limit: totalCount,
      offset: 0,
    })) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

    console.log(`✅ Fetched ${allData.transcripts.length} transcripts from database`);
    return allData.transcripts;
  } catch (error) {
    console.error("❌ Error fetching all transcripts:", error);
    toast.error("Failed to fetch transcripts for summary generation");
    return [];
  }
}

export function buildSummaryTranscriptPayload(
  allTranscripts: Transcript[],
): SummaryTranscriptPayload {
  return {
    transcriptText: allTranscripts
      .map(
        (t) =>
          `${formatTime(t.audio_start_time, t.timestamp)}${formatSpeaker(t.speaker)} ${t.text}`,
      )
      .join("\n"),
    transcriptTexts: allTranscripts.map((t) => t.text),
  };
}

export async function validateSummaryProvider(args: {
  modelConfig: ModelConfig;
  onOpenModelSettings?: () => void;
}) {
  if (args.modelConfig.provider === "ollama") {
    return validateOllamaProvider(args.modelConfig);
  }
  if (args.modelConfig.provider === "builtin-ai") {
    return validateBuiltinAiProvider(args.modelConfig, args.onOpenModelSettings);
  }
  return true;
}

function formatTime(seconds: number | undefined, fallbackTimestamp: string): string {
  if (seconds === undefined) return fallbackTimestamp;
  const totalSecs = Math.floor(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `[${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
}

function formatSpeaker(speaker: string | null | undefined): string {
  return speaker === "me" ? " Me:" : "";
}

async function validateOllamaProvider(modelConfig: ModelConfig) {
  try {
    const endpoint = modelConfig.ollamaEndpoint || null;
    const models = (await invokeTauri("get_ollama_models", { endpoint })) as any[];
    if (models?.length > 0) return true;

    toast.error("No Ollama models found. Please download gemma3:1b from Model Settings.", {
      duration: 5000,
    });
    return false;
  } catch (error) {
    console.error("Error checking Ollama models:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    showOllamaValidationError(errorMessage);
    return false;
  }
}

function showOllamaValidationError(errorMessage: string) {
  if (isOllamaNotInstalledError(errorMessage)) {
    toast.error("Ollama is not installed", {
      description: "Please download and install Ollama to use local models.",
      duration: 7000,
      action: {
        label: "Download",
        onClick: () => invokeTauri("open_external_url", { url: "https://ollama.com/download" }),
      },
    });
    return;
  }

  toast.error(
    "Failed to check Ollama models. Please ensure Ollama is running and download a model from Settings.",
    { duration: 5000 },
  );
}

async function validateBuiltinAiProvider(
  modelConfig: ModelConfig,
  onOpenModelSettings?: () => void,
) {
  const selectedModel = modelConfig.model;
  if (!selectedModel) {
    toast.error("No built-in AI model selected", {
      description: "Please select a model in settings",
      duration: 5000,
    });
    onOpenModelSettings?.();
    return false;
  }

  try {
    const isReady = await invokeTauri<boolean>("builtin_ai_is_model_ready", {
      modelName: selectedModel,
      refresh: true,
    });
    if (isReady) return true;

    const modelInfo = await invokeTauri<BuiltInModelInfo | null>("builtin_ai_get_model_info", {
      modelName: selectedModel,
    });
    return handleBuiltinModelUnavailable(selectedModel, modelInfo, onOpenModelSettings);
  } catch (error) {
    console.error("Error validating built-in AI model:", error);
    toast.error("Failed to validate built-in AI model", {
      description: error instanceof Error ? error.message : String(error),
      duration: 5000,
    });
    return false;
  }
}

function handleBuiltinModelUnavailable(
  selectedModel: string,
  modelInfo: BuiltInModelInfo | null,
  onOpenModelSettings?: () => void,
) {
  if (modelInfo?.status.type === "downloading") {
    toast.info("Model download in progress", {
      description: `${selectedModel} is downloading (${modelInfo.status.progress}%). Please wait until download completes.`,
      duration: 5000,
    });
    return false;
  }

  if (modelInfo?.status.type === "not_downloaded") {
    toast.error("Built-in AI model not downloaded", {
      description: `${selectedModel} needs to be downloaded. Please download it in model settings.`,
      duration: 7000,
    });
    onOpenModelSettings?.();
    return false;
  }

  if (modelInfo?.status.type === "corrupted" || modelInfo?.status.type === "error") {
    const errorDesc =
      modelInfo.status.type === "error"
        ? modelInfo.status.Error || "The model file has an error"
        : "The model file is corrupted";
    toast.error("Built-in AI model not available", {
      description: `${errorDesc}. Please check model settings.`,
      duration: 7000,
    });
    onOpenModelSettings?.();
    return false;
  }

  toast.error("Built-in AI model not ready", {
    description: "Please ensure the model is downloaded in settings",
    duration: 5000,
  });
  onOpenModelSettings?.();
  return false;
}
