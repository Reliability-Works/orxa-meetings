import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { getSummaryModelSizeMb } from "@/lib/onboarding-summary-model";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  PARAKEET_MODEL,
  type DownloadState,
  type SetDownloadState,
} from "./downloadProgressStepTypes";
import { useDownloadProgressEvents } from "./useDownloadProgressEvents";

function useIsMacPlatform() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import("@tauri-apps/plugin-os");
        setIsMac(platform() === "macos");
      } catch (e) {
        setIsMac(navigator.userAgent.includes("Mac"));
      }
    };

    checkPlatform();
  }, []);

  return isMac;
}

function releaseRetryLock(ref: MutableRefObject<boolean>) {
  setTimeout(() => {
    ref.current = false;
  }, 2000);
}

function useRetryHandlers(args: {
  selectedSummaryModel: string;
  recommendedSummaryModel: string;
  retryingRef: MutableRefObject<boolean>;
  retryingSummaryRef: MutableRefObject<boolean>;
  setParakeetState: SetDownloadState;
  setSummaryState: SetDownloadState;
}) {
  const handleRetryDownload = async () => {
    if (args.retryingRef.current) {
      console.log("[DownloadProgressStep] Retry already in progress, ignoring");
      return;
    }

    console.log("[DownloadProgressStep] Retrying Parakeet download");
    args.retryingRef.current = true;
    args.setParakeetState((prev) => ({
      ...prev,
      status: "waiting",
      error: undefined,
      progress: 0,
      downloadedMb: 0,
      speedMbps: 0,
    }));

    try {
      await invoke("parakeet_retry_download", { modelName: PARAKEET_MODEL });
    } catch (error) {
      console.error("[DownloadProgressStep] Retry failed:", error);
      args.setParakeetState((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Retry failed",
      }));
      toast.error("Download retry failed", {
        description: "Please check your connection and try again.",
      });
    } finally {
      releaseRetryLock(args.retryingRef);
    }
  };

  const handleRetrySummaryDownload = async () => {
    if (args.retryingSummaryRef.current) {
      console.log("[DownloadProgressStep] Summary retry already in progress, ignoring");
      return;
    }

    console.log("[DownloadProgressStep] Retrying summary model download");
    args.retryingSummaryRef.current = true;
    args.setSummaryState((prev) => ({
      ...prev,
      status: "downloading",
      error: undefined,
      progress: 0,
      downloadedMb: 0,
      totalMb: getSummaryModelSizeMb(args.selectedSummaryModel || args.recommendedSummaryModel),
      speedMbps: 0,
    }));

    try {
      const modelName = args.selectedSummaryModel;
      if (!modelName) {
        throw new Error("Summary model recommendation is not ready yet");
      }
      await invoke("builtin_ai_download_model", { modelName });
    } catch (error) {
      console.error("[DownloadProgressStep] Summary retry failed:", error);
      args.setSummaryState((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : "Retry failed",
      }));
      toast.error("Summary model download retry failed", {
        description: "Please check your connection and try again.",
      });
    } finally {
      releaseRetryLock(args.retryingSummaryRef);
    }
  };

  return { handleRetryDownload, handleRetrySummaryDownload };
}

function useDownloadStartup(args: {
  selectedSummaryModel: string;
  summaryModelDownloaded: boolean;
  parakeetDownloaded: boolean;
  parakeetDownloadStartedRef: MutableRefObject<boolean>;
  summaryDownloadStartedRef: MutableRefObject<boolean>;
  setParakeetState: SetDownloadState;
  setSummaryState: SetDownloadState;
  startBackgroundDownloads: ReturnType<typeof useOnboarding>["startBackgroundDownloads"];
}) {
  const startSummaryDownload = async () => {
    if (!args.summaryModelDownloaded && args.selectedSummaryModel) {
      try {
        args.setSummaryState((prev) => ({
          ...prev,
          status: "downloading",
          totalMb: getSummaryModelSizeMb(args.selectedSummaryModel),
        }));
        await args.startBackgroundDownloads({
          includeParakeet: false,
          includeSummary: true,
          summaryModel: args.selectedSummaryModel,
        });
      } catch (error) {
        console.error("Failed to start summary model download:", error);
        args.setSummaryState((prev) => ({ ...prev, status: "error", error: String(error) }));
      }
    }
  };

  useEffect(() => {
    if (args.parakeetDownloadStartedRef.current) return;
    args.parakeetDownloadStartedRef.current = true;

    if (!args.parakeetDownloaded) {
      args.setParakeetState((prev) => ({ ...prev, status: "downloading" }));
    }

    args
      .startBackgroundDownloads({ includeParakeet: true, includeSummary: false })
      .catch((error) => {
        console.error("Failed to start Parakeet download:", error);
        if (!args.parakeetDownloaded) {
          args.setParakeetState((prev) => ({ ...prev, status: "error", error: String(error) }));
        }
      });
  }, []);

  useEffect(() => {
    if (args.summaryDownloadStartedRef.current) return;
    if (!args.selectedSummaryModel) return;
    args.summaryDownloadStartedRef.current = true;

    startSummaryDownload();
  }, [args.selectedSummaryModel]);
}

function useSummaryStateSync(args: {
  selectedSummaryModel: string;
  recommendedSummaryModel: string;
  summaryModelDownloaded: boolean;
  setSummaryState: SetDownloadState;
}) {
  useEffect(() => {
    const modelForSize = args.selectedSummaryModel || args.recommendedSummaryModel;
    if (!modelForSize) return;

    args.setSummaryState((prev) => ({
      ...prev,
      status: args.summaryModelDownloaded
        ? "completed"
        : prev.status === "completed"
          ? "waiting"
          : prev.status,
      progress: args.summaryModelDownloaded ? 100 : prev.status === "completed" ? 0 : prev.progress,
      totalMb: prev.totalMb || getSummaryModelSizeMb(modelForSize),
    }));
  }, [args.selectedSummaryModel, args.recommendedSummaryModel, args.summaryModelDownloaded]);
}

function useContinueHandler(args: {
  isMac: boolean;
  parakeetDownloaded: boolean;
  parakeetState: DownloadState;
  summaryState: DownloadState;
  setIsCompleting: (value: boolean) => void;
  setParakeetDownloaded: (value: boolean) => void;
  setParakeetState: SetDownloadState;
  goNext: () => void;
  completeOnboarding: () => Promise<void>;
}) {
  return async () => {
    try {
      await invoke("parakeet_init");
      const actuallyAvailable = await invoke<boolean>("parakeet_has_available_models");

      if (actuallyAvailable && !args.parakeetDownloaded) {
        console.log("[DownloadProgressStep] Model available but state not updated");
        args.setParakeetDownloaded(true);
        args.setParakeetState((prev) => ({ ...prev, status: "completed", progress: 100 }));
      } else if (!actuallyAvailable && args.parakeetState.status === "error") {
        toast.error("Transcription engine required", {
          description: "Please retry the download before continuing.",
        });
        return;
      }
    } catch (error) {
      console.warn("[DownloadProgressStep] Failed to verify model:", error);
    }

    const downloadsComplete =
      args.parakeetState.status === "completed" && args.summaryState.status === "completed";

    if (!downloadsComplete) {
      toast.info("Downloads will continue in the background", {
        description:
          "You can start using the app. Recording will be available once speech recognition is ready.",
        duration: 5000,
      });
    }

    if (args.isMac) {
      args.goNext();
      return;
    }

    args.setIsCompleting(true);
    try {
      await args.completeOnboarding();
      await new Promise((resolve) => setTimeout(resolve, 100));
      window.location.reload();
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      toast.error("Failed to complete setup", {
        description: "Please try again.",
      });
      args.setIsCompleting(false);
    }
  };
}

export function useDownloadProgressStepState() {
  const onboarding = useOnboarding();
  const isMac = useIsMacPlatform();
  const [isCompleting, setIsCompleting] = useState(false);
  const parakeetDownloadStartedRef = useRef(false);
  const summaryDownloadStartedRef = useRef(false);
  const retryingRef = useRef(false);
  const retryingSummaryRef = useRef(false);
  const [parakeetState, setParakeetState] = useState<DownloadState>({
    status: onboarding.parakeetDownloaded ? "completed" : "waiting",
    progress: onboarding.parakeetDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: 670,
    speedMbps: 0,
  });
  const [summaryState, setSummaryState] = useState<DownloadState>({
    status: onboarding.summaryModelDownloaded ? "completed" : "waiting",
    progress: onboarding.summaryModelDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: 0,
    speedMbps: 0,
  });

  useDownloadStartup({
    selectedSummaryModel: onboarding.selectedSummaryModel,
    summaryModelDownloaded: onboarding.summaryModelDownloaded,
    parakeetDownloaded: onboarding.parakeetDownloaded,
    parakeetDownloadStartedRef,
    summaryDownloadStartedRef,
    setParakeetState,
    setSummaryState,
    startBackgroundDownloads: onboarding.startBackgroundDownloads,
  });
  useDownloadProgressEvents({
    selectedSummaryModel: onboarding.selectedSummaryModel,
    setParakeetState,
    setSummaryState,
    setParakeetDownloaded: onboarding.setParakeetDownloaded,
    setSummaryModelDownloaded: onboarding.setSummaryModelDownloaded,
  });
  useSummaryStateSync({
    selectedSummaryModel: onboarding.selectedSummaryModel,
    recommendedSummaryModel: onboarding.recommendedSummaryModel,
    summaryModelDownloaded: onboarding.summaryModelDownloaded,
    setSummaryState,
  });

  const retryHandlers = useRetryHandlers({
    selectedSummaryModel: onboarding.selectedSummaryModel,
    recommendedSummaryModel: onboarding.recommendedSummaryModel,
    retryingRef,
    retryingSummaryRef,
    setParakeetState,
    setSummaryState,
  });
  const handleContinue = useContinueHandler({
    isMac,
    parakeetDownloaded: onboarding.parakeetDownloaded,
    parakeetState,
    summaryState,
    setIsCompleting,
    setParakeetDownloaded: onboarding.setParakeetDownloaded,
    setParakeetState,
    goNext: onboarding.goNext,
    completeOnboarding: onboarding.completeOnboarding,
  });

  return {
    isMac,
    isCompleting,
    parakeetDownloaded: onboarding.parakeetDownloaded,
    summaryModelDownloaded: onboarding.summaryModelDownloaded,
    selectedSummaryModel: onboarding.selectedSummaryModel,
    recommendedSummaryModel: onboarding.recommendedSummaryModel,
    parakeetState,
    summaryState,
    handleContinue,
    ...retryHandlers,
  };
}
