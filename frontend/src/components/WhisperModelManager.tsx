import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { WhisperModelCard } from "@/components/model-settings/WhisperModelCard";
import { useWhisperModelManager } from "@/components/model-settings/useWhisperModelManager";
import {
  BASIC_WHISPER_MODEL_NAMES,
  getWhisperDisplayName,
  getWhisperModelGuidance,
} from "@/components/model-settings/whisperModelGuidance";

interface ModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

function sortedBasicModels(models: any[]) {
  return models
    .filter((model) => BASIC_WHISPER_MODEL_NAMES.includes(model.name))
    .sort(
      (left, right) =>
        BASIC_WHISPER_MODEL_NAMES.indexOf(left.name) -
        BASIC_WHISPER_MODEL_NAMES.indexOf(right.name),
    );
}

export function ModelManager({
  selectedModel,
  onModelSelect,
  className = "",
  autoSave = false,
}: ModelManagerProps) {
  const {
    models,
    loading,
    error,
    downloadingModels,
    selectModel,
    downloadModel,
    cancelDownload,
    deleteModel,
  } = useWhisperModelManager({ selectedModel, onModelSelect, autoSave });

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

  const basicModels = sortedBasicModels(models);
  const advancedModels = models.filter((model) => !BASIC_WHISPER_MODEL_NAMES.includes(model.name));

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {basicModels.map((model) => (
          <WhisperModelCard
            key={model.name}
            model={model}
            isSelected={selectedModel === model.name}
            isRecommended={model.name === "large-v3"}
            onSelect={() => {
              if (model.status === "Available") {
                selectModel(model.name);
              }
            }}
            onDownload={() => downloadModel(model.name)}
            onCancel={() => cancelDownload(model.name)}
            onDelete={() => deleteModel(model.name)}
            isDownloading={downloadingModels.has(model.name)}
            displayName={getWhisperDisplayName(model.name)}
            guidance={getWhisperModelGuidance(model.name)}
          />
        ))}
      </div>

      {advancedModels.length > 0 && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="advanced-models">
            <AccordionTrigger className="py-2 text-sm font-medium text-gray-700">
              <span>Advanced Models</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
                {advancedModels.map((model) => (
                  <WhisperModelCard
                    key={model.name}
                    model={model}
                    isSelected={selectedModel === model.name}
                    isRecommended={false}
                    onSelect={() => {
                      if (model.status === "Available") {
                        selectModel(model.name);
                      }
                    }}
                    onDownload={() => downloadModel(model.name)}
                    onCancel={() => cancelDownload(model.name)}
                    onDelete={() => deleteModel(model.name)}
                    isDownloading={downloadingModels.has(model.name)}
                    displayName={getWhisperDisplayName(model.name)}
                    guidance={getWhisperModelGuidance(model.name)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-gray-500 text-center pt-2"
        >
          Using {getWhisperDisplayName(selectedModel)} for transcription
        </motion.div>
      )}
    </div>
  );
}
