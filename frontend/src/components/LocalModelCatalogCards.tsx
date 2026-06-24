import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  LocalModelCatalogAPI,
  LocalModelCatalogItem,
  LocalModelDownloadStatus,
  runtimeStatusLabel,
} from "@/lib/localModelCatalog";
import { Button } from "./ui/button";

interface LocalModelCatalogCardsProps {
  models: LocalModelCatalogItem[];
}

function statusClass(status: LocalModelCatalogItem["runtimeStatus"]) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

type LocalModelProgressPayload = {
  modelId: string;
  modelName: string;
  progress: number;
  downloaded_mb?: number;
  total_mb?: number;
  speed_mbps?: number;
  status: "downloading" | "completed" | "error" | string;
  error?: string | null;
  path?: string | null;
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  const mb = bytes / 1_048_576;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

async function openSource(url: string) {
  try {
    await invoke("open_external_url", { url });
  } catch (error) {
    console.error("Failed to open model source:", error);
    toast.error("Could not open model page");
  }
}

function modelProgress(status?: LocalModelDownloadStatus) {
  return status?.total_bytes
    ? Math.min(99, Math.round((status.downloaded_bytes / status.total_bytes) * 100))
    : 0;
}

function downloadLabel({ isDownloading, isDownloaded, hasError, progress }: any) {
  if (isDownloading) return `${progress}%`;
  if (isDownloaded) return "Open";
  if (hasError) return "Retry";
  return "Download";
}

function ModelBadges({ model, isDownloaded, hasError }: any) {
  return (
    <>
      {model.recommended && (
        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
          Best
        </span>
      )}
      {model.bestLabel && (
        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
          {model.bestLabel}
        </span>
      )}
      <span
        className={`rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${statusClass(model.runtimeStatus)}`}
      >
        {runtimeStatusLabel(model.runtimeStatus)}
      </span>
      {isDownloaded && (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="h-3 w-3" />
          Downloaded
        </span>
      )}
      {hasError && (
        <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
          Failed
        </span>
      )}
    </>
  );
}

function ModelActions({
  model,
  isDownloading,
  isDownloaded,
  hasError,
  progress,
  onDownload,
  onOpenFolder,
}: any) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        onClick={() => openSource(model.sourceUrl)}
      >
        <ExternalLink className="h-4 w-4" />
        Source
      </Button>
      {isDownloaded && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => onOpenFolder(model.id)}
        >
          <FolderOpen className="h-4 w-4" />
          Folder
        </Button>
      )}
      <Button
        type="button"
        variant={isDownloaded ? "outline" : "secondary"}
        size="sm"
        className="h-8"
        disabled={isDownloading}
        onClick={() => (isDownloaded ? onOpenFolder(model.id) : onDownload(model))}
        title={
          model.runtimeStatus === "ready"
            ? "Download model artifacts locally."
            : "Download model artifacts locally for research and benchmarking."
        }
      >
        {isDownloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {downloadLabel({ isDownloading, isDownloaded, hasError, progress })}
      </Button>
    </div>
  );
}

function ModelExpandedDetails({
  model,
  status,
  isDownloading,
  isDownloaded,
  hasError,
  progress,
}: any) {
  return (
    <div className="border-t border-gray-100 px-4 pb-3 pt-3">
      <p className="text-[13px] leading-5 text-gray-700">{model.bestFor}</p>
      <p className="mt-1 text-xs text-gray-500">{model.notes}</p>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-md bg-emerald-50 p-3 text-emerald-900">
          <p className="font-semibold">Pros</p>
          <ul className="mt-1 space-y-1">
            {model.pros.map((pro: string) => (
              <li key={pro}>+ {pro}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-md bg-gray-50 p-3 text-gray-700">
          <p className="font-semibold text-gray-900">Cons</p>
          <ul className="mt-1 space-y-1">
            {model.cons.map((con: string) => (
              <li key={con}>- {con}</li>
            ))}
          </ul>
        </div>
      </div>
      {isDownloading && (
        <div className="mt-3 max-w-md">
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-gray-900 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {formatBytes(status?.downloaded_bytes ?? 0)}
            {status?.total_bytes ? ` / ${formatBytes(status.total_bytes)}` : ""} downloaded
          </p>
        </div>
      )}
      {isDownloaded && (
        <p className="mt-2 truncate text-xs text-gray-500">
          {status.file_count} files · {formatBytes(status.downloaded_bytes)} · {status.path}
        </p>
      )}
      {hasError && status?.error && <p className="mt-2 text-xs text-red-600">{status.error}</p>}
    </div>
  );
}

function LocalModelCard({ model, status, expanded, onToggle, onDownload, onOpenFolder }: any) {
  const isDownloading = status?.state === "downloading";
  const isDownloaded = status?.state === "downloaded";
  const hasError = status?.state === "error";
  const progress = modelProgress(status);

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onToggle(model.id)}
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
                {model.name}
              </span>
              <ModelBadges model={model} isDownloaded={isDownloaded} hasError={hasError} />
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-gray-500">
              {model.family} · {model.size}
            </span>
          </span>
        </button>

        <ModelActions
          model={model}
          isDownloading={isDownloading}
          isDownloaded={isDownloaded}
          hasError={hasError}
          progress={progress}
          onDownload={onDownload}
          onOpenFolder={onOpenFolder}
        />
      </div>

      {expanded && (
        <ModelExpandedDetails
          model={model}
          status={status}
          isDownloading={isDownloading}
          isDownloaded={isDownloaded}
          hasError={hasError}
          progress={progress}
        />
      )}
    </div>
  );
}

export function LocalModelCatalogCards({ models }: LocalModelCatalogCardsProps) {
  const modelIds = useMemo(() => models.map((model) => model.id), [models]);
  const [statuses, setStatuses] = useState<Record<string, LocalModelDownloadStatus>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const mergeStatus = useCallback((status: LocalModelDownloadStatus) => {
    setStatuses((current) => ({
      ...current,
      [status.model_id]: status,
    }));
  }, []);

  const refreshStatuses = useCallback(async () => {
    try {
      const nextStatuses = await LocalModelCatalogAPI.getStatuses(modelIds);
      setStatuses(Object.fromEntries(nextStatuses.map((status) => [status.model_id, status])));
    } catch (error) {
      console.error("Failed to load local model statuses:", error);
    }
  }, [modelIds]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  useEffect(() => {
    const unlisten = listen<LocalModelProgressPayload>("local-model-download-progress", (event) => {
      const payload = event.payload;
      if (!modelIds.includes(payload.modelId)) return;

      setStatuses((current) => {
        const existing = current[payload.modelId];
        const totalBytes = Math.round((payload.total_mb ?? 0) * 1_048_576);
        const downloadedBytes = Math.round((payload.downloaded_mb ?? 0) * 1_048_576);
        return {
          ...current,
          [payload.modelId]: {
            model_id: payload.modelId,
            state:
              payload.status === "completed"
                ? "downloaded"
                : payload.status === "error"
                  ? "error"
                  : "downloading",
            path: payload.path ?? existing?.path ?? "",
            source_url: existing?.source_url ?? null,
            downloaded_bytes: downloadedBytes || existing?.downloaded_bytes || 0,
            total_bytes: totalBytes || existing?.total_bytes || 0,
            file_count: existing?.file_count ?? 0,
            updated_at: existing?.updated_at ?? null,
            error: payload.error ?? null,
          },
        };
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [modelIds]);

  const handleDownload = useCallback(
    async (model: LocalModelCatalogItem) => {
      mergeStatus({
        model_id: model.id,
        state: "downloading",
        path: statuses[model.id]?.path ?? "",
        source_url: model.sourceUrl,
        downloaded_bytes: 0,
        total_bytes: statuses[model.id]?.total_bytes ?? 0,
        file_count: statuses[model.id]?.file_count ?? 0,
        updated_at: null,
        error: null,
      });

      try {
        const status = await LocalModelCatalogAPI.downloadModel(model);
        mergeStatus(status);
        toast.success(`${model.name} downloaded`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        mergeStatus({
          model_id: model.id,
          state: "error",
          path: statuses[model.id]?.path ?? "",
          source_url: model.sourceUrl,
          downloaded_bytes: 0,
          total_bytes: statuses[model.id]?.total_bytes ?? 0,
          file_count: statuses[model.id]?.file_count ?? 0,
          updated_at: null,
          error: message,
        });
        toast.error(`Could not download ${model.name}`, { description: message });
      }
    },
    [mergeStatus, statuses],
  );

  const handleOpenFolder = useCallback(async (modelId: string) => {
    try {
      await LocalModelCatalogAPI.openFolder(modelId);
    } catch (error) {
      console.error("Failed to open local model folder:", error);
      toast.error("Could not open model folder");
    }
  }, []);

  const toggleExpanded = useCallback((modelId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {models.map((model) => (
        <LocalModelCard
          key={model.id}
          model={model}
          status={statuses[model.id]}
          expanded={expandedIds.has(model.id)}
          onToggle={toggleExpanded}
          onDownload={handleDownload}
          onOpenFolder={handleOpenFolder}
        />
      ))}
    </div>
  );
}
