"use client";

import type { ReactNode } from "react";
import { Bot, Calendar, Check, Clock, Copy, FolderOpen, Server, ShieldCheck } from "lucide-react";

import { Switch } from "../ui/switch";
import {
  CalendarAutoStartPreferences,
  CalendarPermissionStatus,
  calendarPermissionLabel,
  canReadCalendar,
  McpSetupInfo,
  StorageLocations,
} from "./types";

type FolderType = "database" | "models" | "recordings";

interface PreferenceSettingsViewProps {
  notificationsEnabledValue: boolean;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  calendarPrefs: CalendarAutoStartPreferences | null;
  calendarPermissionStatus: CalendarPermissionStatus;
  isCalendarSaving: boolean;
  calendarError: string | null;
  onCalendarPermissionRequest: () => void;
  onCalendarAutoStartToggle: (enabled: boolean) => void;
  onCalendarLeadTimeChange: (leadTimeMinutes: number) => void;
  mcpSetupInfo: McpSetupInfo | null;
  mcpError: string | null;
  isMcpConfigCopied: boolean;
  onCopyMcpConfig: () => void;
  onOpenMcpServerFolder: () => void;
  storageLocations?: StorageLocations | null;
  onOpenFolder: (folderType: FolderType) => void;
}

export function PreferenceSettingsView(props: PreferenceSettingsViewProps) {
  return (
    <div className="space-y-8">
      <GeneralSettingsSection {...props} />
      <AgentAccessSection {...props} />
      <StorageSection storageLocations={props.storageLocations} onOpenFolder={props.onOpenFolder} />
    </div>
  );
}

function GeneralSettingsSection(props: PreferenceSettingsViewProps) {
  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold text-gray-950">General</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex min-h-20 items-center justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium text-gray-950">Notifications</h3>
            <p className="mt-1 text-sm text-gray-500">
              Show start and end notifications for meetings.
            </p>
          </div>
          <Switch
            checked={props.notificationsEnabledValue}
            onCheckedChange={props.onNotificationsEnabledChange}
          />
        </div>

        <CalendarAutoStartRow {...props} />
      </div>
    </section>
  );
}

function CalendarAutoStartRow({
  calendarPrefs,
  calendarPermissionStatus,
  isCalendarSaving,
  calendarError,
  onCalendarPermissionRequest,
  onCalendarAutoStartToggle,
  onCalendarLeadTimeChange,
}: PreferenceSettingsViewProps) {
  return (
    <div className="border-t border-gray-100 px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <h3 className="text-[15px] font-medium text-gray-950">Calendar auto-start</h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Start transcription automatically when a calendar meeting begins.
          </p>
          <CalendarLeadTimeSelect
            calendarPrefs={calendarPrefs}
            isCalendarSaving={isCalendarSaving}
            onCalendarLeadTimeChange={onCalendarLeadTimeChange}
          />
        </div>
        <Switch
          checked={calendarPrefs?.enabled ?? false}
          onCheckedChange={onCalendarAutoStartToggle}
          disabled={!calendarPrefs || isCalendarSaving}
        />
      </div>

      <CalendarPermissionRow
        calendarPermissionStatus={calendarPermissionStatus}
        isCalendarSaving={isCalendarSaving}
        onCalendarPermissionRequest={onCalendarPermissionRequest}
      />

      {calendarError && <p className="mt-3 text-sm text-red-600">{calendarError}</p>}
    </div>
  );
}

function CalendarLeadTimeSelect({
  calendarPrefs,
  isCalendarSaving,
  onCalendarLeadTimeChange,
}: Pick<
  PreferenceSettingsViewProps,
  "calendarPrefs" | "isCalendarSaving" | "onCalendarLeadTimeChange"
>) {
  return (
    <label className="mt-3 flex w-fit items-center gap-2 text-sm text-gray-700">
      <Clock className="h-4 w-4 text-gray-400" />
      <span>Lead time</span>
      <select
        value={calendarPrefs?.lead_time_minutes ?? 0}
        onChange={(event) => onCalendarLeadTimeChange(Number(event.target.value))}
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
  );
}

function CalendarPermissionRow({
  calendarPermissionStatus,
  isCalendarSaving,
  onCalendarPermissionRequest,
}: Pick<
  PreferenceSettingsViewProps,
  "calendarPermissionStatus" | "isCalendarSaving" | "onCalendarPermissionRequest"
>) {
  const canRequestPermission =
    !canReadCalendar(calendarPermissionStatus) && calendarPermissionStatus !== "unavailable";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <ShieldCheck className="h-4 w-4 text-gray-400" />
        <span>Calendar access: {calendarPermissionLabel(calendarPermissionStatus)}</span>
      </div>
      {canRequestPermission && (
        <button
          onClick={onCalendarPermissionRequest}
          disabled={isCalendarSaving}
          className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Allow Access
        </button>
      )}
    </div>
  );
}

function AgentAccessSection({
  mcpSetupInfo,
  mcpError,
  isMcpConfigCopied,
  onCopyMcpConfig,
  onOpenMcpServerFolder,
  storageLocations,
  onOpenFolder,
}: PreferenceSettingsViewProps) {
  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Agent access</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <AgentAccessHeader
          mcpSetupInfo={mcpSetupInfo}
          isMcpConfigCopied={isMcpConfigCopied}
          onCopyMcpConfig={onCopyMcpConfig}
        />
        <McpLocationGrid mcpSetupInfo={mcpSetupInfo} storageLocations={storageLocations} />
        <McpConfigPanel
          mcpSetupInfo={mcpSetupInfo}
          mcpError={mcpError}
          onOpenMcpServerFolder={onOpenMcpServerFolder}
          onOpenFolder={onOpenFolder}
        />
      </div>
    </section>
  );
}

function AgentAccessHeader({
  mcpSetupInfo,
  isMcpConfigCopied,
  onCopyMcpConfig,
}: Pick<PreferenceSettingsViewProps, "mcpSetupInfo" | "isMcpConfigCopied" | "onCopyMcpConfig">) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-gray-500" />
          <h3 className="text-[15px] font-medium text-gray-950">Agent MCP access</h3>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Local agent access to meetings, raw transcripts, speaker labels, summaries, notes, action
          items, and confirmed transcript trimming.
        </p>
      </div>
      <button
        onClick={onCopyMcpConfig}
        disabled={!mcpSetupInfo}
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isMcpConfigCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {isMcpConfigCopied ? "Copied" : "Copy config"}
      </button>
    </div>
  );
}

function McpLocationGrid({
  mcpSetupInfo,
  storageLocations,
}: Pick<PreferenceSettingsViewProps, "mcpSetupInfo" | "storageLocations">) {
  return (
    <div className="grid gap-px border-t border-gray-100 bg-gray-100 md:grid-cols-2">
      <McpLocationCard
        icon={<Server className="h-4 w-4 text-gray-500" />}
        title="MCP server"
        value={mcpSetupInfo?.server_script_path || "Loading..."}
        status={mcpSetupInfo?.server_script_exists ? "Available" : "Not found"}
      />
      <McpLocationCard
        icon={<FolderOpen className="h-4 w-4 text-gray-500" />}
        title="Meeting database"
        value={mcpSetupInfo?.database_path || storageLocations?.database || "Loading..."}
        status={mcpSetupInfo?.database_exists ? "Available" : "Created after meetings are saved"}
      />
    </div>
  );
}

function McpLocationCard({
  icon,
  title,
  value,
  status,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  status: string;
}) {
  return (
    <div className="bg-gray-50 px-5 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
        {icon}
        {title}
      </div>
      <div className="mt-1 break-all font-mono text-xs text-gray-600">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{status}</div>
    </div>
  );
}

function McpConfigPanel({
  mcpSetupInfo,
  mcpError,
  onOpenMcpServerFolder,
  onOpenFolder,
}: Pick<
  PreferenceSettingsViewProps,
  "mcpSetupInfo" | "mcpError" | "onOpenMcpServerFolder" | "onOpenFolder"
>) {
  return (
    <div className="border-t border-gray-100 px-5 py-4">
      <pre className="max-h-40 overflow-auto rounded-lg border border-gray-200 bg-gray-950 p-3 text-xs text-gray-100">
        {mcpSetupInfo?.client_config_json || "Loading MCP config..."}
      </pre>

      <div className="mt-3 flex flex-wrap gap-2">
        <FolderButton onClick={onOpenMcpServerFolder} disabled={!mcpSetupInfo}>
          Open server folder
        </FolderButton>
        <FolderButton onClick={() => onOpenFolder("database")}>Open database folder</FolderButton>
      </div>

      {mcpError && <p className="mt-3 text-sm text-red-600">{mcpError}</p>}
    </div>
  );
}

function StorageSection({
  storageLocations,
  onOpenFolder,
}: Pick<PreferenceSettingsViewProps, "storageLocations" | "onOpenFolder">) {
  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Storage</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium text-gray-950">Meeting recordings</h3>
            <p className="mt-1 break-all font-mono text-xs text-gray-500">
              {storageLocations?.recordings || "Loading..."}
            </p>
          </div>
          <FolderButton onClick={() => onOpenFolder("recordings")}>Open</FolderButton>
        </div>
        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
          Database and models are stored together in your application data directory.
        </div>
      </div>
    </section>
  );
}

function FolderButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <FolderOpen className="h-4 w-4" />
      {children}
    </button>
  );
}
