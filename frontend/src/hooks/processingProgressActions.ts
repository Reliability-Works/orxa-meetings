import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { ProcessingProgress } from "../components/ChunkProgressDisplay";
import type { ProcessingSession } from "./useProcessingProgress";

export function createEmptyProgress(): ProcessingProgress {
  return {
    total_chunks: 0,
    completed_chunks: 0,
    processing_chunks: 0,
    failed_chunks: 0,
    chunks: [],
  };
}

export function useProcessingProgressActions(args: {
  session: ProcessingSession | null;
  processingTimeRef: MutableRefObject<{ [chunkId: number]: number }>;
  setSession: Dispatch<SetStateAction<ProcessingSession | null>>;
  setProgress: Dispatch<SetStateAction<ProcessingProgress>>;
  setIsActive: Dispatch<SetStateAction<boolean>>;
}) {
  const { processingTimeRef, session, setIsActive, setProgress, setSession } = args;

  const initializeSession = useCallback(
    (
      totalAudioDurationMs: number,
      chunkDurationMs: number = 30000,
      modelName: string = "unknown",
    ) => {
      const totalChunks = Math.ceil(totalAudioDurationMs / chunkDurationMs);
      const newSession: ProcessingSession = {
        session_id: `session_${Date.now()}`,
        total_audio_duration_ms: totalAudioDurationMs,
        chunk_duration_ms: chunkDurationMs,
        start_time: Date.now(),
        is_paused: false,
        model_name: modelName,
      };

      setSession(newSession);
      setProgress({
        ...createEmptyProgress(),
        total_chunks: totalChunks,
        chunks: Array.from({ length: totalChunks }, (_, i) => ({
          chunk_id: i,
          status: "pending",
        })),
      });
      setIsActive(true);
      console.log(`Initialized processing session for ${totalChunks} chunks`);
    },
    [setIsActive, setProgress, setSession],
  );

  const startChunkProcessing = useCallback(
    (chunkId: number) => {
      processingTimeRef.current[chunkId] = Date.now();
      setProgress((prev) => ({
        ...prev,
        processing_chunks: prev.processing_chunks + 1,
        chunks: prev.chunks.map((chunk) =>
          chunk.chunk_id === chunkId
            ? { ...chunk, status: "processing", start_time: Date.now() }
            : chunk,
        ),
      }));
      console.log(`Started processing chunk ${chunkId}`);
    },
    [processingTimeRef, setProgress],
  );

  const completeChunk = useCallback(
    (chunkId: number, transcribedText: string) => {
      const startTime = processingTimeRef.current[chunkId];
      const endTime = Date.now();
      const duration = startTime ? endTime - startTime : 0;

      setProgress((prev) => ({
        ...prev,
        completed_chunks: prev.completed_chunks + 1,
        processing_chunks: Math.max(0, prev.processing_chunks - 1),
        chunks: prev.chunks.map((chunk) =>
          chunk.chunk_id === chunkId
            ? {
                ...chunk,
                status: "completed",
                end_time: endTime,
                duration_ms: duration,
                text_preview: transcribedText.slice(0, 100),
              }
            : chunk,
        ),
      }));

      delete processingTimeRef.current[chunkId];
      console.log(`Completed chunk ${chunkId} in ${duration}ms`);
    },
    [processingTimeRef, setProgress],
  );

  const failChunk = useCallback(
    (chunkId: number, errorMessage: string) => {
      setProgress((prev) => ({
        ...prev,
        failed_chunks: prev.failed_chunks + 1,
        processing_chunks: Math.max(0, prev.processing_chunks - 1),
        chunks: prev.chunks.map((chunk) =>
          chunk.chunk_id === chunkId
            ? {
                ...chunk,
                status: "failed",
                error_message: errorMessage,
                end_time: Date.now(),
              }
            : chunk,
        ),
      }));

      delete processingTimeRef.current[chunkId];
      console.log(`Failed chunk ${chunkId}: ${errorMessage}`);
    },
    [processingTimeRef, setProgress],
  );

  const clearProgress = useCallback(() => {
    setIsActive(false);
    setSession(null);
    setProgress(createEmptyProgress());
    processingTimeRef.current = {};
  }, [processingTimeRef, setIsActive, setProgress, setSession]);

  const pauseProcessing = useCallback(() => {
    if (session) {
      setSession((prev) => (prev ? { ...prev, is_paused: true } : null));
      console.log("Processing paused");
    }
  }, [session, setSession]);

  const resumeProcessing = useCallback(() => {
    if (session) {
      setSession((prev) => (prev ? { ...prev, is_paused: false } : null));
      console.log("Processing resumed");
    }
  }, [session, setSession]);

  const cancelProcessing = useCallback(() => {
    clearProgress();
    console.log("Processing cancelled");
  }, [clearProgress]);

  return {
    initializeSession,
    startChunkProcessing,
    completeChunk,
    failChunk,
    pauseProcessing,
    resumeProcessing,
    cancelProcessing,
    reset: clearProgress,
  };
}
