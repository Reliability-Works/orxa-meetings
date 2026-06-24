import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { SelectedDevices } from "@/components/DeviceSelection";
import { RecordingStatus } from "@/contexts/RecordingStateContext";
import { recordingService } from "@/services/recordingService";
import Analytics from "@/lib/analytics";
import { showRecordingNotification } from "@/lib/recordingNotification";

export type RecordingStartLocation = "home_page" | "sidebar_auto" | "sidebar_direct";

export function generateMeetingTitle() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
}

export async function checkParakeetReady() {
  try {
    await invoke("parakeet_init");
    return await invoke<boolean>("parakeet_has_available_models");
  } catch (error) {
    console.error("Failed to check Parakeet status:", error);
    return false;
  }
}

export async function checkIfModelDownloading() {
  try {
    const models = await invoke<any[]>("parakeet_get_available_models");
    return models.some(
      (model) =>
        model.status &&
        (typeof model.status === "object"
          ? "Downloading" in model.status
          : model.status === "Downloading"),
    );
  } catch (error) {
    console.error("Failed to check model download status:", error);
    return false;
  }
}

export async function ensureRecordingModelReady(args: {
  location: RecordingStartLocation;
  showModal?: (name: "modelSelector", message?: string) => void;
  setStatus: (status: RecordingStatus, message?: string) => void;
}) {
  const parakeetReady = await checkParakeetReady();
  if (parakeetReady) return true;

  const isDownloading = await checkIfModelDownloading();
  if (isDownloading) {
    toast.info("Model download in progress", {
      description:
        "Please wait for the transcription model to finish downloading before recording.",
      duration: 5000,
    });
    Analytics.trackButtonClick("start_recording_blocked_downloading", args.location);
  } else {
    toast.error("Transcription model not ready", {
      description: "Please download a transcription model before recording.",
      duration: 5000,
    });
    args.showModal?.("modelSelector", "Transcription model setup required");
    Analytics.trackButtonClick("start_recording_blocked_missing", args.location);
  }

  args.setStatus(RecordingStatus.IDLE);
  return false;
}

export async function startRecordingSession(args: {
  location: RecordingStartLocation;
  selectedDevices: SelectedDevices;
  setStatus: (status: RecordingStatus, message?: string) => void;
  setMeetingTitle: (title: string) => void;
  setIsRecording: (value: boolean) => void;
  clearTranscripts: () => void;
  setIsMeetingActive: (value: boolean) => void;
}) {
  const meetingTitle = generateMeetingTitle();
  args.setStatus(RecordingStatus.STARTING, "Initializing recording...");

  console.log("Starting backend recording with meeting:", meetingTitle);
  const result = await recordingService.startRecordingWithDevices(
    args.selectedDevices?.micDevice || null,
    args.selectedDevices?.systemDevice || null,
    meetingTitle,
  );
  console.log("Backend recording result:", result);

  args.setMeetingTitle(meetingTitle);
  args.setIsRecording(true);
  args.clearTranscripts();
  args.setIsMeetingActive(true);
  Analytics.trackButtonClick("start_recording", args.location);
  await showRecordingNotification();
}
