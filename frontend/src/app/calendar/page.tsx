"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MeetingMetadata } from '@/types';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

interface MeetingListItem {
  id: string;
  title: string;
}

type CalendarMeeting = MeetingMetadata;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseMeetingDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatMonth(value: Date) {
  return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatMeetingTime(value: string) {
  return parseMeetingDate(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
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

export default function CalendarPage() {
  const router = useRouter();
  const { setCurrentMeeting } = useSidebar();
  const [meetings, setMeetings] = useState<CalendarMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));

  useEffect(() => {
    const loadMeetings = async () => {
      setIsLoading(true);
      try {
        const list = await invoke<MeetingListItem[]>('api_get_meetings', { authToken: null });
        const metadata = await Promise.all(
          list.map(async (meeting) => {
            try {
              return await invoke<MeetingMetadata>('api_get_meeting_metadata', { meetingId: meeting.id });
            } catch (error) {
              console.warn('Failed to load meeting metadata:', meeting.id, error);
              return null;
            }
          })
        );

        const loaded = metadata
          .filter((meeting): meeting is MeetingMetadata => !!meeting)
          .sort((a, b) => parseMeetingDate(b.created_at).getTime() - parseMeetingDate(a.created_at).getTime());

        setMeetings(loaded);
        if (loaded.length > 0) {
          const newest = parseMeetingDate(loaded[0].created_at);
          setVisibleMonth(new Date(newest.getFullYear(), newest.getMonth(), 1));
          setSelectedDate(dateKey(newest));
        }
      } catch (error) {
        console.error('Failed to load calendar meetings:', error);
        toast.error('Could not load calendar');
      } finally {
        setIsLoading(false);
      }
    };

    void loadMeetings();
  }, []);

  const meetingsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarMeeting[]>();
    for (const meeting of meetings) {
      const key = dateKey(parseMeetingDate(meeting.created_at));
      const current = grouped.get(key) ?? [];
      current.push(meeting);
      grouped.set(key, current);
    }
    return grouped;
  }, [meetings]);

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const monthMeetings = useMemo(
    () => meetings.filter((meeting) => {
      const date = parseMeetingDate(meeting.created_at);
      return date.getFullYear() === visibleMonth.getFullYear() && date.getMonth() === visibleMonth.getMonth();
    }),
    [meetings, visibleMonth]
  );
  const selectedMeetings = meetingsByDate.get(selectedDate) ?? [];

  const openMeeting = (meeting: CalendarMeeting) => {
    setCurrentMeeting({ id: meeting.id, title: meeting.title });
    router.push(`/meeting-details?id=${meeting.id}`);
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
              <p className="text-sm text-gray-500">Browse previous meetings by date and reopen transcripts or summaries.</p>
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

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading calendar
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)] gap-5">
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
                  const count = meetingsByDate.get(key)?.length ?? 0;
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
                        {(meetingsByDate.get(key) ?? []).slice(0, 2).map((meeting) => (
                          <div key={meeting.id} className={`truncate text-xs ${selected ? 'text-white/80' : 'text-gray-500'}`}>
                            {meeting.title}
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
                  {selectedMeetings.length ? `${selectedMeetings.length} meeting${selectedMeetings.length === 1 ? '' : 's'}` : 'No meetings on this day'}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {(selectedMeetings.length ? selectedMeetings : monthMeetings).map((meeting) => (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={() => openMeeting(meeting)}
                    className="flex w-full gap-3 rounded-lg border border-gray-100 p-3 text-left transition-colors hover:border-gray-200 hover:bg-gray-50"
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{meeting.title}</span>
                      <span className="mt-1 block text-xs text-gray-500">
                        {formatMeetingTime(meeting.created_at)}
                      </span>
                    </span>
                  </button>
                ))}
                {!selectedMeetings.length && !monthMeetings.length && (
                  <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No meetings in {formatMonth(visibleMonth)}
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
