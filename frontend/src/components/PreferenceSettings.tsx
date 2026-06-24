"use client";

import { invoke } from "@tauri-apps/api/core";

import Analytics from "@/lib/analytics";
import { PreferenceSettingsView } from "./preference-settings/PreferenceSettingsView";
import { useCalendarAutoStartSettings } from "./preference-settings/useCalendarAutoStartSettings";
import { useMcpSetupSettings } from "./preference-settings/useMcpSetupSettings";
import { useNotificationPreferenceSettings } from "./preference-settings/useNotificationPreferenceSettings";

type FolderType = "database" | "models" | "recordings";

export function PreferenceSettings() {
  const notificationSettings = useNotificationPreferenceSettings();
  const calendarSettings = useCalendarAutoStartSettings();
  const mcpSettings = useMcpSetupSettings();

  const handleOpenFolder = async (folderType: FolderType) => {
    try {
      await invoke(folderCommandFor(folderType));
      await Analytics.track("storage_folder_opened", {
        folder_type: folderType,
      });
    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  if (notificationSettings.isPreferenceLoading) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>;
  }

  return (
    <PreferenceSettingsView
      notificationsEnabledValue={notificationSettings.notificationsEnabledValue}
      onNotificationsEnabledChange={notificationSettings.setNotificationsEnabled}
      storageLocations={notificationSettings.storageLocations}
      onOpenFolder={handleOpenFolder}
      calendarPrefs={calendarSettings.calendarPrefs}
      calendarPermissionStatus={calendarSettings.calendarPermissionStatus}
      isCalendarSaving={calendarSettings.isCalendarSaving}
      calendarError={calendarSettings.calendarError}
      onCalendarPermissionRequest={calendarSettings.handleRequestCalendarPermission}
      onCalendarAutoStartToggle={calendarSettings.handleCalendarAutoStartToggle}
      onCalendarLeadTimeChange={calendarSettings.handleCalendarLeadTimeChange}
      mcpSetupInfo={mcpSettings.mcpSetupInfo}
      mcpError={mcpSettings.mcpError}
      isMcpConfigCopied={mcpSettings.isMcpConfigCopied}
      onCopyMcpConfig={mcpSettings.handleCopyMcpConfig}
      onOpenMcpServerFolder={mcpSettings.handleOpenMcpServerFolder}
    />
  );
}

function folderCommandFor(folderType: FolderType) {
  switch (folderType) {
    case "database":
      return "open_database_folder";
    case "models":
      return "open_models_folder";
    case "recordings":
      return "open_recordings_folder";
  }
}
