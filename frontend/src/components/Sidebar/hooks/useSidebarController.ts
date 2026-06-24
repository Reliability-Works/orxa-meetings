"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ChatSession } from "@/types";
import { useConfig } from "@/contexts/ConfigContext";
import { useImportDialog } from "@/contexts/ImportDialogContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { useUpdateCheckContext } from "@/components/UpdateCheckProvider";
import { useSidebar } from "../SidebarProvider";
import { chatMatchesQuery } from "../utils";
import type { CurrentMeeting } from "../types";
import { useChatSessions } from "./useChatSessions";
import { useGlobalSearch } from "./useGlobalSearch";
import { useMeetingActions } from "./useMeetingActions";
import { useSidebarLayout } from "./useSidebarLayout";

export function useSidebarController() {
  const router = useRouter();
  const pathname = usePathname();
  const sidebar = useSidebar();
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const update = useUpdateCheckContext();
  const layout = useSidebarLayout(sidebar.isCollapsed);
  const chats = useChatSessions(pathname);

  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [meetingSearchOpen, setMeetingSearchOpen] = useState(false);
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [meetingsCollapsed, setMeetingsCollapsed] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [meetingSearchQuery, setMeetingSearchQuery] = useState("");

  const meetingActions = useMeetingActions({
    currentMeeting: sidebar.currentMeeting,
    setCurrentMeeting: sidebar.setCurrentMeeting,
    meetings: sidebar.meetings,
    setMeetings: sidebar.setMeetings,
    router,
  });
  const globalSearch = useGlobalSearch({
    chatSessions: chats.chatSessions,
    meetings: sidebar.meetings,
    searchTranscripts: sidebar.searchTranscripts,
    setCurrentMeeting: sidebar.setCurrentMeeting,
    setActiveChatId: chats.setActiveChatId,
    router,
  });

  const filteredChats = useMemo(() => {
    const query = chatSearchQuery.trim().toLowerCase();
    if (!query) return chats.chatSessions;

    return chats.chatSessions.filter((session) => chatMatchesQuery(session, query));
  }, [chatSearchQuery, chats.chatSessions]);

  const filteredMeetings = useMemo(() => {
    const query = meetingSearchQuery.trim().toLowerCase();
    if (!query) return sidebar.meetings;

    return sidebar.meetings.filter((meeting) => meeting.title.toLowerCase().includes(query));
  }, [meetingSearchQuery, sidebar.meetings]);

  const navigate = useCallback((href: string) => router.push(href), [router]);

  const openChat = useCallback(
    (session: ChatSession) => {
      chats.setActiveChatId(session.id);
      router.push(`/chat?id=${session.id}`);
    },
    [chats, router],
  );

  const createChat = useCallback(() => {
    chats.setActiveChatId(null);
    router.push("/chat");
  }, [chats, router]);

  const openMeeting = useCallback(
    (meeting: CurrentMeeting) => {
      sidebar.setCurrentMeeting({ id: meeting.id, title: meeting.title });
      router.push(`/meeting-details?id=${meeting.id}`);
    },
    [router, sidebar],
  );

  const handleUpdateClick = useCallback(() => {
    if (update.isDownloading || update.updateError) {
      update.showUpdateDialog();
      return;
    }

    void update.installUpdate();
  }, [update]);

  return {
    ...sidebar,
    ...layout,
    pathname,
    isRecording,
    isFullScreenRoute: pathname?.startsWith("/settings"),
    navigate,
    openImportDialog,
    importAndRetranscribeEnabled: betaFeatures.importAndRetranscribe,
    chatSection: {
      sessions: filteredChats,
      activeChatId: chats.activeChatId,
      collapsed: chatsCollapsed,
      searchOpen: chatSearchOpen,
      searchQuery: chatSearchQuery,
      onToggle: () => setChatsCollapsed((collapsed) => !collapsed),
      onToggleSearch: () => setChatSearchOpen((open) => !open),
      onSearchChange: setChatSearchQuery,
      onClearSearch: () => setChatSearchQuery(""),
      onOpenChat: openChat,
      onCreateChat: createChat,
    },
    meetingSection: {
      meetings: filteredMeetings,
      collapsed: meetingsCollapsed,
      searchOpen: meetingSearchOpen,
      searchQuery: meetingSearchQuery,
      onToggle: () => setMeetingsCollapsed((collapsed) => !collapsed),
      onToggleSearch: () => setMeetingSearchOpen((open) => !open),
      onSearchChange: setMeetingSearchQuery,
      onClearSearch: () => setMeetingSearchQuery(""),
      onOpenMeeting: openMeeting,
      onEditMeeting: meetingActions.startEditMeeting,
      onDeleteMeeting: meetingActions.requestDeleteMeeting,
    },
    globalSearch,
    meetingActions,
    updateInfo: update.updateInfo,
    isUpdateDownloading: update.isDownloading,
    updateProgress: update.updateProgress?.percentage ?? 0,
    updateError: update.updateError,
    handleUpdateClick,
  };
}
