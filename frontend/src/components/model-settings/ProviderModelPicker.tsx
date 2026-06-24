import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ModelConfig, ModelProvider } from "@/components/model-settings/modelSettingsTypes";

interface ProviderModelPickerProps {
  modelConfig: ModelConfig;
  modelLabel: string;
  modelOptions: Record<string, string[]>;
  modelComboboxOpen: boolean;
  setModelComboboxOpen: (open: boolean) => void;
  isLoadingOpenRouter: boolean;
  isLoadingOpenAI: boolean;
  isLoadingClaude: boolean;
  isLoadingGroq: boolean;
  onProviderChange: (provider: ModelProvider) => void;
  onModelChange: (model: string) => void;
}

function providerModelsLoading({
  provider,
  isLoadingOpenRouter,
  isLoadingOpenAI,
  isLoadingClaude,
  isLoadingGroq,
}: any) {
  return (
    (provider === "openrouter" && isLoadingOpenRouter) ||
    (provider === "openai" && isLoadingOpenAI) ||
    (provider === "claude" && isLoadingClaude) ||
    (provider === "groq" && isLoadingGroq)
  );
}

export function ProviderModelPicker({
  modelConfig,
  modelLabel,
  modelOptions,
  modelComboboxOpen,
  setModelComboboxOpen,
  isLoadingOpenRouter,
  isLoadingOpenAI,
  isLoadingClaude,
  isLoadingGroq,
  onProviderChange,
  onModelChange,
}: ProviderModelPickerProps) {
  const isLoading = providerModelsLoading({
    provider: modelConfig.provider,
    isLoadingOpenRouter,
    isLoadingOpenAI,
    isLoadingClaude,
    isLoadingGroq,
  });

  return (
    <div>
      <Label>{modelLabel}</Label>
      <div className="flex space-x-2 mt-1">
        <Select
          value={modelConfig.provider}
          onValueChange={(value) => onProviderChange(value as ModelProvider)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent className="max-h-64 overflow-y-auto">
            <SelectItem value="builtin-ai">Built-in AI (Best private/offline)</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="custom-openai">Custom Server (OpenAI)</SelectItem>
            <SelectItem value="groq">Groq</SelectItem>
            <SelectItem value="ollama">Ollama</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="openrouter">OpenRouter</SelectItem>
          </SelectContent>
        </Select>

        {modelConfig.provider !== "builtin-ai" && modelConfig.provider !== "custom-openai" && (
          <Popover open={modelComboboxOpen} onOpenChange={setModelComboboxOpen} modal={true}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={modelComboboxOpen}
                className="flex-1 max-w-[200px] justify-between font-normal"
              >
                <span className="truncate">{modelConfig.model || "Select model..."}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search models..." />
                <CommandList className="max-h-[300px]">
                  {isLoading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      <RefreshCw className="mx-auto h-4 w-4 animate-spin mb-2" />
                      Loading models...
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No models found.</CommandEmpty>
                      <CommandGroup>
                        {modelOptions[modelConfig.provider]?.map((model) => (
                          <CommandItem
                            key={model}
                            value={model}
                            onSelect={(currentValue) => {
                              onModelChange(currentValue);
                              setModelComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                modelConfig.model === model ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="truncate">{model}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
