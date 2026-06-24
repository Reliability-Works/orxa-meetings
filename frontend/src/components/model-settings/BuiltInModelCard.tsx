import type { MouseEvent } from "react";
import { BadgeAlert, ChevronDown, ChevronRight, Download, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatSummaryModelSizeLabelFromMb } from "@/lib/onboarding-summary-model";
import { cn } from "@/lib/utils";
import {
  BuiltInDownloadProgressInfo,
  BuiltInModelInfo,
  ModelSettingsUsage,
} from "@/components/model-settings/builtinModelTypes";
import {
  getModelDescription,
  getModelGuidance,
} from "@/components/model-settings/builtinModelGuidance";

interface BuiltInModelCardProps {
  model: BuiltInModelInfo;
  index: number;
  selectedModel: string;
  usage: ModelSettingsUsage;
  progress?: number;
  progressInfo?: BuiltInDownloadProgressInfo;
  isDownloading: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (modelName: string) => void;
  onDownload: (modelName: string) => void;
  onCancel: (modelName: string) => void;
  onDelete: (modelName: string) => void;
}

function ModelActionButtons({
  model,
  isAvailable,
  isNotDownloaded,
  isCorrupted,
  isError,
  isDownloading,
  isSelected,
  onDownload,
  onCancel,
  onDelete,
}: any) {
  const stopAndRun = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {isNotDownloaded && !isDownloading && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={(event) => stopAndRun(event, () => onDownload(model.name))}
        >
          <Download className="h-4 w-4" />
          Download
        </Button>
      )}
      {isDownloading && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={(event) => stopAndRun(event, () => onCancel(model.name))}
        >
          Cancel
        </Button>
      )}
      {isError && !isDownloading && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={(event) => stopAndRun(event, () => onDownload(model.name))}
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      )}
      {isCorrupted && !isDownloading && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={(event) => stopAndRun(event, () => onDownload(model.name))}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={(event) => stopAndRun(event, () => onDelete(model.name))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      )}
      {isAvailable && !isDownloading && !isSelected && (
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"
          onClick={(event) => stopAndRun(event, () => onDelete(model.name))}
          title="Delete model"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function BuiltInModelDetails({ model, description, guidance, isCorrupted, isError }: any) {
  return (
    <div className="border-t border-gray-100 px-4 pb-3 pt-3 text-sm text-gray-600">
      {description && <p className="mb-3 max-w-3xl text-[13px] leading-5">{description}</p>}
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-md bg-emerald-50 p-3 text-emerald-900">
          <p className="font-semibold">Pros</p>
          <ul className="mt-1 space-y-1">
            {guidance.pros.map((item: string) => (
              <li key={item}>+ {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-md bg-gray-50 p-3 text-gray-700">
          <p className="font-semibold text-gray-900">Cons</p>
          <ul className="mt-1 space-y-1">
            {guidance.cons.map((item: string) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      </div>
      {(isError || isCorrupted) && (
        <p className="mt-3 text-xs text-red-600">
          {isError && typeof model.status === "object" && "Error" in model.status
            ? (model.status as any).Error
            : isCorrupted
              ? "File is corrupted. Retry download or delete."
              : "An error occurred"}
        </p>
      )}
    </div>
  );
}

function BuiltInDownloadProgress({ model, progress, progressInfo }: any) {
  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">Downloading...</span>
        <span className="text-sm font-semibold text-gray-900">{Math.round(progress)}%</span>
      </div>
      <div className="mb-2 text-sm text-gray-600">
        {progressInfo?.totalMb > 0 ? (
          <>
            {progressInfo.downloadedMb.toFixed(1)} MiB / {progressInfo.totalMb.toFixed(1)} MiB
            {progressInfo.speedMbps > 0 && (
              <span className="ml-2 text-gray-500">
                ({progressInfo.speedMbps.toFixed(1)} MiB/s)
              </span>
            )}
          </>
        ) : (
          <span>{formatSummaryModelSizeLabelFromMb(model.size_mb)}</span>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-gray-900 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function BuiltInModelCard({
  model,
  index,
  selectedModel,
  usage,
  progress,
  progressInfo,
  isDownloading,
  expanded,
  onToggle,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
}: BuiltInModelCardProps) {
  const isAvailable = model.status.type === "available";
  const isNotDownloaded = model.status.type === "not_downloaded";
  const isCorrupted = model.status.type === "corrupted";
  const isError = model.status.type === "error";
  const isSelected = selectedModel === model.name;
  const guidance = getModelGuidance(model.name, usage);
  const description = getModelDescription(model, usage);

  return (
    <div
      className={cn(
        "transition-colors",
        index > 0 && "border-t border-gray-100",
        isSelected ? "bg-gray-50" : "bg-white hover:bg-gray-50",
      )}
    >
      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <Switch
          checked={isSelected}
          disabled={!isAvailable || isDownloading}
          onCheckedChange={(checked) => {
            if (checked && isAvailable && !isDownloading) {
              onSelect(model.name);
            }
          }}
          aria-label={`Use ${model.display_name || model.name}`}
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-gray-950">
                {model.display_name || model.name}
              </span>
              {guidance.isBest && (
                <span className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Best
                </span>
              )}
              <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                {guidance.bestLabel}
              </span>
              {isAvailable && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-green-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                  Ready
                </span>
              )}
              {isSelected && isAvailable && (
                <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                  Selected
                </span>
              )}
              {isCorrupted && (
                <span className="flex shrink-0 items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                  <BadgeAlert className="h-3 w-3" />
                  Corrupted
                </span>
              )}
              {isError && (
                <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                  Error
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-gray-500">
              {formatSummaryModelSizeLabelFromMb(model.size_mb)} · {model.context_size} tokens
            </span>
          </span>
        </button>
        <ModelActionButtons
          model={model}
          isAvailable={isAvailable}
          isNotDownloaded={isNotDownloaded}
          isCorrupted={isCorrupted}
          isError={isError}
          isDownloading={isDownloading}
          isSelected={isSelected}
          onDownload={onDownload}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>
      {expanded && (
        <BuiltInModelDetails
          model={model}
          description={description}
          guidance={guidance}
          isCorrupted={isCorrupted}
          isError={isError}
        />
      )}
      {isDownloading && progress !== undefined && (
        <BuiltInDownloadProgress model={model} progress={progress} progressInfo={progressInfo} />
      )}
    </div>
  );
}
