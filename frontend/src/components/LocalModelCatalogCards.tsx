import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, Download, ExternalLink, FolderOpen, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  LocalModelCatalogAPI,
  LocalModelCatalogItem,
  LocalModelDownloadStatus,
  runtimeStatusLabel,
} from '@/lib/localModelCatalog';
import { Button } from './ui/button';

interface LocalModelCatalogCardsProps {
  models: LocalModelCatalogItem[];
}

function statusClass(status: LocalModelCatalogItem['runtimeStatus']) {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'adapter_pending') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

type LocalModelProgressPayload = {
  modelId: string;
  modelName: string;
  progress: number;
  downloaded_mb?: number;
  total_mb?: number;
  speed_mbps?: number;
  status: 'downloading' | 'completed' | 'error' | string;
  error?: string | null;
  path?: string | null;
};

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1_048_576;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

async function openSource(url: string) {
  try {
    await invoke('open_external_url', { url });
  } catch (error) {
    console.error('Failed to open model source:', error);
    toast.error('Could not open model page');
  }
}

export function LocalModelCatalogCards({ models }: LocalModelCatalogCardsProps) {
  const modelIds = useMemo(() => models.map((model) => model.id), [models]);
  const [statuses, setStatuses] = useState<Record<string, LocalModelDownloadStatus>>({});

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
      console.error('Failed to load local model statuses:', error);
    }
  }, [modelIds]);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  useEffect(() => {
    const unlisten = listen<LocalModelProgressPayload>('local-model-download-progress', (event) => {
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
            state: payload.status === 'completed'
              ? 'downloaded'
              : payload.status === 'error'
                ? 'error'
                : 'downloading',
            path: payload.path ?? existing?.path ?? '',
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

  const handleDownload = useCallback(async (model: LocalModelCatalogItem) => {
    mergeStatus({
      model_id: model.id,
      state: 'downloading',
      path: statuses[model.id]?.path ?? '',
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
        state: 'error',
        path: statuses[model.id]?.path ?? '',
        source_url: model.sourceUrl,
        downloaded_bytes: 0,
        total_bytes: statuses[model.id]?.total_bytes ?? 0,
        file_count: statuses[model.id]?.file_count ?? 0,
        updated_at: null,
        error: message,
      });
      toast.error(`Could not download ${model.name}`, { description: message });
    }
  }, [mergeStatus, statuses]);

  const handleOpenFolder = useCallback(async (modelId: string) => {
    try {
      await LocalModelCatalogAPI.openFolder(modelId);
    } catch (error) {
      console.error('Failed to open local model folder:', error);
      toast.error('Could not open model folder');
    }
  }, []);

  return (
    <div className="grid grid-cols-1 gap-3">
      {models.map((model) => {
        const status = statuses[model.id];
        const isDownloading = status?.state === 'downloading';
        const isDownloaded = status?.state === 'downloaded';
        const hasError = status?.state === 'error';
        const progress = status?.total_bytes
          ? Math.min(99, Math.round((status.downloaded_bytes / status.total_bytes) * 100))
          : 0;

        return (
          <div
            key={model.id}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{model.name}</h3>
                  {model.recommended && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Recommended
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(model.runtimeStatus)}`}>
                    {runtimeStatusLabel(model.runtimeStatus)}
                  </span>
                  {isDownloaded && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Downloaded
                    </span>
                  )}
                  {hasError && (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      Failed
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">{model.family} · {model.size}</p>
                <p className="mt-2 text-sm text-gray-700">{model.bestFor}</p>
                <p className="mt-1 text-xs text-gray-500">{model.notes}</p>
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
                      {status?.total_bytes ? ` / ${formatBytes(status.total_bytes)}` : ''} downloaded
                    </p>
                  </div>
                )}
                {isDownloaded && (
                  <p className="mt-2 truncate text-xs text-gray-500">
                    {status.file_count} files · {formatBytes(status.downloaded_bytes)} · {status.path}
                  </p>
                )}
                {hasError && status?.error && (
                  <p className="mt-2 text-xs text-red-600">{status.error}</p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openSource(model.sourceUrl)}
                >
                  <ExternalLink className="h-4 w-4" />
                  Source
                </Button>
                {isDownloaded && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenFolder(model.id)}
                  >
                    <FolderOpen className="h-4 w-4" />
                    Folder
                  </Button>
                )}
                <Button
                  type="button"
                  variant={isDownloaded ? 'outline' : 'secondary'}
                  size="sm"
                  disabled={isDownloading}
                  onClick={() => isDownloaded ? handleOpenFolder(model.id) : handleDownload(model)}
                  title="Download model artifacts locally. Running this model still requires the matching Meetily runtime adapter."
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isDownloading ? `${progress}%` : isDownloaded ? 'Open' : hasError ? 'Retry' : 'Download'}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
