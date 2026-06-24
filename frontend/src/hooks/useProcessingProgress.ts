import { useState, useCallback, useRef, useEffect } from "react";
import { ProcessingProgress } from "../components/ChunkProgressDisplay";
import { createEmptyProgress, useProcessingProgressActions } from "./processingProgressActions";
import { useProcessingProgressPersistence } from "./processingProgressPersistence";

export interface ProcessingSession {
  session_id: string;
  total_audio_duration_ms: number;
  chunk_duration_ms: number;
  start_time: number;
  is_paused: boolean;
  model_name: string;
}

export function useProcessingProgress() {
  const [progress, setProgress] = useState<ProcessingProgress>({
    ...createEmptyProgress(),
  });

  const [session, setSession] = useState<ProcessingSession | null>(null);
  const [isActive, setIsActive] = useState(false);
  const processingTimeRef = useRef<{ [chunkId: number]: number }>({});
  const {
    initializeSession,
    startChunkProcessing,
    completeChunk,
    failChunk,
    pauseProcessing,
    resumeProcessing,
    cancelProcessing,
    reset,
  } = useProcessingProgressActions({
    session,
    processingTimeRef,
    setSession,
    setProgress,
    setIsActive,
  });
  const { saveProgressState, loadProgressState, clearSavedState } =
    useProcessingProgressPersistence({
      session,
      progress,
      isActive,
      processingTimeRef,
      setSession,
      setProgress,
      setIsActive,
    });

  // Calculate estimated remaining time
  const calculateEstimatedTime = useCallback(() => {
    if (!session || progress.completed_chunks === 0) {
      return undefined;
    }

    const currentTime = Date.now();
    const elapsedTime = currentTime - session.start_time;
    const averageTimePerChunk = elapsedTime / progress.completed_chunks;
    const remainingChunks = progress.total_chunks - progress.completed_chunks;

    return remainingChunks * averageTimePerChunk;
  }, [session, progress.completed_chunks, progress.total_chunks]);

  // Update estimated time in progress
  useEffect(() => {
    const estimatedTime = calculateEstimatedTime();
    if (estimatedTime !== undefined) {
      setProgress((prev) => ({
        ...prev,
        estimated_remaining_ms: estimatedTime,
      }));
    }
  }, [calculateEstimatedTime]);

  // Check if processing is complete
  const isComplete =
    progress.total_chunks > 0 && progress.completed_chunks === progress.total_chunks;

  // Check if there are any failed chunks
  const hasFailures = progress.failed_chunks > 0;

  return {
    // State
    progress,
    session,
    isActive,
    isComplete,
    hasFailures,
    isPaused: session?.is_paused || false,

    // Actions
    initializeSession,
    startChunkProcessing,
    completeChunk,
    failChunk,
    pauseProcessing,
    resumeProcessing,
    cancelProcessing,
    reset,

    // Persistence
    saveProgressState,
    loadProgressState,
    clearSavedState,
  };
}
