import { CheckCircle2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CustomOpenAISectionProps {
  custom: any;
}

export function CustomOpenAISection({ custom }: CustomOpenAISectionProps) {
  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <Label htmlFor="custom-endpoint">Endpoint URL *</Label>
        <Input
          id="custom-endpoint"
          value={custom.endpoint}
          onChange={(event) => custom.setEndpoint(event.target.value)}
          placeholder="http://localhost:8000/v1"
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">Base URL of the OpenAI-compatible API</p>
      </div>

      <div>
        <Label htmlFor="custom-model">Model Name *</Label>
        <Input
          id="custom-model"
          value={custom.model}
          onChange={(event) => custom.setModel(event.target.value)}
          placeholder="gpt-4, llama-3-70b, etc."
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">Model identifier to use for requests</p>
      </div>

      <div>
        <Label htmlFor="custom-api-key">API Key (optional)</Label>
        <Input
          id="custom-api-key"
          type="password"
          value={custom.apiKey}
          onChange={(event) => custom.setApiKey(event.target.value)}
          placeholder="Leave empty if not required"
          className="mt-1"
        />
      </div>

      <div>
        <div
          className="flex items-center justify-between cursor-pointer py-2"
          onClick={() => custom.setIsAdvancedOpen(!custom.isAdvancedOpen)}
        >
          <Label className="cursor-pointer">Advanced Options</Label>
          {custom.isAdvancedOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {custom.isAdvancedOpen && (
          <div className="space-y-3 pl-2 border-l-2 border-muted mt-2">
            <div>
              <Label htmlFor="custom-max-tokens">Max Tokens</Label>
              <Input
                id="custom-max-tokens"
                type="number"
                value={custom.maxTokens}
                onChange={(event) => custom.setMaxTokens(event.target.value)}
                placeholder="e.g., 4096"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="custom-temperature">Temperature (0.0-2.0)</Label>
              <Input
                id="custom-temperature"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={custom.temperature}
                onChange={(event) => custom.setTemperature(event.target.value)}
                placeholder="e.g., 0.7"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="custom-top-p">Top P (0.0-1.0)</Label>
              <Input
                id="custom-top-p"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={custom.topP}
                onChange={(event) => custom.setTopP(event.target.value)}
                placeholder="e.g., 0.9"
                className="mt-1"
              />
            </div>
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={custom.testConnection}
        disabled={custom.isTestingConnection || !custom.endpoint.trim() || !custom.model.trim()}
        className="w-full"
      >
        {custom.isTestingConnection ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Testing Connection...
          </>
        ) : (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Test Connection
          </>
        )}
      </Button>
    </div>
  );
}
