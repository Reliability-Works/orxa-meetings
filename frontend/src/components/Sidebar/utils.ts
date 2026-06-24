import type { ChatSession } from "@/types";
import type { CurrentMeeting } from "./types";

export const INTRO_MEETING: CurrentMeeting = {
  id: "intro-call",
  title: "+ New Call",
};

export function relativeTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return `${Math.floor(days / 7)}w`;
}

export function clampSidebarWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function chatMatchesQuery(session: ChatSession, query: string) {
  return (
    session.title.toLowerCase().includes(query) ||
    session.last_message?.toLowerCase().includes(query) ||
    session.meeting_title?.toLowerCase().includes(query)
  );
}

export function isTerminalSummaryStatus(status?: string) {
  return (
    status === "completed" || status === "error" || status === "failed" || status === "cancelled"
  );
}
