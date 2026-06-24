import { Play, Pause, Square, Mic, AlertCircle, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Analytics from "@/lib/analytics";

interface DeviceError {
  title: string;
  message: string;
}

interface RecordingControlsViewProps {
  barHeights: string[];
  currentTime: number;
  deviceError: DeviceError | null;
  duration: number;
  isPaused: boolean;
  isParentProcessing: boolean;
  isPausing: boolean;
  isProcessing: boolean;
  isRecording: boolean;
  isRecordingDisabled: boolean;
  isResuming: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isValidatingModel: boolean;
  onDismissDeviceError: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  progress: number;
  showPlayback: boolean;
}

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RecordingControlsView(props: RecordingControlsViewProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2 bg-white rounded-full shadow-lg px-4 py-2">
          {props.isProcessing && !props.isParentProcessing ? (
            <ProcessingIndicator />
          ) : (
            <RecordingControlsSurface {...props} />
          )}
        </div>

        {props.isValidatingModel && (
          <div className="text-xs text-gray-600 text-center mt-2">
            Validating speech recognition...
          </div>
        )}

        {props.deviceError && (
          <DeviceErrorAlert error={props.deviceError} onDismiss={props.onDismissDeviceError} />
        )}
      </div>
    </TooltipProvider>
  );
}

function ProcessingIndicator() {
  return (
    <div className="flex items-center space-x-2">
      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900"></div>
      <span className="text-sm text-gray-600">Processing recording...</span>
    </div>
  );
}

function RecordingControlsSurface(props: RecordingControlsViewProps) {
  if (props.showPlayback) return <PlaybackControls {...props} />;

  return (
    <>
      {!props.isRecording ? (
        <StartRecordingButton {...props} />
      ) : (
        <ActiveRecordingButtons {...props} />
      )}
      <LevelBars
        barHeights={props.barHeights}
        isPaused={props.isPaused}
        isRecording={props.isRecording}
      />
    </>
  );
}

function PlaybackControls({
  currentTime,
  duration,
  onStartRecording,
  progress,
}: RecordingControlsViewProps) {
  return (
    <>
      <button
        onClick={onStartRecording}
        className="w-10 h-10 flex items-center justify-center bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors"
      >
        <Mic size={16} />
      </button>

      <div className="w-px h-6 bg-gray-200 mx-1" />
      <div className="flex items-center space-x-1 mx-2">
        <div className="text-sm text-gray-600 min-w-[40px]">{formatTime(currentTime)}</div>
        <div className="relative w-24 h-1 bg-gray-200 rounded-full">
          <div
            className="absolute h-full bg-blue-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-sm text-gray-600 min-w-[40px]">{formatTime(duration)}</div>
      </div>

      <button
        className="w-10 h-10 flex items-center justify-center bg-gray-300 rounded-full text-white cursor-not-allowed"
        disabled
      >
        <Play size={16} />
      </button>
    </>
  );
}

function StartRecordingButton({
  isProcessing,
  isRecordingDisabled,
  isStarting,
  isValidatingModel,
  onStartRecording,
}: RecordingControlsViewProps) {
  const disabled = isStarting || isProcessing || isRecordingDisabled || isValidatingModel;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            Analytics.trackButtonClick("start_recording", "recording_controls");
            onStartRecording();
          }}
          disabled={disabled}
          className={`w-12 h-12 flex items-center justify-center ${
            isStarting || isProcessing || isValidatingModel
              ? "bg-gray-400"
              : "bg-red-500 hover:bg-red-600"
          } rounded-full text-white transition-colors relative`}
        >
          {isValidatingModel ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
          ) : (
            <Mic size={20} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Start recording</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ActiveRecordingButtons(props: RecordingControlsViewProps) {
  return (
    <>
      <PauseResumeButton {...props} />
      <StopRecordingButton {...props} />
    </>
  );
}

function PauseResumeButton({
  isPaused,
  isPausing,
  isResuming,
  isStopping,
  onPauseRecording,
  onResumeRecording,
}: RecordingControlsViewProps) {
  const isBusy = isPausing || isResuming || isStopping;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            if (isPaused) {
              Analytics.trackButtonClick("resume_recording", "recording_controls");
              onResumeRecording();
            } else {
              Analytics.trackButtonClick("pause_recording", "recording_controls");
              onPauseRecording();
            }
          }}
          disabled={isBusy}
          className={`w-10 h-10 flex items-center justify-center ${
            isBusy
              ? "bg-gray-200 border-2 border-gray-300 text-gray-400"
              : "bg-white border-2 border-gray-300 text-gray-600 hover:border-gray-400 hover:bg-gray-50"
          } rounded-full transition-colors relative`}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
          {(isPausing || isResuming) && (
            <div className="absolute -top-8 text-gray-600 font-medium text-xs">
              {isPausing ? "Pausing..." : "Resuming..."}
            </div>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{isPaused ? "Resume recording" : "Pause recording"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function StopRecordingButton({
  isPausing,
  isResuming,
  isStopping,
  onStopRecording,
}: RecordingControlsViewProps) {
  const isBusy = isStopping || isPausing || isResuming;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            Analytics.trackButtonClick("stop_recording", "recording_controls");
            onStopRecording();
          }}
          disabled={isBusy}
          className={`w-10 h-10 flex items-center justify-center ${
            isBusy ? "bg-gray-400" : "bg-red-500 hover:bg-red-600"
          } rounded-full text-white transition-colors relative`}
        >
          <Square size={16} />
          {isStopping && (
            <div className="absolute -top-8 text-gray-600 font-medium text-xs">Stopping...</div>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Stop recording</p>
      </TooltipContent>
    </Tooltip>
  );
}

function LevelBars({
  barHeights,
  isPaused,
  isRecording,
}: Pick<RecordingControlsViewProps, "barHeights" | "isPaused" | "isRecording">) {
  return (
    <div className="flex items-center space-x-1 mx-4">
      {barHeights.map((height, index) => (
        <div
          key={index}
          className={`w-1 rounded-full transition-all duration-200 ${
            isPaused ? "bg-orange-500" : "bg-red-500"
          }`}
          style={{
            height: isRecording && !isPaused ? height : "4px",
            opacity: isPaused ? 0.6 : 1,
          }}
        />
      ))}
    </div>
  );
}

function DeviceErrorAlert({ error, onDismiss }: { error: DeviceError; onDismiss: () => void }) {
  return (
    <Alert variant="destructive" className="mt-4 border-red-300 bg-red-50">
      <AlertCircle className="h-5 w-5 text-red-600" />
      <button
        onClick={onDismiss}
        className="absolute right-3 top-3 text-red-600 hover:text-red-800 transition-colors"
        aria-label="Close alert"
      >
        <X className="h-4 w-4" />
      </button>
      <AlertTitle className="text-red-800 font-semibold mb-2">{error.title}</AlertTitle>
      <AlertDescription className="text-red-700">
        {error.message.split("\n").map((line, i) => (
          <div key={i} className={i > 0 ? "ml-2" : ""}>
            {line}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
