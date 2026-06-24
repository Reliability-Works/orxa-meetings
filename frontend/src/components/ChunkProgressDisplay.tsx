import React from "react";

export interface ChunkStatus {
  chunk_id: number;
  status: "pending" | "processing" | "completed" | "failed";
  start_time?: number;
  end_time?: number;
  duration_ms?: number;
  text_preview?: string;
  error_message?: string;
}

export interface ProcessingProgress {
  total_chunks: number;
  completed_chunks: number;
  processing_chunks: number;
  failed_chunks: number;
  estimated_remaining_ms?: number;
  chunks: ChunkStatus[];
}

interface ChunkProgressDisplayProps {
  progress: ProcessingProgress;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  isPaused?: boolean;
  className?: string;
}

function completionPercentage(progress: ProcessingProgress) {
  return progress.total_chunks > 0
    ? Math.round((progress.completed_chunks / progress.total_chunks) * 100)
    : 0;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTimeRemaining(ms?: number) {
  if (!ms || ms <= 0) return "Calculating...";
  return formatDuration(ms);
}

function getChunkStatusIcon(status: ChunkStatus["status"]) {
  switch (status) {
    case "completed":
      return "✅";
    case "processing":
      return "⚡";
    case "failed":
      return "❌";
    case "pending":
    default:
      return "⏳";
  }
}

function getChunkStatusColor(status: ChunkStatus["status"]) {
  switch (status) {
    case "completed":
      return "text-green-600 bg-green-50 border-green-200";
    case "processing":
      return "text-blue-600 bg-blue-50 border-blue-200";
    case "failed":
      return "text-red-600 bg-red-50 border-red-200";
    case "pending":
    default:
      return "text-gray-600 bg-gray-50 border-gray-200";
  }
}

function ChunkProgressHeader({
  isPaused,
  onCancel,
  onPause,
  onResume,
  progress,
}: Pick<ChunkProgressDisplayProps, "isPaused" | "onCancel" | "onPause" | "onResume"> & {
  progress: ProcessingProgress;
}) {
  const isComplete =
    progress.processing_chunks === 0 && progress.completed_chunks === progress.total_chunks;

  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center space-x-3">
        <h3 className="text-lg font-semibold text-gray-900">Processing Progress</h3>
        {isPaused && (
          <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-medium">
            Paused
          </span>
        )}
      </div>

      <div className="flex items-center space-x-2">
        {!isPaused ? (
          <button
            onClick={onPause}
            className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded text-sm transition-colors"
            disabled={isComplete}
          >
            Pause
          </button>
        ) : (
          <button
            onClick={onResume}
            className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm transition-colors"
          >
            Resume
          </button>
        )}

        <button
          onClick={onCancel}
          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProgressBar({
  percentage,
  progress,
}: {
  percentage: number;
  progress: ProcessingProgress;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          {progress.completed_chunks} of {progress.total_chunks} chunks completed
        </span>
        <span className="text-sm font-medium text-gray-700">{percentage}%</span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function ProgressStats({ progress }: { progress: ProcessingProgress }) {
  const pending =
    progress.total_chunks -
    progress.completed_chunks -
    progress.processing_chunks -
    progress.failed_chunks;

  return (
    <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
      <StatValue label="Completed" value={progress.completed_chunks} className="text-green-600" />
      <StatValue label="Processing" value={progress.processing_chunks} className="text-blue-600" />
      <StatValue label="Pending" value={pending} className="text-gray-600" />
      <StatValue label="Failed" value={progress.failed_chunks} className="text-red-600" />
    </div>
  );
}

function StatValue({
  className,
  label,
  value,
}: {
  className: string;
  label: string;
  value: number;
}) {
  return (
    <div className="text-center">
      <div className={`text-lg font-semibold ${className}`}>{value}</div>
      <div className="text-gray-600">{label}</div>
    </div>
  );
}

function TimeEstimate({ progress }: { progress: ProcessingProgress }) {
  if (!progress.estimated_remaining_ms || progress.estimated_remaining_ms <= 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
      <div className="flex items-center space-x-2">
        <span className="text-blue-600">⏱️</span>
        <span className="text-sm text-blue-800">
          Estimated time remaining: {formatTimeRemaining(progress.estimated_remaining_ms)}
        </span>
      </div>
    </div>
  );
}

function RecentChunks({ progress }: { progress: ProcessingProgress }) {
  const recentChunks = progress.chunks.slice(-10).reverse();

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700 mb-2">
        Recent Chunks ({Math.min(progress.chunks.length, 10)} of {progress.total_chunks})
      </h4>

      <div className="max-h-48 overflow-y-auto space-y-1">
        {recentChunks.map((chunk) => (
          <ChunkRow chunk={chunk} key={chunk.chunk_id} />
        ))}
      </div>
    </div>
  );
}

function ChunkRow({ chunk }: { chunk: ChunkStatus }) {
  return (
    <div className={`text-xs p-2 rounded border ${getChunkStatusColor(chunk.status)}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span>{getChunkStatusIcon(chunk.status)}</span>
          <span className="font-medium">Chunk {chunk.chunk_id}</span>
          {chunk.duration_ms && (
            <span className="text-gray-500">({formatDuration(chunk.duration_ms)})</span>
          )}
        </div>

        {chunk.status === "processing" && (
          <div className="flex items-center space-x-1">
            <div className="animate-spin w-3 h-3 border border-blue-600 border-t-transparent rounded-full"></div>
          </div>
        )}
      </div>

      {chunk.text_preview && (
        <div className="mt-1 text-gray-700 text-xs truncate">"{chunk.text_preview}"</div>
      )}

      {chunk.error_message && (
        <div className="mt-1 text-red-700 text-xs">Error: {chunk.error_message}</div>
      )}
    </div>
  );
}

function CompleteNotice({ progress }: { progress: ProcessingProgress }) {
  if (progress.completed_chunks !== progress.total_chunks || progress.total_chunks <= 0)
    return null;

  return (
    <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
      <div className="flex items-center space-x-2">
        <span className="text-green-600">🎉</span>
        <span className="text-sm font-medium text-green-800">
          Processing completed! All {progress.total_chunks} chunks have been transcribed.
        </span>
      </div>
    </div>
  );
}

export function ChunkProgressDisplay({
  progress,
  onPause,
  onResume,
  onCancel,
  isPaused = false,
  className = "",
}: ChunkProgressDisplayProps) {
  const percentage = completionPercentage(progress);

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
      <ChunkProgressHeader
        isPaused={isPaused}
        onCancel={onCancel}
        onPause={onPause}
        onResume={onResume}
        progress={progress}
      />
      <ProgressBar percentage={percentage} progress={progress} />
      <ProgressStats progress={progress} />
      <TimeEstimate progress={progress} />
      <RecentChunks progress={progress} />
      <CompleteNotice progress={progress} />
    </div>
  );
}

// Mini version for sidebar or compact display
export function ChunkProgressMini({
  progress,
  className = "",
}: {
  progress: ProcessingProgress;
  className?: string;
}) {
  const percentage = completionPercentage(progress);

  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">Processing</span>
        <span className="text-sm font-medium text-gray-700">{percentage}%</span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
        <div
          className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="text-xs text-gray-600">
        {progress.completed_chunks} / {progress.total_chunks} chunks
        {progress.processing_chunks > 0 && (
          <span className="ml-2 text-blue-600">({progress.processing_chunks} processing)</span>
        )}
      </div>
    </div>
  );
}
