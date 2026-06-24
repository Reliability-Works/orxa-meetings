import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ApiKeySectionProps {
  apiKey: string | null;
  setApiKey: (key: string) => void;
  showApiKey: boolean;
  setShowApiKey: (show: boolean) => void;
  isApiKeyLocked: boolean;
  setIsApiKeyLocked: (locked: boolean) => void;
  isLockButtonVibrating: boolean;
  onInputClick: () => void;
}

export function ApiKeySection({
  apiKey,
  setApiKey,
  showApiKey,
  setShowApiKey,
  isApiKeyLocked,
  setIsApiKeyLocked,
  isLockButtonVibrating,
  onInputClick,
}: ApiKeySectionProps) {
  return (
    <div>
      <Label>API Key</Label>
      <div className="relative mt-1">
        <Input
          type={showApiKey ? "text" : "password"}
          value={apiKey || ""}
          onChange={(event) => setApiKey(event.target.value)}
          disabled={isApiKeyLocked}
          placeholder="Enter your API key"
          className="pr-24"
        />
        {isApiKeyLocked && apiKey?.trim() && (
          <div
            onClick={onInputClick}
            className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-md cursor-not-allowed"
          />
        )}
        <div className="absolute inset-y-0 right-0 pr-1 flex items-center space-x-1">
          {apiKey?.trim() && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
              className={isLockButtonVibrating ? "animate-vibrate text-red-500" : ""}
              title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
            >
              {isApiKeyLocked ? <Lock /> : <Unlock />}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>
    </div>
  );
}
