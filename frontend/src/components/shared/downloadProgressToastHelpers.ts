import type { DownloadStatus } from "./downloadProgressToastTypes";

export function categorizeError(error: string): string {
  const lowerError = error.toLowerCase();

  if (
    lowerError.includes("network") ||
    lowerError.includes("connection") ||
    lowerError.includes("timeout") ||
    lowerError.includes("failed to start download")
  ) {
    return "Network error - Check your internet connection";
  }

  if (lowerError.includes("status:") || lowerError.includes("http")) {
    return "Server error - Download temporarily unavailable";
  }

  if (lowerError.includes("disk") || lowerError.includes("write") || lowerError.includes("file")) {
    return "Storage error - Check available disk space";
  }

  if (lowerError.includes("invalid") || lowerError.includes("validation")) {
    return "File validation failed - Please retry download";
  }

  return error;
}

export function getDownloadToastDuration(status: DownloadStatus) {
  switch (status) {
    case "completed":
      return 3000;
    case "cancelled":
      return 5000;
    case "error":
      return 10000;
    case "downloading":
      return Infinity;
  }
}

export function getParakeetDownloadStatus(
  status: string | undefined,
  progress: number,
): DownloadStatus {
  if (status === "cancelled") return "cancelled";
  if (status === "completed" || progress >= 100) return "completed";
  return "downloading";
}

export function getSummaryDownloadStatus(status: string, progress: number): DownloadStatus {
  if (status === "completed" || progress >= 100) return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "error") return "error";
  return "downloading";
}

export function getLocalModelDownloadStatus(status: string, progress: number): DownloadStatus {
  if (status === "completed" || progress >= 100) return "completed";
  if (status === "error") return "error";
  return "downloading";
}
