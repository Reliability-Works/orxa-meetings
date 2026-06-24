"use client";

import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveOnboardingSummaryModelStatus } from "@/lib/onboarding-summary-model";
import type { OnboardingStatus } from "./onboardingContextTypes";

function isDownloadingStatus(status: any) {
  if (!status) return false;
  return typeof status === "object" ? "Downloading" in status : status === "Downloading";
}

async function verifyParakeetStatus() {
  try {
    await invoke("parakeet_init");
    const parakeetDownloaded = await invoke<boolean>("parakeet_has_available_models");
    console.log("[OnboardingContext] Parakeet verified on disk:", parakeetDownloaded);
    return parakeetDownloaded;
  } catch (error) {
    console.warn("[OnboardingContext] Failed to verify Parakeet:", error);
    return false;
  }
}

async function verifySummaryStatus(savedStatus: OnboardingStatus) {
  try {
    const recommendedModel = await invoke<string>("builtin_ai_get_recommended_model");
    const savedSelectedModel = savedStatus.model_status.selected_summary_model || "";
    const modelToCheck = savedSelectedModel || recommendedModel;
    const selectedModelReady = await invoke<boolean>("builtin_ai_is_model_ready", {
      modelName: modelToCheck,
      refresh: true,
    });
    const resolved = resolveOnboardingSummaryModelStatus({
      selectedModel: savedSelectedModel,
      recommendedModel,
      selectedModelReady,
    });

    console.log(
      "[OnboardingContext] Summary model verified on disk:",
      resolved.summaryModelDownloaded,
      "model:",
      resolved.selectedSummaryModel,
    );

    return { recommendedModel, ...resolved };
  } catch (error) {
    console.warn("[OnboardingContext] Failed to verify Summary model:", error);
    return {
      recommendedModel: "",
      selectedSummaryModel: "",
      summaryModelDownloaded: false,
    };
  }
}

async function verifyModelStatus(savedStatus: OnboardingStatus) {
  const parakeetDownloaded = await verifyParakeetStatus();
  const summaryStatus = await verifySummaryStatus(savedStatus);
  const currentStep = savedStatus.current_step > 4 ? 3 : savedStatus.current_step;

  return {
    currentStep,
    completed: savedStatus.completed,
    parakeetDownloaded,
    summaryModelDownloaded: summaryStatus.summaryModelDownloaded,
    selectedSummaryModel: summaryStatus.selectedSummaryModel,
    recommendedSummaryModel: summaryStatus.recommendedModel,
  };
}

async function checkActiveDownloads(setIsBackgroundDownloading: (value: boolean) => void) {
  try {
    const models = await invoke<any[]>("parakeet_get_available_models");
    const isDownloading = models.some((model) => isDownloadingStatus(model.status));

    if (isDownloading) {
      console.log("[OnboardingContext] Detected active background downloads on mount");
      setIsBackgroundDownloading(true);
    }
  } catch (error) {
    console.warn("[OnboardingContext] Failed to check active downloads:", error);
  }
}

export function useOnboardingStatusLoader(args: {
  initializeSummaryModelSelection: () => Promise<any>;
  setCurrentStep: (value: number) => void;
  setCompleted: (value: boolean) => void;
  setParakeetDownloaded: (value: boolean) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
  setSelectedSummaryModel: (value: string) => void;
  setRecommendedSummaryModel: (value: string) => void;
  setIsBackgroundDownloading: (value: boolean) => void;
}) {
  return useCallback(async () => {
    try {
      const status = await invoke<OnboardingStatus | null>("get_onboarding_status");
      if (!status) {
        await args.initializeSummaryModelSelection();
        return;
      }

      console.log("[OnboardingContext] Loaded saved status:", status);
      if (status.completed) {
        args.setCurrentStep(status.current_step);
        args.setCompleted(true);
        args.setParakeetDownloaded(status.model_status.parakeet === "downloaded");
        args.setSummaryModelDownloaded(status.model_status.summary === "downloaded");
        if (status.model_status.selected_summary_model) {
          args.setSelectedSummaryModel(status.model_status.selected_summary_model);
        }
        console.log(
          "[OnboardingContext] Restored completed onboarding status without model verification",
        );
        return;
      }

      const verifiedStatus = await verifyModelStatus(status);
      args.setCurrentStep(verifiedStatus.currentStep);
      args.setCompleted(verifiedStatus.completed);
      args.setParakeetDownloaded(verifiedStatus.parakeetDownloaded);
      args.setSummaryModelDownloaded(verifiedStatus.summaryModelDownloaded);
      args.setRecommendedSummaryModel(verifiedStatus.recommendedSummaryModel);
      if (verifiedStatus.selectedSummaryModel) {
        args.setSelectedSummaryModel(verifiedStatus.selectedSummaryModel);
      }
      console.log("[OnboardingContext] Verified status:", verifiedStatus);
      await checkActiveDownloads(args.setIsBackgroundDownloading);
    } catch (error) {
      console.error("[OnboardingContext] Failed to load onboarding status:", error);
    }
  }, [args]);
}

export function useOnboardingStartup(args: {
  loadOnboardingStatus: () => Promise<void>;
  checkDatabaseStatus: () => Promise<void>;
  initializeDatabaseInBackground: () => Promise<void>;
}) {
  useEffect(() => {
    args.loadOnboardingStatus();
    args.checkDatabaseStatus();
    args.initializeDatabaseInBackground();
  }, [args]);
}
