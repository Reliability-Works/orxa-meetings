"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { BuiltInModelCard } from "@/components/model-settings/BuiltInModelCard";
import { ModelSettingsUsage } from "@/components/model-settings/builtinModelTypes";
import { useBuiltInModelManager } from "@/components/model-settings/useBuiltInModelManager";

interface BuiltInModelManagerProps {
  selectedModel: string;
  onModelSelect: (model: string) => void;
  layout?: "inline" | "dialog";
  usage?: ModelSettingsUsage;
}

export function BuiltInModelManager({
  selectedModel,
  onModelSelect,
  layout = "inline",
  usage = "summary",
}: BuiltInModelManagerProps) {
  const {
    models,
    isLoading,
    hasFetched,
    downloadProgress,
    downloadProgressInfo,
    downloadingModels,
    expandedModel,
    setExpandedModel,
    downloadModel,
    cancelDownload,
    deleteModel,
  } = useBuiltInModelManager({ selectedModel, onModelSelect });

  if (isLoading && downloadingModels.size === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <RefreshCw className="mx-auto h-8 w-8 animate-spin mb-2" />
        Loading models...
      </div>
    );
  }

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
          "overflow-hidden rounded-xl border border-gray-200 bg-white",
          layout === "dialog" && "max-h-[50vh] overflow-y-auto",
        )}
      >
        {models.map((model, index) => (
          <BuiltInModelCard
            key={model.name}
            model={model}
            index={index}
            selectedModel={selectedModel}
            usage={usage}
            progress={downloadProgress[model.name]}
            progressInfo={downloadProgressInfo[model.name]}
            isDownloading={downloadingModels.has(model.name)}
            expanded={expandedModel === model.name}
            onToggle={() => setExpandedModel(expandedModel === model.name ? null : model.name)}
            onSelect={onModelSelect}
            onDownload={downloadModel}
            onCancel={cancelDownload}
            onDelete={deleteModel}
          />
        ))}
      </div>
    </div>
  );
}
