"use client";

import React from "react";
import { ConfirmationModal } from "../ConfirmationModel/confirmation-modal";
import { ChatSection } from "./components/ChatSection";
import { EditMeetingTitleDialog } from "./components/EditMeetingTitleDialog";
import { GlobalSearchDialog } from "./components/GlobalSearchDialog";
import { MeetingSection } from "./components/MeetingSection";
import { SidebarFooter } from "./components/SidebarFooter";
import { TitlebarControls } from "./components/TitlebarControls";
import { TopNav } from "./components/TopNav";
import { useSidebarController } from "./hooks/useSidebarController";

const Sidebar: React.FC = () => {
  const sidebar = useSidebarController();

  if (sidebar.isFullScreenRoute || sidebar.isCollapsed) {
    return (
      <TitlebarControls
        isCollapsed={sidebar.isCollapsed}
        onToggle={sidebar.toggleCollapse}
        variant="floating"
      />
    );
  }

  return (
    <div
      className="fixed left-0 top-0 z-40 h-screen bg-white"
      style={{ width: sidebar.sidebarWidth }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-px bg-gray-200"
      />
      <div
        className={`relative flex h-screen flex-col bg-white ${
          sidebar.isResizing ? "" : "transition-[width] duration-200"
        }`}
        style={{ width: sidebar.sidebarWidth }}
      >
        <button
          type="button"
          aria-label="Resize sidebar"
          className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize bg-transparent hover:bg-gray-200"
          onMouseDown={sidebar.startResizing}
        />
        <TitlebarControls
          isCollapsed={sidebar.isCollapsed}
          onToggle={sidebar.toggleCollapse}
          variant="inline"
        />
        <TopNav
          pathname={sidebar.pathname}
          onNavigate={sidebar.navigate}
          onSearch={sidebar.globalSearch.openGlobalSearch}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
          <ChatSection {...sidebar.chatSection} />
          <MeetingSection
            {...sidebar.meetingSection}
            currentMeeting={sidebar.currentMeeting}
            pathname={sidebar.pathname}
            isRecording={sidebar.isRecording}
            onRecordingToggle={sidebar.handleRecordingToggle}
          />
        </div>
        <SidebarFooter
          pathname={sidebar.pathname}
          importEnabled={sidebar.importAndRetranscribeEnabled}
          updateVersion={sidebar.updateInfo?.version}
          updateAvailable={sidebar.updateInfo?.available}
          isDownloading={sidebar.isUpdateDownloading}
          updateProgress={sidebar.updateProgress}
          updateError={sidebar.updateError}
          onImportAudio={sidebar.openImportDialog}
          onSettings={() => sidebar.navigate("/settings")}
          onUpdateClick={sidebar.handleUpdateClick}
        />
      </div>

      <ConfirmationModal
        isOpen={sidebar.meetingActions.deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={sidebar.meetingActions.confirmDeleteMeeting}
        onCancel={sidebar.meetingActions.cancelDeleteMeeting}
      />
      <GlobalSearchDialog
        open={sidebar.globalSearch.globalSearchOpen}
        query={sidebar.globalSearch.globalSearchQuery}
        inputRef={sidebar.globalSearch.globalSearchInputRef}
        matches={sidebar.globalSearch.globalSearchMatches}
        transcriptResults={sidebar.searchResults}
        isSearching={sidebar.isSearching}
        onOpenChange={(open) => {
          if (open) {
            sidebar.globalSearch.setGlobalSearchOpen(true);
          } else {
            sidebar.globalSearch.closeGlobalSearch();
          }
        }}
        onQueryChange={sidebar.globalSearch.setGlobalSearchQuery}
        onClear={sidebar.globalSearch.clearGlobalSearch}
        onOpenChat={sidebar.globalSearch.openChatFromSearch}
        onOpenMeeting={sidebar.globalSearch.openMeetingFromSearch}
      />
      <EditMeetingTitleDialog
        open={sidebar.meetingActions.editModalState.isOpen}
        title={sidebar.meetingActions.editingTitle}
        onTitleChange={sidebar.meetingActions.setEditingTitle}
        onConfirm={() => void sidebar.meetingActions.confirmEditMeeting()}
        onCancel={sidebar.meetingActions.cancelEditMeeting}
      />
    </div>
  );
};

export default Sidebar;
