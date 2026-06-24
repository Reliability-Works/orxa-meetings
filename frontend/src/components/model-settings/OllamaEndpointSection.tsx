import { CheckCircle2, ChevronDown, ChevronUp, RefreshCw, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface OllamaEndpointSectionProps {
  endpoint: string;
  endpointChanged: boolean;
  error: string;
  isLoading: boolean;
  endpointValidationState: "valid" | "invalid" | "none";
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  onEndpointChange: (value: string) => void;
  fetchModels: () => void;
}

export function OllamaEndpointSection({
  endpoint,
  endpointChanged,
  error,
  isLoading,
  endpointValidationState,
  isCollapsed,
  setIsCollapsed,
  onEndpointChange,
  fetchModels,
}: OllamaEndpointSectionProps) {
  return (
    <div>
      <div
        className="flex items-center justify-between cursor-pointer py-2"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <Label className="cursor-pointer">Custom Endpoint (optional)</Label>
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {!isCollapsed && (
        <>
          <p className="text-sm text-muted-foreground mt-1 mb-2">
            Leave empty or enter a custom endpoint (e.g., http://x.yy.zz:11434)
          </p>
          <div className="flex gap-2 mt-1">
            <div className="relative flex-1">
              <Input
                type="url"
                value={endpoint}
                onChange={(event) => onEndpointChange(event.target.value)}
                placeholder="http://localhost:11434"
                className={cn("pr-10", endpointValidationState === "invalid" && "border-red-500")}
              />
              {endpointValidationState === "valid" && (
                <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-green-500" />
              )}
              {endpointValidationState === "invalid" && (
                <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
              )}
            </div>
            <Button
              type="button"
              size={"sm"}
              onClick={fetchModels}
              disabled={isLoading}
              variant="outline"
              className="whitespace-nowrap"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Fetch Models
                </>
              )}
            </Button>
          </div>
          {endpointChanged && !error && (
            <Alert className="mt-3 border-yellow-500 bg-yellow-50">
              <AlertDescription className="text-yellow-800">
                Endpoint changed. Please click "Fetch Models" to load models from the new endpoint
                before saving.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
