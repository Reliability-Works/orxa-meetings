"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, MouseEvent, RefObject, SetStateAction } from "react";

import { Summary } from "@/types";
import {
  deleteSelectedBlocks,
  getAllBlocks,
  getBlockRange,
  getSelectedBlocksContent,
} from "./summaryEditorUtils";

interface UseAISummarySelectionArgs {
  currentSummary: Summary;
  onSummaryChange: (summary: Summary) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export interface SummarySelectionState {
  selectedBlocks: string[];
  setSelectedBlocks: Dispatch<SetStateAction<string[]>>;
  setLastSelectedBlock: Dispatch<SetStateAction<string | null>>;
  hiddenInputRef: RefObject<HTMLTextAreaElement>;
  selectedBlocksContent: () => string;
  handleDeleteSelectedBlocks: () => void;
  handleBlockNavigate: (blockId: string, direction: "up" | "down") => void;
  handleBlockMouseDown: (blockId: string, event: MouseEvent<HTMLDivElement>) => void;
  handleBlockMouseEnter: (blockId: string) => void;
  handleBlockMouseUp: (blockId: string, event: MouseEvent<HTMLDivElement>) => void;
  handleKeyDown: (event: KeyboardEvent, blockId: string) => void;
}

export function useAISummarySelection({
  currentSummary,
  onSummaryChange,
  onUndo,
  onRedo,
}: UseAISummarySelectionArgs): SummarySelectionState {
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [lastSelectedBlock, setLastSelectedBlock] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartBlock, setDragStartBlock] = useState<string | null>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);

  const selectedBlocksContent = useCallback(
    () => getSelectedBlocksContent(currentSummary, selectedBlocks),
    [currentSummary, selectedBlocks],
  );

  const handleDeleteSelectedBlocks = useCallback(() => {
    onSummaryChange(deleteSelectedBlocks(currentSummary, selectedBlocks));
    setSelectedBlocks([]);
    setLastSelectedBlock(null);
  }, [currentSummary, onSummaryChange, selectedBlocks]);

  useEffect(() => {
    if (hiddenInputRef.current && selectedBlocks.length > 1) {
      hiddenInputRef.current.value = selectedBlocksContent();
      hiddenInputRef.current.select();
    }
  }, [selectedBlocks, selectedBlocksContent]);

  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (handleShortcutKeyDown(event, onUndo, onRedo, selectedBlocksContent)) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedBlocks.length > 1) {
        event.preventDefault();
        handleDeleteSelectedBlocks();
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleDeleteSelectedBlocks, onRedo, onUndo, selectedBlocks, selectedBlocksContent]);

  const handleBlockNavigate = (blockId: string, direction: "up" | "down") => {
    const allBlocks = getAllBlocks(currentSummary);
    const currentIndex = allBlocks.findIndex((block) => block.id === blockId);
    if (currentIndex === -1) return;

    const targetIndex =
      direction === "up"
        ? Math.max(0, currentIndex - 1)
        : Math.min(allBlocks.length - 1, currentIndex + 1);
    if (targetIndex === currentIndex) return;

    const targetBlock = allBlocks[targetIndex];
    setSelectedBlocks([targetBlock.id]);
    setLastSelectedBlock(targetBlock.id);
  };

  const handleBlockMouseDown = (blockId: string, event: MouseEvent<HTMLDivElement>) => {
    if (!event.shiftKey) {
      setDragStartBlock(blockId);
      setLastSelectedBlock(blockId);
      setSelectedBlocks([blockId]);
    }
    setIsDragging(true);
  };

  const handleBlockMouseEnter = (blockId: string) => {
    if (isDragging && dragStartBlock) {
      setSelectedBlocks(getBlockRange(currentSummary, dragStartBlock, blockId));
    }
  };

  const handleBlockMouseUp = (blockId: string, event: MouseEvent<HTMLDivElement>) => {
    if (event.shiftKey && lastSelectedBlock) {
      setSelectedBlocks(getBlockRange(currentSummary, lastSelectedBlock, blockId));
    }
    setIsDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent, _blockId: string) => {
    if ((event.key === "Delete" || event.key === "Backspace") && selectedBlocks.length > 1) {
      event.preventDefault();
      handleDeleteSelectedBlocks();
    }
  };

  return {
    selectedBlocks,
    setSelectedBlocks,
    setLastSelectedBlock,
    hiddenInputRef,
    selectedBlocksContent,
    handleDeleteSelectedBlocks,
    handleBlockNavigate,
    handleBlockMouseDown,
    handleBlockMouseEnter,
    handleBlockMouseUp,
    handleKeyDown,
  };
}

function handleShortcutKeyDown(
  event: globalThis.KeyboardEvent,
  onUndo: () => void,
  onRedo: () => void,
  selectedBlocksContent: () => string,
) {
  if (!event.metaKey && !event.ctrlKey) return false;

  if (event.key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      onRedo();
    } else {
      onUndo();
    }
    return true;
  }

  if (event.key === "c") {
    navigator.clipboard.writeText(selectedBlocksContent());
    return true;
  }

  return false;
}
