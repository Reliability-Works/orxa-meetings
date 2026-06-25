"use client";

import { Transcript, TranscriptSegmentData } from "@/types";
import { VirtualizedTranscriptView } from "@/components/VirtualizedTranscriptView";
import { TranscriptButtonGroup } from "./TranscriptButtonGroup";
import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { formatRecordingTime } from "@/lib/transcriptTime";

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map((t) => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      speaker: t.speaker,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  const transcriptCount = usePagination
    ? (totalCount ?? convertedSegments.length)
    : transcripts?.length || 0;

  const handleRemoveSegment = useCallback(
    async (segment: TranscriptSegmentData) => {
      if (!meetingId) return;

      const timestamp = `[${formatRecordingTime(segment.timestamp)}]`;
      const confirmed = window.confirm(
        `Remove the transcript segment at ${timestamp}? The current summary will be cleared.`,
      );
      if (!confirmed) return;

      try {
        const result = await invoke<{ deleted_count: number }>(
          "api_delete_meeting_transcript_segment",
          {
            meetingId,
            transcriptId: segment.id,
            confirm: true,
          },
        );
        toast.success(
          result.deleted_count === 1 ? "Removed transcript segment." : "No transcript was removed.",
        );
        await onRefetchTranscripts?.();
      } catch (error) {
        console.error("Failed to remove transcript segment:", error);
        toast.error("Could not remove transcript segment.");
      }
    },
    [meetingId, onRefetchTranscripts],
  );

  const handleTrimFromSegment = useCallback(
    async (segment: TranscriptSegmentData) => {
      if (!meetingId) return;

      const timestamp = `[${formatRecordingTime(segment.timestamp)}]`;
      const confirmed = window.confirm(
        `Remove ${timestamp} and every transcript segment below it? The current summary will be cleared.`,
      );
      if (!confirmed) return;

      try {
        const result = await invoke<{ deleted_count: number }>(
          "api_trim_meeting_transcript_from_segment",
          {
            meetingId,
            transcriptId: segment.id,
            confirm: true,
          },
        );
        toast.success(
          `Removed ${result.deleted_count} transcript segment${result.deleted_count === 1 ? "" : "s"}.`,
        );
        await onRefetchTranscripts?.();
      } catch (error) {
        console.error("Failed to trim transcript from segment:", error);
        toast.error("Could not trim transcript from this timestamp.");
      }
    },
    [meetingId, onRefetchTranscripts],
  );

  return (
    <div className="hidden md:flex min-w-0 flex-1 border-r border-gray-200 bg-white flex-col relative">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-gray-900">Transcript</h2>
          <p className="truncate text-[11px] text-gray-500">{transcriptCount} segments</p>
        </div>
        <TranscriptButtonGroup
          transcriptCount={transcriptCount}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          onRemoveSegment={meetingId ? handleRemoveSegment : undefined}
          onTrimFromSegment={meetingId ? handleTrimFromSegment : undefined}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
