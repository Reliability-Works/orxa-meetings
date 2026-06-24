import type { Summary } from "@/types";
import type { ModelConfig } from "@/components/ModelSettingsModal";

export type SummaryStatus =
  | "idle"
  | "processing"
  | "summarizing"
  | "regenerating"
  | "completed"
  | "error";

export interface SummaryTranscriptPayload {
  transcriptText: string;
  transcriptTexts: string[];
}

export interface ProcessSummaryInput {
  transcriptText: string;
  transcriptTexts?: string[];
  customPrompt?: string;
  isRegeneration?: boolean;
}

export interface ProcessSummaryArgs extends ProcessSummaryInput {
  meeting: any;
  modelConfig: ModelConfig;
  selectedTemplate: string;
  startSummaryPolling: (
    meetingId: string,
    processId: string,
    callback: (pollingResult: any) => Promise<void>,
  ) => void;
  onMeetingUpdated?: () => Promise<void>;
  updateMeetingTitle: (title: string) => void;
  setAiSummary: (summary: Summary | null) => void;
  setSummaryStatus: (status: SummaryStatus) => void;
  setSummaryError: (error: string | null) => void;
  onOpenModelSettings?: () => void;
}
