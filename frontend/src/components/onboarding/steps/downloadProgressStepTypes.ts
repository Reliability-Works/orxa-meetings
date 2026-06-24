import type { Dispatch, SetStateAction } from "react";

export const PARAKEET_MODEL = "parakeet-tdt-0.6b-v3-int8";

export type DownloadStatus = "waiting" | "downloading" | "completed" | "error";

export interface DownloadState {
  status: DownloadStatus;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  error?: string;
}

export type SetDownloadState = Dispatch<SetStateAction<DownloadState>>;
