"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Save, Loader2, Search, FolderOpen, Square, Volume2 } from 'lucide-react';
import Analytics from '@/lib/analytics';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onPlay?: () => Promise<void>;
  onStopPlayback?: () => void;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
  isPlayingSummary?: boolean;
  isSummaryPlaybackSupported?: boolean;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onPlay,
  onStopPlayback,
  onFind,
  onOpenFolder,
  hasSummary,
  isPlayingSummary = false,
  isSummaryPlaybackSupported = false
}: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup>
      {/* Save button */}
      <Button
        variant="outline"
        size="sm"
        className={`${isDirty ? 'bg-green-200' : ""}`}
        title={isSaving ? "Saving" : "Save Changes"}
        onClick={() => {
          Analytics.trackButtonClick('save_changes', 'meeting_details');
          onSave();
        }}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="animate-spin" />
            <span className="hidden lg:inline">Saving...</span>
          </>
        ) : (
          <>
            <Save />
            <span className="hidden lg:inline">Save</span>
          </>
        )}
      </Button>

      {/* Copy button */}
      <Button
        variant="outline"
        size="sm"
        title="Copy Summary"
        onClick={() => {
          Analytics.trackButtonClick('copy_summary', 'meeting_details');
          onCopy();
        }}
        disabled={!hasSummary}
        className="cursor-pointer"
      >
        <Copy />
        <span className="hidden lg:inline">Copy</span>
      </Button>

      {/* Playback button */}
      <Button
        variant="outline"
        size="sm"
        title={isPlayingSummary ? "Stop Summary Playback" : "Read Summary Aloud"}
        onClick={() => {
          Analytics.trackButtonClick(isPlayingSummary ? 'stop_summary_playback' : 'read_summary_aloud', 'meeting_details');
          if (isPlayingSummary) {
            onStopPlayback?.();
          } else {
            onPlay?.();
          }
        }}
        disabled={!hasSummary || !isSummaryPlaybackSupported}
        className="cursor-pointer"
      >
        {isPlayingSummary ? <Square /> : <Volume2 />}
        <span className="hidden lg:inline">{isPlayingSummary ? 'Stop' : 'Read'}</span>
      </Button>

      {/* Find button */}
      {/* {onFind && (
        <Button
          variant="outline"
          size="sm"
          title="Find in Summary"
          onClick={() => {
            Analytics.trackButtonClick('find_in_summary', 'meeting_details');
            onFind();
          }}
          disabled={!hasSummary}
          className="cursor-pointer"
        >
          <Search />
          <span className="hidden lg:inline">Find</span>
        </Button>
      )} */}
    </ButtonGroup>
  );
}
