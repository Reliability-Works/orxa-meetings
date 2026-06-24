"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ChatSession } from "@/types";
import { chatMatchesQuery } from "../utils";
import type { CurrentMeeting, SidebarRouter } from "../types";

interface UseGlobalSearchParams {
  chatSessions: ChatSession[];
  meetings: CurrentMeeting[];
  searchTranscripts: (query: string) => Promise<void>;
  setCurrentMeeting: React.Dispatch<React.SetStateAction<CurrentMeeting | null>>;
  setActiveChatId: React.Dispatch<React.SetStateAction<string | null>>;
  router: SidebarRouter;
}

export function useGlobalSearch({
  chatSessions,
  meetings,
  searchTranscripts,
  setCurrentMeeting,
  setActiveChatId,
  router,
}: UseGlobalSearchParams) {
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (globalSearchOpen) {
      globalSearchInputRef.current?.focus();
    }
  }, [globalSearchOpen]);

  const globalSearchMatches = useMemo(() => {
    const query = globalSearchQuery.trim().toLowerCase();
    if (!query) {
      return { chats: [] as ChatSession[], meetings: [] as CurrentMeeting[] };
    }

    return {
      chats: chatSessions.filter((session) => chatMatchesQuery(session, query)),
      meetings: meetings.filter((meeting) => meeting.title.toLowerCase().includes(query)),
    };
  }, [chatSessions, globalSearchQuery, meetings]);

  useEffect(() => {
    const query = globalSearchQuery.trim();
    if (!query) {
      void searchTranscripts("");
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchTranscripts(query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [globalSearchQuery, searchTranscripts]);

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true);
  }, []);

  const closeGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
    void searchTranscripts("");
  }, [searchTranscripts]);

  const clearGlobalSearch = useCallback(() => {
    setGlobalSearchQuery("");
    void searchTranscripts("");
    globalSearchInputRef.current?.focus();
  }, [searchTranscripts]);

  const openMeetingFromSearch = useCallback(
    (meeting: CurrentMeeting) => {
      setCurrentMeeting({ id: meeting.id, title: meeting.title });
      closeGlobalSearch();
      router.push(`/meeting-details?id=${meeting.id}`);
    },
    [closeGlobalSearch, router, setCurrentMeeting],
  );

  const openChatFromSearch = useCallback(
    (session: ChatSession) => {
      setActiveChatId(session.id);
      closeGlobalSearch();
      router.push(`/chat?id=${session.id}`);
    },
    [closeGlobalSearch, router, setActiveChatId],
  );

  return {
    globalSearchOpen,
    globalSearchQuery,
    setGlobalSearchOpen,
    setGlobalSearchQuery,
    globalSearchInputRef,
    globalSearchMatches,
    openGlobalSearch,
    closeGlobalSearch,
    clearGlobalSearch,
    openMeetingFromSearch,
    openChatFromSearch,
  };
}
