"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import Analytics from "@/lib/analytics";
import {
  CalendarAutoStartPreferences,
  CalendarPermissionStatus,
  canReadCalendar,
  DEFAULT_CALENDAR_PREFS,
} from "./types";

export function useCalendarAutoStartSettings() {
  const [calendarPrefs, setCalendarPrefs] = useState<CalendarAutoStartPreferences | null>(null);
  const [calendarPermissionStatus, setCalendarPermissionStatus] =
    useState<CalendarPermissionStatus>("unknown");
  const [isCalendarSaving, setIsCalendarSaving] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadCalendarAutoStart = async () => {
      try {
        const [preferences, permissionStatus] = await Promise.all([
          invoke<CalendarAutoStartPreferences>("get_calendar_auto_start_preferences"),
          invoke<CalendarPermissionStatus>("get_calendar_permission_status"),
        ]);

        if (!isMounted) return;

        setCalendarPrefs(preferences);
        setCalendarPermissionStatus(permissionStatus);
      } catch (error) {
        console.error("Failed to load calendar auto-start preferences:", error);
        if (!isMounted) return;

        setCalendarPrefs(DEFAULT_CALENDAR_PREFS);
        setCalendarPermissionStatus("unknown");
        setCalendarError("Calendar auto-start is not available in this build.");
      }
    };

    loadCalendarAutoStart();

    return () => {
      isMounted = false;
    };
  }, []);

  const saveCalendarPreferences = async (nextPreferences: CalendarAutoStartPreferences) => {
    setIsCalendarSaving(true);
    try {
      await invoke("set_calendar_auto_start_preferences", { preferences: nextPreferences });
      setCalendarPrefs(nextPreferences);
      setCalendarError(null);
    } catch (error) {
      console.error("Failed to save calendar auto-start preferences:", error);
      setCalendarError("Could not save calendar auto-start settings.");
    } finally {
      setIsCalendarSaving(false);
    }
  };

  const requestCalendarPermission = async () => {
    const permissionStatus = await invoke<CalendarPermissionStatus>("request_calendar_permission");
    setCalendarPermissionStatus(permissionStatus);
    return permissionStatus;
  };

  const handleRequestCalendarPermission = async () => {
    setIsCalendarSaving(true);
    setCalendarError(null);
    try {
      const permissionStatus = await requestCalendarPermission();

      if (!canReadCalendar(permissionStatus)) {
        setCalendarError(
          "Calendar access is required before Orxa can auto-start meeting transcription.",
        );
      }
    } catch (error) {
      console.error("Failed to request calendar permission:", error);
      setCalendarError("Could not request calendar access.");
    } finally {
      setIsCalendarSaving(false);
    }
  };

  const handleCalendarAutoStartToggle = async (enabled: boolean) => {
    if (!calendarPrefs) return;

    let nextPermissionStatus = calendarPermissionStatus;
    setCalendarError(null);

    if (enabled && !canReadCalendar(nextPermissionStatus)) {
      setIsCalendarSaving(true);
      try {
        nextPermissionStatus = await requestCalendarPermission();
      } catch (error) {
        console.error("Failed to request calendar permission:", error);
        setCalendarError("Could not request calendar access.");
        setIsCalendarSaving(false);
        return;
      } finally {
        setIsCalendarSaving(false);
      }

      if (!canReadCalendar(nextPermissionStatus)) {
        setCalendarError(
          "Calendar access is required before Orxa can auto-start meeting transcription.",
        );
        return;
      }
    }

    await saveCalendarPreferences({ ...calendarPrefs, enabled });
    await Analytics.track("calendar_auto_start_changed", {
      enabled: enabled.toString(),
    });
  };

  const handleCalendarLeadTimeChange = async (leadTimeMinutes: number) => {
    if (!calendarPrefs) return;

    await saveCalendarPreferences({
      ...calendarPrefs,
      lead_time_minutes: leadTimeMinutes,
    });
  };

  return {
    calendarPrefs,
    calendarPermissionStatus,
    isCalendarSaving,
    calendarError,
    handleRequestCalendarPermission,
    handleCalendarAutoStartToggle,
    handleCalendarLeadTimeChange,
  };
}
