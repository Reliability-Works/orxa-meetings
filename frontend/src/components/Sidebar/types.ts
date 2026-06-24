import type React from "react";

export interface SidebarItem {
  id: string;
  title: string;
  type: "folder" | "file";
  children?: SidebarItem[];
}

export interface CurrentMeeting {
  id: string;
  title: string;
}

export interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
}

export interface SidebarContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: React.Dispatch<React.SetStateAction<CurrentMeeting | null>>;
  sidebarItems: SidebarItem[];
  isCollapsed: boolean;
  toggleCollapse: () => void;
  meetings: CurrentMeeting[];
  setMeetings: React.Dispatch<React.SetStateAction<CurrentMeeting[]>>;
  isMeetingActive: boolean;
  setIsMeetingActive: React.Dispatch<React.SetStateAction<boolean>>;
  handleRecordingToggle: () => void;
  searchTranscripts: (query: string) => Promise<void>;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  setServerAddress: React.Dispatch<React.SetStateAction<string>>;
  serverAddress: string;
  transcriptServerAddress: string;
  setTranscriptServerAddress: React.Dispatch<React.SetStateAction<string>>;
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void,
  ) => void;
  stopSummaryPolling: (meetingId: string) => void;
  refetchMeetings: () => Promise<void>;
}

export interface SidebarRouter {
  push: (href: string) => void;
}
