import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { Check, Download, Loader2, Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSummaryModelSizeLabel } from "@/lib/onboarding-summary-model";
import { OnboardingContainer } from "../OnboardingContainer";
import type { DownloadState } from "./downloadProgressStepTypes";

interface DownloadProgressStepViewProps {
  isMac: boolean;
  isCompleting: boolean;
  parakeetDownloaded: boolean;
  summaryModelDownloaded: boolean;
  selectedSummaryModel: string;
  recommendedSummaryModel: string;
  parakeetState: DownloadState;
  summaryState: DownloadState;
  handleRetryDownload: () => void;
  handleRetrySummaryDownload: () => void;
  handleContinue: () => void;
}

interface DownloadCardProps {
  title: string;
  icon: ReactNode;
  state: DownloadState;
  modelSize: string;
  onRetry: () => void;
  sizeUnit?: string;
}

function DownloadStatusIndicator({ state }: { state: DownloadState }) {
  if (state.status === "waiting") {
    return <span className="text-sm text-gray-500">Waiting...</span>;
  }
  if (state.status === "downloading") {
    return <Loader2 className="w-5 h-5 text-gray-700 animate-spin" />;
  }
  if (state.status === "completed") {
    return (
      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
        <Check className="w-4 h-4 text-green-600" />
      </div>
    );
  }
  return <span className="text-sm text-red-500">Failed</span>;
}

function DownloadProgressMeter({ state, sizeUnit }: { state: DownloadState; sizeUnit: string }) {
  if (state.status !== "downloading" && state.status !== "completed") return null;

  return (
    <div className="space-y-2">
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-gray-700 to-gray-900 rounded-full transition-all duration-300"
          style={{ width: `${state.progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">
          {state.downloadedMb.toFixed(1)} {sizeUnit} / {state.totalMb.toFixed(1)} {sizeUnit}
        </span>
        <div className="flex items-center gap-2">
          {state.speedMbps > 0 && (
            <span className="text-gray-500">
              {state.speedMbps.toFixed(1)} {sizeUnit}/s
            </span>
          )}
          <span className="font-semibold text-gray-900">{Math.round(state.progress)}%</span>
        </div>
      </div>
    </div>
  );
}

function RetryIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function DownloadErrorPanel({ state, onRetry }: { state: DownloadState; onRetry: () => void }) {
  if (state.status !== "error" || !state.error) return null;

  return (
    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
      <p className="text-sm text-red-600 font-medium">Download Error</p>
      <p className="text-xs text-red-500 mt-1">{state.error}</p>
      <button
        onClick={onRetry}
        className="mt-3 w-full h-9 px-4 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2"
      >
        <RetryIcon />
        Try Again
      </button>
    </div>
  );
}

function DownloadCard({
  title,
  icon,
  state,
  modelSize,
  onRetry,
  sizeUnit = "MB",
}: DownloadCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
            {icon}
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">{modelSize}</p>
          </div>
        </div>
        <div>
          <DownloadStatusIndicator state={state} />
        </div>
      </div>

      <DownloadProgressMeter state={state} sizeUnit={sizeUnit} />
      <DownloadErrorPanel state={state} onRetry={onRetry} />
    </div>
  );
}

function BackgroundDownloadNotice() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full max-w-lg bg-gray-100 rounded-lg p-4 text-sm text-gray-800"
    >
      <div className="flex items-start gap-3">
        <Download className="w-5 h-5 text-gray-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">You can continue while this finishes</p>
          <p className="text-gray-700 mt-1">Download will continue in the background.</p>
        </div>
      </div>
    </motion.div>
  );
}

export function DownloadProgressStepView({
  isMac,
  isCompleting,
  parakeetDownloaded,
  summaryModelDownloaded,
  selectedSummaryModel,
  recommendedSummaryModel,
  parakeetState,
  summaryState,
  handleRetryDownload,
  handleRetrySummaryDownload,
  handleContinue,
}: DownloadProgressStepViewProps) {
  return (
    <OnboardingContainer
      title="Getting things ready"
      description="You can start using Orxa after downloading the Transcription Engine."
      step={3}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-6">
        <div className="w-full max-w-lg space-y-4">
          <DownloadCard
            title="Transcription Engine"
            icon={<Mic className="w-5 h-5 text-gray-600" />}
            state={parakeetState}
            modelSize="~670 MB"
            onRetry={handleRetryDownload}
          />
          <DownloadCard
            title="Summary Engine"
            icon={<Sparkles className="w-5 h-5 text-gray-600" />}
            state={summaryState}
            modelSize={getSummaryModelSizeLabel(selectedSummaryModel || recommendedSummaryModel)}
            onRetry={handleRetrySummaryDownload}
            sizeUnit="MiB"
          />
        </div>

        <AnimatePresence>
          {parakeetDownloaded && !summaryModelDownloaded && <BackgroundDownloadNotice />}
        </AnimatePresence>

        <div className="w-full max-w-xs">
          <Button
            onClick={handleContinue}
            disabled={!parakeetDownloaded || isCompleting}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCompleting || !parakeetDownloaded ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
