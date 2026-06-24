import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import Analytics from "@/lib/analytics";

interface UseRecordingControlEventsOptions {
  onRecordingStop: (callApi?: boolean) => void;
  onTranscriptionError?: (message: string) => void;
  setIsProcessing: (isProcessing: boolean) => void;
}

export function useRecordingControlEvents({
  onRecordingStop,
  onTranscriptionError,
  setIsProcessing,
}: UseRecordingControlEventsOptions) {
  useEffect(() => {
    console.log("Setting up recording event listeners");
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        const transcriptErrorUnsubscribe = await listen("transcript-error", (event) => {
          const errorMessage = event.payload as string;
          console.log("transcript-error event received:", event);
          handleTranscriptionFailure(errorMessage, setIsProcessing, onRecordingStop);
          onTranscriptionError?.(errorMessage);
        });

        const transcriptionErrorUnsubscribe = await listen("transcription-error", (event) => {
          const errorMessage = transcriptionErrorMessage(event.payload);
          console.log("transcription-error event received:", event);
          handleTranscriptionFailure(errorMessage, setIsProcessing, onRecordingStop);
        });

        unsubscribes = [transcriptErrorUnsubscribe, transcriptionErrorUnsubscribe];
        console.log("Recording event listeners set up successfully");
      } catch (error) {
        console.error("Failed to set up recording event listeners:", error);
      }
    };

    setupListeners();

    return () => {
      console.log("Cleaning up recording event listeners");
      unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [onRecordingStop, onTranscriptionError, setIsProcessing]);
}

function handleTranscriptionFailure(
  errorMessage: string,
  setIsProcessing: (isProcessing: boolean) => void,
  onRecordingStop: (callApi?: boolean) => void,
) {
  console.error("Transcription error received:", errorMessage);
  Analytics.trackTranscriptionError(errorMessage);
  setIsProcessing(false);
  onRecordingStop(false);
}

function transcriptionErrorMessage(payload: unknown) {
  if (typeof payload === "object" && payload !== null) {
    const structuredPayload = payload as {
      error: string;
      userMessage: string;
    };
    return structuredPayload.userMessage || structuredPayload.error;
  }

  return String(payload);
}
