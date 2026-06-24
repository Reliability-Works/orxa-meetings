import { useState, useEffect, useCallback } from "react";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState, RecordingStatus } from "@/contexts/RecordingStateContext";
import Analytics from "@/lib/analytics";
import {
  ensureRecordingModelReady,
  RecordingStartLocation,
  startRecordingSession,
} from "./recordingStartHelpers";

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Analytics tracking
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: "modelSelector", message?: string) => void,
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  const startSession = useCallback(
    async (location: RecordingStartLocation) => {
      await startRecordingSession({
        location,
        selectedDevices,
        setStatus,
        setMeetingTitle,
        setIsRecording,
        clearTranscripts,
        setIsMeetingActive,
      });
    },
    [
      selectedDevices,
      setStatus,
      setMeetingTitle,
      setIsRecording,
      clearTranscripts,
      setIsMeetingActive,
    ],
  );

  const ensureReady = useCallback(
    (location: RecordingStartLocation) =>
      ensureRecordingModelReady({
        location,
        showModal,
        setStatus,
      }),
    [showModal, setStatus],
  );

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    try {
      console.log("handleRecordingStart called - checking Parakeet model status");

      const isReady = await ensureReady("home_page");
      if (!isReady) return;

      console.log("Parakeet ready - setting up meeting title and state");
      await startSession("home_page");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setStatus(
        RecordingStatus.ERROR,
        error instanceof Error ? error.message : "Failed to start recording",
      );
      setIsRecording(false); // Reset state on error
      Analytics.trackButtonClick("start_recording_error", "home_page");
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    }
  }, [ensureReady, startSession, setIsRecording, setStatus]);

  const handleSidebarStart = useCallback(
    async (location: "sidebar_auto" | "sidebar_direct") => {
      if (isRecording || isAutoStarting) {
        console.log("Recording already in progress, ignoring direct start event");
        return;
      }

      setIsAutoStarting(true);
      const isReady = await ensureReady(location);
      if (!isReady) {
        setIsAutoStarting(false);
        return;
      }

      try {
        await startSession(location);
      } catch (error) {
        const message =
          location === "sidebar_auto"
            ? "Failed to auto-start recording"
            : "Failed to start recording from sidebar";
        console.error(`${message}:`, error);
        setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : message);
        alert("Failed to start recording. Check console for details.");
        Analytics.trackButtonClick("start_recording_error", location);
      } finally {
        setIsAutoStarting(false);
      }
    },
    [isRecording, isAutoStarting, ensureReady, startSession, setStatus],
  );

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== "undefined") {
        const shouldAutoStart = sessionStorage.getItem("autoStartRecording");
        if (shouldAutoStart === "true" && !isRecording && !isAutoStarting) {
          console.log("Auto-starting recording from navigation...");
          sessionStorage.removeItem("autoStartRecording"); // Clear the flag
          await handleSidebarStart("sidebar_auto");
        }
      }
    };

    checkAutoStartRecording();
  }, [isRecording, isAutoStarting, handleSidebarStart]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      console.log("Direct start from sidebar - checking Parakeet model status");
      await handleSidebarStart("sidebar_direct");
    };

    window.addEventListener("start-recording-from-sidebar", handleDirectStart);

    return () => {
      window.removeEventListener("start-recording-from-sidebar", handleDirectStart);
    };
  }, [handleSidebarStart]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}
