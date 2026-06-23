'use client';

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { BadgeAlert, ChevronDown, ChevronRight, Download, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatSummaryModelSizeLabelFromMb } from '@/lib/onboarding-summary-model';
import { Switch } from '@/components/ui/switch';

interface ModelInfo {
  name: string;
  display_name: string;
  status: {
    type: 'not_downloaded' | 'downloading' | 'available' | 'corrupted' | 'error';
    progress?: number;
  };
  size_mb: number;
  context_size: number;
  description: string;
  gguf_file: string;
}

interface DownloadProgressInfo {
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface BuiltInModelManagerProps {
  selectedModel: string;
  onModelSelect: (model: string) => void;
  layout?: 'inline' | 'dialog';
  usage?: 'summary' | 'chat';
}

type SummaryModelGuidance = {
  bestLabel: string;
  pros: string[];
  cons: string[];
  isBest?: boolean;
};

function getModelGuidance(modelName: string, usage: 'summary' | 'chat'): SummaryModelGuidance {
  if (usage === 'chat') {
    if (modelName === 'qwen3.5:2b') {
      return {
        bestLabel: 'Best local chat default',
        isBest: true,
        pros: [
          'Fastest good built-in choice for responsive meeting Q&A.',
          'Enough reasoning for transcript-backed follow-ups on most meetings.',
        ],
        cons: [
          'Less exhaustive than Qwen 3.5 4B for tangled technical discussions.',
          'May need more explicit prompts for multi-meeting synthesis.',
        ],
      };
    }

    if (modelName === 'qwen3.5:4b') {
      return {
        bestLabel: 'Best deep chat reasoning',
        pros: [
          'Strongest built-in option for nuanced meeting questions.',
          'Better at reconciling summary, evidence, and action items.',
        ],
        cons: [
          'Slower responses than Qwen 3.5 2B.',
          'Largest local download and memory footprint.',
        ],
      };
    }

    if (modelName === 'gemma3:4b') {
      return {
        bestLabel: 'Best alternate chat style',
        pros: [
          'Useful backup when Qwen answers feel too terse.',
          'Good for concise interpretation and rewriting tasks.',
        ],
        cons: [
          'Less preferred for evidence-heavy meeting agent answers.',
          'May need tighter prompting to cite transcript evidence.',
        ],
      };
    }

    return {
      bestLabel: 'Best lightweight chat fallback',
      pros: [
        'Smallest built-in option for quick local chat.',
        'Good for simple lookup questions and short meetings.',
      ],
      cons: [
        'Weakest reasoning on complex meetings.',
        'Most likely to miss context across long transcripts.',
      ],
    };
  }

  if (modelName === 'qwen3.5:4b') {
    return {
      bestLabel: 'Best local summary quality',
      isBest: true,
      pros: [
        'Best built-in choice for expansive summaries.',
        'Large context window for long meeting notes.',
      ],
      cons: [
        'Largest built-in Qwen download.',
        'Needs more memory than the 2B model.',
      ],
    };
  }

  if (modelName === 'qwen3.5:2b') {
    return {
      bestLabel: 'Best lighter Qwen option',
      pros: [
        'Good balance of quality and local resource use.',
        'Safer default on lower-memory Macs.',
      ],
      cons: [
        'Less detail retention than Qwen 3.5 4B.',
        'May compress complex meetings more aggressively.',
      ],
    };
  }

  if (modelName === 'gemma3:4b') {
    return {
      bestLabel: 'Best legacy alternative',
      pros: [
        'Useful if you prefer Gemma-style summaries.',
        'Good quality/speed trade-off.',
      ],
      cons: [
        'Lower priority than the Qwen summary models.',
        'Not the best option for exhaustive meeting coverage.',
      ],
    };
  }

  return {
    bestLabel: 'Best fastest fallback',
    pros: [
      'Smallest built-in summary model.',
      'Useful when speed and low memory matter most.',
    ],
    cons: [
      'Most likely to miss details in longer meetings.',
      'Not recommended for the expansive summary mode.',
    ],
  };
}

function getModelDescription(model: ModelInfo, usage: 'summary' | 'chat') {
  if (usage === 'summary') return model.description;

  if (model.name === 'qwen3.5:2b') {
    return 'Best default for responsive local meeting chat. Balanced speed, context use, and answer quality.';
  }

  if (model.name === 'qwen3.5:4b') {
    return 'Highest-quality local chat model for nuanced questions, evidence synthesis, and technical follow-ups.';
  }

  if (model.name === 'gemma3:4b') {
    return 'Alternative local chat model with a concise answer style and moderate local requirements.';
  }

  return 'Fast lightweight chat fallback for simple meeting lookup questions on lower-memory Macs.';
}

function summaryModelPriority(modelName: string) {
  if (modelName === 'qwen3.5:4b') return 40;
  if (modelName === 'qwen3.5:2b') return 30;
  if (modelName === 'gemma3:4b') return 20;
  if (modelName === 'gemma3:1b') return 10;
  return 0;
}

export function BuiltInModelManager({
  selectedModel,
  onModelSelect,
  layout = 'inline',
  usage = 'summary',
}: BuiltInModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasFetched, setHasFetched] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadProgressInfo, setDownloadProgressInfo] = useState<Record<string, DownloadProgressInfo>>({});
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      setIsLoading(true);
      const data = (await invoke('builtin_ai_list_models')) as ModelInfo[];
      setModels(data);

      // Auto-select first available model if none selected
      if (data.length > 0 && !selectedModel) {
        const bestAvailable = data
          .filter((m) => m.status.type === 'available')
          .sort((a, b) => summaryModelPriority(b.name) - summaryModelPriority(a.name))[0];
        if (bestAvailable) {
          onModelSelect(bestAvailable.name);
        }
      }
    } catch (error) {
      console.error('Failed to fetch built-in AI models:', error);
      toast.error('Failed to load models');
    } finally {
      setIsLoading(false);
      setHasFetched(true);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  // Listen for download progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen('builtin-ai-download-progress', (event: any) => {
        const { model, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;

        // Update percentage progress
        setDownloadProgress((prev) => ({
          ...prev,
          [model]: progress,
        }));

        // Update detailed progress info (MB, speed)
        setDownloadProgressInfo((prev) => ({
          ...prev,
          [model]: {
            downloadedMb: downloaded_mb ?? 0,
            totalMb: total_mb ?? 0,
            speedMbps: speed_mbps ?? 0,
          },
        }));

        // Handle downloading status - restore downloadingModels state on modal reopen
        if (status === 'downloading') {
          setDownloadingModels((prev) => {
            if (!prev.has(model)) {
              const newSet = new Set(prev);
              newSet.add(model);
              return newSet;
            }
            return prev;
          });
        }

        // Handle completed status
        if (status === 'completed') {
          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(model);
            return newSet;
          });
          // Clean up progress state
          setDownloadProgress((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          setDownloadProgressInfo((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          // Refresh models list
          fetchModels();
          toast.success(`Model ${model} downloaded successfully`);
        }

        // Handle cancelled status
        if (status === 'cancelled') {
          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(model);
            return newSet;
          });
          // Clean up progress state
          setDownloadProgress((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          setDownloadProgressInfo((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          // Refresh models list
          fetchModels();
        }

        // Handle error status
        if (status === 'error') {
          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(model);
            return newSet;
          });
          // Clean up progress state
          setDownloadProgress((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          setDownloadProgressInfo((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });

          // Update model status to error locally instead of fetching from backend
          // Backend doesn't persist error status, so fetchModels() would return not_downloaded
          setModels((prevModels) =>
            prevModels.map((m) =>
              m.name === model
                ? {
                    ...m,
                    status: {
                      type: 'error',
                      progress: 0,
                    } as any,
                  }
                : m
            )
          );

          // Don't show error toast here - DownloadProgressToast already handles it
          // Don't call fetchModels() - it would overwrite error status with not_downloaded
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const downloadModel = async (modelName: string) => {
    try {
      // Optimistically add to downloadingModels for immediate UI feedback
      setDownloadingModels((prev) => new Set([...prev, modelName]));

      await invoke('builtin_ai_download_model', { modelName });
    } catch (error) {
      console.error('Failed to download model:', error);

      // Check if this is a cancellation error (starts with "CANCELLED:")
      const errorMsg = String(error);
      if (errorMsg.startsWith('CANCELLED:')) {
        // Cancel handler already removed from downloadingModels
        // Don't show error toast for cancellations - cancel function already shows info toast
        return;
      }

      // For real errors, show toast and remove from downloading
      toast.error(`Failed to download ${modelName}`);

      setDownloadingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      // Refresh model list to get updated Error status from backend
      fetchModels();
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      await invoke('builtin_ai_cancel_download', { modelName });
      toast.info(`Download of ${modelName} cancelled`);
      setDownloadingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });
    } catch (error) {
      console.error('Failed to cancel download:', error);
    }
  };

  const deleteModel = async (modelName: string) => {
    try {
      await invoke('builtin_ai_delete_model', { modelName });
      toast.success(`Model ${modelName} deleted`);
      fetchModels();
    } catch (error) {
      console.error('Failed to delete model:', error);
      toast.error(`Failed to delete ${modelName}`);
    }
  };

  // Don't show loading spinner if we have downloads in progress - show the model list instead
  if (isLoading && downloadingModels.size === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin mb-2" />
        Loading models...
      </div>
    );
  }

  // Only show "no models" message after fetch has completed
  if (hasFetched && models.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No models found. Download a model to get started with Built-in AI.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-950">Built-in AI Models</h4>
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-xl border border-gray-200 bg-white',
          layout === 'dialog' && 'max-h-[50vh] overflow-y-auto'
        )}
      >
        {models.map((model, index) => {
          const progress = downloadProgress[model.name];
          const progressInfo = downloadProgressInfo[model.name];
          const modelIsDownloading = downloadingModels.has(model.name);
          const isAvailable = model.status.type === 'available';
          const isNotDownloaded = model.status.type === 'not_downloaded';
          const isCorrupted = model.status.type === 'corrupted';
          const isError = model.status.type === 'error';
          const guidance = getModelGuidance(model.name, usage);
          const description = getModelDescription(model, usage);
          const expanded = expandedModel === model.name;

          return (
            <div
              key={model.name}
              className={cn(
                'transition-colors',
                index > 0 && 'border-t border-gray-100',
                selectedModel === model.name ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'
              )}
            >
              <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
                <Switch
                  checked={selectedModel === model.name}
                  disabled={!isAvailable || modelIsDownloading}
                  onCheckedChange={(checked) => {
                    if (checked && isAvailable && !modelIsDownloading) {
                      onModelSelect(model.name);
                    }
                  }}
                  aria-label={`Use ${model.display_name || model.name}`}
                />
                <button
                  type="button"
                  onClick={() => setExpandedModel(expanded ? null : model.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-gray-950">{model.display_name || model.name}</span>
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
                      {selectedModel === model.name && isAvailable && (
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
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {isNotDownloaded && !modelIsDownloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadModel(model.name);
                      }}
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                  {modelIsDownloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={(event) => {
                        event.stopPropagation();
                        cancelDownload(model.name);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  {isError && !modelIsDownloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadModel(model.name);
                      }}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retry
                    </Button>
                  )}
                  {isCorrupted && !modelIsDownloading && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          downloadModel(model.name);
                        }}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteModel(model.name);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {isAvailable && !modelIsDownloading && selectedModel !== model.name && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteModel(model.name);
                      }}
                      title="Delete model"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {expanded && (
                <div className="border-t border-gray-100 px-4 pb-3 pt-3 text-sm text-gray-600">
                  {description && (
                    <p className="mb-3 max-w-3xl text-[13px] leading-5">{description}</p>
                  )}
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div className="rounded-md bg-emerald-50 p-3 text-emerald-900">
                      <p className="font-semibold">Pros</p>
                      <ul className="mt-1 space-y-1">
                        {guidance.pros.map((item) => (
                          <li key={item}>+ {item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3 text-gray-700">
                      <p className="font-semibold text-gray-900">Cons</p>
                      <ul className="mt-1 space-y-1">
                        {guidance.cons.map((item) => (
                          <li key={item}>- {item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {(isError || isCorrupted) && (
                    <p className="mt-3 text-xs text-red-600">
                      {isError && typeof model.status === 'object' && 'Error' in model.status
                        ? (model.status as any).Error
                        : isCorrupted
                          ? 'File is corrupted. Retry download or delete.'
                          : 'An error occurred'}
                    </p>
                  )}
                </div>
              )}

              {modelIsDownloading && progress !== undefined && (
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
