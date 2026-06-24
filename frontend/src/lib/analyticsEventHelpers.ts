import { invoke } from "@tauri-apps/api/core";
import type { AnalyticsProperties, DeviceInfo } from "./analytics";

type TrackFn = (eventName: string, properties?: AnalyticsProperties) => Promise<void>;
type DeviceInfoFn = () => Promise<DeviceInfo>;

export async function trackSessionStartedEvent(args: {
  sessionId: string;
  getDeviceInfo: DeviceInfoFn;
  calculateDaysSince: (dateKey: string) => Promise<number | null>;
  track: TrackFn;
}) {
  try {
    const deviceInfo = await args.getDeviceInfo();
    const daysSinceLast = await args.calculateDaysSince("last_meeting_date");
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const totalMeetings = (await store.get<number>("total_meetings")) || 0;

    await args.track("session_started", {
      session_id: args.sessionId,
      days_since_last_meeting: daysSinceLast?.toString() || "null",
      total_meetings: totalMeetings.toString(),
      platform: deviceInfo.platform,
      os_version: deviceInfo.os_version,
      architecture: deviceInfo.architecture,
    });
    return Date.now();
  } catch (error) {
    console.error("Failed to track session started:", error);
    return null;
  }
}

export async function trackSessionEndedEvent(args: {
  sessionId: string;
  sessionStartTime: number;
  meetingsInSession: number;
  getDeviceInfo: DeviceInfoFn;
  track: TrackFn;
}) {
  try {
    const deviceInfo = await args.getDeviceInfo();
    const sessionDuration = (Date.now() - args.sessionStartTime) / 1000;
    await args.track("session_ended", {
      session_id: args.sessionId,
      session_duration_seconds: sessionDuration.toString(),
      meetings_in_session: args.meetingsInSession.toString(),
      platform: deviceInfo.platform,
      os_version: deviceInfo.os_version,
    });
  } catch (error) {
    console.error("Failed to track session ended:", error);
  }
}

export async function trackMeetingCompletedEvent(args: {
  meetingId: string;
  metrics: {
    duration_seconds: number;
    transcript_segments: number;
    transcript_word_count: number;
    words_per_minute: number;
    meetings_today: number;
  };
  getDeviceInfo: DeviceInfoFn;
  track: TrackFn;
}) {
  try {
    const deviceInfo = await args.getDeviceInfo();
    await args.track("meeting_completed", {
      meeting_id: args.meetingId,
      duration_seconds: args.metrics.duration_seconds.toString(),
      transcript_segments: args.metrics.transcript_segments.toString(),
      transcript_word_count: args.metrics.transcript_word_count.toString(),
      words_per_minute: args.metrics.words_per_minute.toFixed(2),
      meetings_today: args.metrics.meetings_today.toString(),
      day_of_week: new Date().getDay().toString(),
      hour_of_day: new Date().getHours().toString(),
      platform: deviceInfo.platform,
      os_version: deviceInfo.os_version,
    });
    return true;
  } catch (error) {
    console.error("Failed to track meeting completed:", error);
    return false;
  }
}

export async function trackFeatureUsedEnhancedEvent(args: {
  featureName: string;
  properties?: Record<string, any>;
  getDeviceInfo: DeviceInfoFn;
  hasUsedFeatureBefore: (featureName: string) => Promise<boolean>;
  markFeatureUsed: (featureName: string) => Promise<void>;
  track: TrackFn;
}) {
  try {
    const deviceInfo = await args.getDeviceInfo();
    const isFirstUse = !(await args.hasUsedFeatureBefore(args.featureName));
    await args.markFeatureUsed(args.featureName);
    const trackingProperties = withExtraProperties(
      {
        feature_name: args.featureName,
        is_first_use: isFirstUse.toString(),
        platform: deviceInfo.platform,
        os_version: deviceInfo.os_version,
      },
      args.properties,
    );
    await args.track("feature_used", trackingProperties);
  } catch (error) {
    console.error(`Failed to track feature used: ${args.featureName}`, error);
  }
}

export async function trackCopyEvent(args: {
  copyType: "transcript" | "summary";
  properties?: Record<string, any>;
  getDeviceInfo: DeviceInfoFn;
  track: TrackFn;
}) {
  try {
    const deviceInfo = await args.getDeviceInfo();
    const copyCount = await incrementCopyCount(args.copyType);
    const trackingProperties = withExtraProperties(
      {
        copy_type: args.copyType,
        copy_count_today: copyCount.toString(),
        platform: deviceInfo.platform,
        os_version: deviceInfo.os_version,
      },
      args.properties,
    );
    await args.track(`${args.copyType}_copied`, trackingProperties);
  } catch (error) {
    console.error(`Failed to track ${args.copyType} copy:`, error);
  }
}

export async function trackBackendConnectionEvent(args: {
  success: boolean;
  error?: string;
  waitForInitialization: () => Promise<boolean>;
}) {
  const isInitialized = await args.waitForInitialization();
  if (!isInitialized) {
    console.warn("Analytics not initialized within timeout, skipping backend connection tracking");
    return;
  }

  try {
    console.log("Tracking backend connection event:", {
      success: args.success,
      error: args.error,
    });
    await invoke("track_event", {
      eventName: "backend_connection",
      properties: {
        success: args.success.toString(),
        error: args.error || "",
        timestamp: new Date().toISOString(),
      },
    });
    console.log("Backend connection event tracked successfully");
  } catch (error) {
    console.error("Failed to track backend connection:", error);
  }
}

export async function trackTranscriptionErrorEvent(initialized: boolean, errorMessage: string) {
  if (!initialized) {
    console.warn("Analytics not initialized, skipping transcription error tracking");
    return;
  }

  try {
    console.log("Tracking transcription error event:", { errorMessage });
    await invoke("track_event", {
      eventName: "transcription_error",
      properties: {
        error_message: errorMessage,
        timestamp: new Date().toISOString(),
      },
    });
    console.log("Transcription error event tracked successfully");
  } catch (error) {
    console.error("Failed to track transcription error:", error);
  }
}

export async function trackTranscriptionSuccessEvent(initialized: boolean, duration?: number) {
  if (!initialized) {
    console.warn("Analytics not initialized, skipping transcription success tracking");
    return;
  }

  try {
    console.log("Tracking transcription success event:", { duration });
    await invoke("track_event", {
      eventName: "transcription_success",
      properties: {
        duration: duration ? duration.toString() : "",
        timestamp: new Date().toISOString(),
      },
    });
    console.log("Transcription success event tracked successfully");
  } catch (error) {
    console.error("Failed to track transcription success:", error);
  }
}

export async function trackSummaryGenerationStartedEvent(args: {
  initialized: boolean;
  modelProvider: string;
  modelName: string;
  transcriptLength: number;
  timeSinceRecordingMinutes?: number;
  getDeviceInfo: DeviceInfoFn;
  track: TrackFn;
}) {
  if (!args.initialized) {
    console.warn("Analytics not initialized, skipping summary generation started tracking");
    return;
  }

  try {
    const deviceInfo = await args.getDeviceInfo();
    console.log("Tracking summary generation started event:", args);
    const properties: AnalyticsProperties = {
      model_provider: args.modelProvider,
      model_name: args.modelName,
      transcript_length: args.transcriptLength.toString(),
      platform: deviceInfo.platform,
      os_version: deviceInfo.os_version,
    };

    if (args.timeSinceRecordingMinutes !== undefined) {
      properties.time_since_recording_minutes = args.timeSinceRecordingMinutes.toFixed(2);
    }

    await args.track("summary_generation_started", properties);
    console.log("Summary generation started event tracked successfully");
  } catch (error) {
    console.error("Failed to track summary generation started:", error);
  }
}

export async function trackSummaryGenerationCompletedEvent(args: {
  initialized: boolean;
  modelProvider: string;
  modelName: string;
  success: boolean;
  durationSeconds?: number;
  errorMessage?: string;
}) {
  await invokeInitializedAnalyticsEvent({
    initialized: args.initialized,
    skippedMessage: "Analytics not initialized, skipping summary generation completed tracking",
    logMessage: "Tracking summary generation completed event:",
    command: "track_summary_generation_completed",
    payload: {
      modelProvider: args.modelProvider,
      modelName: args.modelName,
      success: args.success,
      durationSeconds: args.durationSeconds,
      errorMessage: args.errorMessage,
    },
    successMessage: "Summary generation completed event tracked successfully",
    failureMessage: "Failed to track summary generation completed:",
  });
}

export async function trackSummaryRegeneratedEvent(args: {
  initialized: boolean;
  modelProvider: string;
  modelName: string;
}) {
  await invokeInitializedAnalyticsEvent({
    initialized: args.initialized,
    skippedMessage: "Analytics not initialized, skipping summary regenerated tracking",
    logMessage: "Tracking summary regenerated event:",
    command: "track_summary_regenerated",
    payload: { modelProvider: args.modelProvider, modelName: args.modelName },
    successMessage: "Summary regenerated event tracked successfully",
    failureMessage: "Failed to track summary regenerated:",
  });
}

export async function trackModelChangedEvent(args: {
  initialized: boolean;
  oldProvider: string;
  oldModel: string;
  newProvider: string;
  newModel: string;
}) {
  await invokeInitializedAnalyticsEvent({
    initialized: args.initialized,
    skippedMessage: "Analytics not initialized, skipping model changed tracking",
    logMessage: "Tracking model changed event:",
    command: "track_model_changed",
    payload: {
      oldProvider: args.oldProvider,
      oldModel: args.oldModel,
      newProvider: args.newProvider,
      newModel: args.newModel,
    },
    successMessage: "Model changed event tracked successfully",
    failureMessage: "Failed to track model changed:",
  });
}

export async function trackCustomPromptUsedEvent(initialized: boolean, promptLength: number) {
  await invokeInitializedAnalyticsEvent({
    initialized,
    skippedMessage: "Analytics not initialized, skipping custom prompt used tracking",
    logMessage: "Tracking custom prompt used event:",
    command: "track_custom_prompt_used",
    payload: { promptLength },
    successMessage: "Custom prompt used event tracked successfully",
    failureMessage: "Failed to track custom prompt used:",
  });
}

export async function invokeInitializedAnalyticsEvent(args: {
  initialized: boolean;
  skippedMessage: string;
  logMessage: string;
  command: string;
  payload: Record<string, any>;
  successMessage: string;
  failureMessage: string;
}) {
  if (!args.initialized) {
    console.warn(args.skippedMessage);
    return;
  }

  try {
    console.log(args.logMessage, args.payload);
    await invoke(args.command, args.payload);
    console.log(args.successMessage);
  } catch (error) {
    console.error(args.failureMessage, error);
  }
}

export async function invokeSimpleAnalyticsCommand(args: {
  initialized: boolean;
  command: string;
  payload: Record<string, any>;
  failureMessage: string;
}) {
  if (!args.initialized) return;

  try {
    await invoke(args.command, args.payload);
  } catch (error) {
    console.error(args.failureMessage, error);
  }
}

function withExtraProperties(
  base: AnalyticsProperties,
  extra?: Record<string, any>,
): AnalyticsProperties {
  if (!extra) return base;

  Object.entries(extra).forEach(([key, value]) => {
    base[key] = String(value);
  });
  return base;
}

async function incrementCopyCount(copyType: "transcript" | "summary") {
  const { Store } = await import("@tauri-apps/plugin-store");
  const store = await Store.load("analytics.json");
  const today = new Date().toISOString().split("T")[0];
  const copyCounts = (await store.get<Record<string, any>>("copy_counts")) || {};
  const todayCounts = copyCounts[today] || {};
  const copyCount = todayCounts[copyType] || 0;

  todayCounts[copyType] = copyCount + 1;
  copyCounts[today] = todayCounts;
  await store.set("copy_counts", copyCounts);
  await store.save();
  return copyCount + 1;
}
