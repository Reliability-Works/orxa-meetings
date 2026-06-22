"use client";

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Scissors } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface TrimTranscriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  onComplete?: () => Promise<void> | void;
}

interface TrimSegment {
  id: string;
  text: string;
  timestamp: string;
  audio_start_time?: number;
  audio_end_time?: number;
}

interface TrimResult {
  meeting_id: string;
  cutoff_seconds: number;
  deleted_count: number;
  remaining_count: number;
  total_count: number;
  summary_invalidated: boolean;
  last_kept_segment?: TrimSegment;
  first_removed_segment?: TrimSegment;
  last_removed_segment?: TrimSegment;
  applied: boolean;
}

function parseCutoffSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const parsed = parts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isFinite(part) || part < 0)) return null;

  const [hours, minutes, seconds] =
    parsed.length === 3 ? parsed : [0, parsed[0], parsed[1]];

  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatRecordingTime(seconds?: number) {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return '--:--';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function SegmentPreview({
  label,
  segment,
}: {
  label: string;
  segment?: TrimSegment;
}) {
  if (!segment) return null;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-gray-500">
        <span>{label}</span>
        <span>[{formatRecordingTime(segment.audio_start_time)}]</span>
      </div>
      <p className="line-clamp-3 text-sm text-gray-800">{segment.text}</p>
    </div>
  );
}

export function TrimTranscriptDialog({
  open,
  onOpenChange,
  meetingId,
  onComplete,
}: TrimTranscriptDialogProps) {
  const [cutoffInput, setCutoffInput] = useState('');
  const [preview, setPreview] = useState<TrimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const cutoffSeconds = useMemo(
    () => parseCutoffSeconds(cutoffInput),
    [cutoffInput]
  );

  useEffect(() => {
    if (open) {
      setCutoffInput('');
      setPreview(null);
      setError(null);
      setIsPreviewing(false);
      setIsApplying(false);
    }
  }, [open]);

  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [cutoffInput]);

  const handlePreview = async () => {
    if (cutoffSeconds === null) {
      setError('Enter a cutoff like 17:52, 1:02:30, or 1072 seconds.');
      return;
    }

    setIsPreviewing(true);
    setError(null);
    try {
      const result = await invoke<TrimResult>('api_preview_trim_meeting_transcript', {
        meetingId,
        cutoffSeconds,
      });
      setPreview(result);
    } catch (error) {
      console.error('Failed to preview transcript trim:', error);
      setError('Could not preview transcript trim.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (cutoffSeconds === null || !preview || preview.deleted_count === 0) return;

    setIsApplying(true);
    setError(null);
    try {
      const result = await invoke<TrimResult>('api_trim_meeting_transcript', {
        meetingId,
        cutoffSeconds,
        confirm: true,
      });
      toast.success(`Removed ${result.deleted_count} transcript segment${result.deleted_count === 1 ? '' : 's'}.`);
      await onComplete?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to trim transcript:', error);
      setError('Could not trim transcript.');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            Trim Transcript Tail
          </DialogTitle>
          <DialogDescription>
            Remove transcript segments that start after a recording timestamp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-800" htmlFor="trim-cutoff">
              Keep transcript through
            </label>
            <div className="flex gap-2">
              <Input
                id="trim-cutoff"
                value={cutoffInput}
                onChange={(event) => setCutoffInput(event.target.value)}
                placeholder="17:52"
                disabled={isPreviewing || isApplying}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handlePreview}
                disabled={isPreviewing || isApplying}
              >
                {isPreviewing && <Loader2 className="h-4 w-4 animate-spin" />}
                Preview
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Exact cutoff matches are kept. Segments without recording timestamps are left untouched.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                  <div className="text-sm text-amber-900">
                    <p className="font-medium">
                      {preview.deleted_count === 0
                        ? 'No transcript segments would be removed.'
                        : `${preview.deleted_count} of ${preview.total_count} transcript segments will be removed.`}
                    </p>
                    <p className="mt-1 text-xs">
                      {preview.summary_invalidated
                        ? 'The stored summary will be cleared so it can be regenerated from the cleaned transcript.'
                        : 'No stored summary needs to be cleared.'}
                    </p>
                  </div>
                </div>
              </div>

              <SegmentPreview label="Last kept segment" segment={preview.last_kept_segment} />
              <SegmentPreview label="First removed segment" segment={preview.first_removed_segment} />
              <SegmentPreview label="Last removed segment" segment={preview.last_removed_segment} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isApplying}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleApply}
            disabled={!preview || preview.deleted_count === 0 || isApplying}
          >
            {isApplying && <Loader2 className="h-4 w-4 animate-spin" />}
            Trim Transcript
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
