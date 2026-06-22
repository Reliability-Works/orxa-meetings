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
        setCalendarError('Calendar access is required before Meetily can auto-start meeting transcription.');
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
        setCalendarError('Calendar access is required before Meetily can auto-start meeting transcription.');
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
    <div className="space-y-6">
      {/* Notifications Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Notifications</h3>
            <p className="text-sm text-gray-600">Enable or disable notifications of start and end of meeting</p>
          </div>
          <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} />
        </div>
      </div>

      {/* Calendar Auto-Start Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Calendar Auto-Start</h3>
              <p className="text-sm text-gray-600">
                Start transcription automatically when a calendar meeting begins.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span>Lead time</span>
                  <select
                    value={calendarPrefs?.lead_time_minutes ?? 0}
                    onChange={(event) => handleCalendarLeadTimeChange(Number(event.target.value))}
                    disabled={!calendarPrefs?.enabled || isCalendarSaving}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value={0}>At start time</option>
                    <option value={1}>1 minute early</option>
                    <option value={2}>2 minutes early</option>
                    <option value={5}>5 minutes early</option>
                    <option value={10}>10 minutes early</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
          <Switch
            checked={calendarPrefs?.enabled ?? false}
            onCheckedChange={handleCalendarAutoStartToggle}
            disabled={!calendarPrefs || isCalendarSaving}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-gray-50 p-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <ShieldCheck className="h-4 w-4 text-gray-500" />
            <span>Calendar access: {calendarPermissionLabel(calendarPermissionStatus)}</span>
          </div>
          {!canReadCalendar(calendarPermissionStatus) && calendarPermissionStatus !== 'unavailable' && (
            <button
              onClick={handleRequestCalendarPermission}
              disabled={isCalendarSaving}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Allow Access
            </button>
          )}
        </div>

        {calendarError && (
          <p className="mt-3 text-sm text-red-600">{calendarError}</p>
        )}
      </div>

      {/* MCP Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-md bg-purple-50 text-purple-700">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Agent MCP Access</h3>
              <p className="text-sm text-gray-600">
                Local agent access to meetings, raw transcripts, local speaker labels, summaries, notes, action items, and confirmed transcript trimming.
              </p>
            </div>
          </div>
          <button
            onClick={handleCopyMcpConfig}
            disabled={!mcpSetupInfo}
            className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMcpConfigCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {isMcpConfigCopied ? 'Copied' : 'Copy Config'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <Server className="h-4 w-4 text-gray-500" />
              MCP server
            </div>
            <div className="mt-2 break-all font-mono text-xs text-gray-600">
              {mcpSetupInfo?.server_script_path || 'Loading...'}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {mcpSetupInfo?.server_script_exists ? 'Available' : 'Not found'}
            </div>
          </div>

          <div className="rounded-md bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <FolderOpen className="h-4 w-4 text-gray-500" />
              Meeting database
            </div>
            <div className="mt-2 break-all font-mono text-xs text-gray-600">
              {mcpSetupInfo?.database_path || storageLocations?.database || 'Loading...'}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {mcpSetupInfo?.database_exists ? 'Available' : 'Created after meetings are saved'}
            </div>
          </div>
        </div>

        <pre className="mt-4 max-h-56 overflow-auto rounded-md border border-gray-200 bg-gray-950 p-3 text-xs text-gray-100">
          {mcpSetupInfo?.client_config_json || 'Loading MCP config...'}
        </pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleOpenMcpServerFolder}
            disabled={!mcpSetupInfo}
            className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen className="h-4 w-4" />
            Open Server Folder
          </button>
          <button
            onClick={() => handleOpenFolder('database')}
            className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
          >
            <FolderOpen className="h-4 w-4" />
            Open Database Folder
          </button>
        </div>

        {mcpError && (
          <p className="mt-3 text-sm text-red-600">{mcpError}</p>
        )}
      </div>

      {/* Data Storage Locations Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Storage Locations</h3>
        <p className="text-sm text-gray-600 mb-6">
          View and access where Meetily stores your data
        </p>

        <div className="space-y-4">
          {/* Database Location */}
          {/* <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Database</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.database || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('database')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div> */}

          {/* Models Location */}
          {/* <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Whisper Models</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.models || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('models')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div> */}

          {/* Recordings Location */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Meeting Recordings</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.recordings || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('recordings')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-50 rounded-md">
          <p className="text-xs text-blue-800">
            <strong>Note:</strong> Database and models are stored together in your application data directory for unified management.
          </p>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <AnalyticsConsentSwitch />
      </div>
    </div>
  )
}
