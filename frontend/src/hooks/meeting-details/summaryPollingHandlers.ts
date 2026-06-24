import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { Summary } from "@/types";
import Analytics from "@/lib/analytics";
import { resolveSummaryLanguage } from "./summaryGenerationValidation";
import type { ProcessSummaryArgs } from "./summaryGenerationTypes";

export function getSummaryStatusMessage(status: string) {
  switch (status) {
    case "processing":
      return "Processing transcript...";
    case "summarizing":
      return "Generating summary...";
    case "regenerating":
      return "Regenerating summary...";
    case "completed":
      return "Summary completed";
    case "error":
      return "Error generating summary";
    default:
      return "";
  }
}

export async function processSummaryGeneration(args: ProcessSummaryArgs) {
  const isRegeneration = args.isRegeneration ?? false;
  args.setSummaryStatus(isRegeneration ? "regenerating" : "processing");
  args.setSummaryError(null);

  try {
    if (!args.transcriptText.trim()) {
      throw new Error("No transcript text available. Please add some text first.");
    }

    console.log("Processing transcript with template:", args.selectedTemplate);
    const timeSinceRecording = (Date.now() - new Date(args.meeting.created_at).getTime()) / 60000;
    await Analytics.trackSummaryGenerationStarted(
      args.modelConfig.provider,
      args.modelConfig.model,
      args.transcriptText.length,
      timeSinceRecording,
    );

    if ((args.customPrompt || "").trim().length > 0) {
      await Analytics.trackCustomPromptUsed((args.customPrompt || "").trim().length);
    }

    toast.info(`${isRegeneration ? "Regenerating" : "Generating"} summary...`, {
      description: `Using ${args.modelConfig.provider}/${args.modelConfig.model}`,
      duration: 3000,
    });

    const summaryLanguage = await resolveSummaryLanguage(
      args.meeting.id,
      args.transcriptTexts?.length ? args.transcriptTexts : [args.transcriptText],
    );
    const result = (await invokeTauri("api_process_transcript", {
      text: args.transcriptText,
      model: args.modelConfig.provider,
      modelName: args.modelConfig.model,
      meetingId: args.meeting.id,
      chunkSize: 40000,
      overlap: 1000,
      customPrompt: args.customPrompt || "",
      templateId: args.selectedTemplate,
      summaryLanguage,
    })) as any;

    console.log("Process ID:", result.process_id);
    args.startSummaryPolling(args.meeting.id, result.process_id, async (pollingResult) => {
      await handlePollingResult(pollingResult, args);
    });
  } catch (error) {
    await handleSummaryProcessError(error, args);
  }
}

async function handlePollingResult(pollingResult: any, args: ProcessSummaryArgs) {
  console.log("Summary status:", pollingResult);

  if (pollingResult.status === "cancelled") {
    await handleCancelledSummary(args);
    return;
  }

  if (pollingResult.status === "error" || pollingResult.status === "failed") {
    await handleFailedSummary(pollingResult, args);
    return;
  }

  if (pollingResult.status === "completed" && pollingResult.data) {
    await handleCompletedSummary(pollingResult, args);
  }
}

async function handleCancelledSummary(args: ProcessSummaryArgs) {
  console.log("Summary generation was cancelled");

  try {
    const existingSummary = (await invokeTauri("api_get_summary", {
      meetingId: args.meeting.id,
    })) as any;

    if (existingSummary?.data) {
      console.log("Restored previous summary after cancellation");
      args.setAiSummary(existingSummary.data);
      args.setSummaryStatus("completed");
    } else {
      args.setSummaryStatus("idle");
    }
  } catch (error) {
    console.error("Failed to reload summary after cancellation:", error);
    args.setSummaryStatus("idle");
  }

  args.setSummaryError(null);
}

async function handleFailedSummary(pollingResult: any, args: ProcessSummaryArgs) {
  console.error("Backend returned error:", pollingResult.error);
  const isRegeneration = args.isRegeneration ?? false;
  const errorMessage =
    pollingResult.error || `Summary ${isRegeneration ? "regeneration" : "generation"} failed`;

  if (isRegeneration && (await restorePreviousSummaryAfterFailure(errorMessage, args))) {
    return;
  }

  args.setSummaryError(errorMessage);
  args.setSummaryStatus("error");
  toast.error(`Failed to ${isRegeneration ? "regenerate" : "generate"} summary`, {
    description: errorMessage.includes("Connection refused")
      ? "Could not connect to LLM service. Please ensure Ollama or your configured LLM provider is running."
      : errorMessage,
  });

  if (isModelRequiredError(errorMessage) && args.onOpenModelSettings) {
    console.log("🔧 Model required error detected, opening model settings...");
    args.onOpenModelSettings();
  }

  await Analytics.trackSummaryGenerationCompleted(
    args.modelConfig.provider,
    args.modelConfig.model,
    false,
    undefined,
    errorMessage,
  );
}

async function restorePreviousSummaryAfterFailure(errorMessage: string, args: ProcessSummaryArgs) {
  try {
    const existingSummary = (await invokeTauri("api_get_summary", {
      meetingId: args.meeting.id,
    })) as any;

    if (!existingSummary?.data) return false;

    console.log("Restored previous summary after regeneration failure");
    args.setAiSummary(existingSummary.data);
    args.setSummaryStatus("completed");
    args.setSummaryError(null);
    toast.error("Failed to regenerate summary", {
      description: `${errorMessage}. Your previous summary has been restored.`,
    });
    await Analytics.trackSummaryGenerationCompleted(
      args.modelConfig.provider,
      args.modelConfig.model,
      false,
      undefined,
      errorMessage,
    );
    return true;
  } catch (error) {
    console.error("Failed to reload summary after error:", error);
    return false;
  }
}

async function handleCompletedSummary(pollingResult: any, args: ProcessSummaryArgs) {
  console.log("Summary generation completed:", pollingResult.data);

  const meetingName = pollingResult.data.MeetingName || pollingResult.meetingName;
  if (meetingName) {
    args.updateMeetingTitle(meetingName);
  }

  if (pollingResult.data.markdown) {
    console.log("Received markdown format from backend");
    args.setAiSummary({ markdown: pollingResult.data.markdown } as any);
    args.setSummaryStatus("completed");
    await showSummarySuccess(meetingName, args);
    return;
  }

  if (isLegacySummaryEmpty(pollingResult.data)) {
    console.error("Summary completed but all sections empty");
    args.setSummaryError("Summary generation completed but returned empty content.");
    args.setSummaryStatus("error");
    await Analytics.trackSummaryGenerationCompleted(
      args.modelConfig.provider,
      args.modelConfig.model,
      false,
      undefined,
      "Empty summary generated",
    );
    return;
  }

  args.setAiSummary(formatLegacySummary(pollingResult.data));
  args.setSummaryStatus("completed");
  await showSummarySuccess(meetingName, args);
}

async function showSummarySuccess(meetingName: string | undefined, args: ProcessSummaryArgs) {
  toast.success("Summary generated successfully!", {
    description: "Your meeting summary is ready",
    duration: 4000,
  });

  if (meetingName && args.onMeetingUpdated) {
    await args.onMeetingUpdated();
  }

  await Analytics.trackSummaryGenerationCompleted(
    args.modelConfig.provider,
    args.modelConfig.model,
    true,
  );
}

function isLegacySummaryEmpty(data: any) {
  const summarySections = Object.entries(data).filter(([key]) => key !== "MeetingName");
  return summarySections.every(
    ([, section]) => !(section as any).blocks || (section as any).blocks.length === 0,
  );
}

function formatLegacySummary(data: any): Summary {
  const { MeetingName: _MeetingName, ...summaryData } = data;
  const formattedSummary: Summary = {};
  const sectionKeys = data._section_order || Object.keys(summaryData);

  for (const key of sectionKeys) {
    try {
      const section = summaryData[key];
      if (!isSummarySection(section)) continue;

      formattedSummary[key] = {
        title: section.title || key,
        blocks: Array.isArray(section.blocks)
          ? section.blocks.map((block: any) => ({
              ...block,
              color: "default",
              content: block?.content?.trim() || "",
            }))
          : [],
      };
    } catch (error) {
      console.warn(`Error processing section ${key}:`, error);
    }
  }

  return formattedSummary;
}

function isSummarySection(section: any): section is { title?: string; blocks?: any[] } {
  return section && typeof section === "object" && "title" in section && "blocks" in section;
}

function isModelRequiredError(errorMessage: string) {
  return (
    errorMessage.includes("model is required") ||
    errorMessage.includes('"model":"required"') ||
    (errorMessage.toLowerCase().includes("model") &&
      errorMessage.toLowerCase().includes("required"))
  );
}

async function handleSummaryProcessError(error: unknown, args: ProcessSummaryArgs) {
  const isRegeneration = args.isRegeneration ?? false;
  console.error(`Failed to ${isRegeneration ? "regenerate" : "generate"} summary:`, error);
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  args.setSummaryError(errorMessage);
  args.setSummaryStatus("error");

  toast.error(`Failed to ${isRegeneration ? "regenerate" : "generate"} summary`, {
    description: errorMessage,
  });

  await Analytics.trackSummaryGenerationCompleted(
    args.modelConfig.provider,
    args.modelConfig.model,
    false,
    undefined,
    errorMessage,
  );
}
