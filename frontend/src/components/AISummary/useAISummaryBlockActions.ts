"use client";

import type { Dispatch, SetStateAction } from "react";

import { Block, Summary } from "@/types";
import { BlockLocation, findBlockLocation, generateUniqueId } from "./summaryEditorUtils";

interface UseAISummaryBlockActionsArgs {
  currentSummary: Summary;
  onSummaryChange: (summary: Summary) => void;
  setSelectedBlocks: Dispatch<SetStateAction<string[]>>;
  setLastSelectedBlock: Dispatch<SetStateAction<string | null>>;
}

export function useAISummaryBlockActions({
  currentSummary,
  onSummaryChange,
  setSelectedBlocks,
  setLastSelectedBlock,
}: UseAISummaryBlockActionsArgs) {
  const selectNearbyBlock = (updatedBlocks: Block[], removedIndex: number) => {
    if (updatedBlocks.length === 0) {
      setSelectedBlocks([]);
      setLastSelectedBlock(null);
      return;
    }

    const newSelectedBlock = updatedBlocks[Math.max(0, removedIndex - 1)];
    setSelectedBlocks([newSelectedBlock.id]);
    setLastSelectedBlock(newSelectedBlock.id);
  };

  const handleBlockChange = (sectionKey: string, blockId: string, newContent: string) => {
    onSummaryChange({
      ...currentSummary,
      [sectionKey]: {
        ...currentSummary[sectionKey],
        blocks: currentSummary[sectionKey].blocks.map((block) =>
          block.id === blockId ? { ...block, content: newContent } : block,
        ),
      },
    });
  };

  const handleBlockTypeChange = (blockId: string, newType: Block["type"]) => {
    const location = findBlockLocation(currentSummary, blockId);
    if (!location) return;

    onSummaryChange({
      ...currentSummary,
      [location.sectionKey]: {
        ...currentSummary[location.sectionKey],
        blocks: currentSummary[location.sectionKey].blocks.map((block) =>
          block.id === blockId ? { ...block, type: newType } : block,
        ),
      },
    });
  };

  const handleTitleChange = (sectionKey: string, newTitle: string) => {
    onSummaryChange({
      ...currentSummary,
      [sectionKey]: {
        ...currentSummary[sectionKey],
        title: newTitle,
      },
    });
  };

  const handleCreateNewBlock = (
    blockId: string,
    newBlockContent: string,
    blockType: Block["type"],
    currentBlockContent?: string,
  ) => {
    const location = findBlockLocation(currentSummary, blockId);
    if (!location) return;

    const newId = generateUniqueId(location.sectionKey);
    const updatedBlocks = [...currentSummary[location.sectionKey].blocks];
    const newBlockType = blockType === "bullet" ? "bullet" : "text";

    if (currentBlockContent !== undefined) {
      updatedBlocks[location.blockIndex] = { ...location.block, content: currentBlockContent };
    }

    updatedBlocks.splice(location.blockIndex + 1, 0, {
      id: newId,
      type: newBlockType,
      content: newBlockContent,
      color: location.block.color || "default",
    });

    updateSectionBlocks(currentSummary, onSummaryChange, location.sectionKey, updatedBlocks);
    setSelectedBlocks([newId]);
    setLastSelectedBlock(newId);
    focusBlock(newId, 0);
  };

  const handleBlockDelete = (blockId: string, mergeContent?: string) => {
    const location = findBlockLocation(currentSummary, blockId);
    if (!location) return;

    const updatedBlocks = [...currentSummary[location.sectionKey].blocks];
    if (mergeContent && location.blockIndex > 0) {
      mergeWithPreviousBlock(
        currentSummary,
        onSummaryChange,
        location,
        updatedBlocks,
        mergeContent,
      );
      setSelectedBlocks([updatedBlocks[location.blockIndex - 1].id]);
      setLastSelectedBlock(updatedBlocks[location.blockIndex - 1].id);
      return;
    }

    updatedBlocks.splice(location.blockIndex, 1);
    updateSectionBlocks(currentSummary, onSummaryChange, location.sectionKey, updatedBlocks);
    selectNearbyBlock(updatedBlocks, location.blockIndex);
  };

  const handleSectionDelete = (sectionKey: string) => {
    const newSummary = { ...currentSummary };
    delete newSummary[sectionKey];
    onSummaryChange(newSummary);
  };

  return {
    handleBlockChange,
    handleBlockTypeChange,
    handleTitleChange,
    handleCreateNewBlock,
    handleBlockDelete,
    handleSectionDelete,
  };
}

function mergeWithPreviousBlock(
  currentSummary: Summary,
  onSummaryChange: (summary: Summary) => void,
  location: BlockLocation,
  updatedBlocks: Block[],
  mergeContent: string,
) {
  const previousBlock = updatedBlocks[location.blockIndex - 1];
  const cursorPosition = previousBlock.content.length;
  updatedBlocks[location.blockIndex - 1] = {
    ...previousBlock,
    content: previousBlock.content + mergeContent,
  };
  updatedBlocks.splice(location.blockIndex, 1);
  updateSectionBlocks(currentSummary, onSummaryChange, location.sectionKey, updatedBlocks);
  focusBlock(previousBlock.id, cursorPosition);
}

function updateSectionBlocks(
  currentSummary: Summary,
  onSummaryChange: (summary: Summary) => void,
  sectionKey: string,
  blocks: Block[],
) {
  onSummaryChange({
    ...currentSummary,
    [sectionKey]: {
      ...currentSummary[sectionKey],
      blocks,
    },
  });
}

function focusBlock(blockId: string, cursorPosition: number) {
  window.setTimeout(() => {
    const textarea = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLTextAreaElement;
    if (!textarea) return;

    textarea.focus();
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }, 0);
}
