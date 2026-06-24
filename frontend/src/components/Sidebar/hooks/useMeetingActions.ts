"use client";

import { useCallback, useState } from "react";
import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import Analytics from "@/lib/analytics";
import { INTRO_MEETING } from "../utils";
import type { CurrentMeeting, SidebarRouter } from "../types";

interface UseMeetingActionsParams {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: React.Dispatch<React.SetStateAction<CurrentMeeting | null>>;
  meetings: CurrentMeeting[];
  setMeetings: React.Dispatch<React.SetStateAction<CurrentMeeting[]>>;
  router: SidebarRouter;
}

export function useMeetingActions({
  currentMeeting,
  setCurrentMeeting,
  meetings,
  setMeetings,
  router,
}: UseMeetingActionsParams) {
  const [deleteModalState, setDeleteModalState] = useState({
    isOpen: false,
    itemId: null as string | null,
  });
  const [editModalState, setEditModalState] = useState({
    isOpen: false,
    meetingId: null as string | null,
    currentTitle: "",
  });
  const [editingTitle, setEditingTitle] = useState("");

  const handleDelete = useCallback(
    async (itemId: string) => {
      try {
        await invoke("api_delete_meeting", { meetingId: itemId });
        setMeetings(meetings.filter((meeting) => meeting.id !== itemId));
        Analytics.trackMeetingDeleted(itemId);
        toast.success("Meeting deleted successfully");

        if (currentMeeting?.id === itemId) {
          setCurrentMeeting(INTRO_MEETING);
          router.push("/");
        }
      } catch (error) {
        console.error("Failed to delete meeting:", error);
        toast.error("Failed to delete meeting", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [currentMeeting?.id, meetings, router, setCurrentMeeting, setMeetings],
  );

  const requestDeleteMeeting = useCallback((itemId: string) => {
    setDeleteModalState({ isOpen: true, itemId });
  }, []);

  const confirmDeleteMeeting = useCallback(() => {
    if (deleteModalState.itemId) {
      void handleDelete(deleteModalState.itemId);
    }

    setDeleteModalState({ isOpen: false, itemId: null });
  }, [deleteModalState.itemId, handleDelete]);

  const cancelDeleteMeeting = useCallback(() => {
    setDeleteModalState({ isOpen: false, itemId: null });
  }, []);

  const startEditMeeting = useCallback((meetingId: string, currentTitle: string) => {
    setEditModalState({ isOpen: true, meetingId, currentTitle });
    setEditingTitle(currentTitle);
  }, []);

  const cancelEditMeeting = useCallback(() => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: "" });
    setEditingTitle("");
  }, []);

  const confirmEditMeeting = useCallback(async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke("api_save_meeting_title", { meetingId, title: newTitle });
      setMeetings(
        meetings.map((meeting) =>
          meeting.id === meetingId ? { ...meeting, title: newTitle } : meeting,
        ),
      );

      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      Analytics.trackButtonClick("edit_meeting_title", "sidebar");
      toast.success("Meeting title updated successfully");
      cancelEditMeeting();
    } catch (error) {
      console.error("Failed to update meeting title:", error);
      toast.error("Failed to update meeting title", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    cancelEditMeeting,
    currentMeeting?.id,
    editModalState.meetingId,
    editingTitle,
    meetings,
    setCurrentMeeting,
    setMeetings,
  ]);

  return {
    deleteModalState,
    requestDeleteMeeting,
    confirmDeleteMeeting,
    cancelDeleteMeeting,
    editModalState,
    editingTitle,
    setEditingTitle,
    startEditMeeting,
    confirmEditMeeting,
    cancelEditMeeting,
  };
}
