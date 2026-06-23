import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Download, RefreshCw, Trash2 } from 'lucide-react';
import {
  ModelInfo,
  ModelStatus,
  getModelIcon,
  formatFileSize,
  getModelPerformanceBadge,
  isQuantizedModel,
  getModelBaseName,
  getModelTagline,
  WhisperAPI
} from '../lib/whisper';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';

interface ModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

type WhisperModelGuidance = {
  bestLabel: string;
  pros: string[];
  cons: string[];
};

function getWhisperModelGuidance(modelName: string): WhisperModelGuidance {
  const baseName = getModelBaseName(modelName);
  const isQuantized = isQuantizedModel(modelName);

  if (baseName === 'large-v3') {
    return {
      bestLabel: isQuantized ? 'Best lower-memory accuracy option' : 'Best raw offline accuracy',
      pros: [
        'Strongest choice for important post-meeting retranscription.',
        isQuantized ? 'Lower memory footprint than full precision Large V3.' : 'Highest quality Whisper option in this list.',
      ],
      cons: [
        'Slowest local Whisper path.',
        isQuantized ? 'Quantization can lose some detail versus full precision.' : 'Largest download and memory requirement.',
      ],
    };
  }

  if (baseName === 'large-v3-turbo') {
    return {
      bestLabel: 'Best speed/accuracy compromise',
      pros: [
        'Good choice when Large V3 is too slow.',
        'Keeps high accuracy while improving turnaround time.',
      ],
      cons: [
        'Not the absolute highest-accuracy option.',
        'Still heavier than Small or Medium quantized models.',
      ],
    };
  }

  if (baseName === 'medium') {
    return {
      bestLabel: 'Best balanced smaller fallback',
      pros: [
        'Solid quality without the Large model footprint.',
        'Reasonable fallback for regular offline cleanup.',
      ],
      cons: [
        'Less accurate than Large V3 on technical terms.',
        'Still not as quick as Small/Base-class models.',
      ],
    };
  }

  if (baseName === 'small') {
    return {
      bestLabel: 'Best lightweight Whisper option',
      pros: [
        'Faster and smaller than Medium or Large models.',
        'Useful for quick rough retranscription.',
      ],
      cons: [
        'More likely to miss technical names and nuance.',
        'Not ideal for important meeting records.',
      ],
    };
  }

  return {
    bestLabel: 'Fastest Whisper fallback',
    pros: [
      'Small footprint and quick turnaround.',
      'Useful when speed matters more than transcript fidelity.',
    ],
    cons: [
      'Lower accuracy than the larger Whisper models.',
      'Use only for rough transcript passes.',
    ],
  };
}

export function ModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false
}: ModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [hasUserSelection, setHasUserSelection] = useState(false);

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

  // Load persisted downloading state from localStorage
  const getPersistedDownloadingModels = (): Set<string> => {
    try {
      const saved = localStorage.getItem('downloading-models');
      return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  };

  // Persist downloading state to localStorage
  const updateDownloadingModels = (updater: (prev: Set<string>) => Set<string>) => {
    setDownloadingModels(prev => {
      const newSet = updater(prev);
      localStorage.setItem('downloading-models', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  // Initialize models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await WhisperAPI.init();
        const modelList = await WhisperAPI.getAvailableModels();

        // Apply persisted downloading states
        const persistedDownloading = getPersistedDownloadingModels();
        const modelsWithDownloadState = modelList.map(model => {
          if (persistedDownloading.has(model.name) && model.status !== 'Available') {
            if (typeof model.status === 'object' && 'Corrupted' in model.status) {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else if (model.status === 'Missing') {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else {
              return { ...model, status: { Downloading: 0 } as ModelStatus };
            }
          }
          return model;
        });

        setModels(modelsWithDownloadState);
        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Whisper:', err);
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
      console.log('[ModelManager] Setting up event listeners...');

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(`[ModelManager] Progress update for ${modelName}: ${progress}%`);
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
        'model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const model = models.find(m => m.name === modelName);
          const displayName = getDisplayName(modelName);

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

          toast.success(`${getModelIcon(model?.accuracy || 'Good')} ${displayName} ready!`, {
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
        'model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayName = getDisplayName(modelName);

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
      console.log('[ModelManager] Cleaning up event listeners...');
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, []); // Empty dependency array - listeners use refs for stable callbacks

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke('api_save_transcript_config', {
        provider: 'localWhisper',
        model: modelName,
        apiKey: null
      });
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  };

  const cancelDownload = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.cancelDownload(modelName);

      updateDownloadingModels(prev => {
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

    const displayName = getDisplayName(modelName);

    try {
      updateDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: 0 } as ModelStatus }
            : model
        )
      );

      toast.info(`Downloading ${displayName}...`, {
        description: 'This may take a few minutes',
        duration: 5000
      });

      await WhisperAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      updateDownloadingModels(prev => {
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
    setHasUserSelection(true);

    if (onModelSelect) {
      onModelSelect(modelName);
    }

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    const displayName = getDisplayName(modelName);
    toast.success(`Switched to ${displayName}`, {
      duration: 3000
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await WhisperAPI.getAvailableModels();
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

  const getDisplayName = (modelName: string): string => {
    const modelNameMapping: { [key: string]: string } = {
      "small": "Small",
      "medium-q5_0": "Medium",
      "large-v3-q5_0": "Large V3 Compressed",
      "large-v3-turbo": "Large V3 Turbo",
      "large-v3": "Large V3"
    };

    const basicModelNames = ["small", "medium-q5_0", "large-v3-q5_0", "large-v3-turbo", "large-v3"];
    if (basicModelNames.includes(modelName)) {
      return modelNameMapping[modelName] || modelName;
    }
    return `Whisper ${modelName}`;
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-100 rounded-lg"></div>
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

  const basicModelNames = ["small", "medium-q5_0", "large-v3-q5_0", "large-v3-turbo", "large-v3"];
  const basicModels = models.filter(m => basicModelNames.includes(m.name))
    .sort((a, b) => basicModelNames.indexOf(a.name) - basicModelNames.indexOf(b.name));
  const advancedModels = models.filter(m => !basicModelNames.includes(m.name));

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Basic Models */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {basicModels.map((model) => {
          const isRecommended = model.name === 'large-v3';
          return (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={isRecommended}
              onSelect={() => {
                if (model.status === 'Available') {
                  selectModel(model.name);
                }
              }}
              onDownload={() => downloadModel(model.name)}
              onCancel={() => cancelDownload(model.name)}
              onDelete={() => deleteModel(model.name)}
              isDownloading={downloadingModels.has(model.name)}
              displayName={getDisplayName(model.name)}
              guidance={getWhisperModelGuidance(model.name)}
            />
          );
        })}
      </div>

      {/* Advanced Models */}
      {advancedModels.length > 0 && (
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="advanced-models">
            <AccordionTrigger className="py-2 text-sm font-medium text-gray-700">
              <span>Advanced Models</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
                {advancedModels.map((model) => (
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
                    displayName={getDisplayName(model.name)}
                    guidance={getWhisperModelGuidance(model.name)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Helper text */}
      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-gray-500 text-center pt-2"
        >
          Using {getDisplayName(selectedModel)} for transcription
        </motion.div>
      )}
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
  displayName: string;
  guidance: WhisperModelGuidance;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  isDownloading,
  displayName,
  guidance
}: ModelCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

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
          <span className="text-lg leading-none">{getModelIcon(model.accuracy)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-gray-950">{displayName}</span>
              {isRecommended && (
                <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Best
                </span>
              )}
              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                {guidance.bestLabel}
              </span>
              {isSelected && isAvailable && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                  Selected
                </span>
              )}
              {isQuantizedModel(model.name) && (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${getModelPerformanceBadge(model.name).color === 'green'
                  ? 'bg-green-100 text-green-700'
                  : getModelPerformanceBadge(model.name).color === 'orange'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-gray-100 text-gray-700'
                  }`}>
                  {getModelPerformanceBadge(model.name).label}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-gray-500">
              {formatFileSize(model.size_mb)} · {model.accuracy} accuracy · {model.speed} processing
            </span>
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

      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-3">
          <p className="text-[13px] leading-5 text-gray-700">
            {getModelTagline(model.name, model.speed, model.accuracy)}
          </p>
          <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-2">
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
        </div>
      )}

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
