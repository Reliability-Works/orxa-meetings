"use client";

import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";

import { ContextMenuState, getContextMenuPosition } from "./summaryEditorUtils";

interface UseAISummaryContextMenuArgs {
  selectedBlocksContent: () => string;
  onDeleteSelectedBlocks: () => void;
}

export function useAISummaryContextMenu({
  selectedBlocksContent,
  onDeleteSelectedBlocks,
}: UseAISummaryContextMenuArgs) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    visible: false,
  });

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    setContextMenu({ ...getContextMenuPosition(event), visible: true });
  };

  const handleCopyBlocks = useCallback(() => {
    navigator.clipboard.writeText(selectedBlocksContent());
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [selectedBlocksContent]);

  const handleDeleteBlocks = () => {
    onDeleteSelectedBlocks();
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  return {
    contextMenu,
    handleContextMenu,
    handleCopyBlocks,
    handleDeleteBlocks,
  };
}
