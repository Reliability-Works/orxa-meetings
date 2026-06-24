"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Analytics from "@/lib/analytics";
import { INTRO_MEETING } from "../utils";
import type { CurrentMeeting, SidebarItem } from "../types";

interface BackendMeeting {
  id: string;
  title: string;
}

function buildSidebarItems(meetings: CurrentMeeting[]): SidebarItem[] {
  return [
    {
      id: "meetings",
      title: "Meeting Notes",
      type: "folder",
      children: meetings.map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        type: "file",
      })),
    },
  ];
}

export function useSidebarMeetings(serverAddress: string, pathname: string | null) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>(INTRO_MEETING);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);

  const fetchMeetings = useCallback(async () => {
    if (!serverAddress) return;

    try {
      const backendMeetings = await invoke<BackendMeeting[]>("api_get_meetings");
      setMeetings(backendMeetings.map(({ id, title }) => ({ id, title })));
      Analytics.trackBackendConnection(true);
    } catch (error) {
      console.error("Error fetching meetings:", error);
      setMeetings([]);
      Analytics.trackBackendConnection(
        false,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }, [serverAddress]);

  useEffect(() => {
    void fetchMeetings();
  }, [fetchMeetings]);

  useEffect(() => {
    if (pathname === "/") {
      setCurrentMeeting(INTRO_MEETING);
    }
  }, [pathname]);

  return {
    currentMeeting,
    setCurrentMeeting,
    meetings,
    setMeetings,
    sidebarItems: useMemo(() => buildSidebarItems(meetings), [meetings]),
    refetchMeetings: fetchMeetings,
  };
}
