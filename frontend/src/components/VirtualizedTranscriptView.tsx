"use client";

import { useRef, useReducer, startTransition, useEffect, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData } from "@/types";

export interface VirtualizedTranscriptViewProps {
  /** Transcript segments to display */
  segments: TranscriptSegmentData[];
  /** Whether recording is in progress */
  isRecording?: boolean;
  /** Whether recording is paused */
  isPaused?: boolean;
  /** Whether processing/finalizing transcription */
  isProcessing?: boolean;
  /** Whether stopping */
  isStopping?: boolean;
  /** Enable streaming effect for latest segment */
  enableStreaming?: boolean;
  /** Show confidence indicators */
  showConfidence?: boolean;
  /** Completely disable auto-scroll behavior (for meeting details page) */
  disableAutoScroll?: boolean;

  // Pagination props (infinite scroll)
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
  if (seconds === undefined) return "[--:--]";

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  return `[${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
}

// Helper function to remove filler words and repetitions
function cleanStopWords(text: string): string {
  const stopWords = ["uh", "um", "er", "ah", "hmm", "hm", "eh", "oh"];

  let cleanedText = text;
  stopWords.forEach((word) => {
    const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, "gi");
    cleanedText = cleanedText.replace(pattern, " ");
  });

  return cleanedText.replace(/\s+/g, " ").trim();
}

function formatSpeakerLabel(speaker?: string | null): string | null {
  return speaker === "me" ? "Me" : null;
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
  id,
  timestamp,
  text,
  speaker,
  confidence,
  isStreaming,
  showConfidence,
}: {
  id: string;
  timestamp: number;
  text: string;
  speaker?: string | null;
  confidence?: number;
  isStreaming: boolean;
  showConfidence: boolean;
}) {
  const displayText = cleanStopWords(text) || (text.trim() === "" ? "[Silence]" : text);
  const speakerLabel = formatSpeakerLabel(speaker);

  return (
    <div id={`segment-${id}`} className="mb-3">
      <div className="flex items-start gap-2">
        <Tooltip>
          <TooltipTrigger>
            <span className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px]">
              {formatRecordingTime(timestamp)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {confidence !== undefined && showConfidence && (
              <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
            )}
          </TooltipContent>
        </Tooltip>
        {speakerLabel && (
          <span className="mt-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
            {speakerLabel}
          </span>
        )}
        <div className="flex-1">
          {isStreaming ? (
            <div className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-base text-gray-800 leading-relaxed">{displayText}</p>
            </div>
          ) : (
            <p className="text-base text-gray-800 leading-relaxed">{displayText}</p>
          )}
        </div>
      </div>
    </div>
  );
});

function EmptyTranscriptState({ isRecording, isPaused }: any) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center text-gray-500 mt-8"
    >
      {isRecording ? (
        <>
          <div className="flex items-center justify-center mb-3">
            <div
              className={`w-3 h-3 rounded-full ${isPaused ? "bg-orange-500" : "bg-blue-500 animate-pulse"}`}
            ></div>
          </div>
          <p className="text-sm text-gray-600">
            {isPaused ? "Recording paused" : "Listening for speech..."}
          </p>
          <p className="text-xs mt-1 text-gray-400">
            {isPaused ? "Click resume to continue recording" : "Speak to see live transcription"}
          </p>
        </>
      ) : (
        <>
          <p className="text-lg font-semibold">Welcome to Orxa!</p>
          <p className="text-xs mt-1">Start recording to see live transcription</p>
        </>
      )}
    </motion.div>
  );
}

function LoadMoreIndicator({
  hasMore,
  isLoadingMore,
  isRecording,
  segmentsLength,
  totalCount,
  loadedCount,
  triggerRef,
}: any) {
  if ((!hasMore && !isLoadingMore) || isRecording || segmentsLength === 0) return null;

  return (
    <div ref={triggerRef} className="flex justify-center items-center py-4 mt-2">
      {isLoadingMore ? (
        <div className="flex items-center gap-2 text-gray-500">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          <span className="text-sm">Loading more...</span>
        </div>
      ) : hasMore && totalCount > 0 ? (
        <span className="text-sm text-gray-400">
          Showing {loadedCount} of {totalCount} segments
        </span>
      ) : null}
    </div>
  );
}

function ListeningIndicator({
  isStopping,
  isRecording,
  isPaused,
  isProcessing,
  segmentsLength,
}: any) {
  if (isStopping || !isRecording || isPaused || isProcessing || segmentsLength === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-2 mt-4 text-gray-500"
    >
      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
      <span className="text-sm">Listening...</span>
    </motion.div>
  );
}

function VirtualizedSegmentsList({
  segments,
  virtualizer,
  streamingSegmentId,
  getDisplayText,
  showConfidence,
}: any) {
  return (
    <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
      {virtualizer.getVirtualItems().map((virtualRow: any) => {
        const segment = segments[virtualRow.index];
        const isStreaming = streamingSegmentId === segment.id;

        return (
          <div
            key={segment.id}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <TranscriptSegment
              id={segment.id}
              timestamp={segment.timestamp}
              text={getDisplayText(segment)}
              speaker={segment.speaker}
              confidence={segment.confidence}
              isStreaming={isStreaming}
              showConfidence={showConfidence}
            />
          </div>
        );
      })}
    </div>
  );
}

function SimpleSegmentsList({ segments, streamingSegmentId, getDisplayText, showConfidence }: any) {
  return (
    <div className="space-y-1">
      {segments.map((segment: TranscriptSegmentData) => {
        const isStreaming = streamingSegmentId === segment.id;

        return (
          <motion.div
            key={segment.id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <TranscriptSegment
              id={segment.id}
              timestamp={segment.timestamp}
              text={getDisplayText(segment)}
              speaker={segment.speaker}
              confidence={segment.confidence}
              isStreaming={isStreaming}
              showConfidence={showConfidence}
            />
          </motion.div>
        );
      })}
    </div>
  );
}

export const VirtualizedTranscriptView: React.FC<VirtualizedTranscriptViewProps> = ({
  segments,
  isRecording = false,
  isPaused = false,
  isProcessing = false,
  isStopping = false,
  enableStreaming = false,
  showConfidence = true,
  disableAutoScroll = false,
  hasMore = false,
  isLoadingMore = false,
  totalCount = 0,
  loadedCount = 0,
  onLoadMore,
}) => {
  // Create scroll ref first - shared between virtualizer and auto-scroll hook
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ref for infinite scroll trigger element
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  // Force re-render without flushSync (avoids React warning)
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  // Setup virtualizer for efficient rendering of large lists
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60, // Estimated height per segment
    overscan: 10, // Render extra items above/below viewport
    onChange: () => {
      startTransition(() => {
        rerender();
      });
    },
  });

  // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
  useAutoScroll({
    scrollRef,
    segments,
    isRecording,
    isPaused,
    virtualizer,
    virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
    disableAutoScroll,
  });

  // Streaming text effect hook (typewriter animation for new transcripts)
  const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
    segments,
    isRecording,
    enableStreaming,
  );

  // Infinite scroll: IntersectionObserver to trigger loading more
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
      return;
    }

    const triggerElement = loadMoreTriggerRef.current;
    if (!triggerElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          onLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "100px",
        threshold: 0,
      },
    );

    observer.observe(triggerElement);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

  // Scroll-based fallback for fast scrolling
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking || isLoadingMore || !hasMore) return;

      ticking = true;
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = scrollElement;
        const scrollBottom = scrollHeight - scrollTop - clientHeight;

        // Trigger load when within 200px of bottom
        if (scrollBottom < 200 && hasMore && !isLoadingMore) {
          onLoadMore();
        }
        ticking = false;
      });
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

  // Use simple rendering for small lists, virtualization for large lists
  const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

  return (
    <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto px-4 py-2">
      {/* Recording Status Bar - Sticky at top, always visible when recording */}
      <AnimatePresence>
        {isRecording && (
          <div className="sticky top-0 z-10 bg-white pb-2">
            <RecordingStatusBar isPaused={isPaused} />
          </div>
        )}
      </AnimatePresence>

      {/* Content - add padding when recording to prevent overlap */}
      <div className={isRecording ? "pt-2" : ""}>
        {segments.length === 0 ? (
          <EmptyTranscriptState isRecording={isRecording} isPaused={isPaused} />
        ) : useVirtualization ? (
          <>
            <VirtualizedSegmentsList
              segments={segments}
              virtualizer={virtualizer}
              streamingSegmentId={streamingSegmentId}
              getDisplayText={getDisplayText}
              showConfidence={showConfidence}
            />
            <LoadMoreIndicator
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              isRecording={isRecording}
              segmentsLength={segments.length}
              totalCount={totalCount}
              loadedCount={loadedCount}
              triggerRef={loadMoreTriggerRef}
            />
            <ListeningIndicator
              isStopping={isStopping}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessing}
              segmentsLength={segments.length}
            />
          </>
        ) : (
          <>
            <SimpleSegmentsList
              segments={segments}
              streamingSegmentId={streamingSegmentId}
              getDisplayText={getDisplayText}
              showConfidence={showConfidence}
            />
            <LoadMoreIndicator
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              isRecording={isRecording}
              segmentsLength={segments.length}
              totalCount={totalCount}
              loadedCount={loadedCount}
              triggerRef={loadMoreTriggerRef}
            />
            <ListeningIndicator
              isStopping={isStopping}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessing}
              segmentsLength={segments.length}
            />
          </>
        )}
      </div>
    </div>
  );
};
