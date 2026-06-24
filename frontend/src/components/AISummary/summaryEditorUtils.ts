import type { MouseEvent } from "react";
import { Block, Summary } from "@/types";

export interface SummaryBlockRef {
  id: string;
  sectionKey: string;
}

export interface BlockLocation {
  sectionKey: string;
  blockIndex: number;
  block: Block;
}

export interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
}

export function createDefaultSummary(): Summary {
  return {
    Agenda: { title: "Agenda", blocks: [] },
    Decisions: { title: "Decisions", blocks: [] },
    ActionItems: { title: "Action Items", blocks: [] },
    ClosingRemarks: { title: "Closing Remarks", blocks: [] },
  };
}

export function generateUniqueId(sectionKey: string) {
  return `${sectionKey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function ensureUniqueBlockIds(summary: Summary): Summary {
  const updatedSummary: Summary = {};

  Object.entries(summary).forEach(([sectionKey, section]) => {
    if (section && Array.isArray(section.blocks)) {
      updatedSummary[sectionKey] = {
        ...section,
        blocks: section.blocks.map((block) => ({
          ...block,
          id: block.id.includes(sectionKey) ? block.id : generateUniqueId(sectionKey),
        })),
      };
      return;
    }

    updatedSummary[sectionKey] = {
      title: section?.title || sectionKey,
      blocks: [],
    };
  });

  return updatedSummary;
}

export function getAllBlocks(summary: Summary) {
  const allBlocks: SummaryBlockRef[] = [];

  Object.entries(summary).forEach(([sectionKey, section]) => {
    section.blocks.forEach((block) => {
      allBlocks.push({ id: block.id, sectionKey });
    });
  });

  return allBlocks;
}

export function getBlockRange(summary: Summary, startId: string, endId: string) {
  const allBlocks = getAllBlocks(summary);
  const startIndex = allBlocks.findIndex((block) => block.id === startId);
  const endIndex = allBlocks.findIndex((block) => block.id === endId);

  if (startIndex === -1 || endIndex === -1) return [];

  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);

  return allBlocks.slice(start, end + 1).map((block) => block.id);
}

export function findBlockLocation(summary: Summary, blockId: string): BlockLocation | null {
  for (const [sectionKey, section] of Object.entries(summary)) {
    const blockIndex = section.blocks.findIndex((block) => block.id === blockId);
    if (blockIndex !== -1) {
      return { sectionKey, blockIndex, block: section.blocks[blockIndex] };
    }
  }

  return null;
}

export function getSelectedBlocksContent(summary: Summary, selectedBlocks: string[]) {
  return selectedBlocks
    .map((blockId) => findBlockLocation(summary, blockId)?.block.content || "")
    .filter(Boolean)
    .join("\n");
}

export function deleteSelectedBlocks(summary: Summary, selectedBlocks: string[]) {
  const selectedBlockSet = new Set(selectedBlocks);
  const nextSummary: Summary = {};

  Object.entries(summary).forEach(([sectionKey, section]) => {
    nextSummary[sectionKey] = {
      ...section,
      blocks: section.blocks.filter((block) => !selectedBlockSet.has(block.id)),
    };
  });

  return nextSummary;
}

export function hasSummaryContent(summary: Summary) {
  return Object.values(summary).some(
    (section) =>
      section?.blocks?.length > 0 && section.blocks.some((block) => block.content.trim()),
  );
}

export function getContextMenuPosition(event: MouseEvent) {
  const menuWidth = 160;
  const menuHeight = 80;

  return {
    x: clamp(event.clientX, 10, window.innerWidth - menuWidth - 10),
    y: clamp(event.clientY, 10, window.innerHeight - menuHeight - 10),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
