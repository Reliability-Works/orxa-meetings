"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  FileSearch,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "./ui/switch";

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
        { value: "review", label: "Needs review" },
        { value: "triaged", label: "Triaged" },
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

function storageKey(featureId: string) {
  return `orxa.featureSettings.${featureId}`;
}

function defaultsFor(feature: FeatureDefinition) {
  return Object.fromEntries(feature.settings.map((setting) => [setting.key, setting.defaultValue]));
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
            className={`flex min-h-16 items-center justify-between gap-5 px-4 py-3 ${
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

      <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
        <p>These controls are stored locally on this Mac. Integrations should read these settings before running automated work.</p>
      </div>
    </div>
  );
}

export const WORKFLOW_FEATURE_SETTINGS = FEATURE_DEFINITIONS;
