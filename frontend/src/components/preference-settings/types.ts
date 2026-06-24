export type CalendarPermissionStatus =
  | "not_determined"
  | "restricted"
  | "denied"
  | "full_access"
  | "write_only"
  | "unavailable"
  | "unknown";

export interface CalendarAutoStartPreferences {
  enabled: boolean;
  lead_time_minutes: number;
  include_all_day_events: boolean;
}

export interface McpSetupInfo {
  command: string;
  server_script_path: string;
  server_script_exists: boolean;
  database_path: string;
  database_exists: boolean;
  client_config_json: string;
}

export interface StorageLocations {
  database?: string;
  recordings?: string;
}

export const DEFAULT_CALENDAR_PREFS: CalendarAutoStartPreferences = {
  enabled: false,
  lead_time_minutes: 0,
  include_all_day_events: false,
};

export function canReadCalendar(status: CalendarPermissionStatus) {
  return status === "full_access";
}

export function calendarPermissionLabel(status: CalendarPermissionStatus) {
  switch (status) {
    case "full_access":
      return "Allowed";
    case "not_determined":
      return "Not requested";
    case "denied":
      return "Denied";
    case "restricted":
      return "Restricted";
    case "write_only":
      return "Write-only";
    case "unavailable":
      return "Unavailable";
    default:
      return "Unknown";
  }
}
