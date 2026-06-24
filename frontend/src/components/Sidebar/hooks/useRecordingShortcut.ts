"use client";

import { useCallback } from "react";
import Analytics from "@/lib/analytics";
import type { SidebarRouter } from "../types";

interface UseRecordingShortcutParams {
  isRecording: boolean;
  pathname: string | null;
  router: SidebarRouter;
}

export function useRecordingShortcut({
  isRecording,
  pathname,
  router,
}: UseRecordingShortcutParams) {
  return useCallback(() => {
    if (isRecording) return;

    if (pathname === "/") {
      console.log("Triggering recording from sidebar (already on home page)");
      window.dispatchEvent(new CustomEvent("start-recording-from-sidebar"));
    } else {
      console.log("Navigating to home page with auto-start flag");
      sessionStorage.setItem("autoStartRecording", "true");
      router.push("/");
    }

    Analytics.trackButtonClick("start_recording", "sidebar");
  }, [isRecording, pathname, router]);
}
