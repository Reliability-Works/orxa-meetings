export interface BuiltInModelInfo {
  name: string;
  display_name: string;
  status: {
    type: "not_downloaded" | "downloading" | "available" | "corrupted" | "error";
    progress?: number;
  };
  size_mb: number;
  context_size: number;
  description: string;
  gguf_file: string;
}

export interface BuiltInDownloadProgressInfo {
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

export type ModelSettingsUsage = "summary" | "chat";

export type SummaryModelGuidance = {
  bestLabel: string;
  pros: string[];
  cons: string[];
  isBest?: boolean;
};
