/**
 * useTranscriptRecovery Hook
 *
 * Orchestrates transcript recovery operations for interrupted meetings.
 * Provides functionality to detect, preview, and recover meetings from IndexedDB.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { indexedDBService, MeetingMetadata, StoredTranscript } from "@/services/indexedDBService";
import { recoverMeetingFromIndexedDB } from "./transcriptRecoveryHelpers";

export interface AudioRecoveryStatus {
  status: string; // "success" | "partial" | "failed" | "none"
  chunk_count: number;
  estimated_duration_seconds: number;
  audio_file_path?: string;
  message: string;
}

export interface UseTranscriptRecoveryReturn {
  recoverableMeetings: MeetingMetadata[];
  isLoading: boolean;
  isRecovering: boolean;
  checkForRecoverableTranscripts: () => Promise<void>;
  recoverMeeting: (meetingId: string) => Promise<{
    success: boolean;
    audioRecoveryStatus?: AudioRecoveryStatus | null;
    meetingId?: string;
  }>;
  loadMeetingTranscripts: (meetingId: string) => Promise<StoredTranscript[]>;
  deleteRecoverableMeeting: (meetingId: string) => Promise<void>;
}

export function useTranscriptRecovery(): UseTranscriptRecoveryReturn {
  const [recoverableMeetings, setRecoverableMeetings] = useState<MeetingMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  /**
   * Check for recoverable meetings in IndexedDB
   */
  const checkForRecoverableTranscripts = useCallback(async () => {
    setIsLoading(true);
    try {
      const meetings = await indexedDBService.getAllMeetings();

      // Filter out meetings older than 7 days and newer than 15 seconds
      // The 15 seconds threshold prevents showing meetings from the current session(jus in case)
      // where recording just stopped but hasn't been fully saved yet
      const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const secondsAgo = Date.now() - 2 * 1000;

      const recentMeetings = meetings.filter((m) => {
        const isWithinRetention = m.lastUpdated > cutoffTime; // Not older than 7 days
        const isOldEnough = m.lastUpdated < secondsAgo; // Older than 15 seconds
        return isWithinRetention && isOldEnough;
      });

      // Verify audio checkpoint availability for each meeting
      const meetingsWithAudioStatus = await Promise.all(
        recentMeetings.map(async (meeting) => {
          if (meeting.folderPath) {
            try {
              const hasAudio = await invoke<boolean>("has_audio_checkpoints", {
                meetingFolder: meeting.folderPath,
              });

              // If no audio files, clear folderPath to show "No audio" in UI
              return {
                ...meeting,
                folderPath: hasAudio ? meeting.folderPath : undefined,
              };
            } catch (error) {
              console.warn("Failed to check audio for meeting:", error);
              // On error, assume no audio to be safe
              return { ...meeting, folderPath: undefined };
            }
          }
          return meeting;
        }),
      );

      setRecoverableMeetings(meetingsWithAudioStatus);
    } catch (error) {
      console.error("Failed to check for recoverable transcripts:", error);
      setRecoverableMeetings([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Load transcripts for preview
   */
  const loadMeetingTranscripts = useCallback(
    async (meetingId: string): Promise<StoredTranscript[]> => {
      try {
        const transcripts = await indexedDBService.getTranscripts(meetingId);
        // Sort by sequence ID
        transcripts.sort((a, b) => (a.sequenceId || 0) - (b.sequenceId || 0));
        return transcripts;
      } catch (error) {
        console.error("Failed to load meeting transcripts:", error);
        return [];
      }
    },
    [],
  );

  /**
   * Recover a meeting from IndexedDB
   */
  const recoverMeeting = useCallback(
    async (
      meetingId: string,
    ): Promise<{
      success: boolean;
      audioRecoveryStatus?: AudioRecoveryStatus | null;
      meetingId?: string;
    }> => {
      setIsRecovering(true);
      try {
        const result = await recoverMeetingFromIndexedDB(meetingId, loadMeetingTranscripts);
        setRecoverableMeetings((prev) => prev.filter((m) => m.meetingId !== meetingId));
        return result;
      } catch (error) {
        console.error("Failed to recover meeting:", error);
        throw error;
      } finally {
        setIsRecovering(false);
      }
    },
    [loadMeetingTranscripts],
  );

  /**
   * Delete a recoverable meeting
   */
  const deleteRecoverableMeeting = useCallback(async (meetingId: string): Promise<void> => {
    try {
      await indexedDBService.deleteMeeting(meetingId);
      setRecoverableMeetings((prev) => prev.filter((m) => m.meetingId !== meetingId));
    } catch (error) {
      console.error("Failed to delete meeting:", error);
      throw error;
    }
  }, []);

  return {
    recoverableMeetings,
    isLoading,
    isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting,
  };
}
