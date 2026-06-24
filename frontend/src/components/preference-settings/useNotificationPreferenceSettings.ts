"use client";

import { useEffect, useRef, useState } from "react";

import { useConfig, NotificationSettings } from "@/contexts/ConfigContext";
import Analytics from "@/lib/analytics";

export function useNotificationPreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  } = useConfig();
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(
    null,
  );
  const hasTrackedViewRef = useRef(false);

  useEffect(() => {
    loadPreferences();
    hasTrackedViewRef.current = false;
  }, [loadPreferences]);

  useEffect(() => {
    if (hasTrackedViewRef.current) return;

    const trackPreferencesViewed = async () => {
      if (notificationSettings) {
        await Analytics.track("preferences_viewed", {
          notifications_enabled: notificationSettings.notification_preferences
            .show_recording_started
            ? "true"
            : "false",
        });
        hasTrackedViewRef.current = true;
        return;
      }

      if (!isLoadingPreferences) {
        await Analytics.track("preferences_viewed", {
          notifications_enabled: "false",
        });
        hasTrackedViewRef.current = true;
      }
    };

    trackPreferencesViewed();
  }, [notificationSettings, isLoadingPreferences]);

  useEffect(() => {
    if (notificationSettings) {
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
      return;
    }

    if (!isLoadingPreferences) {
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad]);

  useEffect(() => {
    if (
      isInitialLoad ||
      notificationsEnabled === null ||
      notificationsEnabled === previousNotificationsEnabled ||
      !notificationSettings
    ) {
      return;
    }

    const handleUpdateNotificationSettings = async () => {
      try {
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          },
        };

        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        await Analytics.track("notification_settings_changed", {
          notifications_enabled: notificationsEnabled.toString(),
        });
      } catch (error) {
        console.error("Failed to update notification settings:", error);
      }
    };

    handleUpdateNotificationSettings();
  }, [
    notificationsEnabled,
    notificationSettings,
    isInitialLoad,
    previousNotificationsEnabled,
    updateNotificationSettings,
  ]);

  const isPreferenceLoading =
    (isLoadingPreferences && !notificationSettings && !storageLocations) ||
    (notificationsEnabled === null && !isLoadingPreferences);

  return {
    isPreferenceLoading,
    notificationsEnabledValue: notificationsEnabled ?? false,
    setNotificationsEnabled,
    storageLocations,
  };
}
