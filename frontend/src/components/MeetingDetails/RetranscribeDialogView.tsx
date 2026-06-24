import React from "react";
import { AlertCircle, Cpu, Globe, Loader2, RefreshCw, X } from "lucide-react";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { LANGUAGES } from "@/constants/languages";
import { ModelOption } from "@/hooks/useTranscriptionModels";
import { RetranscriptionProgress } from "./useRetranscriptionEvents";

interface RetranscribeDialogViewProps {
  availableModels: ModelOption[];
  error: string | null;
  isParakeetModel: boolean;
  isProcessing: boolean;
  loadingModels: boolean;
  meetingFolderPath: string | null;
  onCancel: () => void;
  onClose: () => void;
  onResetError: () => void;
  onStart: () => void;
  progress: RetranscriptionProgress | null;
  selectedLang: string;
  selectedModelKey: string;
  setSelectedLang: (value: string) => void;
  setSelectedModelKey: (value: string) => void;
}

export function RetranscribeDialogView(props: RetranscribeDialogViewProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <RetranscribeTitle error={props.error} isProcessing={props.isProcessing} />
        </DialogTitle>
        <DialogDescription>
          <RetranscribeDescription
            error={props.error}
            isProcessing={props.isProcessing}
            progress={props.progress}
          />
        </DialogDescription>
      </DialogHeader>

      <RetranscribeBody {...props} />
      <RetranscribeFooter {...props} />
    </>
  );
}

function RetranscribeTitle({
  error,
  isProcessing,
}: {
  error: string | null;
  isProcessing: boolean;
}) {
  if (isProcessing) {
    return (
      <>
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        Retranscribing...
      </>
    );
  }

  if (error) {
    return (
      <>
        <AlertCircle className="h-5 w-5 text-red-600" />
        Retranscription Failed
      </>
    );
  }

  return (
    <>
      <RefreshCw className="h-5 w-5 text-blue-600" />
      Retranscribe Meeting
    </>
  );
}

function RetranscribeDescription({
  error,
  isProcessing,
  progress,
}: {
  error: string | null;
  isProcessing: boolean;
  progress: RetranscriptionProgress | null;
}) {
  if (isProcessing) return progress?.message || "Processing audio...";
  if (error) return "An error occurred during retranscription";
  return "Re-process the audio with different language settings";
}

function RetranscribeBody(props: RetranscribeDialogViewProps) {
  return (
    <div className="space-y-4 py-4">
      {!props.isProcessing && !props.error && <RetranscribeOptions {...props} />}
      {props.isProcessing && props.progress && <RetranscribeProgress progress={props.progress} />}
      {props.error && <RetranscribeError error={props.error} />}
    </div>
  );
}

function RetranscribeOptions(props: RetranscribeDialogViewProps) {
  return (
    <>
      <LanguageSelector {...props} />
      {props.availableModels.length > 0 && <ModelSelector {...props} />}
    </>
  );
}

function LanguageSelector({
  isParakeetModel,
  selectedLang,
  setSelectedLang,
}: Pick<RetranscribeDialogViewProps, "isParakeetModel" | "selectedLang" | "setSelectedLang">) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Language</span>
      </div>
      {isParakeetModel ? (
        <p className="text-xs text-muted-foreground">
          Language selection isn't supported for Parakeet. It always uses automatic detection.
        </p>
      ) : (
        <>
          <Select value={selectedLang} onValueChange={setSelectedLang}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Select a specific language to improve accuracy, or use auto-detect
          </p>
        </>
      )}
    </div>
  );
}

function ModelSelector({
  availableModels,
  loadingModels,
  selectedModelKey,
  setSelectedModelKey,
}: Pick<
  RetranscribeDialogViewProps,
  "availableModels" | "loadingModels" | "selectedModelKey" | "setSelectedModelKey"
>) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Model</span>
      </div>
      <Select value={selectedModelKey} onValueChange={setSelectedModelKey} disabled={loadingModels}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={loadingModels ? "Loading models..." : "Select model"} />
        </SelectTrigger>
        <SelectContent>
          {availableModels.map((model) => (
            <SelectItem
              key={`${model.provider}:${model.name}`}
              value={`${model.provider}:${model.name}`}
            >
              {model.displayName} ({Math.round(model.size_mb)} MB)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Choose a transcription model</p>
    </div>
  );
}

function RetranscribeProgress({ progress }: { progress: RetranscriptionProgress }) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.min(progress.progress_percentage, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-1">
          <span>{progress.stage}</span>
          <span>{Math.round(progress.progress_percentage)}%</span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground text-center">{progress.message}</p>
    </div>
  );
}

function RetranscribeError({ error }: { error: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
      <p className="text-sm text-red-800">{error}</p>
    </div>
  );
}

function RetranscribeFooter({
  error,
  isProcessing,
  meetingFolderPath,
  onCancel,
  onClose,
  onResetError,
  onStart,
}: RetranscribeDialogViewProps) {
  return (
    <DialogFooter>
      {!isProcessing && !error && (
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onStart}
            className="bg-blue-600 hover:bg-blue-700"
            disabled={!meetingFolderPath}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Start Retranscription
          </Button>
        </>
      )}
      {isProcessing && (
        <Button variant="outline" onClick={onCancel}>
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
      )}
      {error && (
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onResetError} variant="outline">
            Try Again
          </Button>
        </>
      )}
    </DialogFooter>
  );
}
