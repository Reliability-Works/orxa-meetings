import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent } from "../ui/dialog";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useImportAudio, ImportResult } from "@/hooks/useImportAudio";
import { useRouter } from "next/navigation";
import { useSidebar } from "../Sidebar/SidebarProvider";
import { useTranscriptionModels, ModelOption } from "@/hooks/useTranscriptionModels";
import { ImportAudioDialogView } from "./ImportAudioDialogView";

interface ImportAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedFile?: string | null;
  onComplete?: () => void;
}

function useImportDialogInitialization({
  fetchModels,
  modelConfigVersion,
  open,
  preselectedFile,
  reset,
  resetSelection,
  selectedLanguage,
  setSelectedLang,
  setShowAdvanced,
  setTitle,
  setTitleModifiedByUser,
  validateFile,
}: {
  fetchModels: () => void;
  modelConfigVersion: unknown;
  open: boolean;
  preselectedFile?: string | null;
  reset: () => void;
  resetSelection: () => void;
  selectedLanguage: string | null | undefined;
  setSelectedLang: (language: string) => void;
  setShowAdvanced: (show: boolean) => void;
  setTitle: (title: string) => void;
  setTitleModifiedByUser: (modified: boolean) => void;
  validateFile: (path: string) => Promise<{ filename: string } | null>;
}) {
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;

    reset();
    resetSelection();
    setTitle("");
    setTitleModifiedByUser(false);
    setSelectedLang(selectedLanguage || "auto");
    setShowAdvanced(false);

    if (preselectedFile) {
      validateFile(preselectedFile).then((info) => {
        if (info) setTitle(info.filename);
      });
    }

    fetchModels();
  }, [
    fetchModels,
    modelConfigVersion,
    open,
    preselectedFile,
    reset,
    resetSelection,
    selectedLanguage,
    setSelectedLang,
    setShowAdvanced,
    setTitle,
    setTitleModifiedByUser,
    validateFile,
  ]);
}

export function ImportAudioDialog({
  open,
  onOpenChange,
  preselectedFile,
  onComplete,
}: ImportAudioDialogProps) {
  const router = useRouter();
  const { refetchMeetings } = useSidebar();
  const { selectedLanguage, transcriptModelConfig } = useConfig();

  const [title, setTitle] = useState("");
  const [selectedLang, setSelectedLang] = useState(selectedLanguage || "auto");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [titleModifiedByUser, setTitleModifiedByUser] = useState(false);

  // Use centralized model fetching hook
  const {
    availableModels,
    selectedModelKey,
    setSelectedModelKey,
    loadingModels,
    fetchModels,
    resetSelection,
  } = useTranscriptionModels(transcriptModelConfig);

  const handleImportComplete = useCallback(
    (result: ImportResult) => {
      toast.success(`Import complete! ${result.segments_count} segments created.`);

      // Refresh meetings list then navigate to the imported meeting
      refetchMeetings();
      onComplete?.();
      onOpenChange(false);
      router.push(`/meeting-details?id=${result.meeting_id}`);
    },
    [router, refetchMeetings, onComplete, onOpenChange],
  );

  const handleImportError = useCallback((error: string) => {
    toast.error("Import failed", { description: error });
  }, []);

  const {
    status,
    fileInfo,
    progress,
    error,
    isProcessing,
    selectFile,
    validateFile,
    startImport,
    cancelImport,
    reset,
  } = useImportAudio({
    onComplete: handleImportComplete,
    onError: handleImportError,
  });

  useImportDialogInitialization({
    fetchModels,
    modelConfigVersion: transcriptModelConfig,
    open,
    preselectedFile,
    reset,
    resetSelection,
    selectedLanguage,
    setSelectedLang,
    setShowAdvanced,
    setTitle,
    setTitleModifiedByUser,
    validateFile,
  });

  // Update title when fileInfo changes
  useEffect(() => {
    if (fileInfo && !title && !titleModifiedByUser) {
      setTitle(fileInfo.filename);
    }
  }, [fileInfo, title, titleModifiedByUser]);

  const selectedModel = useMemo((): ModelOption | undefined => {
    if (!selectedModelKey) return undefined;
    const colonIndex = selectedModelKey.indexOf(":");
    if (colonIndex === -1) return undefined;
    const provider = selectedModelKey.slice(0, colonIndex);
    const name = selectedModelKey.slice(colonIndex + 1);
    return availableModels.find((m) => m.provider === provider && m.name === name);
  }, [selectedModelKey, availableModels]);
  const isParakeetModel = selectedModel?.provider === "parakeet";

  useEffect(() => {
    if (isParakeetModel && selectedLang !== "auto") {
      setSelectedLang("auto");
    }
  }, [isParakeetModel, selectedLang]);

  const handleSelectFile = async () => {
    const info = await selectFile();
    if (info) {
      setTitle(info.filename);
    }
  };

  const handleStartImport = async () => {
    if (!fileInfo) return;

    await startImport(
      fileInfo.path,
      title || fileInfo.filename,
      isParakeetModel ? null : selectedLang === "auto" ? null : selectedLang,
      selectedModel?.name || null,
      selectedModel?.provider || null,
    );
  };

  const handleCancel = async () => {
    if (isProcessing) {
      await cancelImport();
      toast.info("Import cancelled");
    }
    onOpenChange(false);
  };

  // Prevent closing during processing
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isProcessing) {
      return;
    }
    onOpenChange(newOpen);
  };

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  const handleInteractOutside = (event: Event) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    setTitleModifiedByUser(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <ImportAudioDialogView
          availableModels={availableModels}
          error={error}
          fileInfo={fileInfo}
          isParakeetModel={isParakeetModel}
          isProcessing={isProcessing}
          loadingModels={loadingModels}
          onCancel={handleCancel}
          onClose={() => onOpenChange(false)}
          onReset={reset}
          onSelectFile={handleSelectFile}
          onStartImport={handleStartImport}
          onTitleChange={handleTitleChange}
          progress={progress}
          selectedLang={selectedLang}
          selectedModelKey={selectedModelKey}
          setSelectedLang={setSelectedLang}
          setSelectedModelKey={setSelectedModelKey}
          setShowAdvanced={setShowAdvanced}
          showAdvanced={showAdvanced}
          status={status}
          title={title}
        />
      </DialogContent>
    </Dialog>
  );
}
