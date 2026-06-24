import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  FileAudio,
  Globe,
  HardDrive,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { LANGUAGES } from "@/constants/languages";
import { AudioFileInfo, ImportProgress, ImportStatus } from "@/hooks/useImportAudio";
import { ModelOption } from "@/hooks/useTranscriptionModels";

interface ImportAudioDialogViewProps {
  availableModels: ModelOption[];
  error: string | null;
  fileInfo: AudioFileInfo | null;
  isParakeetModel: boolean;
  isProcessing: boolean;
  loadingModels: boolean;
  onCancel: () => void;
  onClose: () => void;
  onReset: () => void;
  onSelectFile: () => void;
  onStartImport: () => void;
  onTitleChange: (title: string) => void;
  progress: ImportProgress | null;
  selectedLang: string;
  selectedModelKey: string;
  setSelectedLang: (value: string) => void;
  setSelectedModelKey: (value: string) => void;
  setShowAdvanced: (value: boolean) => void;
  showAdvanced: boolean;
  status: ImportStatus;
  title: string;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ImportAudioDialogView(props: ImportAudioDialogViewProps) {
  const { error, isProcessing, progress, status } = props;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ImportDialogTitle error={error} isProcessing={isProcessing} status={status} />
        </DialogTitle>
        <DialogDescription>
          <ImportDialogDescription error={error} isProcessing={isProcessing} progress={progress} />
        </DialogDescription>
      </DialogHeader>

      <ImportDialogBody {...props} />
      <ImportDialogFooter {...props} />
    </>
  );
}

function ImportDialogTitle({
  error,
  isProcessing,
  status,
}: {
  error: string | null;
  isProcessing: boolean;
  status: ImportStatus;
}) {
  if (isProcessing) {
    return (
      <>
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        Importing Audio...
      </>
    );
  }

  if (error) {
    return (
      <>
        <AlertCircle className="h-5 w-5 text-red-600" />
        Import Failed
      </>
    );
  }

  if (status === "complete") {
    return (
      <>
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        Import Complete
      </>
    );
  }

  return (
    <>
      <Upload className="h-5 w-5 text-blue-600" />
      Import Audio File
    </>
  );
}

function ImportDialogDescription({
  error,
  isProcessing,
  progress,
}: {
  error: string | null;
  isProcessing: boolean;
  progress: ImportProgress | null;
}) {
  if (isProcessing) return progress?.message || "Processing audio...";
  if (error) return "An error occurred during import";
  return "Import an audio file to create a new meeting with transcripts";
}

function ImportDialogBody(props: ImportAudioDialogViewProps) {
  const { error, isProcessing, progress } = props;

  return (
    <div className="space-y-4 py-4">
      {!isProcessing && !error && <FileSelectionSection {...props} />}
      {isProcessing && progress && <ImportProgressView progress={progress} />}
      {error && <ImportErrorView error={error} />}
    </div>
  );
}

function FileSelectionSection(props: ImportAudioDialogViewProps) {
  return (
    <>
      {props.fileInfo ? <AudioFileCard {...props} /> : <EmptyFilePicker {...props} />}
      {props.fileInfo && <AdvancedOptions {...props} />}
    </>
  );
}

function AudioFileCard({
  fileInfo,
  onSelectFile,
  onTitleChange,
  title,
}: Pick<ImportAudioDialogViewProps, "fileInfo" | "onSelectFile" | "onTitleChange" | "title">) {
  if (!fileInfo) return null;

  return (
    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <FileAudio className="h-8 w-8 text-blue-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate">{fileInfo.filename}</p>
          <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(fileInfo.duration_seconds)}
            </span>
            <span className="flex items-center gap-1">
              <HardDrive className="h-3.5 w-3.5" />
              {formatFileSize(fileInfo.size_bytes)}
            </span>
            <span className="text-blue-600 font-medium">{fileInfo.format}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700">Meeting Title</label>
        <Input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Enter meeting title"
        />
      </div>

      <Button variant="outline" size="sm" onClick={onSelectFile} className="w-full">
        Choose Different File
      </Button>
    </div>
  );
}

function EmptyFilePicker({ onSelectFile, status }: ImportAudioDialogViewProps) {
  return (
    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
      <FileAudio className="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <Button onClick={onSelectFile} disabled={status === "validating"}>
        {status === "validating" ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Validating...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Select Audio File
          </>
        )}
      </Button>
      <p className="text-sm text-gray-500 mt-2">MP4, WAV, MP3, FLAC, OGG, MKV, WebM, WMA</p>
    </div>
  );
}

function AdvancedOptions(props: ImportAudioDialogViewProps) {
  const { setShowAdvanced, showAdvanced } = props;

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between p-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>Advanced Options</span>
        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showAdvanced && (
        <div className="p-3 pt-0 space-y-4 border-t">
          <LanguageSelector {...props} />
          {props.availableModels.length > 0 && <ModelSelector {...props} />}
        </div>
      )}
    </div>
  );
}

function LanguageSelector({
  isParakeetModel,
  selectedLang,
  setSelectedLang,
}: Pick<ImportAudioDialogViewProps, "isParakeetModel" | "selectedLang" | "setSelectedLang">) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Language</span>
      </div>
      {isParakeetModel ? (
        <p className="text-xs text-muted-foreground">
          Language selection isn't supported for Parakeet. It always uses automatic detection.
        </p>
      ) : (
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
  ImportAudioDialogViewProps,
  "availableModels" | "loadingModels" | "selectedModelKey" | "setSelectedModelKey"
>) {
  return (
    <div className="space-y-2">
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
    </div>
  );
}

function ImportProgressView({ progress }: { progress: ImportProgress }) {
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

function ImportErrorView({ error }: { error: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
      <p className="text-sm text-red-800">{error}</p>
    </div>
  );
}

function ImportDialogFooter({
  error,
  fileInfo,
  isProcessing,
  onCancel,
  onClose,
  onReset,
  onStartImport,
}: ImportAudioDialogViewProps) {
  return (
    <DialogFooter>
      {!isProcessing && !error && (
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onStartImport}
            className="bg-blue-600 hover:bg-blue-700"
            disabled={!fileInfo}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
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
          <Button onClick={onReset} variant="outline">
            Try Again
          </Button>
        </>
      )}
    </DialogFooter>
  );
}
