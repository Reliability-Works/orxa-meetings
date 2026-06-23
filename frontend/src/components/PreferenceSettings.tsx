"use client"

import { useEffect, useState, useRef } from "react"
import { Switch } from "./ui/switch"
import { Bot, Calendar, Check, Clock, Copy, FolderOpen, Server, ShieldCheck } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import Analytics from "@/lib/analytics"
import AnalyticsConsentSwitch from "./AnalyticsConsentSwitch"
import { useConfig, NotificationSettings } from "@/contexts/ConfigContext"

type CalendarPermissionStatus =
  | 'not_determined'
  | 'restricted'
  | 'denied'
  | 'full_access'
  | 'write_only'
  | 'unavailable'
  | 'unknown';

interface CalendarAutoStartPreferences {
  enabled: boolean;
  lead_time_minutes: number;
  include_all_day_events: boolean;
}

interface McpSetupInfo {
  command: string;
  server_script_path: string;
  server_script_exists: boolean;
  database_path: string;
  database_exists: boolean;
  client_config_json: string;
}

const DEFAULT_CALENDAR_PREFS: CalendarAutoStartPreferences = {
  enabled: false,
  lead_time_minutes: 0,
  include_all_day_events: false,
};

function canReadCalendar(status: CalendarPermissionStatus) {
  return status === 'full_access';
}

function calendarPermissionLabel(status: CalendarPermissionStatus) {
  switch (status) {
    case 'full_access':
      return 'Allowed';
    case 'not_determined':
      return 'Not requested';
    case 'denied':
      return 'Denied';
    case 'restricted':
      return 'Restricted';
    case 'write_only':
      return 'Write-only';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Unknown';
  }
}

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings
  } = useConfig();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(null);
  const [calendarPrefs, setCalendarPrefs] = useState<CalendarAutoStartPreferences | null>(null);
  const [calendarPermissionStatus, setCalendarPermissionStatus] = useState<CalendarPermissionStatus>('unknown');
  const [isCalendarSaving, setIsCalendarSaving] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [mcpSetupInfo, setMcpSetupInfo] = useState<McpSetupInfo | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [isMcpConfigCopied, setIsMcpConfigCopied] = useState(false);
  const hasTrackedViewRef = useRef(false);

  // Lazy load preferences on mount (only loads if not already cached)
  useEffect(() => {
    loadPreferences();
    // Reset tracking ref on mount (every tab visit)
    hasTrackedViewRef.current = false;
  }, [loadPreferences]);

  // Track preferences viewed analytics on every tab visit (once per mount)
  useEffect(() => {
    if (hasTrackedViewRef.current) return;

    const trackPreferencesViewed = async () => {
      // Wait for notification settings to be available (either from cache or after loading)
      if (notificationSettings) {
        await Analytics.track('preferences_viewed', {
          notifications_enabled: notificationSettings.notification_preferences.show_recording_started ? 'true' : 'false'
        });
        hasTrackedViewRef.current = true;
      } else if (!isLoadingPreferences) {
        // If not loading and no settings available, track with default value
        await Analytics.track('preferences_viewed', {
          notifications_enabled: 'false'
        });
        hasTrackedViewRef.current = true;
      }
    };

    trackPreferencesViewed();
  }, [notificationSettings, isLoadingPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad])

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (isInitialLoad || notificationsEnabled === null || notificationsEnabled === previousNotificationsEnabled) return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      console.log("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          }
        };

        console.log("Calling updateNotificationSettings with:", updatedSettings);
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        console.log("Successfully updated notification settings to:", notificationsEnabled);

        // Track notification preference change - only fires when user manually toggles
        await Analytics.track('notification_settings_changed', {
          notifications_enabled: notificationsEnabled.toString()
        });
      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };

    handleUpdateNotificationSettings();
  }, [notificationsEnabled, notificationSettings, isInitialLoad, previousNotificationsEnabled, updateNotificationSettings])

  useEffect(() => {
    let isMounted = true;

    const loadCalendarAutoStart = async () => {
      try {
        const [preferences, permissionStatus] = await Promise.all([
          invoke<CalendarAutoStartPreferences>('get_calendar_auto_start_preferences'),
          invoke<CalendarPermissionStatus>('get_calendar_permission_status'),
        ]);

        if (!isMounted) return;

        setCalendarPrefs(preferences);
        setCalendarPermissionStatus(permissionStatus);
      } catch (error) {
        console.error('Failed to load calendar auto-start preferences:', error);
        if (!isMounted) return;

        setCalendarPrefs(DEFAULT_CALENDAR_PREFS);
        setCalendarPermissionStatus('unknown');
        setCalendarError('Calendar auto-start is not available in this build.');
      }
    };

    loadCalendarAutoStart();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadMcpSetupInfo = async () => {
      try {
        const setupInfo = await invoke<McpSetupInfo>('get_mcp_setup_info');
        if (!isMounted) return;

        setMcpSetupInfo(setupInfo);
        setMcpError(null);
      } catch (error) {
        console.error('Failed to load MCP setup info:', error);
        if (!isMounted) return;

        setMcpError('MCP setup details are not available in this build.');
      }
    };

    loadMcpSetupInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleOpenFolder = async (folderType: 'database' | 'models' | 'recordings') => {
    try {
      switch (folderType) {
        case 'database':
          await invoke('open_database_folder');
          break;
        case 'models':
          await invoke('open_models_folder');
          break;
        case 'recordings':
          await invoke('open_recordings_folder');
          break;
      }

      // Track storage folder access
      await Analytics.track('storage_folder_opened', {
        folder_type: folderType
      });
    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  const handleOpenMcpServerFolder = async () => {
    try {
      await invoke('open_mcp_server_folder');
    } catch (error) {
      console.error('Failed to open MCP server folder:', error);
      setMcpError('Could not open the MCP server folder.');
    }
  };

  const handleCopyMcpConfig = async () => {
    if (!mcpSetupInfo) return;

    try {
      await navigator.clipboard.writeText(mcpSetupInfo.client_config_json);
      setIsMcpConfigCopied(true);
      window.setTimeout(() => setIsMcpConfigCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy MCP config:', error);
      setMcpError('Could not copy the MCP config.');
    }
  };

  const saveCalendarPreferences = async (nextPreferences: CalendarAutoStartPreferences) => {
    setIsCalendarSaving(true);
    try {
      await invoke('set_calendar_auto_start_preferences', { preferences: nextPreferences });
      setCalendarPrefs(nextPreferences);
      setCalendarError(null);
    } catch (error) {
      console.error('Failed to save calendar auto-start preferences:', error);
      setCalendarError('Could not save calendar auto-start settings.');
    } finally {
      setIsCalendarSaving(false);
    }
  };

  const handleRequestCalendarPermission = async () => {
    setIsCalendarSaving(true);
    setCalendarError(null);
    try {
      const permissionStatus = await invoke<CalendarPermissionStatus>('request_calendar_permission');
      setCalendarPermissionStatus(permissionStatus);

      if (!canReadCalendar(permissionStatus)) {
        setCalendarError('Calendar access is required before Orxa can auto-start meeting transcription.');
      }
    } catch (error) {
      console.error('Failed to request calendar permission:', error);
      setCalendarError('Could not request calendar access.');
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
        nextPermissionStatus = await invoke<CalendarPermissionStatus>('request_calendar_permission');
        setCalendarPermissionStatus(nextPermissionStatus);
      } catch (error) {
        console.error('Failed to request calendar permission:', error);
        setCalendarError('Could not request calendar access.');
        setIsCalendarSaving(false);
        return;
      } finally {
        setIsCalendarSaving(false);
      }

      if (!canReadCalendar(nextPermissionStatus)) {
        setCalendarError('Calendar access is required before Orxa can auto-start meeting transcription.');
        return;
      }
    }

    const nextPreferences = { ...calendarPrefs, enabled };
    await saveCalendarPreferences(nextPreferences);

    await Analytics.track('calendar_auto_start_changed', {
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

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">General</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex min-h-20 items-center justify-between gap-6 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium text-gray-950">Notifications</h3>
              <p className="mt-1 text-sm text-gray-500">Show start and end notifications for meetings.</p>
            </div>
            <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} />
          </div>

          <div className="border-t border-gray-100 px-5 py-4">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <h3 className="text-[15px] font-medium text-gray-950">Calendar auto-start</h3>
                </div>
                <p className="mt-1 text-sm text-gray-500">Start transcription automatically when a calendar meeting begins.</p>
                <label className="mt-3 flex w-fit items-center gap-2 text-sm text-gray-700">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>Lead time</span>
                  <select
                    value={calendarPrefs?.lead_time_minutes ?? 0}
                    onChange={(event) => handleCalendarLeadTimeChange(Number(event.target.value))}
                    disabled={!calendarPrefs?.enabled || isCalendarSaving}
                    className="h-8 rounded-lg border-0 bg-gray-100 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value={0}>At start time</option>
                    <option value={1}>1 minute early</option>
                    <option value={2}>2 minutes early</option>
                    <option value={5}>5 minutes early</option>
                    <option value={10}>10 minutes early</option>
                  </select>
                </label>
              </div>
              <Switch
                checked={calendarPrefs?.enabled ?? false}
                onCheckedChange={handleCalendarAutoStartToggle}
                disabled={!calendarPrefs || isCalendarSaving}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ShieldCheck className="h-4 w-4 text-gray-400" />
                <span>Calendar access: {calendarPermissionLabel(calendarPermissionStatus)}</span>
              </div>
              {!canReadCalendar(calendarPermissionStatus) && calendarPermissionStatus !== 'unavailable' && (
                <button
                  onClick={handleRequestCalendarPermission}
                  disabled={isCalendarSaving}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Allow Access
                </button>
              )}
            </div>

            {calendarError && (
              <p className="mt-3 text-sm text-red-600">{calendarError}</p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Agent access</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-start justify-between gap-6 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-gray-500" />
                <h3 className="text-[15px] font-medium text-gray-950">Agent MCP access</h3>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-gray-500">
                Local agent access to meetings, raw transcripts, speaker labels, summaries, notes, action items, and confirmed transcript trimming.
              </p>
            </div>
            <button
              onClick={handleCopyMcpConfig}
              disabled={!mcpSetupInfo}
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMcpConfigCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {isMcpConfigCopied ? 'Copied' : 'Copy config'}
            </button>
          </div>

          <div className="grid gap-px border-t border-gray-100 bg-gray-100 md:grid-cols-2">
            <div className="bg-gray-50 px-5 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <Server className="h-4 w-4 text-gray-500" />
                MCP server
              </div>
              <div className="mt-1 break-all font-mono text-xs text-gray-600">
                {mcpSetupInfo?.server_script_path || 'Loading...'}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {mcpSetupInfo?.server_script_exists ? 'Available' : 'Not found'}
              </div>
            </div>

            <div className="bg-gray-50 px-5 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <FolderOpen className="h-4 w-4 text-gray-500" />
                Meeting database
              </div>
              <div className="mt-1 break-all font-mono text-xs text-gray-600">
                {mcpSetupInfo?.database_path || storageLocations?.database || 'Loading...'}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {mcpSetupInfo?.database_exists ? 'Available' : 'Created after meetings are saved'}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 px-5 py-4">
            <pre className="max-h-40 overflow-auto rounded-lg border border-gray-200 bg-gray-950 p-3 text-xs text-gray-100">
              {mcpSetupInfo?.client_config_json || 'Loading MCP config...'}
            </pre>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleOpenMcpServerFolder}
                disabled={!mcpSetupInfo}
                className="flex h-8 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
                Open server folder
              </button>
              <button
                onClick={() => handleOpenFolder('database')}
                className="flex h-8 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
              >
                <FolderOpen className="h-4 w-4" />
                Open database folder
              </button>
            </div>

            {mcpError && (
              <p className="mt-3 text-sm text-red-600">{mcpError}</p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Storage</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-6 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium text-gray-950">Meeting recordings</h3>
              <p className="mt-1 break-all font-mono text-xs text-gray-500">{storageLocations?.recordings || 'Loading...'}</p>
            </div>
            <button
              onClick={() => handleOpenFolder('recordings')}
              className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
            >
              <FolderOpen className="h-4 w-4" />
              Open
            </button>
          </div>
          <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            Database and models are stored together in your application data directory.
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Usage analytics</h2>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <AnalyticsConsentSwitch />
        </div>
      </section>
    </div>
  )
}
