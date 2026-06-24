"use client";

import { Summary } from "@/types";
import { useAISummaryBlockActions } from "./useAISummaryBlockActions";
import { useAISummaryContextMenu } from "./useAISummaryContextMenu";
import { useAISummaryHistory } from "./useAISummaryHistory";
import { useAISummarySelection } from "./useAISummarySelection";

interface UseAISummaryEditorArgs {
  currentSummary: Summary;
  summary: Summary | null;
  onSummaryChange: (summary: Summary) => void;
}

export function useAISummaryEditor({
  currentSummary,
  summary,
  onSummaryChange,
}: UseAISummaryEditorArgs) {
  const history = useAISummaryHistory({ currentSummary, summary, onSummaryChange });
  const selection = useAISummarySelection({
    currentSummary,
    onSummaryChange,
    onUndo: history.handleUndo,
    onRedo: history.handleRedo,
  });
  const blockActions = useAISummaryBlockActions({
    currentSummary,
    onSummaryChange,
    setSelectedBlocks: selection.setSelectedBlocks,
    setLastSelectedBlock: selection.setLastSelectedBlock,
  });
  const contextMenu = useAISummaryContextMenu({
    selectedBlocksContent: selection.selectedBlocksContent,
    onDeleteSelectedBlocks: selection.handleDeleteSelectedBlocks,
  });

  return {
    selectedBlocks: selection.selectedBlocks,
    hiddenInputRef: selection.hiddenInputRef,
    selectedBlocksContent: selection.selectedBlocksContent,
    contextMenu: contextMenu.contextMenu,
    handleBlockNavigate: selection.handleBlockNavigate,
    handleBlockMouseDown: selection.handleBlockMouseDown,
    handleBlockMouseEnter: selection.handleBlockMouseEnter,
    handleBlockMouseUp: selection.handleBlockMouseUp,
    handleKeyDown: selection.handleKeyDown,
    handleContextMenu: contextMenu.handleContextMenu,
    handleCopyBlocks: contextMenu.handleCopyBlocks,
    handleDeleteBlocks: contextMenu.handleDeleteBlocks,
    ...blockActions,
  };
}
