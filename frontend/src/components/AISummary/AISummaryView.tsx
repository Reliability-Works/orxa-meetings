"use client";

import { Summary } from "@/types";
import { Section } from "./Section";
import { useAISummaryEditor } from "./useAISummaryEditor";

interface AISummaryViewProps {
  currentSummary: Summary;
  editor: ReturnType<typeof useAISummaryEditor>;
}

export function AISummaryView({ currentSummary, editor }: AISummaryViewProps) {
  return (
    <div className="relative">
      {editor.selectedBlocks.length > 1 && (
        <textarea
          ref={editor.hiddenInputRef}
          className="sr-only"
          readOnly
          value={editor.selectedBlocksContent()}
          tabIndex={-1}
        />
      )}

      <SummaryContextMenu editor={editor} />

      {Object.keys(currentSummary)
        .filter((key) => currentSummary[key]?.blocks?.length > 0)
        .map((key) => (
          <Section
            key={key}
            section={currentSummary[key]}
            sectionKey={key}
            selectedBlocks={editor.selectedBlocks}
            onBlockTypeChange={editor.handleBlockTypeChange}
            onBlockChange={(blockId, content) => editor.handleBlockChange(key, blockId, content)}
            onBlockMouseDown={(blockId, event) => editor.handleBlockMouseDown(blockId, event)}
            onBlockMouseEnter={editor.handleBlockMouseEnter}
            onBlockMouseUp={(blockId, event) => editor.handleBlockMouseUp(blockId, event)}
            onKeyDown={editor.handleKeyDown}
            onTitleChange={editor.handleTitleChange}
            onSectionDelete={editor.handleSectionDelete}
            onBlockDelete={editor.handleBlockDelete}
            onContextMenu={editor.handleContextMenu}
            onBlockNavigate={(blockId, direction) => editor.handleBlockNavigate(blockId, direction)}
            onCreateNewBlock={editor.handleCreateNewBlock}
          />
        ))}
    </div>
  );
}

function SummaryContextMenu({ editor }: Pick<AISummaryViewProps, "editor">) {
  if (!editor.contextMenu.visible || editor.selectedBlocks.length === 0) return null;

  return (
    <div
      className="fixed z-50 bg-white shadow-lg rounded-lg py-1 min-w-[160px] border border-gray-200 animate-in fade-in zoom-in-95 duration-150"
      style={{
        left: editor.contextMenu.x,
        top: editor.contextMenu.y,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center space-x-2"
        onClick={editor.handleCopyBlocks}
      >
        <span className="text-gray-600">Copy</span>
        <span>
          {editor.selectedBlocks.length > 1 ? `${editor.selectedBlocks.length} blocks` : "block"}
        </span>
      </button>
      <button
        className="w-full px-4 py-2 text-left hover:bg-gray-100 text-red-600 flex items-center space-x-2"
        onClick={editor.handleDeleteBlocks}
      >
        <span>
          Delete{" "}
          {editor.selectedBlocks.length > 1 ? `${editor.selectedBlocks.length} blocks` : "block"}
        </span>
      </button>
    </div>
  );
}
