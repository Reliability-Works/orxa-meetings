import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { ProcessingProgress } from "../components/ChunkProgressDisplay";
import type { ProcessingSession } from "./useProcessingProgress";

export function useProcessingProgressPersistence(args: {
  session: ProcessingSession | null;
  progress: ProcessingProgress;
  isActive: boolean;
  processingTimeRef: MutableRefObject<{ [chunkId: number]: number }>;
  setSession: Dispatch<SetStateAction<ProcessingSession | null>>;
  setProgress: Dispatch<SetStateAction<ProcessingProgress>>;
  setIsActive: Dispatch<SetStateAction<boolean>>;
}) {
  const saveProgressState = useCallback(() => {
    if (!args.session) return null;

    const state = {
      session: args.session,
      progress: args.progress,
      processing_times: args.processingTimeRef.current,
      is_active: args.isActive,
    };

    localStorage.setItem("transcription_progress", JSON.stringify(state));
    return state;
  }, [args]);

  const loadProgressState = useCallback(() => {
    try {
      const saved = localStorage.getItem("transcription_progress");
      if (!saved) return false;

      const state = JSON.parse(saved);
      args.setSession(state.session);
      args.setProgress(state.progress);
      args.setIsActive(state.is_active);
      args.processingTimeRef.current = state.processing_times || {};

      console.log("Loaded saved progress state");
      return true;
    } catch (error) {
      console.error("Failed to load progress state:", error);
      return false;
    }
  }, [args]);

  const clearSavedState = useCallback(() => {
    localStorage.removeItem("transcription_progress");
  }, []);

  return { saveProgressState, loadProgressState, clearSavedState };
}
