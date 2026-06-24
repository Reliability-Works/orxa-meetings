"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PermissionStatus, OnboardingPermissions } from "@/types/onboarding";
import { resolveOnboardingSummaryModelStatus } from "@/lib/onboarding-summary-model";
import {
  OnboardingContextType,
  PARAKEET_MODEL,
  ParakeetProgressInfo,
  StartBackgroundDownloadsOptions,
  SummaryModelProgressInfo,
} from "./onboardingContextTypes";
import { useDownloadProgressListeners } from "./onboardingDownloadListeners";
import { useStatusPersistence } from "./onboardingStatusPersistence";
import { useOnboardingStartup, useOnboardingStatusLoader } from "./onboardingStatusLoader";

const EMPTY_PROGRESS = {
  percent: 0,
  downloadedMb: 0,
  totalMb: 0,
  speedMbps: 0,
};

function clampOnboardingStep(step: number) {
  return Math.max(1, Math.min(step, 4));
}

function requestSummaryModelDownload(modelName: string) {
  console.log("[OnboardingContext] Starting Summary Model download");
  invoke("builtin_ai_download_model", { modelName }).catch((err) => {
    if (String(err).includes("Download already in progress")) return;
    console.error("[OnboardingContext] Summary Model download failed:", err);
  });
}

async function performAutoDetection(setDatabaseExists: (value: boolean) => void) {
  if (typeof navigator !== "undefined" && navigator.platform?.toLowerCase().includes("mac")) {
    const homebrewDbPath = "/usr/local/var/orxa/meeting_minutes.db";
    try {
      const homebrewCheck = await invoke<{ exists: boolean; size: number } | null>(
        "check_homebrew_database",
        { path: homebrewDbPath },
      );

      if (homebrewCheck?.exists) {
        console.log("[OnboardingContext] Found Homebrew database, importing");
        await invoke("import_and_initialize_database", { legacyDbPath: homebrewDbPath });
        setDatabaseExists(true);
        return;
      }
    } catch (e) {
      console.log("[OnboardingContext] Homebrew check failed, continuing:", e);
    }
  }

  try {
    const legacyPath = await invoke<string | null>("check_default_legacy_database");
    if (legacyPath) {
      console.log("[OnboardingContext] Found legacy database, importing");
      await invoke("import_and_initialize_database", { legacyDbPath: legacyPath });
      setDatabaseExists(true);
      return;
    }
  } catch (e) {
    console.log("[OnboardingContext] Legacy check failed, continuing:", e);
  }

  console.log("[OnboardingContext] No legacy database found, initializing fresh");
  await invoke("initialize_fresh_database");
  setDatabaseExists(true);
}

function useSummaryModelSelection(args: {
  selectedSummaryModel: string;
  setRecommendedSummaryModel: (value: string) => void;
  setSelectedSummaryModel: (value: string) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
}) {
  return useCallback(
    async (preferredModel = args.selectedSummaryModel) => {
      try {
        const recommendedModel = await invoke<string>("builtin_ai_get_recommended_model");
        args.setRecommendedSummaryModel(recommendedModel);
        const modelToCheck = preferredModel || recommendedModel;
        args.setSelectedSummaryModel(modelToCheck);

        const selectedModelReady = await invoke<boolean>("builtin_ai_is_model_ready", {
          modelName: modelToCheck,
          refresh: true,
        });
        const resolved = resolveOnboardingSummaryModelStatus({
          selectedModel: preferredModel,
          recommendedModel,
          selectedModelReady,
        });

        args.setSelectedSummaryModel(resolved.selectedSummaryModel);
        args.setSummaryModelDownloaded(resolved.summaryModelDownloaded);
        console.log("[OnboardingContext] Set recommended model:", resolved.selectedSummaryModel);
        return resolved;
      } catch (error) {
        console.error("[OnboardingContext] Failed to initialize summary model:", error);
        return null;
      }
    },
    [args],
  );
}

function useDatabaseState() {
  const [databaseExists, setDatabaseExists] = useState(false);

  const checkDatabaseStatus = useCallback(async () => {
    try {
      const isFirstLaunch = await invoke<boolean>("check_first_launch");
      setDatabaseExists(!isFirstLaunch);
      console.log("[OnboardingContext] Database exists:", !isFirstLaunch);
    } catch (error) {
      console.error("[OnboardingContext] Failed to check database status:", error);
      setDatabaseExists(false);
    }
  }, []);

  const initializeDatabaseInBackground = useCallback(async () => {
    try {
      console.log("[OnboardingContext] Starting background database initialization");
      const isFirstLaunch = await invoke<boolean>("check_first_launch");

      if (!isFirstLaunch) {
        console.log("[OnboardingContext] Database exists, skipping initialization");
        setDatabaseExists(true);
        return;
      }

      await performAutoDetection(setDatabaseExists);
    } catch (error) {
      console.error("[OnboardingContext] Database initialization failed:", error);
    }
  }, []);

  return { databaseExists, setDatabaseExists, checkDatabaseStatus, initializeDatabaseInBackground };
}

function useCompleteOnboarding(args: {
  selectedSummaryModel: string;
  setSelectedSummaryModel: (value: string) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
  setCompleted: (value: boolean) => void;
  isCompletingRef: MutableRefObject<boolean>;
  saveTimeoutRef: MutableRefObject<NodeJS.Timeout | undefined>;
}) {
  return useCallback(async () => {
    try {
      args.isCompletingRef.current = true;
      if (args.saveTimeoutRef.current) {
        clearTimeout(args.saveTimeoutRef.current);
        args.saveTimeoutRef.current = undefined;
      }

      let modelToSave = args.selectedSummaryModel;
      if (!modelToSave) {
        modelToSave = await invoke<string>("builtin_ai_get_recommended_model");
        args.setSelectedSummaryModel(modelToSave);
      }

      const selectedModelReady = await invoke<boolean>("builtin_ai_is_model_ready", {
        modelName: modelToSave,
        refresh: true,
      });
      args.setSummaryModelDownloaded(selectedModelReady);
      if (!selectedModelReady) {
        requestSummaryModelDownload(modelToSave);
      }

      await invoke("complete_onboarding", { model: modelToSave });
      args.setCompleted(true);
      console.log("[OnboardingContext] Onboarding completed with model:", modelToSave);
      args.isCompletingRef.current = false;
    } catch (error) {
      console.error("[OnboardingContext] Failed to complete onboarding:", error);
      args.isCompletingRef.current = false;
      throw error;
    }
  }, [args]);
}

function useBackgroundDownloads(args: {
  parakeetDownloaded: boolean;
  summaryModelDownloaded: boolean;
  setIsBackgroundDownloading: (value: boolean) => void;
}) {
  return useCallback(
    async ({ includeParakeet, includeSummary, summaryModel }: StartBackgroundDownloadsOptions) => {
      console.log("[OnboardingContext] Starting background downloads:", {
        includeParakeet,
        includeSummary,
        summaryModel,
      });

      try {
        const shouldStartParakeet = includeParakeet && !args.parakeetDownloaded;
        const shouldStartSummary = includeSummary && !args.summaryModelDownloaded && !!summaryModel;

        if (!shouldStartParakeet && !shouldStartSummary) {
          if (includeSummary && !args.summaryModelDownloaded && !summaryModel) {
            console.warn(
              "[OnboardingContext] Summary Model download skipped until recommendation is loaded",
            );
          }
          return;
        }

        args.setIsBackgroundDownloading(true);
        if (shouldStartParakeet) {
          console.log("[OnboardingContext] Starting Parakeet download");
          invoke("parakeet_download_model", { modelName: PARAKEET_MODEL }).catch((err) =>
            console.error("[OnboardingContext] Parakeet download failed:", err),
          );
        }
        if (shouldStartSummary && summaryModel) {
          requestSummaryModelDownload(summaryModel);
        }
      } catch (error) {
        console.error("[OnboardingContext] Failed to start background downloads:", error);
        args.setIsBackgroundDownloading(false);
        throw error;
      }
    },
    [args],
  );
}

function useOnboardingNavigation(setCurrentStep: (updater: (prev: number) => number) => void) {
  const goToStep = useCallback(
    (step: number) => {
      setCurrentStep(() => clampOnboardingStep(step));
    },
    [setCurrentStep],
  );

  const goNext = useCallback(() => {
    setCurrentStep((prev: number) => Math.min(prev + 1, 4));
  }, [setCurrentStep]);

  const goPrevious = useCallback(() => {
    setCurrentStep((prev: number) => Math.max(prev - 1, 1));
  }, [setCurrentStep]);

  return { goToStep, goNext, goPrevious };
}

export function useOnboardingController(): OnboardingContextType {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [parakeetDownloaded, setParakeetDownloaded] = useState(false);
  const [parakeetProgress, setParakeetProgress] = useState(0);
  const [parakeetProgressInfo, setParakeetProgressInfo] =
    useState<ParakeetProgressInfo>(EMPTY_PROGRESS);
  const [summaryModelDownloaded, setSummaryModelDownloaded] = useState(false);
  const [summaryModelProgress, setSummaryModelProgress] = useState(0);
  const [summaryModelProgressInfo, setSummaryModelProgressInfo] =
    useState<SummaryModelProgressInfo>(EMPTY_PROGRESS);
  const [selectedSummaryModel, setSelectedSummaryModel] = useState<string>("");
  const [recommendedSummaryModel, setRecommendedSummaryModel] = useState<string>("");
  const [isBackgroundDownloading, setIsBackgroundDownloading] = useState(false);
  const [permissions, setPermissions] = useState<OnboardingPermissions>({
    microphone: "not_determined",
    systemAudio: "not_determined",
    screenRecording: "not_determined",
  });
  const [permissionsSkipped, setPermissionsSkipped] = useState(false);
  const isCompletingRef = useRef(false);
  const { databaseExists, setDatabaseExists, checkDatabaseStatus, initializeDatabaseInBackground } =
    useDatabaseState();

  const selectionArgs = useMemo(
    () => ({
      selectedSummaryModel,
      setRecommendedSummaryModel,
      setSelectedSummaryModel,
      setSummaryModelDownloaded,
    }),
    [selectedSummaryModel],
  );
  const initializeSummaryModelSelection = useSummaryModelSelection(selectionArgs);

  const persistenceArgs = useMemo(
    () => ({
      currentStep,
      completed,
      parakeetDownloaded,
      summaryModelDownloaded,
      selectedSummaryModel,
      isCompletingRef,
    }),
    [currentStep, completed, parakeetDownloaded, summaryModelDownloaded, selectedSummaryModel],
  );
  const { saveTimeoutRef } = useStatusPersistence(persistenceArgs);

  const loaderArgs = useMemo(
    () => ({
      initializeSummaryModelSelection,
      setCurrentStep,
      setCompleted,
      setParakeetDownloaded,
      setSummaryModelDownloaded,
      setSelectedSummaryModel,
      setRecommendedSummaryModel,
      setIsBackgroundDownloading,
    }),
    [initializeSummaryModelSelection],
  );
  const loadOnboardingStatus = useOnboardingStatusLoader(loaderArgs);
  const startupArgs = useMemo(
    () => ({ loadOnboardingStatus, checkDatabaseStatus, initializeDatabaseInBackground }),
    [loadOnboardingStatus, checkDatabaseStatus, initializeDatabaseInBackground],
  );
  useOnboardingStartup(startupArgs);

  const downloadProgressArgs = useMemo(
    () => ({
      selectedSummaryModel,
      setParakeetDownloaded,
      setParakeetProgress,
      setParakeetProgressInfo,
      setSummaryModelDownloaded,
      setSummaryModelProgress,
      setSummaryModelProgressInfo,
    }),
    [selectedSummaryModel],
  );
  useDownloadProgressListeners(downloadProgressArgs);

  const completeArgs = useMemo(
    () => ({
      selectedSummaryModel,
      setSelectedSummaryModel,
      setSummaryModelDownloaded,
      setCompleted,
      isCompletingRef,
      saveTimeoutRef,
    }),
    [selectedSummaryModel, saveTimeoutRef],
  );
  const completeOnboarding = useCompleteOnboarding(completeArgs);

  const backgroundDownloadArgs = useMemo(
    () => ({
      parakeetDownloaded,
      summaryModelDownloaded,
      setIsBackgroundDownloading,
    }),
    [parakeetDownloaded, summaryModelDownloaded],
  );
  const startBackgroundDownloads = useBackgroundDownloads(backgroundDownloadArgs);
  const retryParakeetDownload = useCallback(async () => {
    console.log("[OnboardingContext] Retrying Parakeet download");
    try {
      await invoke("parakeet_retry_download", { modelName: PARAKEET_MODEL });
    } catch (error) {
      console.error("[OnboardingContext] Retry failed:", error);
      throw error;
    }
  }, []);
  const setPermissionStatus = useCallback(
    (permission: keyof OnboardingPermissions, status: PermissionStatus) => {
      setPermissions((prev: OnboardingPermissions) => ({ ...prev, [permission]: status }));
    },
    [],
  );
  const { goToStep, goNext, goPrevious } = useOnboardingNavigation(setCurrentStep);

  return {
    currentStep,
    parakeetDownloaded,
    parakeetProgress,
    parakeetProgressInfo,
    summaryModelDownloaded,
    summaryModelProgress,
    summaryModelProgressInfo,
    selectedSummaryModel,
    recommendedSummaryModel,
    databaseExists,
    isBackgroundDownloading,
    permissions,
    permissionsSkipped,
    goToStep,
    goNext,
    goPrevious,
    setParakeetDownloaded,
    setSummaryModelDownloaded,
    setSelectedSummaryModel,
    setDatabaseExists,
    setPermissionStatus,
    setPermissionsSkipped,
    completeOnboarding,
    startBackgroundDownloads,
    retryParakeetDownload,
  };
}
