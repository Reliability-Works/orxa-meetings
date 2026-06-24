"use client";

import { useCallback, useEffect, useState } from "react";

import { Summary } from "@/types";

interface UseAISummaryHistoryArgs {
  currentSummary: Summary;
  summary: Summary | null;
  onSummaryChange: (summary: Summary) => void;
}

export function useAISummaryHistory({
  currentSummary,
  summary,
  onSummaryChange,
}: UseAISummaryHistoryArgs) {
  const [history, setHistory] = useState<Summary[]>([currentSummary]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(0);
  const [isUndoRedoing, setIsUndoRedoing] = useState(false);

  useEffect(() => {
    if (!isUndoRedoing && summary) {
      const newHistory = history.slice(0, currentHistoryIndex + 1);
      newHistory.push(summary);
      setHistory(newHistory);
      setCurrentHistoryIndex(newHistory.length - 1);
    }
    setIsUndoRedoing(false);
  }, [summary]);

  const handleUndo = useCallback(() => {
    if (currentHistoryIndex <= 0) return;

    setIsUndoRedoing(true);
    const newIndex = currentHistoryIndex - 1;
    setCurrentHistoryIndex(newIndex);
    onSummaryChange(history[newIndex]);
  }, [currentHistoryIndex, history, onSummaryChange]);

  const handleRedo = useCallback(() => {
    if (currentHistoryIndex >= history.length - 1) return;

    setIsUndoRedoing(true);
    const newIndex = currentHistoryIndex + 1;
    setCurrentHistoryIndex(newIndex);
    onSummaryChange(history[newIndex]);
  }, [currentHistoryIndex, history, onSummaryChange]);

  return { handleUndo, handleRedo };
}
