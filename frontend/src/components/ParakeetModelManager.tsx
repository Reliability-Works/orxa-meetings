import { motion } from "framer-motion";
import { ParakeetModelCard } from "@/components/model-settings/ParakeetModelCard";
import { useParakeetModelManager } from "@/components/model-settings/useParakeetModelManager";
import { getModelDisplayName } from "@/lib/parakeet";

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = "",
  autoSave = false,
}: ParakeetModelManagerProps) {
  const {
    models,
    loading,
    error,
    downloadingModels,
    selectModel,
    downloadModel,
    cancelDownload,
    deleteModel,
  } = useParakeetModelManager({ selectedModel, onModelSelect, autoSave });

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

  const recommendedModel = models.find((model) => model.name === "parakeet-tdt-0.6b-v3-int8");
  const otherModels = models.filter((model) => model.name !== "parakeet-tdt-0.6b-v3-int8");

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {recommendedModel && (
          <ParakeetModelCard
            model={recommendedModel}
            isSelected={selectedModel === recommendedModel.name}
            isRecommended={true}
            onSelect={() => {
              if (recommendedModel.status === "Available") {
                selectModel(recommendedModel.name);
              }
            }}
            onDownload={() => downloadModel(recommendedModel.name)}
            onCancel={() => cancelDownload(recommendedModel.name)}
            onDelete={() => deleteModel(recommendedModel.name)}
            isDownloading={downloadingModels.has(recommendedModel.name)}
          />
        )}

        {otherModels.map((model) => (
          <ParakeetModelCard
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
          />
        ))}
      </div>

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
