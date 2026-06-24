import React, { useState, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent } from "../ui/dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useTranscriptionModels, ModelOption } from "@/hooks/useTranscriptionModels";
import Analytics from "@/lib/analytics";
import { RetranscribeDialogView } from "./RetranscribeDialogView";
import { RetranscriptionProgress, useRetranscriptionEvents } from "./useRetranscriptionEvents";

interface RetranscribeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  meetingFolderPath: string | null;
  onComplete?: () => void;
}

export function RetranscribeDialog({
  open,
  onOpenChange,
  meetingId,
  meetingFolderPath,
  onComplete,
}: RetranscribeDialogProps) {
  const { selectedLanguage, transcriptModelConfig } = useConfig();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<RetranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState(selectedLanguage || "auto");

  const {
    availableModels,
    selectedModelKey,
    setSelectedModelKey,
    loadingModels,
    fetchModels,
    resetSelection,
  } = useTranscriptionModels(transcriptModelConfig);

  const onCompleteRef = useRef(onComplete);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const prevOpenRef = useRef(false);

  const selectedModelDetails = useMemo((): ModelOption | undefined => {
    if (!selectedModelKey) return undefined;
    const colonIndex = selectedModelKey.indexOf(":");
    if (colonIndex === -1) return undefined;
    const provider = selectedModelKey.slice(0, colonIndex);
    const name = selectedModelKey.slice(colonIndex + 1);
    return availableModels.find((m) => m.provider === provider && m.name === name);
  }, [selectedModelKey, availableModels]);
  const isParakeetModel = selectedModelDetails?.provider === "parakeet";

  useEffect(() => {
    if (isParakeetModel && selectedLang !== "auto") {
      setSelectedLang("auto");
    }
  }, [isParakeetModel, selectedLang]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (open && !wasOpen) {
      resetSelection();
      setIsProcessing(false);
      setProgress(null);
      setError(null);
      setSelectedLang(selectedLanguage || "auto");

      fetchModels();
    }
  }, [open, selectedLanguage, transcriptModelConfig, fetchModels]);

  useRetranscriptionEvents({
    meetingId,
    onCompleteRef,
    onOpenChangeRef,
    open,
    setError,
    setIsProcessing,
    setProgress,
  });

  const handleStartRetranscription = async () => {
    if (!meetingFolderPath) {
      setError("Meeting folder path not available");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress(null);

    try {
      const languageToSend = isParakeetModel ? null : selectedLang === "auto" ? null : selectedLang;
      await Analytics.track("enhance_transcript_started", {
        language: isParakeetModel ? "auto" : selectedLang === "auto" ? "auto" : selectedLang,
        model_provider: selectedModelDetails?.provider || "",
        model_name: selectedModelDetails?.name || "",
      });

      await invoke("start_retranscription_command", {
        meetingId,
        meetingFolderPath,
        language: languageToSend,
        model: selectedModelDetails?.name || null,
        provider: selectedModelDetails?.provider || null,
      });
    } catch (err: any) {
      setIsProcessing(false);
      const errorMsg = typeof err === "string" ? err : err?.message || String(err);
      setError(errorMsg);

      await Analytics.trackError("enhance_transcript_failed", errorMsg);
    }
  };

  const handleCancel = async () => {
    if (isProcessing) {
      try {
        await invoke("cancel_retranscription_command");
        setIsProcessing(false);
        setProgress(null);
        toast.info("Retranscription cancelled");
      } catch (err) {
        console.error("Failed to cancel retranscription:", err);
      }
    }
    onOpenChange(false);
  };

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[450px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <RetranscribeDialogView
          availableModels={availableModels}
          error={error}
          isParakeetModel={isParakeetModel}
          isProcessing={isProcessing}
          loadingModels={loadingModels}
          meetingFolderPath={meetingFolderPath}
          onCancel={handleCancel}
          onClose={() => onOpenChange(false)}
          onResetError={() => {
            setError(null);
            setProgress(null);
          }}
          onStart={handleStartRetranscription}
          progress={progress}
          selectedLang={selectedLang}
          selectedModelKey={selectedModelKey}
          setSelectedLang={setSelectedLang}
          setSelectedModelKey={setSelectedModelKey}
        />
      </DialogContent>
    </Dialog>
  );
}
