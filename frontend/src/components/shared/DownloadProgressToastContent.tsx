import { ArrowBigDownDash, Check, X } from "lucide-react";
import type { DownloadProgress } from "./downloadProgressToastTypes";

function DownloadToastIcon({ download }: { download: DownloadProgress }) {
  const isComplete = download.status === "completed";
  const hasError = download.status === "error";
  const isCancelled = download.status === "cancelled";
  const backgroundClass = isComplete ? "bg-green-100" : hasError ? "bg-red-100" : "bg-gray-100";

  return (
    <div
      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${backgroundClass}`}
    >
      {isComplete ? (
        <Check className="w-4 h-4 text-green-600" />
      ) : hasError ? (
        <X className="w-4 h-4 text-red-600" />
      ) : isCancelled ? (
        <X className="w-4 h-4 text-gray-600" />
      ) : (
        <ArrowBigDownDash className="size-5 text-gray-600 " />
      )}
    </div>
  );
}

function DownloadToastProgress({ download }: { download: DownloadProgress }) {
  const unitLabel = download.unitLabel ?? "MB";

  return (
    <>
      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1.5">
        <div
          className="h-full bg-gray-900 rounded-full transition-all duration-300"
          style={{ width: `${download.progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {download.downloadedMb.toFixed(1)} / {download.totalMb.toFixed(1)} {unitLabel}
        </span>
        <span className="flex items-center gap-1">
          {download.speedMbps > 0 && (
            <span>
              {download.speedMbps.toFixed(1)} {unitLabel}/s
            </span>
          )}
          <span className="text-gray-900 font-medium">{Math.round(download.progress)}%</span>
        </span>
      </div>
    </>
  );
}

function DownloadToastMessage({ download }: { download: DownloadProgress }) {
  if (download.status === "error") {
    return <p className="text-xs text-red-600">{download.error || "Download failed"}</p>;
  }
  if (download.status === "completed") {
    return <p className="text-xs text-green-600">Download complete</p>;
  }
  if (download.status === "cancelled") {
    return <p className="text-xs text-gray-600">Download cancelled</p>;
  }
  return <DownloadToastProgress download={download} />;
}

export function DownloadToastContent({
  download,
}: {
  download: DownloadProgress;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 w-full max-w-sm bg-white rounded-lg shadow-lg border border-gray-200 p-3 relative">
      <DownloadToastIcon download={download} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-gray-900 truncate">{download.displayName}</p>
        </div>

        <DownloadToastMessage download={download} />
      </div>
    </div>
  );
}
