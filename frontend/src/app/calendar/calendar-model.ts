export interface MeetingCalendarItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_path?: string | null;
  recording_duration_seconds?: number | null;
  transcript_count: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  calendar_title?: string | null;
  start_unix_ms: number;
  end_unix_ms: number;
  is_all_day: boolean;
}

export type CalendarPermissionStatus =
  | "not_determined"
  | "restricted"
  | "denied"
  | "full_access"
  | "write_only"
  | "unavailable"
  | "unknown";

export interface EventAgendaItem {
  type: "event";
  id: string;
  startMs: number;
  event: CalendarEvent;
  meetings: MeetingCalendarItem[];
}

export interface RecordingAgendaItem {
  type: "recording";
  id: string;
  startMs: number;
  meeting: MeetingCalendarItem;
}

export type AgendaItem = EventAgendaItem | RecordingAgendaItem;

const FALLBACK_RECORDING_DURATION_MS = 5 * 60 * 1000;

export function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function formatMonth(value: Date) {
  return value.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatTime(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : parseDate(value);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTimeRange(event: CalendarEvent) {
  if (event.is_all_day) return "All day";
  return `${formatTime(event.start_unix_ms)} - ${formatTime(event.end_unix_ms)}`;
}

export function buildCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function calendarRangeForMonth(month: Date) {
  const days = buildCalendarDays(month);
  const start = new Date(days[0]);
  start.setHours(0, 0, 0, 0);

  const end = new Date(days[days.length - 1]);
  end.setDate(end.getDate() + 1);
  end.setHours(0, 0, 0, 0);

  return { start, end };
}

function meetingStartMs(meeting: MeetingCalendarItem) {
  return parseDate(meeting.created_at).getTime();
}

function meetingEndMs(meeting: MeetingCalendarItem) {
  const start = meetingStartMs(meeting);
  const durationMs = Math.max(0, meeting.recording_duration_seconds ?? 0) * 1000;
  const updated = parseDate(meeting.updated_at).getTime();

  return Math.max(
    start + (durationMs || FALLBACK_RECORDING_DURATION_MS),
    Number.isNaN(updated) ? start : updated,
  );
}

function overlapMs(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function matchMeetingToEvent(meeting: MeetingCalendarItem, events: CalendarEvent[]) {
  const start = meetingStartMs(meeting);
  const end = meetingEndMs(meeting);
  let best: { event: CalendarEvent; overlap: number } | null = null;

  for (const event of events) {
    if (event.is_all_day) continue;
    const overlap = overlapMs(start, end, event.start_unix_ms, event.end_unix_ms);
    const startsInsideEvent = start >= event.start_unix_ms && start <= event.end_unix_ms;

    if ((overlap > 0 || startsInsideEvent) && (!best || overlap > best.overlap)) {
      best = { event, overlap };
    }
  }

  return best?.event ?? null;
}

export function buildAgenda(events: CalendarEvent[], meetings: MeetingCalendarItem[]) {
  const itemsByDate = new Map<string, AgendaItem[]>();
  const eventItems = new Map<string, EventAgendaItem>();

  for (const event of events) {
    const item: EventAgendaItem = {
      type: "event",
      id: `event-${event.id}`,
      startMs: event.start_unix_ms,
      event,
      meetings: [],
    };
    eventItems.set(event.id, item);

    const key = dateKey(new Date(event.start_unix_ms));
    const list = itemsByDate.get(key) ?? [];
    list.push(item);
    itemsByDate.set(key, list);
  }

  for (const meeting of meetings) {
    const event = matchMeetingToEvent(meeting, events);

    if (event) {
      eventItems.get(event.id)?.meetings.push(meeting);
      continue;
    }

    const key = dateKey(parseDate(meeting.created_at));
    const list = itemsByDate.get(key) ?? [];
    list.push({
      type: "recording",
      id: `recording-${meeting.id}`,
      startMs: meetingStartMs(meeting),
      meeting,
    });
    itemsByDate.set(key, list);
  }

  for (const items of itemsByDate.values()) {
    items.sort((a, b) => a.startMs - b.startMs);
    for (const item of items) {
      if (item.type === "event") {
        item.meetings.sort((a, b) => meetingStartMs(a) - meetingStartMs(b));
      }
    }
  }

  return itemsByDate;
}

export function itemTitle(item: AgendaItem) {
  return item.type === "event" ? item.event.title : item.meeting.title;
}

export function canReadCalendar(status: CalendarPermissionStatus) {
  return status === "full_access";
}

export function shouldAttemptCalendarRead(status: CalendarPermissionStatus) {
  return status === "full_access" || status === "unknown";
}

export function calendarAccessMessage(status: CalendarPermissionStatus) {
  switch (status) {
    case "denied":
      return "Calendar access is denied. Open macOS Settings and allow Orxa to read Calendar events.";
    case "restricted":
      return "Calendar access is restricted by macOS settings.";
    case "write_only":
      return "Calendar access is write-only. Orxa needs full access to read meeting events.";
    case "unavailable":
      return "Calendar access is not available in this build.";
    case "not_determined":
      return "Allow Calendar access to show your real meeting events here.";
    default:
      return "Calendar access did not settle after the macOS prompt. Try again or reopen Orxa.";
  }
}
