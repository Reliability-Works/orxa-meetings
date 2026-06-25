"use client";

import { Scissors, Trash2 } from "lucide-react";
import { TranscriptSegmentData } from "@/types";
import { formatRecordingTime } from "@/lib/transcriptTime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface TranscriptTimestampMenuProps {
  segment: TranscriptSegmentData;
  onRemoveSegment?: (segment: TranscriptSegmentData) => void;
  onTrimFromSegment?: (segment: TranscriptSegmentData) => void;
}

export function TranscriptTimestampMenu({
  segment,
  onRemoveSegment,
  onTrimFromSegment,
}: TranscriptTimestampMenuProps) {
  const label = `[${formatRecordingTime(segment.timestamp)}]`;

  if (!onRemoveSegment && !onTrimFromSegment) {
    return <span className={timestampClassName}>{label}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`${timestampClassName} rounded px-1 text-left transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
          aria-label={`Transcript actions for ${label}`}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-gray-500">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onRemoveSegment && (
          <DropdownMenuItem
            className="text-red-600 focus:text-red-700"
            onSelect={() => onRemoveSegment(segment)}
          >
            <Trash2 className="h-4 w-4" />
            Remove this transcript
          </DropdownMenuItem>
        )}
        {onTrimFromSegment && (
          <DropdownMenuItem
            className="text-red-600 focus:text-red-700"
            onSelect={() => onTrimFromSegment(segment)}
          >
            <Scissors className="h-4 w-4" />
            Remove this and everything below
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const timestampClassName = "text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[58px]";
