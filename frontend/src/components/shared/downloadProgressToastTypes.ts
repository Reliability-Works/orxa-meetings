export interface DownloadProgress {
  modelName: string;
  displayName: string;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  status: "downloading" | "completed" | "error" | "cancelled";
  unitLabel?: string;
  error?: string;
}

export type DownloadStatus = DownloadProgress["status"];
export type UpdateDownload = (modelName: string, data: Partial<DownloadProgress>) => void;
export type CleanupDownload = (modelName: string, delay?: number) => void;
