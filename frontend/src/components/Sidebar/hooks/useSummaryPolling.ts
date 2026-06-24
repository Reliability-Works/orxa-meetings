"use client";

import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTerminalSummaryStatus } from "../utils";

const SUMMARY_POLL_INTERVAL_MS = 5000;
const MAX_SUMMARY_POLLS = 200;

function removeSummaryPoll(
  setActiveSummaryPolls: React.Dispatch<React.SetStateAction<Map<string, NodeJS.Timeout>>>,
  meetingId: string,
) {
  setActiveSummaryPolls((prev) => {
    const next = new Map(prev);
    next.delete(meetingId);
    return next;
  });
}

function clearSummaryPoll(
  pollInterval: NodeJS.Timeout,
  setActiveSummaryPolls: React.Dispatch<React.SetStateAction<Map<string, NodeJS.Timeout>>>,
  meetingId: string,
) {
  clearInterval(pollInterval);
  removeSummaryPoll(setActiveSummaryPolls, meetingId);
}

export function useSummaryPolling() {
  const [activeSummaryPolls, setActiveSummaryPolls] = useState<Map<string, NodeJS.Timeout>>(
    new Map(),
  );

  const startSummaryPolling = useCallback(
    (meetingId: string, processId: string, onUpdate: (result: any) => void) => {
      const existingPoll = activeSummaryPolls.get(meetingId);
      if (existingPoll) {
        clearInterval(existingPoll);
      }

      console.log(`📊 Starting polling for meeting ${meetingId}, process ${processId}`);

      let pollCount = 0;
      const pollInterval = setInterval(async () => {
        pollCount += 1;

        if (pollCount >= MAX_SUMMARY_POLLS) {
          console.warn(`⏱️ Polling timeout for ${meetingId} after ${MAX_SUMMARY_POLLS} iterations`);
          clearSummaryPoll(pollInterval, setActiveSummaryPolls, meetingId);
          onUpdate({
            status: "error",
            error:
              "Summary generation timed out after 15 minutes. Please try again or check your model configuration.",
          });
          return;
        }

        try {
          const result = (await invoke("api_get_summary", { meetingId })) as any;
          console.log(`📊 Polling update for ${meetingId}:`, result.status);
          onUpdate(result);

          if (isTerminalSummaryStatus(result.status)) {
            console.log(`Polling completed for ${meetingId}, status: ${result.status}`);
            clearSummaryPoll(pollInterval, setActiveSummaryPolls, meetingId);
            return;
          }

          if (result.status === "idle" && pollCount > 1) {
            console.log(`Process completed or not found for ${meetingId}, stopping poll`);
            clearSummaryPoll(pollInterval, setActiveSummaryPolls, meetingId);
          }
        } catch (error) {
          console.error(`Polling error for ${meetingId}:`, error);
          onUpdate({
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          clearSummaryPoll(pollInterval, setActiveSummaryPolls, meetingId);
        }
      }, SUMMARY_POLL_INTERVAL_MS);

      setActiveSummaryPolls((prev) => new Map(prev).set(meetingId, pollInterval));
    },
    [activeSummaryPolls],
  );

  const stopSummaryPolling = useCallback(
    (meetingId: string) => {
      const pollInterval = activeSummaryPolls.get(meetingId);
      if (!pollInterval) return;

      console.log(`⏹️ Stopping polling for meeting ${meetingId}`);
      clearSummaryPoll(pollInterval, setActiveSummaryPolls, meetingId);
    },
    [activeSummaryPolls],
  );

  useEffect(() => {
    return () => {
      console.log("🧹 Cleaning up all summary polling intervals");
      activeSummaryPolls.forEach((interval) => clearInterval(interval));
    };
  }, [activeSummaryPolls]);

  return {
    activeSummaryPolls,
    startSummaryPolling,
    stopSummaryPolling,
  };
}
