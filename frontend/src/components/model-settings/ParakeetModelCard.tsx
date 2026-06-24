import { useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, Download, RefreshCw, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ParakeetModelInfo, formatFileSize, getModelDisplayInfo } from "@/lib/parakeet";

interface ParakeetModelCardProps {
  model: ParakeetModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
}

function stopAndRun(event: MouseEvent, action: () => void) {
  event.stopPropagation();
  action();
}

function ParakeetModelActions({
  isAvailable,
  isMissing,
  isError,
  isCorrupted,
  isSelected,
  downloadProgress,
  onDownload,
  onDelete,
}: any) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {isAvailable && (
        <span className="flex items-center gap-1 text-[11px] font-medium text-green-600">
          <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
          Ready
        </span>
      )}
      {isMissing && (
        <button
          onClick={(event) => stopAndRun(event, onDownload)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          <Download className="h-4 w-4" />
          Download
        </button>
      )}
      {downloadProgress === null && isError && (
        <button
          onClick={(event) => stopAndRun(event, onDownload)}
          className="flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      )}
      {isCorrupted && (
        <>
          <button
            onClick={(event) => stopAndRun(event, onDelete)}
            className="h-8 rounded-md bg-orange-600 px-3 text-sm font-medium text-white transition-colors hover:bg-orange-700"
          >
            Delete
          </button>
          <button
            onClick={(event) => stopAndRun(event, onDownload)}
            className="h-8 rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            Re-download
          </button>
        </>
      )}
      {isAvailable && !isSelected && (
        <button
          type="button"
          onClick={(event) => stopAndRun(event, onDelete)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"
          title="Delete model to free up space"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ParakeetModelDetails({ displayInfo, tagline }: any) {
  if (!displayInfo || displayInfo.pros.length === 0 || displayInfo.cons.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-gray-100 px-4 pb-3 pt-3">
      <p className="text-[13px] leading-5 text-gray-700">{tagline}</p>
      <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-2">
        <div className="rounded-md bg-emerald-50 p-3 text-emerald-900">
          <p className="font-semibold">Pros</p>
          <ul className="mt-1 space-y-1">
            {displayInfo.pros.map((item: string) => (
              <li key={item}>+ {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-md bg-gray-50 p-3 text-gray-700">
          <p className="font-semibold text-gray-900">Cons</p>
          <ul className="mt-1 space-y-1">
            {displayInfo.cons.map((item: string) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ParakeetTitleBadges({ isRecommended, displayInfo, isSelected, isAvailable }: any) {
  return (
    <>
      {isRecommended && (
        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
          Best
        </span>
      )}
      {displayInfo?.bestLabel && (
        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
          {displayInfo.bestLabel}
        </span>
      )}
      {isSelected && isAvailable && (
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
          Selected
        </span>
      )}
    </>
  );
}

function ParakeetDownloadProgress({ model, downloadProgress, onCancel }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="border-t border-gray-100 px-4 py-3"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-blue-600">Downloading...</span>
          <span className="text-sm font-semibold text-blue-600">
            {Math.round(downloadProgress)}%
          </span>
        </div>
        <button
          onClick={(event) => stopAndRun(event, onCancel)}
          className="text-xs text-gray-600 hover:text-red-600 font-medium transition-colors px-2 py-1 rounded hover:bg-red-50"
          title="Cancel download"
        >
          Cancel
        </button>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gray-900 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${downloadProgress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {model.size_mb ? (
          <>
            {formatFileSize((model.size_mb * downloadProgress) / 100)} /{" "}
            {formatFileSize(model.size_mb)}
          </>
        ) : (
          "Downloading..."
        )}
      </p>
    </motion.div>
  );
}

export function ParakeetModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  isDownloading,
}: ParakeetModelCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayInfo = getModelDisplayInfo(model.name);
  const displayName = displayInfo?.friendlyName || model.name;
  const icon = displayInfo?.icon || "📦";
  const tagline = displayInfo?.tagline || model.description || "";
  const isAvailable = model.status === "Available";
  const isMissing = model.status === "Missing";
  const isError = typeof model.status === "object" && "Error" in model.status;
  const isCorrupted = typeof model.status === "object" && "Corrupted" in model.status;
  const downloadProgress =
    typeof model.status === "object" && "Downloading" in model.status
      ? model.status.Downloading
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`${isSelected && isAvailable ? "bg-gray-50" : isAvailable ? "bg-white hover:bg-gray-50" : "bg-gray-50/70"} transition-colors`}
    >
      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <Switch
          checked={isSelected && isAvailable}
          disabled={!isAvailable || isDownloading}
          onCheckedChange={(checked) => {
            if (checked && isAvailable) onSelect();
          }}
          aria-label={`Use ${displayName}`}
        />
        <button
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <span className="text-lg leading-none">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-gray-950">
                {displayName}
              </span>
              <ParakeetTitleBadges
                isRecommended={isRecommended}
                displayInfo={displayInfo}
                isSelected={isSelected}
                isAvailable={isAvailable}
              />
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-gray-500">{tagline}</span>
          </span>
        </button>
        <ParakeetModelActions
          isAvailable={isAvailable}
          isMissing={isMissing}
          isError={isError}
          isCorrupted={isCorrupted}
          isSelected={isSelected}
          downloadProgress={downloadProgress}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      </div>
      {isExpanded && <ParakeetModelDetails displayInfo={displayInfo} tagline={tagline} />}
      {downloadProgress !== null && (
        <ParakeetDownloadProgress
          model={model}
          downloadProgress={downloadProgress}
          onCancel={onCancel}
        />
      )}
    </motion.div>
  );
}
