import { invoke } from "@tauri-apps/api/core";
import {
  calculateDaysSinceInStore,
  checkAndTrackDailyUsageInStore,
  checkAndTrackFirstLaunchInStore,
  detectDeviceInfo,
  getMeetingsCountTodayFromStore,
  getOSVersionFromNavigator,
  getPersistentUserIdFromStore,
  getPlatformFromNavigator,
  hasUsedFeatureBeforeInStore,
  markFeatureUsedInStore,
  updateMeetingCountInStore,
} from "./analyticsStoreHelpers";
import {
  invokeSimpleAnalyticsCommand,
  trackBackendConnectionEvent,
  trackCopyEvent,
  trackFeatureUsedEnhancedEvent,
  trackMeetingCompletedEvent,
  trackCustomPromptUsedEvent,
  trackModelChangedEvent,
  trackSessionEndedEvent,
  trackSessionStartedEvent,
  trackSummaryGenerationCompletedEvent,
  trackSummaryRegeneratedEvent,
  trackSummaryGenerationStartedEvent,
  trackTranscriptionErrorEvent,
  trackTranscriptionSuccessEvent,
} from "./analyticsEventHelpers";

export interface AnalyticsProperties {
  [key: string]: string;
}

export interface DeviceInfo {
  platform: string;
  os_version: string;
  architecture: string;
}

export class Analytics {
  private static initialized = false;
  private static currentUserId: string | null = null;
  private static initializationPromise: Promise<void> | null = null;
  private static sessionStartTime: number | null = null;
  private static meetingsInSession: number = 0;
  private static deviceInfo: DeviceInfo | null = null;

  static async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInit();
    return this.initializationPromise;
  }

  private static async doInit(): Promise<void> {
    try {
      await invoke("init_analytics");
      this.initialized = true;
      console.log("Analytics initialized successfully");
    } catch (error) {
      console.error("Failed to initialize analytics:", error);
      throw error;
    } finally {
      this.initializationPromise = null;
    }
  }

  static async disable(): Promise<void> {
    try {
      await invoke("disable_analytics");
      this.initialized = false;
      this.currentUserId = null;
      this.initializationPromise = null;
      console.log("Analytics disabled successfully");
    } catch (error) {
      console.error("Failed to disable analytics:", error);
    }
  }

  static async isEnabled(): Promise<boolean> {
    try {
      return await invoke("is_analytics_enabled");
    } catch (error) {
      console.error("Failed to check analytics status:", error);
      return false;
    }
  }

  static async track(eventName: string, properties?: AnalyticsProperties): Promise<void> {
    if (!this.initialized) {
      console.warn("Analytics not initialized");
      return;
    }

    try {
      await invoke("track_event", { eventName, properties });
    } catch (error) {
      console.error(`Failed to track event ${eventName}:`, error);
    }
  }

  static async identify(userId: string, properties?: AnalyticsProperties): Promise<void> {
    if (!this.initialized) {
      console.warn("Analytics not initialized");
      return;
    }

    try {
      await invoke("identify_user", { userId, properties });
      this.currentUserId = userId;
    } catch (error) {
      console.error(`Failed to identify user ${userId}:`, error);
    }
  }

  static async startSession(userId: string): Promise<string | null> {
    if (!this.initialized) {
      console.warn("Analytics not initialized");
      return null;
    }

    try {
      const sessionId = await invoke("start_analytics_session", { userId });
      this.currentUserId = userId;

      return sessionId as string;
    } catch (error) {
      console.error("Failed to start analytics session:", error);
      return null;
    }
  }

  static async endSession(): Promise<void> {
    if (!this.initialized) return;

    try {
      await invoke("end_analytics_session");
    } catch (error) {
      console.error("Failed to end analytics session:", error);
    }
  }

  static async trackDailyActiveUser(): Promise<void> {
    if (!this.initialized) return;

    try {
      await invoke("track_daily_active_user");
    } catch (error) {
      console.error("Failed to track daily active user:", error);
    }
  }

  static async trackUserFirstLaunch(): Promise<void> {
    if (!this.initialized) return;

    try {
      await invoke("track_user_first_launch");
    } catch (error) {
      console.error("Failed to track user first launch:", error);
    }
  }

  static async isSessionActive(): Promise<boolean> {
    if (!this.initialized) return false;

    try {
      return await invoke("is_analytics_session_active");
    } catch (error) {
      console.error("Failed to check session status:", error);
      return false;
    }
  }

  static async getPersistentUserId(): Promise<string> {
    return getPersistentUserIdFromStore();
  }

  static async checkAndTrackFirstLaunch(): Promise<void> {
    await checkAndTrackFirstLaunchInStore(() => this.trackUserFirstLaunch());
  }

  static async checkAndTrackDailyUsage(): Promise<void> {
    await checkAndTrackDailyUsageInStore(() => this.trackDailyActiveUser());
  }

  static getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  static async getPlatform(): Promise<string> {
    return getPlatformFromNavigator();
  }

  static async getOSVersion(): Promise<string> {
    return getOSVersionFromNavigator();
  }

  static async getDeviceInfo(): Promise<DeviceInfo> {
    if (this.deviceInfo) return this.deviceInfo;
    this.deviceInfo = await detectDeviceInfo();
    return this.deviceInfo;
  }

  static async calculateDaysSince(dateKey: string): Promise<number | null> {
    return calculateDaysSinceInStore(dateKey);
  }

  static async updateMeetingCount(): Promise<void> {
    await updateMeetingCountInStore();
  }

  static async getMeetingsCountToday(): Promise<number> {
    return getMeetingsCountTodayFromStore();
  }

  static async hasUsedFeatureBefore(featureName: string): Promise<boolean> {
    return hasUsedFeatureBeforeInStore(featureName);
  }

  static async markFeatureUsed(featureName: string): Promise<void> {
    await markFeatureUsedInStore(featureName);
  }

  static async trackSessionStarted(sessionId: string): Promise<void> {
    if (!this.initialized) return;

    const sessionStartTime = await trackSessionStartedEvent({
      sessionId,
      getDeviceInfo: () => this.getDeviceInfo(),
      calculateDaysSince: (dateKey) => this.calculateDaysSince(dateKey),
      track: (eventName, properties) => this.track(eventName, properties),
    });
    if (sessionStartTime) {
      this.sessionStartTime = sessionStartTime;
      this.meetingsInSession = 0;
    }
  }

  static async trackSessionEnded(sessionId: string): Promise<void> {
    if (!this.initialized || !this.sessionStartTime) return;

    await trackSessionEndedEvent({
      sessionId,
      sessionStartTime: this.sessionStartTime,
      meetingsInSession: this.meetingsInSession,
      getDeviceInfo: () => this.getDeviceInfo(),
      track: (eventName, properties) => this.track(eventName, properties),
    });
  }

  static async trackMeetingCompleted(
    meetingId: string,
    metrics: {
      duration_seconds: number;
      transcript_segments: number;
      transcript_word_count: number;
      words_per_minute: number;
      meetings_today: number;
    },
  ): Promise<void> {
    if (!this.initialized) return;

    const tracked = await trackMeetingCompletedEvent({
      meetingId,
      metrics,
      getDeviceInfo: () => this.getDeviceInfo(),
      track: (eventName, properties) => this.track(eventName, properties),
    });
    if (tracked) {
      this.meetingsInSession++;
    }
  }

  static async trackFeatureUsedEnhanced(
    featureName: string,
    properties?: Record<string, any>,
  ): Promise<void> {
    if (!this.initialized) return;

    await trackFeatureUsedEnhancedEvent({
      featureName,
      properties,
      getDeviceInfo: () => this.getDeviceInfo(),
      hasUsedFeatureBefore: (name) => this.hasUsedFeatureBefore(name),
      markFeatureUsed: (name) => this.markFeatureUsed(name),
      track: (eventName, trackingProperties) => this.track(eventName, trackingProperties),
    });
  }

  static async trackCopy(
    copyType: "transcript" | "summary",
    properties?: Record<string, any>,
  ): Promise<void> {
    if (!this.initialized) return;

    await trackCopyEvent({
      copyType,
      properties,
      getDeviceInfo: () => this.getDeviceInfo(),
      track: (eventName, trackingProperties) => this.track(eventName, trackingProperties),
    });
  }

  private static async invokeSimple(
    command: string,
    payload: Record<string, any>,
    failureMessage: string,
  ) {
    await invokeSimpleAnalyticsCommand({
      initialized: this.initialized,
      command,
      payload,
      failureMessage,
    });
  }

  static async trackMeetingStarted(meetingId: string): Promise<void> {
    await this.invokeSimple(
      "track_meeting_started",
      { meetingId },
      "Failed to track meeting started:",
    );
  }

  static async trackRecordingStarted(meetingId: string): Promise<void> {
    await this.invokeSimple(
      "track_recording_started",
      { meetingId },
      "Failed to track recording started:",
    );
  }

  static async trackRecordingStopped(meetingId: string, durationSeconds?: number): Promise<void> {
    await this.invokeSimple(
      "track_recording_stopped",
      { meetingId, durationSeconds },
      "Failed to track recording stopped:",
    );
  }

  static async trackMeetingDeleted(meetingId: string): Promise<void> {
    await this.invokeSimple(
      "track_meeting_deleted",
      { meetingId },
      "Failed to track meeting deleted:",
    );
  }

  static async trackSettingsChanged(settingType: string, newValue: string): Promise<void> {
    await this.invokeSimple(
      "track_settings_changed",
      { settingType, newValue },
      "Failed to track settings changed:",
    );
  }

  static async trackFeatureUsed(featureName: string): Promise<void> {
    await this.invokeSimple("track_feature_used", { featureName }, "Failed to track feature used:");
  }

  static async trackPageView(pageName: string): Promise<void> {
    await this.track(`page_view_${pageName}`, { page: pageName });
  }

  static async trackButtonClick(buttonName: string, location?: string): Promise<void> {
    const properties: AnalyticsProperties = { button: buttonName };
    if (location) properties.location = location;
    await this.track(`button_click_${buttonName}`, properties);
  }

  static async trackError(errorType: string, errorMessage: string): Promise<void> {
    await this.track("error", {
      error_type: errorType,
      error_message: errorMessage,
    });
  }

  static async trackAppStarted(): Promise<void> {
    await this.track("app_started", {
      timestamp: new Date().toISOString(),
    });
  }

  static async cleanup(): Promise<void> {
    await this.endSession();
  }

  static reset(): void {
    this.initialized = false;
    this.currentUserId = null;
    this.initializationPromise = null;
  }

  static async waitForInitialization(timeout: number = 5000): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    const startTime = Date.now();
    while (!this.initialized && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return this.initialized;
  }

  static async trackBackendConnection(success: boolean, error?: string) {
    await trackBackendConnectionEvent({
      success,
      error,
      waitForInitialization: () => this.waitForInitialization(),
    });
  }

  static async trackTranscriptionError(errorMessage: string) {
    await trackTranscriptionErrorEvent(this.initialized, errorMessage);
  }

  static async trackTranscriptionSuccess(duration?: number) {
    await trackTranscriptionSuccessEvent(this.initialized, duration);
  }

  static async trackSummaryGenerationStarted(
    modelProvider: string,
    modelName: string,
    transcriptLength: number,
    timeSinceRecordingMinutes?: number,
  ) {
    await trackSummaryGenerationStartedEvent({
      initialized: this.initialized,
      modelProvider,
      modelName,
      transcriptLength,
      timeSinceRecordingMinutes,
      getDeviceInfo: () => this.getDeviceInfo(),
      track: (eventName, properties) => this.track(eventName, properties),
    });
  }

  static async trackSummaryGenerationCompleted(
    modelProvider: string,
    modelName: string,
    success: boolean,
    durationSeconds?: number,
    errorMessage?: string,
  ) {
    await trackSummaryGenerationCompletedEvent({
      initialized: this.initialized,
      modelProvider,
      modelName,
      success,
      durationSeconds,
      errorMessage,
    });
  }

  static async trackSummaryRegenerated(modelProvider: string, modelName: string) {
    await trackSummaryRegeneratedEvent({
      initialized: this.initialized,
      modelProvider,
      modelName,
    });
  }

  static async trackModelChanged(
    oldProvider: string,
    oldModel: string,
    newProvider: string,
    newModel: string,
  ) {
    await trackModelChangedEvent({
      initialized: this.initialized,
      oldProvider,
      oldModel,
      newProvider,
      newModel,
    });
  }

  static async trackCustomPromptUsed(promptLength: number) {
    await trackCustomPromptUsedEvent(this.initialized, promptLength);
  }
}

export default Analytics;
