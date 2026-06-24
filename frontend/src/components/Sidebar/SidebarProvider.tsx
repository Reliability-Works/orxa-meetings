"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { useRecordingShortcut } from "./hooks/useRecordingShortcut";
import { useSidebarMeetings } from "./hooks/useSidebarMeetings";
import { useSummaryPolling } from "./hooks/useSummaryPolling";
import { useTranscriptSearch } from "./hooks/useTranscriptSearch";
import type { SidebarContextType } from "./types";

export type { CurrentMeeting } from "./types";

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [serverAddress, setServerAddress] = useState("");
  const [transcriptServerAddress, setTranscriptServerAddress] = useState("");

  const pathname = usePathname();
  const router = useRouter();
  const { isRecording } = useRecordingState();

  const meetingsState = useSidebarMeetings(serverAddress, pathname);
  const searchState = useTranscriptSearch();
  const pollingState = useSummaryPolling();
  const toggleCollapse = useCallback(() => {
    setIsCollapsed((collapsed) => !collapsed);
  }, []);
  const handleRecordingToggle = useRecordingShortcut({
    isRecording,
    pathname,
    router,
  });

  useEffect(() => {
    setServerAddress("http://localhost:5167");
    setTranscriptServerAddress("http://127.0.0.1:8178/stream");
  }, []);

  const value = useMemo<SidebarContextType>(
    () => ({
      currentMeeting: meetingsState.currentMeeting,
      setCurrentMeeting: meetingsState.setCurrentMeeting,
      sidebarItems: meetingsState.sidebarItems,
      isCollapsed,
      toggleCollapse,
      meetings: meetingsState.meetings,
      setMeetings: meetingsState.setMeetings,
      isMeetingActive,
      setIsMeetingActive,
      handleRecordingToggle,
      searchTranscripts: searchState.searchTranscripts,
      searchResults: searchState.searchResults,
      isSearching: searchState.isSearching,
      setServerAddress,
      serverAddress,
      transcriptServerAddress,
      setTranscriptServerAddress,
      activeSummaryPolls: pollingState.activeSummaryPolls,
      startSummaryPolling: pollingState.startSummaryPolling,
      stopSummaryPolling: pollingState.stopSummaryPolling,
      refetchMeetings: meetingsState.refetchMeetings,
    }),
    [
      handleRecordingToggle,
      isCollapsed,
      isMeetingActive,
      meetingsState,
      pollingState,
      searchState,
      serverAddress,
      toggleCollapse,
      transcriptServerAddress,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
