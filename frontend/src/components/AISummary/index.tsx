"use client";

import { useMemo } from "react";

import { Summary } from "@/types";
import { AISummaryView } from "./AISummaryView";
import { SummaryEmptyState, SummaryErrorState, SummaryLoadingState } from "./AISummaryStates";
import {
  createDefaultSummary,
  ensureUniqueBlockIds,
  hasSummaryContent,
} from "./summaryEditorUtils";
import { useAISummaryEditor } from "./useAISummaryEditor";

interface Props {
  summary: Summary | null;
  status: "idle" | "processing" | "summarizing" | "regenerating" | "completed" | "error";
  error: string | null;
  onSummaryChange: (summary: Summary) => void;
  onRegenerateSummary: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
}

export const AISummary = ({
  summary,
  status,
  error,
  onSummaryChange,
  onRegenerateSummary: _onRegenerateSummary,
  meeting: _meeting,
}: Props) => {
  const currentSummary = useMemo(
    () => (summary ? ensureUniqueBlockIds(summary) : createDefaultSummary()),
    [summary],
  );
  const editor = useAISummaryEditor({ currentSummary, summary, onSummaryChange });

  if (error) {
    return <SummaryErrorState error={error} />;
  }

  if (status === "processing" || status === "summarizing" || status === "regenerating") {
    return <SummaryLoadingState status={status} />;
  }

  if (!hasSummaryContent(currentSummary) && status === "completed") {
    return <SummaryEmptyState />;
  }

  return <AISummaryView currentSummary={currentSummary} editor={editor} />;
};
