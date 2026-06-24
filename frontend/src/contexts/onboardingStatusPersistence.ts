"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useStatusPersistence(args: {
  currentStep: number;
  completed: boolean;
  parakeetDownloaded: boolean;
  summaryModelDownloaded: boolean;
  selectedSummaryModel: string;
  isCompletingRef: MutableRefObject<boolean>;
}) {
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  const saveOnboardingStatus = useCallback(async () => {
    if (args.isCompletingRef.current) {
      console.log(
        "[OnboardingContext] Skipping saveOnboardingStatus because completion is in progress",
      );
      return;
    }

    try {
      await invoke("save_onboarding_status_cmd", {
        status: {
          version: "1.0",
          completed: args.completed,
          current_step: args.currentStep,
          model_status: {
            parakeet: args.parakeetDownloaded ? "downloaded" : "not_downloaded",
            summary: args.summaryModelDownloaded ? "downloaded" : "not_downloaded",
            selected_summary_model: args.selectedSummaryModel || undefined,
          },
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("[OnboardingContext] Failed to save onboarding status:", error);
    }
  }, [args]);

  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (args.completed || args.isCompletingRef.current) return;

    saveTimeoutRef.current = setTimeout(() => {
      saveOnboardingStatus();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    args.currentStep,
    args.parakeetDownloaded,
    args.summaryModelDownloaded,
    args.completed,
    args.isCompletingRef,
    saveOnboardingStatus,
  ]);

  return { saveTimeoutRef, saveOnboardingStatus };
}
