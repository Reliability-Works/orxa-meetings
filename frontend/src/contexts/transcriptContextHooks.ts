"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import { Transcript, TranscriptUpdate } from "@/types";
import { transcriptService } from "@/services/transcriptService";
import { recordingService } from "@/services/recordingService";
import { indexedDBService } from "@/services/indexedDBService";
import { useRecordingState } from "./RecordingStateContext";
import {
  appendUniqueTranscripts,
  createTranscript,
  formatSpeaker,
  formatTranscriptTime,
  sortTranscripts,
} from "./transcriptContextUtils";

interface TranscriptController {
  transcripts: Transcript[];
  transcriptsRef: MutableRefObject<Transcript[]>;
  addTranscript: (update: TranscriptUpdate) => void;
  copyTranscript: () => void;
  flushBuffer: () => void;
  transcriptContainerRef: RefObject<HTMLDivElement>;
  meetingTitle: string;
  setMeetingTitle: (title: string) => void;
  clearTranscripts: () => void;
  currentMeetingId: string | null;
  markMeetingAsSaved: () => Promise<void>;
}

function useTranscriptRefs(transcripts: Transcript[]) {
  const transcriptsRef = useRef<Transcript[]>(transcripts);
  const isUserAtBottomRef = useRef<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const finalFlushRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    const handleScroll = () => {
      const container = transcriptContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      isUserAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 10;
    };

    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, []);

  useEffect(() => {
    if (!isUserAtBottomRef.current || !transcriptContainerRef.current) return;

    const scrollTimeout = setTimeout(() => {
      const container = transcriptContainerRef.current;
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 150);

    return () => clearTimeout(scrollTimeout);
  }, [transcripts]);

  return { transcriptsRef, transcriptContainerRef, finalFlushRef };
}

function useRecordingMetadataListeners(args: {
  currentMeetingId: string | null;
  setCurrentMeetingId: (value: string | null) => void;
  setMeetingTitle: (value: string) => void;
}) {
  useEffect(() => {
    let unlistenRecordingStarted: (() => void) | undefined;
    let unlistenRecordingStopped: (() => void) | undefined;

    const setupRecordingListeners = async () => {
      try {
        await indexedDBService.init();

        unlistenRecordingStarted = await recordingService.onRecordingStarted(async () => {
          try {
            const meetingId = `meeting-${Date.now()}`;
            args.setCurrentMeetingId(meetingId);
            sessionStorage.setItem("indexeddb_current_meeting_id", meetingId);
            console.log("[Recording Started] 💾 IndexedDB meeting ID stored:", meetingId);

            const meetingName = await recordingService.getRecordingMeetingName();
            const effectiveTitle =
              meetingName ||
              `Meeting ${new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")}`;

            await indexedDBService.saveMeetingMetadata({
              meetingId,
              title: effectiveTitle,
              startTime: Date.now(),
              lastUpdated: Date.now(),
              transcriptCount: 0,
              savedToSQLite: false,
              folderPath: undefined,
            });

            args.setMeetingTitle(effectiveTitle);
            await syncMeetingFolderPath(meetingId);
          } catch (error) {
            console.error("Failed to initialize meeting in IndexedDB:", error);
          }
        });

        unlistenRecordingStopped = await recordingService.onRecordingStopped(async (payload) => {
          try {
            if (!args.currentMeetingId) return;

            const metadata = await indexedDBService.getMeetingMetadata(args.currentMeetingId);
            if (metadata && payload.folder_path) {
              metadata.folderPath = payload.folder_path;
              await indexedDBService.saveMeetingMetadata(metadata);
            }
          } catch (error) {
            console.error("Failed to update meeting metadata on stop:", error);
          }
        });
      } catch (error) {
        console.error("Failed to setup recording listeners:", error);
      }
    };

    setupRecordingListeners();

    return () => {
      if (unlistenRecordingStarted) {
        unlistenRecordingStarted();
        console.log("🧹 Recording started listener cleaned up");
      }
      if (unlistenRecordingStopped) {
        unlistenRecordingStopped();
        console.log("🧹 Recording stopped listener cleaned up");
      }
    };
  }, [args]);
}

async function syncMeetingFolderPath(meetingId: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const folderPath = await invoke<string>("get_meeting_folder_path");
    if (!folderPath) return;

    const metadata = await indexedDBService.getMeetingMetadata(meetingId);
    if (metadata) {
      metadata.folderPath = folderPath;
      await indexedDBService.saveMeetingMetadata(metadata);
    }
  } catch (error) {
    // Non-fatal - will be set on stop if recording completes normally.
  }
}

function useTranscriptBuffering(args: {
  currentMeetingId: string | null;
  setTranscripts: Dispatch<SetStateAction<Transcript[]>>;
  finalFlushRef: MutableRefObject<(() => void) | null>;
}) {
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let transcriptCounter = 0;
    const transcriptBuffer = new Map<number, Transcript>();
    let lastProcessedSequence = 0;
    let processingTimer: NodeJS.Timeout | undefined;

    const processBufferedTranscripts = (forceFlush = false) => {
      const sortedTranscripts: Transcript[] = [];
      let nextSequence = lastProcessedSequence + 1;

      while (transcriptBuffer.has(nextSequence)) {
        const bufferedTranscript = transcriptBuffer.get(nextSequence)!;
        sortedTranscripts.push(bufferedTranscript);
        transcriptBuffer.delete(nextSequence);
        lastProcessedSequence = nextSequence;
        nextSequence++;
      }

      const remaining = collectRemainingBufferedTranscripts(transcriptBuffer, forceFlush);
      const allNewTranscripts = [
        ...sortedTranscripts,
        ...remaining.sortedRecentTranscripts,
        ...remaining.sortedStaleTranscripts,
        ...remaining.sortedForceFlushTranscripts,
      ];

      if (allNewTranscripts.length === 0) return;

      args.setTranscripts((prev) => appendUniqueTranscripts(prev, allNewTranscripts));
      const logMessage = forceFlush
        ? `Force flush processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${remaining.sortedForceFlushTranscripts.length} forced)`
        : `Processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${remaining.sortedRecentTranscripts.length} recent, ${remaining.sortedStaleTranscripts.length} stale)`;
      console.log(logMessage);
    };

    args.finalFlushRef.current = () => processBufferedTranscripts(true);

    const setupListener = async () => {
      try {
        console.log("🔥 Setting up MAIN transcript listener during component initialization...");
        unlistenFn = await transcriptService.onTranscriptUpdate((update) => {
          const now = Date.now();
          console.log("🎯 MAIN LISTENER: Received transcript update:", {
            sequence_id: update.sequence_id,
            text: update.text.substring(0, 50) + "...",
            timestamp: update.timestamp,
            is_partial: update.is_partial,
            received_at: new Date(now).toISOString(),
            buffer_size_before: transcriptBuffer.size,
          });

          if (transcriptBuffer.has(update.sequence_id)) {
            console.log(
              "🚫 MAIN LISTENER: Duplicate sequence_id, skipping buffer:",
              update.sequence_id,
            );
            return;
          }

          transcriptBuffer.set(
            update.sequence_id,
            createTranscript(update, `${Date.now()}-${transcriptCounter++}`),
          );
          console.log(
            `✅ MAIN LISTENER: Buffered transcript with sequence_id ${update.sequence_id}. Buffer size: ${transcriptBuffer.size}, Last processed: ${lastProcessedSequence}`,
          );

          if (args.currentMeetingId) {
            indexedDBService
              .saveTranscript(args.currentMeetingId, update)
              .catch((err) => console.warn("IndexedDB save failed:", err));
          }

          if (processingTimer) clearTimeout(processingTimer);
          processingTimer = setTimeout(processBufferedTranscripts, 10);
        });
        console.log("✅ MAIN transcript listener setup complete");
      } catch (error) {
        console.error("❌ Failed to setup MAIN transcript listener:", error);
        alert("Failed to setup transcript listener. Check console for details.");
      }
    };

    setupListener();
    console.log("Started enhanced listener setup");

    return () => {
      console.log("🧹 CLEANUP: Cleaning up MAIN transcript listener...");
      if (processingTimer) {
        clearTimeout(processingTimer);
        console.log("🧹 CLEANUP: Cleared processing timer");
      }
      if (unlistenFn) {
        unlistenFn();
        console.log("🧹 CLEANUP: MAIN transcript listener cleaned up");
      }
    };
  }, [args]);
}

function collectRemainingBufferedTranscripts(
  transcriptBuffer: Map<number, Transcript>,
  forceFlush: boolean,
) {
  const now = Date.now();
  const staleTranscripts: Transcript[] = [];
  const recentTranscripts: Transcript[] = [];
  const forceFlushTranscripts: Transcript[] = [];

  for (const [sequenceId, transcript] of transcriptBuffer.entries()) {
    if (forceFlush) {
      forceFlushTranscripts.push(transcript);
      transcriptBuffer.delete(sequenceId);
      console.log(`Force flush: processing transcript with sequence_id ${sequenceId}`);
      continue;
    }

    const transcriptAge = now - parseInt(transcript.id.split("-")[0]);
    if (transcriptAge > 100) {
      staleTranscripts.push(transcript);
      transcriptBuffer.delete(sequenceId);
    } else if (transcriptAge >= 0) {
      recentTranscripts.push(transcript);
      transcriptBuffer.delete(sequenceId);
      console.log(`Processing transcript with sequence_id ${sequenceId}, age: ${transcriptAge}ms`);
    }
  }

  return {
    sortedStaleTranscripts: sortTranscripts(staleTranscripts),
    sortedRecentTranscripts: sortTranscripts(recentTranscripts),
    sortedForceFlushTranscripts: sortTranscripts(forceFlushTranscripts),
  };
}

function useBackendTranscriptSync(args: {
  isRecording: boolean;
  transcriptsLength: number;
  setTranscripts: Dispatch<SetStateAction<Transcript[]>>;
  setMeetingTitle: (value: string) => void;
}) {
  useEffect(() => {
    const syncFromBackend = async () => {
      if (!args.isRecording || args.transcriptsLength !== 0) return;

      try {
        console.log("[Reload Sync] Recording active after reload, syncing transcript history...");
        const history = await transcriptService.getTranscriptHistory();
        console.log(`[Reload Sync] Retrieved ${history.length} transcript segments from backend`);

        const formattedTranscripts: Transcript[] = history.map((segment: any) => ({
          id: segment.id,
          text: segment.text,
          timestamp: segment.display_time,
          speaker: segment.speaker,
          sequence_id: segment.sequence_id,
          chunk_start_time: segment.audio_start_time,
          is_partial: false,
          confidence: segment.confidence,
          audio_start_time: segment.audio_start_time,
          audio_end_time: segment.audio_end_time,
          duration: segment.duration,
        }));

        args.setTranscripts(formattedTranscripts);
        console.log("[Reload Sync] ✅ Transcript history synced successfully");

        const meetingName = await recordingService.getRecordingMeetingName();
        if (meetingName) {
          console.log("[Reload Sync] Retrieved meeting name:", meetingName);
          args.setMeetingTitle(meetingName);
          console.log("[Reload Sync] ✅ Meeting title synced successfully");
        }
      } catch (error) {
        console.error("[Reload Sync] Failed to sync from backend:", error);
      }
    };

    syncFromBackend();
  }, [args]);
}

export function useTranscriptController(): TranscriptController {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [meetingTitle, setMeetingTitle] = useState("+ New Call");
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const recordingState = useRecordingState();
  const { transcriptsRef, transcriptContainerRef, finalFlushRef } = useTranscriptRefs(transcripts);

  const metadataListenerArgs = useMemo(
    () => ({ currentMeetingId, setCurrentMeetingId, setMeetingTitle }),
    [currentMeetingId],
  );
  useRecordingMetadataListeners(metadataListenerArgs);

  const bufferingArgs = useMemo(
    () => ({ currentMeetingId, setTranscripts, finalFlushRef }),
    [currentMeetingId, finalFlushRef],
  );
  useTranscriptBuffering(bufferingArgs);

  const backendSyncArgs = useMemo(
    () => ({
      isRecording: recordingState.isRecording,
      transcriptsLength: transcripts.length,
      setTranscripts,
      setMeetingTitle,
    }),
    [recordingState.isRecording, transcripts.length],
  );
  useBackendTranscriptSync(backendSyncArgs);

  const addTranscript = useCallback((update: TranscriptUpdate) => {
    console.log("🎯 addTranscript called with:", {
      sequence_id: update.sequence_id,
      text: update.text.substring(0, 50) + "...",
      timestamp: update.timestamp,
      is_partial: update.is_partial,
    });

    const newTranscript = createTranscript(
      { ...update, sequence_id: update.sequence_id || 0 },
      update.sequence_id ? update.sequence_id.toString() : Date.now().toString(),
    );

    setTranscripts((prev) => {
      console.log("📊 Current transcripts count before update:", prev.length);
      const exists = prev.some((t) => t.text === update.text && t.timestamp === update.timestamp);
      if (exists) {
        console.log(
          "🚫 Duplicate transcript detected, skipping:",
          update.text.substring(0, 30) + "...",
        );
        return prev;
      }

      const sorted = [...prev, newTranscript].sort(
        (a, b) => (a.sequence_id || 0) - (b.sequence_id || 0),
      );
      console.log("✅ Added new transcript. New count:", sorted.length);
      console.log("📝 Latest transcript:", {
        id: newTranscript.id,
        text: newTranscript.text.substring(0, 30) + "...",
        sequence_id: newTranscript.sequence_id,
      });
      return sorted;
    });
  }, []);

  const copyTranscript = useCallback(() => {
    const fullTranscript = transcripts
      .map(
        (t) => `${formatTranscriptTime(t.audio_start_time)}${formatSpeaker(t.speaker)} ${t.text}`,
      )
      .join("\n");
    navigator.clipboard.writeText(fullTranscript);
    toast.success("Transcript copied to clipboard");
  }, [transcripts]);

  const flushBuffer = useCallback(() => {
    if (finalFlushRef.current) {
      console.log("🔄 Flushing transcript buffer...");
      finalFlushRef.current();
    }
  }, [finalFlushRef]);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
  }, []);

  const markMeetingAsSaved = useCallback(async () => {
    const meetingId = currentMeetingId || sessionStorage.getItem("indexeddb_current_meeting_id");
    if (!meetingId) {
      console.error("[IndexedDB] ❌ Cannot mark meeting as saved: No meeting ID available!");
      console.error("[IndexedDB] currentMeetingId:", currentMeetingId);
      console.error(
        "[IndexedDB] sessionStorage:",
        sessionStorage.getItem("indexeddb_current_meeting_id"),
      );
      return;
    }

    try {
      await indexedDBService.markMeetingSaved(meetingId);
      setCurrentMeetingId(null);
      sessionStorage.removeItem("indexeddb_current_meeting_id");
    } catch (error) {
      console.error("[IndexedDB] ❌ Failed to mark meeting as saved:", error);
    }
  }, [currentMeetingId]);

  return {
    transcripts,
    transcriptsRef,
    addTranscript,
    copyTranscript,
    flushBuffer,
    transcriptContainerRef,
    meetingTitle,
    setMeetingTitle,
    clearTranscripts,
    currentMeetingId,
    markMeetingAsSaved,
  };
}
