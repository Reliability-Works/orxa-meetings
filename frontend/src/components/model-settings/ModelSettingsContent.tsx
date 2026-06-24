import { Button } from "@/components/ui/button";
import { BuiltInModelManager } from "@/components/BuiltInModelManager";
import { cn } from "@/lib/utils";
import { ApiKeySection } from "@/components/model-settings/ApiKeySection";
import { CustomOpenAISection } from "@/components/model-settings/CustomOpenAISection";
import { OllamaEndpointSection } from "@/components/model-settings/OllamaEndpointSection";
import { OllamaModelsSection } from "@/components/model-settings/OllamaModelsSection";
import { ProviderGuidancePanel } from "@/components/model-settings/ProviderGuidancePanel";
import { ProviderModelPicker } from "@/components/model-settings/ProviderModelPicker";

interface ModelSettingsContentProps {
  controller: any;
}

export function ModelSettingsContent({ controller }: ModelSettingsContentProps) {
  const {
    modelConfig,
    setModelConfig,
    heading,
    modelLabel,
    layout,
    usage,
    modelOptions,
    modelComboboxOpen,
    setModelComboboxOpen,
    cloud,
    custom,
    apiKeySettings,
    ollama,
    providerGuidance,
    isProviderGuidanceOpen,
    setIsProviderGuidanceOpen,
    isDoneDisabled,
    handleProviderChange,
    handleSave,
  } = controller;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{heading}</h3>
      </div>

      <div className="space-y-4">
        <div>
          <ProviderModelPicker
            modelConfig={modelConfig}
            modelLabel={modelLabel}
            modelOptions={modelOptions}
            modelComboboxOpen={modelComboboxOpen}
            setModelComboboxOpen={setModelComboboxOpen}
            isLoadingOpenRouter={cloud.isLoadingOpenRouter}
            isLoadingOpenAI={cloud.isLoadingOpenAI}
            isLoadingClaude={cloud.isLoadingClaude}
            isLoadingGroq={cloud.isLoadingGroq}
            onProviderChange={handleProviderChange}
            onModelChange={(model: string) => setModelConfig((prev: any) => ({ ...prev, model }))}
          />
          <ProviderGuidancePanel
            provider={modelConfig.provider}
            guidance={providerGuidance}
            isOpen={isProviderGuidanceOpen}
            onToggle={() => setIsProviderGuidanceOpen((open: boolean) => !open)}
          />
        </div>

        {modelConfig.provider === "custom-openai" && <CustomOpenAISection custom={custom} />}
        {apiKeySettings.requiresApiKey && <ApiKeySection {...apiKeySettings} />}
        {modelConfig.provider === "ollama" && (
          <>
            <OllamaEndpointSection
              endpoint={ollama.endpoint}
              endpointChanged={ollama.endpointChanged}
              error={ollama.error}
              isLoading={ollama.isLoading}
              endpointValidationState={ollama.endpointValidationState}
              isCollapsed={ollama.isEndpointSectionCollapsed}
              setIsCollapsed={ollama.setIsEndpointSectionCollapsed}
              onEndpointChange={ollama.handleEndpointChange}
              fetchModels={() => ollama.fetchModels()}
            />
            <OllamaModelsSection
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              models={ollama.models}
              filteredModels={ollama.filteredModels}
              searchQuery={ollama.searchQuery}
              setSearchQuery={ollama.setSearchQuery}
              isLoading={ollama.isLoading}
              endpointChanged={ollama.endpointChanged}
              lastFetchedEndpoint={ollama.lastFetchedEndpoint}
              ollamaNotInstalled={ollama.ollamaNotInstalled}
              isDownloading={ollama.isDownloading}
              getProgress={ollama.getProgress}
              downloadRecommendedModel={ollama.downloadRecommendedModel}
            />
          </>
        )}

        {modelConfig.provider === "builtin-ai" && (
          <div className="mt-6">
            <BuiltInModelManager
              selectedModel={modelConfig.model}
              layout={layout}
              usage={usage}
              onModelSelect={(model) => setModelConfig((prev: any) => ({ ...prev, model }))}
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          className={cn(
            "px-4 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
            isDoneDisabled ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700",
          )}
          onClick={handleSave}
          disabled={isDoneDisabled}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
