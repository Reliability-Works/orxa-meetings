import { invoke } from "@tauri-apps/api/core";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ModelConfig, OllamaModel } from "@/components/model-settings/modelSettingsTypes";

interface OllamaModelsSectionProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  models: OllamaModel[];
  filteredModels: OllamaModel[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isLoading: boolean;
  endpointChanged: boolean;
  lastFetchedEndpoint: string;
  ollamaNotInstalled: boolean;
  isDownloading: (modelName: string) => boolean;
  getProgress: (modelName: string) => number | undefined;
  downloadRecommendedModel: () => void;
}

function RecommendedDownloadProgress({ getProgress }: any) {
  const progress = getProgress("gemma3:1b");
  if (progress === undefined) {
    return null;
  }

  return (
    <div className="bg-white rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-blue-600">Downloading gemma3:1b</span>
        <span className="text-sm font-semibold text-blue-600">{Math.round(progress)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function OllamaEmptyState({
  endpointChanged,
  ollamaNotInstalled,
  isDownloading,
  getProgress,
  downloadRecommendedModel,
}: any) {
  if (ollamaNotInstalled) {
    return (
      <div className="space-y-4">
        <Alert className="border-orange-500 bg-orange-50">
          <AlertDescription className="text-orange-800">
            Ollama is not installed or not running. Please download and install Ollama to use local
            models.
          </AlertDescription>
        </Alert>
        <Button
          variant="default"
          size="sm"
          onClick={() => invoke("open_external_url", { url: "https://ollama.com/download" })}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Download Ollama
        </Button>
        <div className="text-sm text-muted-foreground text-center">
          After installing Ollama, restart this application and click "Fetch Models" to continue.
        </div>
      </div>
    );
  }

  return (
    <>
      <Alert className="mb-4">
        <AlertDescription>
          {endpointChanged
            ? 'Endpoint changed. Click "Fetch Models" to load models from the new endpoint.'
            : 'No models found. Download a recommended model or click "Fetch Models" to load available Ollama models.'}
        </AlertDescription>
      </Alert>
      {!endpointChanged && (
        <div className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadRecommendedModel}
            disabled={isDownloading("gemma3:1b")}
            className="w-full"
          >
            {isDownloading("gemma3:1b") ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Downloading gemma3:1b...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download gemma3:1b (Recommended, ~800MB)
              </>
            )}
          </Button>
          {isDownloading("gemma3:1b") && <RecommendedDownloadProgress getProgress={getProgress} />}
        </div>
      )}
    </>
  );
}

function OllamaModelRow({ model, modelConfig, setModelConfig, isDownloading, getProgress }: any) {
  const progress = getProgress(model.name);
  const modelIsDownloading = isDownloading(model.name);

  return (
    <div
      className={cn(
        "bg-card p-2 m-0 rounded-md border transition-colors",
        modelConfig.model === model.name
          ? "ring-1 ring-blue-500 border-blue-500 background-blue-100"
          : "hover:bg-muted/50",
        !modelIsDownloading && "cursor-pointer",
      )}
      onClick={() => {
        if (!modelIsDownloading) {
          setModelConfig((prev: ModelConfig) => ({ ...prev, model: model.name }));
        }
      }}
    >
      <div>
        <b className="font-bold">{model.name}&nbsp;</b>
        <span className="text-muted-foreground">with a size of </span>
        <span className="font-mono font-bold text-sm">{model.size}</span>
      </div>
      {modelIsDownloading && progress !== undefined && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-600">Downloading...</span>
            <span className="text-sm font-semibold text-blue-600">{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function OllamaModelsSection({
  modelConfig,
  setModelConfig,
  models,
  filteredModels,
  searchQuery,
  setSearchQuery,
  isLoading,
  endpointChanged,
  lastFetchedEndpoint,
  ollamaNotInstalled,
  isDownloading,
  getProgress,
  downloadRecommendedModel,
}: OllamaModelsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-bold">Available Ollama Models</h4>
        {lastFetchedEndpoint && models.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Using:</span>
            <code className="px-2 py-1 bg-muted rounded text-xs">
              {lastFetchedEndpoint || "http://localhost:11434"}
            </code>
          </div>
        )}
      </div>
      {models.length > 0 && (
        <div className="mb-4">
          <Input
            placeholder="Search models..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full"
          />
        </div>
      )}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          <RefreshCw className="mx-auto h-8 w-8 animate-spin mb-2" />
          Loading models...
        </div>
      ) : models.length === 0 ? (
        <div className="space-y-3">
          <OllamaEmptyState
            endpointChanged={endpointChanged}
            ollamaNotInstalled={ollamaNotInstalled}
            isDownloading={isDownloading}
            getProgress={getProgress}
            downloadRecommendedModel={downloadRecommendedModel}
          />
        </div>
      ) : (
        !endpointChanged && (
          <ScrollArea className="max-h-[calc(100vh-450px)] overflow-y-auto pr-4">
            {filteredModels.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No models found matching "{searchQuery}". Try a different search term.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4">
                {filteredModels.map((model) => (
                  <OllamaModelRow
                    key={model.id}
                    model={model}
                    modelConfig={modelConfig}
                    setModelConfig={setModelConfig}
                    isDownloading={isDownloading}
                    getProgress={getProgress}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        )
      )}
    </div>
  );
}
