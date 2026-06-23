"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

interface MeetingCalendarItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_path?: string | null;
  recording_duration_seconds?: number | null;
  transcript_count: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  calendar_title?: string | null;
  start_unix_ms: number;
  end_unix_ms: number;
  is_all_day: boolean;
}

type CalendarPermissionStatus =
  | 'not_determined'
  | 'restricted'
  | 'denied'
  | 'full_access'
  | 'write_only'
  | 'unavailable'
  | 'unknown';

interface EventAgendaItem {
  type: 'event';
  id: string;
  startMs: number;
  event: CalendarEvent;
  meetings: MeetingCalendarItem[];
}

interface RecordingAgendaItem {
  type: 'recording';
  id: string;
  startMs: number;
  meeting: MeetingCalendarItem;
}

type AgendaItem = EventAgendaItem | RecordingAgendaItem;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FALLBACK_RECORDING_DURATION_MS = 5 * 60 * 1000;

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatMonth(value: Date) {
  return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatTime(value: number | string) {
  const date = typeof value === 'number' ? new Date(value) : parseDate(value);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeRange(event: CalendarEvent) {
  if (event.is_all_day) return 'All day';
  return `${formatTime(event.start_unix_ms)} - ${formatTime(event.end_unix_ms)}`;
}

function buildCalendarDays(month: Date) {
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

function calendarRangeForMonth(month: Date) {
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
    Number.isNaN(updated) ? start : updated
  );
}

function overlapMs(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
) {
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

function buildAgenda(events: CalendarEvent[], meetings: MeetingCalendarItem[]) {
  const itemsByDate = new Map<string, AgendaItem[]>();
  const eventItems = new Map<string, EventAgendaItem>();

  for (const event of events) {
    const item: EventAgendaItem = {
      type: 'event',
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
      type: 'recording',
      id: `recording-${meeting.id}`,
      startMs: meetingStartMs(meeting),
      meeting,
    });
    itemsByDate.set(key, list);
  }

  for (const items of itemsByDate.values()) {
    items.sort((a, b) => a.startMs - b.startMs);
    for (const item of items) {
      if (item.type === 'event') {
        item.meetings.sort((a, b) => meetingStartMs(a) - meetingStartMs(b));
      }
    }
  }

  return itemsByDate;
}

function itemTitle(item: AgendaItem) {
  return item.type === 'event' ? item.event.title : item.meeting.title;
}

export default function CalendarPage() {
  const router = useRouter();
  const { setCurrentMeeting } = useSidebar();
  const [meetings, setMeetings] = useState<MeetingCalendarItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<CalendarPermissionStatus>('unknown');
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const range = useMemo(() => calendarRangeForMonth(visibleMonth), [visibleMonth]);

  const loadMeetings = useCallback(async () => {
    setIsLoadingMeetings(true);
    try {
      const loaded = await invoke<MeetingCalendarItem[]>('api_get_meeting_calendar_items');
      setMeetings(loaded);

      if (loaded.length > 0) {
        const newest = parseDate(loaded[0].created_at);
        setVisibleMonth(new Date(newest.getFullYear(), newest.getMonth(), 1));
        setSelectedDate(dateKey(newest));
      }
    } catch (error) {
      console.error('Failed to load meeting calendar items:', error);
      toast.error('Could not load meeting recordings');
    } finally {
      setIsLoadingMeetings(false);
    }
  }, []);

  const loadCalendarEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      const status = await invoke<CalendarPermissionStatus>('get_calendar_permission_status');
      setPermissionStatus(status);

      if (status !== 'full_access') {
        setCalendarEvents([]);
        return;
      }

      const events = await invoke<CalendarEvent[]>('list_calendar_events', {
        startUnixMs: range.start.getTime(),
        endUnixMs: range.end.getTime(),
        includeAllDayEvents: false,
      });
      setCalendarEvents(events);
    } catch (error) {
      console.error('Failed to load macOS Calendar events:', error);
      setCalendarEvents([]);
      toast.error('Could not load macOS Calendar events');
    } finally {
      setIsLoadingEvents(false);
    }
  }, [range.end, range.start]);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    void loadCalendarEvents();
  }, [loadCalendarEvents]);

  const agendaByDate = useMemo(
    () => buildAgenda(calendarEvents, meetings),
    [calendarEvents, meetings]
  );

  const selectedItems = agendaByDate.get(selectedDate) ?? [];
  const isLoading = isLoadingMeetings || isLoadingEvents;

  const openMeeting = (meeting: MeetingCalendarItem) => {
    setCurrentMeeting({ id: meeting.id, title: meeting.title });
    router.push(`/meeting-details?id=${meeting.id}`);
  };

  const requestCalendarAccess = async () => {
    try {
      const status = await invoke<CalendarPermissionStatus>('request_calendar_permission');
      setPermissionStatus(status);
      if (status === 'full_access') {
        await loadCalendarEvents();
      } else {
        toast.warning('Calendar access is not enabled');
      }
    } catch (error) {
      console.error('Failed to request calendar access:', error);
      toast.error('Could not request calendar access');
    }
  };

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <main className="h-full overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-8 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-gray-700 ring-1 ring-gray-200">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-gray-950">Calendar</h1>
              <p className="text-sm text-gray-500">
                Browse Calendar events and attached Orxa transcripts.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => moveMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-40 text-center text-sm font-medium text-gray-700">{formatMonth(visibleMonth)}</div>
            <Button variant="outline" size="icon" onClick={() => moveMonth(1)} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {permissionStatus !== 'full_access' && permissionStatus !== 'unknown' && permissionStatus !== 'unavailable' && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-gray-500" />
              <span>Allow Calendar access to show your real meeting events here.</span>
            </div>
            <Button variant="outline" size="sm" onClick={requestCalendarAccess}>
              Allow Access
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading calendar
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)] gap-5">
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-7 gap-1 pb-2">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                    {weekday}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day) => {
                  const key = dateKey(day);
                  const items = agendaByDate.get(key) ?? [];
                  const count = items.length;
                  const inMonth = day.getMonth() === visibleMonth.getMonth();
                  const selected = selectedDate === key;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDate(key)}
                      className={`min-h-[92px] rounded-lg border p-2 text-left transition-colors ${
                        selected
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : inMonth
                            ? 'border-gray-100 bg-white text-gray-900 hover:bg-gray-50'
                            : 'border-transparent bg-gray-50 text-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{day.getDate()}</span>
                        {count > 0 && (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-600'}`}>
                            {count}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        {items.slice(0, 2).map((item) => (
                          <div key={item.id} className={`truncate text-xs ${selected ? 'text-white/80' : 'text-gray-500'}`}>
                            {itemTitle(item)}
                          </div>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-gray-950">
                  {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h2>
                <p className="text-sm text-gray-500">
                  {selectedItems.length
                    ? `${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`
                    : 'No events or recordings on this day'}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {selectedItems.map((item) => (
                  item.type === 'event' ? (
                    <div
                      key={item.id}
                      className="rounded-lg border border-gray-100 p-3"
                    >
                      <div className="flex gap-3">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-900">{item.event.title}</div>
                          <div className="mt-1 text-xs text-gray-500">{formatTimeRange(item.event)}</div>
                          {item.event.calendar_title && (
                            <div className="mt-0.5 truncate text-xs text-gray-400">{item.event.calendar_title}</div>
                          )}
                        </div>
                      </div>

                      {item.meetings.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                          {item.meetings.map((meeting) => (
                            <button
                              key={meeting.id}
                              type="button"
                              onClick={() => openMeeting(meeting)}
                              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-50"
                            >
                              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-gray-900">{meeting.title}</span>
                                <span className="mt-0.5 block text-xs text-gray-500">
                                  Transcript attached - {meeting.transcript_count} segment{meeting.transcript_count === 1 ? '' : 's'}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openMeeting(item.meeting)}
                      className="flex w-full gap-3 rounded-lg border border-gray-100 p-3 text-left transition-colors hover:border-gray-200 hover:bg-gray-50"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{item.meeting.title}</span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {formatTime(item.meeting.created_at)} - no matching Calendar event
                        </span>
                      </span>
                    </button>
                  )
                ))}

                {!selectedItems.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No Calendar events or Orxa recordings for this date.
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
