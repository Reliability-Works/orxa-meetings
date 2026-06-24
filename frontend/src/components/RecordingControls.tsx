"use client";

import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";
import { SummaryResponse } from "@/types/summary";
import Analytics from "@/lib/analytics";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { RecordingControlsView } from "./RecordingControlsView";
import { useRecordingControlEvents } from "./useRecordingControlEvents";

interface RecordingControlsProps {
  isRecording: boolean;
  barHeights: string[];
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: SummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

function startRecordingErrorDetails(error: unknown) {
  const errorMsg = error instanceof Error ? error.message : String(error);

  if (errorMsg.includes("microphone") || errorMsg.includes("mic") || errorMsg.includes("input")) {
    return {
      title: "Microphone Not Available",
      message:
        "Unable to access your microphone. Please check that:\n• Your microphone is connected\n• The app has microphone permissions\n• No other app is using the microphone",
    };
  }

  if (
    errorMsg.includes("system audio") ||
    errorMsg.includes("speaker") ||
    errorMsg.includes("output")
  ) {
    return {
      title: "System Audio Not Available",
      message:
        "Unable to capture system audio. Please check that:\n• A virtual audio device (like BlackHole) is installed\n• The app has screen recording permissions (macOS)\n• System audio is properly configured",
    };
  }

  if (errorMsg.includes("permission")) {
    return {
      title: "Permission Required",
      message:
        "Recording permissions are required. Please:\n• Grant microphone access in System Settings\n• Grant screen recording access for system audio (macOS)\n• Restart the app after granting permissions",
    };
  }

  return {
    title: "Recording Failed",
    message: "Unable to start recording. Please check your audio device settings and try again.",
  };
}

function isNoRecordingInProgressError(error: unknown) {
  if (error instanceof Error) return error.message.includes("No recording in progress");
  if (typeof error === "string") return error.includes("No recording in progress");
  return Boolean(
    error && typeof error === "object" && String(error).includes("No recording in progress"),
  );
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  barHeights,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;

  const showPlayback = false;
  const [isProcessing, setIsProcessing] = useState(false);
  const isStarting = false;
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const isValidatingModel = false;
  const [deviceError, setDeviceError] = useState<{ title: string; message: string } | null>(null);

  const currentTime = 0;
  const duration = 0;
  const progress = 0;

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke("is_recording");
        console.log("Tauri is initialized and ready, is_recording result:", result);
      } catch (error) {
        console.error("Tauri initialization error:", error);
        alert("Failed to initialize recording. Please check the console for details.");
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isValidatingModel) return;
    console.log("Starting recording...");
    console.log("Selected devices:", selectedDevices);
    console.log("Meeting name:", meetingName);
    console.log("Current isRecording state:", isRecording);

    try {
      // Call the validation callback which will:
      // 1. Check if model is ready
      // 2. Show appropriate toast/modal
      // 3. Call backend if valid
      // 4. Update UI state
      await onRecordingStart();
    } catch (error) {
      console.error("Failed to start recording:", error);
      console.error("Error details:", {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "Unknown",
        stack: error instanceof Error ? error.stack : undefined,
      });

      setDeviceError(startRecordingErrorDetails(error));
    }
  }, [onRecordingStart, isStarting, isValidatingModel, selectedDevices, meetingName, isRecording]);

  const stopRecordingAction = useCallback(async () => {
    console.log("Executing stop recording...");
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log("Saving recording to:", savePath);
      console.log("About to call stop_recording command");
      const result = await invoke("stop_recording", {
        args: {
          save_path: savePath,
        },
      });
      console.log("stop_recording command completed successfully:", result);
      // setShowPlayback(true);
      setIsProcessing(false);
      // Track successful transcription
      Analytics.trackTranscriptionSuccess();
      onRecordingStop(true);
    } catch (error) {
      console.error("Failed to stop recording:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
      }
      if (isNoRecordingInProgressError(error)) return;
      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log(
      "handleStopRecording called - isRecording:",
      isRecording,
      "isStarting:",
      isStarting,
      "isStopping:",
      isStopping,
    );
    if (!isRecording || isStarting || isStopping) {
      console.log("Early return from handleStopRecording due to state check");
      return;
    }

    console.log("Stopping recording...");

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    // Immediately trigger the stop action
    await stopRecordingAction();
  }, [isRecording, isStarting, isStopping, stopRecordingAction, onStopInitiated]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log("Pausing recording...");
    setIsPausing(true);

    try {
      await invoke("pause_recording");
      // isPaused state now managed by RecordingStateContext via events
      console.log("Recording paused successfully");
    } catch (error) {
      console.error("Failed to pause recording:", error);
      alert("Failed to pause recording. Please check the console for details.");
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log("Resuming recording...");
    setIsResuming(true);

    try {
      await invoke("resume_recording");
      // isPaused state now managed by RecordingStateContext via events
      console.log("Recording resumed successfully");
    } catch (error) {
      console.error("Failed to resume recording:", error);
      alert("Failed to resume recording. Please check the console for details.");
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useRecordingControlEvents({
    onRecordingStop,
    onTranscriptionError,
    setIsProcessing,
  });

  return (
    <RecordingControlsView
      barHeights={barHeights}
      currentTime={currentTime}
      deviceError={deviceError}
      duration={duration}
      isParentProcessing={isParentProcessing}
      isPaused={isPaused}
      isPausing={isPausing}
      isProcessing={isProcessing}
      isRecording={isRecording}
      isRecordingDisabled={isRecordingDisabled}
      isResuming={isResuming}
      isStarting={isStarting}
      isStopping={isStopping}
      isValidatingModel={isValidatingModel}
      onDismissDeviceError={() => setDeviceError(null)}
      onPauseRecording={handlePauseRecording}
      onResumeRecording={handleResumeRecording}
      onStartRecording={handleStartRecording}
      onStopRecording={handleStopRecording}
      progress={progress}
      showPlayback={showPlayback}
    />
  );
};
