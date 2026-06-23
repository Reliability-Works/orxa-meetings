"use client";

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  Copy,
  ExternalLink,
  FileSearch,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { WorkItem, WorkItemStatus, WorkPreMeetingBrief, WorkRecurringMemory } from "@/types";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

type FeatureSettingKind = "switch" | "select";

type FeatureSetting = {
  key: string;
  label: string;
  description: string;
  kind: FeatureSettingKind;
  defaultValue: boolean | string;
  options?: { value: string; label: string }[];
};

type FeatureDefinition = {
  id: string;
  title: string;
  intro: string;
  icon: LucideIcon;
  settings: FeatureSetting[];
};

type MeetingOption = {
  id: string;
  title: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  calendar_title?: string | null;
  start_unix_ms: number;
  end_unix_ms: number;
  is_all_day: boolean;
};

type AgentHandoffPacket = {
  meeting_id: string;
  meeting_title: string;
  target: string;
  role_scope: string;
  markdown: string;
  created_at: string;
};

type WorkBriefing = {
  kind: string;
  title: string;
  generated_at: string;
  meeting_count: number;
  item_count: number;
  markdown: string;
};

type TranscriptRepairSuggestion = {
  meeting_id: string;
  meeting_title: string;
  suggested_cutoff_seconds?: number | null;
  suggested_trim_reason?: string | null;
  weak_segments: Array<{
    id: string;
    text: string;
    timestamp: string;
    audio_start_time?: number | null;
    audio_end_time?: number | null;
    reason: string;
  }>;
  markdown: string;
};

type TrimResult = {
  deleted_count: number;
  remaining_count: number;
  total_count: number;
  summary_invalidated: boolean;
  applied: boolean;
};

type AgentToolCapability = {
  id: string;
  label: string;
  scope: string;
  access: string;
  enabled_by_default: boolean;
  description: string;
};

type McpSetupInfo = {
  command: string;
  server_script_path: string;
  server_script_exists: boolean;
  database_path: string;
  database_exists: boolean;
  client_config_json: string;
};

const FEATURE_DEFINITIONS = {
  agentHandoff: {
    id: "agentHandoff",
    title: "Agent handoff packets",
    intro: "Prepare meeting-backed briefs that can be sent to coding agents or workplace tools.",
    icon: Bot,
    settings: [
      { key: "enabled", label: "Enable handoff packets", description: "Expose handoff generation from meeting summaries and chat.", kind: "switch", defaultValue: true },
      { key: "defaultTarget", label: "Default target", description: "Primary output format when creating a packet.", kind: "select", defaultValue: "codex", options: [
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude" },
        { value: "jira", label: "Jira" },
        { value: "slack", label: "Slack" },
      ] },
      { key: "includeEvidence", label: "Include transcript evidence", description: "Attach timestamps and quotes for important claims.", kind: "switch", defaultValue: true },
      { key: "includeRepoHints", label: "Include repo and branch hints", description: "Use detected project references when they appear in a meeting.", kind: "switch", defaultValue: true },
    ],
  },
  actionInbox: {
    id: "actionInbox",
    title: "Action inbox",
    intro: "Collect actions, decisions, blockers, and follow-ups into a reviewable work queue.",
    icon: CheckSquare,
    settings: [
      { key: "enabled", label: "Enable action inbox", description: "Show extracted work items across meetings.", kind: "switch", defaultValue: true },
      { key: "autoExtract", label: "Extract after summaries", description: "Run action extraction whenever a summary is generated.", kind: "switch", defaultValue: true },
      { key: "requireEvidence", label: "Require evidence", description: "Keep items in review until transcript support is attached.", kind: "switch", defaultValue: true },
      { key: "defaultStatus", label: "Default status", description: "Initial state for newly extracted tasks.", kind: "select", defaultValue: "open", options: [
        { value: "open", label: "Open" },
        { value: "in_progress", label: "In progress" },
        { value: "blocked", label: "Blocked" },
      ] },
    ],
  },
  calendarIntelligence: {
    id: "calendarIntelligence",
    title: "Calendar intelligence",
    intro: "Use Calendar events to prep meetings, attach transcripts, and drive follow-up.",
    icon: CalendarClock,
    settings: [
      { key: "enabled", label: "Enable calendar intelligence", description: "Use Calendar metadata beyond auto-start.", kind: "switch", defaultValue: true },
      { key: "prepBriefs", label: "Pre-meeting prep", description: "Generate context briefs for upcoming calendar events.", kind: "switch", defaultValue: true },
      { key: "followUpReview", label: "Post-meeting review", description: "Suggest follow-ups after meetings end.", kind: "switch", defaultValue: true },
      { key: "matchWindow", label: "Attachment window", description: "How far from an event a transcript can be attached.", kind: "select", defaultValue: "30", options: [
        { value: "15", label: "15 minutes" },
        { value: "30", label: "30 minutes" },
        { value: "60", label: "1 hour" },
      ] },
    ],
  },
  projectMemory: {
    id: "projectMemory",
    title: "Project memory",
    intro: "Build a local memory of people, projects, decisions, acronyms, and recurring context.",
    icon: BriefcaseBusiness,
    settings: [
      { key: "enabled", label: "Enable project memory", description: "Let Orxa connect context across meetings.", kind: "switch", defaultValue: true },
      { key: "rememberDecisions", label: "Remember decisions", description: "Carry confirmed decisions into future chat and summaries.", kind: "switch", defaultValue: true },
      { key: "rememberPeople", label: "Remember people and teams", description: "Track names, roles, and ownership signals locally.", kind: "switch", defaultValue: true },
      { key: "retention", label: "Retention", description: "How long memory candidates stay active before review.", kind: "select", defaultValue: "90", options: [
        { value: "30", label: "30 days" },
        { value: "90", label: "90 days" },
        { value: "manual", label: "Until dismissed" },
      ] },
    ],
  },
  transcriptRepair: {
    id: "transcriptRepair",
    title: "Transcript repair studio",
    intro: "Find weak transcript sections, repair speakers, trim endings, and reprocess selected ranges.",
    icon: FileSearch,
    settings: [
      { key: "enabled", label: "Enable repair tools", description: "Show transcript cleanup actions in meeting views.", kind: "switch", defaultValue: true },
      { key: "flagLowConfidence", label: "Flag weak transcript areas", description: "Highlight sections likely to need correction.", kind: "switch", defaultValue: true },
      { key: "suggestTrim", label: "Suggest end trims", description: "Detect post-meeting noise after sign-off phrases.", kind: "switch", defaultValue: true },
      { key: "retranscribeRanges", label: "Allow range retranscription", description: "Re-run transcription for selected audio ranges.", kind: "switch", defaultValue: true },
    ],
  },
  briefings: {
    id: "briefings",
    title: "Briefings",
    intro: "Generate daily and weekly digest views for commitments, decisions, and changed context.",
    icon: ClipboardList,
    settings: [
      { key: "enabled", label: "Enable briefings", description: "Show briefing generation in Home and Calendar.", kind: "switch", defaultValue: true },
      { key: "daily", label: "Daily briefing", description: "Summarize yesterday, today, and overdue follow-ups.", kind: "switch", defaultValue: true },
      { key: "weekly", label: "Weekly briefing", description: "Summarize project progress and unresolved work.", kind: "switch", defaultValue: true },
      { key: "defaultTime", label: "Default time", description: "Preferred time for generated briefing reminders.", kind: "select", defaultValue: "09:00", options: [
        { value: "08:00", label: "08:00" },
        { value: "09:00", label: "09:00" },
        { value: "16:00", label: "16:00" },
      ] },
    ],
  },
  agentTools: {
    id: "agentTools",
    title: "Agent tools",
    intro: "Control what the chat agent and MCP layer can inspect or update.",
    icon: MessageSquareText,
    settings: [
      { key: "enabled", label: "Enable agent tools", description: "Allow the chat agent to use local meeting tools.", kind: "switch", defaultValue: true },
      { key: "queryTranscripts", label: "Query transcripts", description: "Let agents search raw transcript segments with citations.", kind: "switch", defaultValue: true },
      { key: "queryWork", label: "Query work items", description: "Let agents read actions, decisions, risks, and questions.", kind: "switch", defaultValue: true },
      { key: "updateWork", label: "Update work item status", description: "Allow agents to mark items open, blocked, done, or dismissed.", kind: "switch", defaultValue: false },
    ],
  },
} satisfies Record<string, FeatureDefinition>;

export type WorkflowFeatureTab = keyof typeof FEATURE_DEFINITIONS;

const ROLE_OPTIONS = [
  { value: "engineering", label: "Engineering" },
  { value: "product", label: "Product" },
  { value: "sales_cs", label: "Sales / CS" },
  { value: "people", label: "People" },
  { value: "leadership", label: "Leadership" },
  { value: "general", label: "General" },
];

const STATUS_OPTIONS: WorkItemStatus[] = ["open", "in_progress", "blocked", "done", "dismissed"];

function storageKey(featureId: string) {
  return `orxa.featureSettings.${featureId}`;
}

function defaultsFor(feature: FeatureDefinition) {
  return Object.fromEntries(feature.settings.map((setting) => [setting.key, setting.defaultValue]));
}

function isEnabled(values: Record<string, boolean | string>) {
  return values.enabled !== false;
}

function formatDateTime(value?: number | string | null) {
  if (!value) return "TBD";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function buildEventHint(event: CalendarEvent) {
  return [event.calendar_title, event.is_all_day ? "All day event" : null].filter(Boolean).join(" - ");
}

function MeetingSelect({
  value,
  onChange,
  meetings,
}: {
  value: string;
  onChange: (value: string) => void;
  meetings: MeetingOption[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none focus:border-gray-300"
    >
      <option value="">Choose meeting</option>
      {meetings.map((meeting) => (
        <option key={meeting.id} value={meeting.id}>
          {meeting.title}
        </option>
      ))}
    </select>
  );
}

function OutputBox({ output, onCopy }: { output: string; onCopy: () => void }) {
  if (!output) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <div className="text-[13px] font-medium text-gray-700">Generated output</div>
        <Button variant="ghost" size="sm" onClick={onCopy}>
          <Copy className="h-4 w-4" />
          Copy
        </Button>
      </div>
      <Textarea
        readOnly
        value={output}
        className="min-h-72 resize-y rounded-none border-0 bg-white font-mono text-xs leading-5 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

export function WorkflowFeatureSettings({ featureId }: { featureId: keyof typeof FEATURE_DEFINITIONS }) {
  const feature = FEATURE_DEFINITIONS[featureId];
  const defaults = useMemo(() => defaultsFor(feature), [feature]);
  const [values, setValues] = useState<Record<string, boolean | string>>(defaults);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(storageKey(feature.id));
      setValues(saved ? { ...defaults, ...JSON.parse(saved) } : defaults);
    } catch {
      setValues(defaults);
    }
  }, [defaults, feature.id]);

  const updateValue = (key: string, value: boolean | string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(feature.id), JSON.stringify(next));
    }
  };

  const Icon = feature.icon;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-950">{feature.title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-500">{feature.intro}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {feature.settings.map((setting, index) => (
          <div
            key={setting.key}
            className={`flex min-h-14 items-center justify-between gap-5 px-4 py-3 ${
              index > 0 ? "border-t border-gray-100" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-gray-950">{setting.label}</div>
              <div className="mt-0.5 text-[13px] leading-5 text-gray-500">{setting.description}</div>
            </div>
            {setting.kind === "switch" ? (
              <Switch
                checked={Boolean(values[setting.key])}
                onCheckedChange={(checked) => updateValue(setting.key, checked)}
              />
            ) : (
              <select
                value={String(values[setting.key] ?? setting.defaultValue)}
                onChange={(event) => updateValue(setting.key, event.target.value)}
                className="h-8 min-w-32 rounded-lg border border-gray-200 bg-gray-50 px-2 text-sm text-gray-800 outline-none focus:border-gray-300"
              >
                {setting.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <WorkflowWorkbench featureId={featureId} values={values} />

      <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
        <p>These controls are stored locally on this Mac. The workbench below runs against the local Orxa database and MCP-compatible tool layer.</p>
      </div>
    </div>
  );
}

function WorkflowWorkbench({
  featureId,
  values,
}: {
  featureId: WorkflowFeatureTab;
  values: Record<string, boolean | string>;
}) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [meetingId, setMeetingId] = useState("");
  const [roleScope, setRoleScope] = useState("engineering");
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [inboxStatus, setInboxStatus] = useState<WorkItemStatus | "all">("open");
  const [briefingKind, setBriefingKind] = useState("daily");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [repairSuggestion, setRepairSuggestion] = useState<TranscriptRepairSuggestion | null>(null);
  const [trimPreview, setTrimPreview] = useState<TrimResult | null>(null);
  const [capabilities, setCapabilities] = useState<AgentToolCapability[]>([]);
  const [mcpInfo, setMcpInfo] = useState<McpSetupInfo | null>(null);

  const selectedMeeting = meetings.find((meeting) => meeting.id === meetingId);
  const selectedEvent = calendarEvents.find((event) => event.id === selectedEventId);
  const disabled = !isEnabled(values);

  useEffect(() => {
    setOutput("");
    setRepairSuggestion(null);
    setTrimPreview(null);
  }, [featureId]);

  useEffect(() => {
    const loadMeetings = async () => {
      if (!["agentHandoff", "actionInbox", "projectMemory", "transcriptRepair"].includes(featureId)) return;
      try {
        const result = await invoke<MeetingOption[]>("api_get_meetings", { authToken: null });
        setMeetings(result);
        setMeetingId((current) => current || result[0]?.id || "");
      } catch (error) {
        console.error("Failed to load meetings:", error);
        toast.error("Could not load meetings");
      }
    };

    void loadMeetings();
  }, [featureId]);

  useEffect(() => {
    if (featureId === "actionInbox") {
      void loadItems();
    }
    if (featureId === "calendarIntelligence") {
      void loadCalendarEvents();
    }
    if (featureId === "agentTools") {
      void loadAgentTools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  const copyOutput = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    toast.success("Copied");
  };

  const runWithToast = async (action: () => Promise<void>) => {
    setIsRunning(true);
    try {
      await action();
    } catch (error) {
      console.error("Workflow failed:", error);
      toast.error("Workflow failed", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsRunning(false);
    }
  };

  const loadItems = async () => {
    const result = await invoke<WorkItem[]>("workhub_list_items", {
      kind: null,
      status: inboxStatus === "all" ? null : inboxStatus,
      meetingId: null,
      limit: 100,
    });
    setItems(result);
  };

  const syncRecentMeetings = async () => {
    await runWithToast(async () => {
      const nextMeetings = meetings.length ? meetings : await invoke<MeetingOption[]>("api_get_meetings", { authToken: null });
      for (const meeting of nextMeetings.slice(0, 8)) {
        await invoke("workhub_sync_meeting", { meetingId: meeting.id });
      }
      await loadItems();
      toast.success("Recent meetings synced");
    });
  };

  const updateItemStatus = async (item: WorkItem, status: WorkItemStatus) => {
    const updated = await invoke<WorkItem>("workhub_update_item_status", {
      itemId: item.id,
      status,
      agentNotes: "Updated from Orxa Action inbox settings.",
    });
    setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
  };

  const generateHandoff = async () => {
    if (!meetingId) {
      toast.warning("Choose a meeting first");
      return;
    }
    await runWithToast(async () => {
      const result = await invoke<AgentHandoffPacket>("workhub_create_agent_handoff", {
        meetingId,
        target: String(values.defaultTarget || "codex"),
        roleScope,
        includeEvidence: Boolean(values.includeEvidence),
        includeRepoHints: Boolean(values.includeRepoHints),
      });
      setOutput(result.markdown);
      toast.success("Handoff packet generated");
    });
  };

  const generateBriefing = async () => {
    await runWithToast(async () => {
      const result = await invoke<WorkBriefing>("workhub_generate_briefing", { kind: briefingKind });
      setOutput(result.markdown);
      toast.success(`${result.title} generated`);
    });
  };

  const loadCalendarEvents = async () => {
    await runWithToast(async () => {
      const now = Date.now();
      const events = await invoke<CalendarEvent[]>("list_calendar_events", {
        startUnixMs: now - 24 * 60 * 60 * 1000,
        endUnixMs: now + 14 * 24 * 60 * 60 * 1000,
      });
      setCalendarEvents(events);
      setSelectedEventId((current) => current || events[0]?.id || "");
    });
  };

  const generateCalendarBrief = async () => {
    if (!selectedEvent) {
      toast.warning("Choose a calendar event first");
      return;
    }
    await runWithToast(async () => {
      const result = await invoke<WorkPreMeetingBrief>("workhub_create_pre_meeting_brief", {
        title: selectedEvent.title,
        startsAt: new Date(selectedEvent.start_unix_ms).toISOString(),
        attendeeHint: buildEventHint(selectedEvent) || null,
        relatedMeetingId: null,
      });
      setOutput(result.brief_markdown);
      toast.success("Pre-meeting brief generated");
    });
  };

  const generateProjectMemory = async () => {
    if (!meetingId) {
      toast.warning("Choose a meeting first");
      return;
    }
    await runWithToast(async () => {
      const result = await invoke<WorkRecurringMemory>("workhub_get_recurring_memory", { meetingId });
      setOutput(result.markdown);
      toast.success("Project memory generated");
    });
  };

  const suggestRepairs = async () => {
    if (!meetingId) {
      toast.warning("Choose a meeting first");
      return;
    }
    await runWithToast(async () => {
      const result = await invoke<TranscriptRepairSuggestion>("workhub_suggest_transcript_repairs", { meetingId });
      setRepairSuggestion(result);
      setTrimPreview(null);
      setOutput(result.markdown);
      toast.success("Repair review generated");
    });
  };

  const previewTrim = async () => {
    if (!repairSuggestion?.suggested_cutoff_seconds) return;
    await runWithToast(async () => {
      const result = await invoke<TrimResult>("api_preview_trim_meeting_transcript", {
        meetingId: repairSuggestion.meeting_id,
        cutoffSeconds: repairSuggestion.suggested_cutoff_seconds,
      });
      setTrimPreview(result);
      toast.success("Trim preview ready");
    });
  };

  const applyTrim = async () => {
    if (!repairSuggestion?.suggested_cutoff_seconds) return;
    await runWithToast(async () => {
      const result = await invoke<TrimResult>("api_trim_meeting_transcript", {
        meetingId: repairSuggestion.meeting_id,
        cutoffSeconds: repairSuggestion.suggested_cutoff_seconds,
        confirm: true,
      });
      setTrimPreview(result);
      toast.success("Transcript trimmed");
    });
  };

  const loadAgentTools = async () => {
    await runWithToast(async () => {
      const [toolInfo, setupInfo] = await Promise.all([
        invoke<AgentToolCapability[]>("workhub_get_agent_tool_capabilities"),
        invoke<McpSetupInfo>("get_mcp_setup_info"),
      ]);
      setCapabilities(toolInfo);
      setMcpInfo(setupInfo);
    });
  };

  const copyMcpConfig = async () => {
    if (!mcpInfo) return;
    await navigator.clipboard.writeText(mcpInfo.client_config_json);
    toast.success("MCP config copied");
  };

  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${disabled ? "opacity-60" : ""}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-gray-950">Run this workflow</div>
          <div className="mt-0.5 text-[13px] text-gray-500">These actions use local meetings, transcripts, summaries, and Work Hub data.</div>
        </div>
        {isRunning && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
      </div>

      {featureId === "agentHandoff" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <MeetingSelect value={meetingId} onChange={setMeetingId} meetings={meetings} />
            <select value={roleScope} onChange={(event) => setRoleScope(event.target.value)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm">
              {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Button size="sm" onClick={generateHandoff} disabled={disabled || isRunning || !meetingId}>
              Generate handoff
            </Button>
          </div>
          <OutputBox output={output} onCopy={copyOutput} />
        </div>
      )}

      {featureId === "actionInbox" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={inboxStatus} onChange={(event) => setInboxStatus(event.target.value as WorkItemStatus | "all")} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm">
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => void loadItems()} disabled={disabled || isRunning}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={syncRecentMeetings} disabled={disabled || isRunning}>
              Sync recent meetings
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-sm text-gray-500">No work items in this filter yet.</div>
            ) : (
              items.map((item, index) => (
                <div key={item.id} className={`px-4 py-3 ${index > 0 ? "border-t border-gray-100" : ""}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-500">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5">{item.kind}</span>
                        <span>{formatStatus(item.status)}</span>
                        <span className="truncate">{item.meeting_title || item.meeting_id}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-950">{item.title}</div>
                      {item.evidence && <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{item.evidence}</div>}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {STATUS_OPTIONS.map((status) => (
                        <Button
                          key={status}
                          variant={item.status === status ? "default" : "outline"}
                          size="sm"
                          onClick={() => void updateItemStatus(item, status)}
                          disabled={disabled || isRunning}
                        >
                          {formatStatus(status)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {featureId === "briefings" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <select value={briefingKind} onChange={(event) => setBriefingKind(event.target.value)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm">
              <option value="daily">Daily briefing</option>
              <option value="weekly">Weekly briefing</option>
            </select>
            <Button size="sm" onClick={generateBriefing} disabled={disabled || isRunning}>
              Generate briefing
            </Button>
          </div>
          <OutputBox output={output} onCopy={copyOutput} />
        </div>
      )}

      {featureId === "calendarIntelligence" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)} className="h-8 min-w-72 rounded-lg border border-gray-200 bg-white px-2 text-sm">
              <option value="">Choose Calendar event</option>
              {calendarEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} - {formatDateTime(event.start_unix_ms)}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={loadCalendarEvents} disabled={disabled || isRunning}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={generateCalendarBrief} disabled={disabled || isRunning || !selectedEvent}>
              Generate prep brief
            </Button>
          </div>
          {selectedEvent && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {selectedEvent.title} starts {formatDateTime(selectedEvent.start_unix_ms)}
            </div>
          )}
          <OutputBox output={output} onCopy={copyOutput} />
        </div>
      )}

      {featureId === "projectMemory" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <MeetingSelect value={meetingId} onChange={setMeetingId} meetings={meetings} />
            <Button size="sm" onClick={generateProjectMemory} disabled={disabled || isRunning || !meetingId}>
              Generate memory
            </Button>
          </div>
          <OutputBox output={output} onCopy={copyOutput} />
        </div>
      )}

      {featureId === "transcriptRepair" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <MeetingSelect value={meetingId} onChange={setMeetingId} meetings={meetings} />
            <Button size="sm" onClick={suggestRepairs} disabled={disabled || isRunning || !meetingId}>
              Review transcript
            </Button>
            {selectedMeeting && (
              <Button size="sm" variant="outline" onClick={() => router.push(`/meeting-details?id=${selectedMeeting.id}`)}>
                <ExternalLink className="h-4 w-4" />
                Open meeting
              </Button>
            )}
          </div>
          {repairSuggestion?.suggested_cutoff_seconds && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>{repairSuggestion.suggested_trim_reason || "Tail trim suggested."}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={previewTrim} disabled={disabled || isRunning}>
                  Preview trim
                </Button>
                <Button size="sm" variant="destructive" onClick={applyTrim} disabled={disabled || isRunning || !trimPreview}>
                  Apply trim
                </Button>
              </div>
            </div>
          )}
          {trimPreview && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {trimPreview.applied ? "Applied" : "Preview"}: {trimPreview.deleted_count} segments removed, {trimPreview.remaining_count} kept.
              {trimPreview.summary_invalidated ? " Summary needs regeneration." : ""}
            </div>
          )}
          <OutputBox output={output} onCopy={copyOutput} />
        </div>
      )}

      {featureId === "agentTools" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={loadAgentTools} disabled={disabled || isRunning}>
              <RefreshCcw className="h-4 w-4" />
              Refresh tools
            </Button>
            <Button size="sm" onClick={() => router.push("/chat")} disabled={disabled}>
              Open chat agent
            </Button>
            <Button size="sm" variant="outline" onClick={copyMcpConfig} disabled={disabled || !mcpInfo}>
              <Copy className="h-4 w-4" />
              Copy MCP config
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {capabilities.map((capability, index) => (
              <div key={capability.id} className={`flex items-start justify-between gap-4 px-4 py-3 ${index > 0 ? "border-t border-gray-100" : ""}`}>
                <div>
                  <div className="text-sm font-medium text-gray-950">{capability.label}</div>
                  <div className="mt-0.5 text-xs leading-5 text-gray-500">{capability.description}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-gray-500">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5">{capability.scope}</span>
                  <span>{capability.access}</span>
                </div>
              </div>
            ))}
          </div>
          {mcpInfo && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <div className="font-medium text-gray-800">MCP server</div>
                <div className="mt-1 break-all">{mcpInfo.server_script_path}</div>
                <div className="mt-1">{mcpInfo.server_script_exists ? "Available" : "Missing"}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                <div className="font-medium text-gray-800">Meeting database</div>
                <div className="mt-1 break-all">{mcpInfo.database_path}</div>
                <div className="mt-1">{mcpInfo.database_exists ? "Available" : "Missing"}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const WORKFLOW_FEATURE_SETTINGS = FEATURE_DEFINITIONS;
