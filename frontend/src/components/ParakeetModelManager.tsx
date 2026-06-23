import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Download, RefreshCw, Trash2 } from 'lucide-react';
import {
  ParakeetModelInfo,
  ModelStatus,
  ParakeetAPI,
  getModelDisplayInfo,
  getModelDisplayName,
  formatFileSize
} from '../lib/parakeet';
import { Switch } from '@/components/ui/switch';

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ParakeetModelManagerProps) {
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

  // Refs for stable callbacks
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());

  // Update refs when props change
  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  // Initialize and load models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await ParakeetAPI.init();
        const modelList = await ParakeetAPI.getAvailableModels();
        setModels(modelList);

        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Parakeet:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
        toast.error('Failed to load transcription models', {
          description: err instanceof Error ? err.message : 'Unknown error',
          duration: 5000
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  // Set up event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      console.log('[ParakeetModelManager] Setting up event listeners...');

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'parakeet-model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(`[ParakeetModelManager] Progress update for ${modelName}: ${progress}%`);
            progressThrottleRef.current.set(modelName, { progress, timestamp: now });

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: { Downloading: progress } as ModelStatus }
                  : model
              )
            );
          }
        }
      );

      // Download complete
      unlistenComplete = await listen<{ modelName: string }>(
        'parakeet-model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: 'Available' as ModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.success(`${displayInfo?.icon || '✓'} ${displayName} ready!`, {
            description: 'Model downloaded and ready to use',
            duration: 4000
          });

          // Auto-select after download using stable refs
          if (onModelSelectRef.current) {
            onModelSelectRef.current(modelName);
            if (autoSaveRef.current) {
              saveModelSelection(modelName);
            }
          }
        }
      );

      // Download error
      unlistenError = await listen<{ modelName: string; error: string }>(
        'parakeet-model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: { Error: error } as ModelStatus }
                : model
            )
          );

          setDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.error(`Failed to download ${displayName}`, {
            description: error,
            duration: 6000,
            action: {
              label: 'Retry',
              onClick: () => downloadModel(modelName)
            }
          });
        }
      );
    };

    setupListeners();

    return () => {
      console.log('[ParakeetModelManager] Cleaning up event listeners...');
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, []); // Empty dependency array - listeners use refs for stable callbacks

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke('api_save_transcript_config', {
        provider: 'parakeet',
        model: modelName,
        apiKey: null
      });
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  };

  const cancelDownload = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.cancelDownload(modelName);

      setDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: 'Missing' as ModelStatus }
            : model
        )
      );

      // Clean up throttle data
      progressThrottleRef.current.delete(modelName);

      toast.info(`${displayName} download cancelled`, {
        duration: 3000
      });
    } catch (err) {
      console.error('Failed to cancel download:', err);
      toast.error('Failed to cancel download', {
        description: err instanceof Error ? err.message : 'Unknown error',
        duration: 4000
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (downloadingModels.has(modelName)) return;

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      setDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: 0 } as ModelStatus }
            : model
        )
      );

      toast.info(`Downloading ${displayName}...`, {
        description: 'This may take a few minutes',
        duration: 5000  // Auto-dismiss after 5 seconds
      });

      await ParakeetAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      setModels(prev =>
        prev.map(model =>
          model.name === modelName ? { ...model, status: { Error: errorMessage } } : model
        )
      );
    }
  };

  const selectModel = async (modelName: string) => {
    if (onModelSelect) {
      onModelSelect(modelName);
    }

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;
    toast.success(`Switched to ${displayName}`, {
      duration: 3000
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await ParakeetAPI.getAvailableModels();
      setModels(modelList);

      toast.success(`${displayName} deleted`, {
        description: 'Model removed to free up space',
        duration: 3000
      });

      // If deleted model was selected, clear selection
      if (selectedModel === modelName && onModelSelect) {
        onModelSelect('');
      }
    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error(`Failed to delete ${displayName}`, {
        description: err instanceof Error ? err.message : 'Delete failed',
        duration: 4000
      });
    }
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-100 rounded-lg"></div>
          <div className="h-20 bg-gray-100 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-800">Failed to load models</p>
        <p className="text-xs text-red-600 mt-1">{error}</p>
      </div>
    );
  }

  const recommendedModel = models.find(m =>
    m.name === 'parakeet-tdt-0.6b-v3-int8'
  );
  const otherModels = models.filter(m =>
    m.name !== 'parakeet-tdt-0.6b-v3-int8'
  );

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {recommendedModel && (
          <ModelCard
            model={recommendedModel}
            isSelected={selectedModel === recommendedModel.name}
            isRecommended={true}
            onSelect={() => {
              if (recommendedModel.status === 'Available') {
                selectModel(recommendedModel.name);
              }
            }}
            onDownload={() => downloadModel(recommendedModel.name)}
            onCancel={() => cancelDownload(recommendedModel.name)}
            onDelete={() => deleteModel(recommendedModel.name)}
            isDownloading={downloadingModels.has(recommendedModel.name)}
          />
        )}

        {otherModels.map(model => (
          <ModelCard
            key={model.name}
            model={model}
            isSelected={selectedModel === model.name}
            isRecommended={false}
            onSelect={() => {
              if (model.status === 'Available') {
                selectModel(model.name);
              }
            }}
            onDownload={() => downloadModel(model.name)}
            onCancel={() => cancelDownload(model.name)}
            onDelete={() => deleteModel(model.name)}
            isDownloading={downloadingModels.has(model.name)}
          />
        ))}
      </div>

      {/* Helper text */}
      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-gray-500 text-center pt-2"
        >
          Using {getModelDisplayName(selectedModel)} for transcription
        </motion.div>
      )}
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ParakeetModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  isDownloading
}: ModelCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayInfo = getModelDisplayInfo(model.name);
  const displayName = displayInfo?.friendlyName || model.name;
  const icon = displayInfo?.icon || '📦';
  const tagline = displayInfo?.tagline || model.description || '';

  const isAvailable = model.status === 'Available';
  const isMissing = model.status === 'Missing';
  const isError = typeof model.status === 'object' && 'Error' in model.status;
  const isCorrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
  const downloadProgress =
    typeof model.status === 'object' && 'Downloading' in model.status
      ? model.status.Downloading
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`${isSelected && isAvailable ? 'bg-gray-50' : isAvailable ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/70'} transition-colors`}
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
          {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
          <span className="text-lg leading-none">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-gray-950">{displayName}</span>
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
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-gray-500">{tagline}</span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {isAvailable && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
              Ready
            </span>
          )}

          {isMissing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              className="flex h-8 items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          )}

          {downloadProgress === null && isError && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              className="flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          )}

          {isCorrupted && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="h-8 rounded-md bg-orange-600 px-3 text-sm font-medium text-white transition-colors hover:bg-orange-700"
              >
                Delete
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="h-8 rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
              >
                Re-download
              </button>
            </>
          )}

          {isAvailable && !isSelected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"
              title="Delete model to free up space"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && displayInfo && displayInfo.pros.length > 0 && displayInfo.cons.length > 0 ? (
        <div className="border-t border-gray-100 px-4 pb-3 pt-3">
          <p className="text-[13px] leading-5 text-gray-700">{tagline}</p>
          <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-2">
            <div className="rounded-md bg-emerald-50 p-3 text-emerald-900">
              <p className="font-semibold">Pros</p>
              <ul className="mt-1 space-y-1">
                {displayInfo.pros.map((item) => (
                  <li key={item}>+ {item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md bg-gray-50 p-3 text-gray-700">
              <p className="font-semibold text-gray-900">Cons</p>
              <ul className="mt-1 space-y-1">
                {displayInfo.cons.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

        {/* Full-width Download Progress Bar - PROMINENT */}
        {downloadProgress !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-gray-100 px-4 py-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-blue-600">Downloading...</span>
                <span className="text-sm font-semibold text-blue-600">{Math.round(downloadProgress)}%</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
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
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {model.size_mb ? (
                <>
                  {formatFileSize(model.size_mb * downloadProgress / 100)} / {formatFileSize(model.size_mb)}
                </>
              ) : (
                'Downloading...'
              )}
            </p>
          </motion.div>
        )}
    </motion.div>
  );
}
