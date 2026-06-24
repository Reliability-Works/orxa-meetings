import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AgendaItem,
  CalendarPermissionStatus,
  MeetingCalendarItem,
  calendarAccessMessage,
  canReadCalendar,
  dateKey,
  formatMonth,
  formatTime,
  formatTimeRange,
  itemTitle,
} from "./calendar-model";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarHeaderProps {
  visibleMonth: Date;
  onMoveMonth: (amount: number) => void;
}

export function CalendarHeader({ visibleMonth, onMoveMonth }: CalendarHeaderProps) {
  return (
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
        <Button
          variant="outline"
          size="icon"
          onClick={() => onMoveMonth(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-40 text-center text-sm font-medium text-gray-700">
          {formatMonth(visibleMonth)}
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onMoveMonth(1)}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface CalendarAccessBannerProps {
  status: CalendarPermissionStatus;
  onRequestAccess: () => void;
}

export function CalendarAccessBanner({ status, onRequestAccess }: CalendarAccessBannerProps) {
  if (canReadCalendar(status) || status === "unknown" || status === "unavailable") {
    return null;
  }

  const shouldOpenSettings =
    status === "denied" || status === "restricted" || status === "write_only";

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-gray-500" />
        <span>{calendarAccessMessage(status)}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onRequestAccess}>
        {shouldOpenSettings ? "Open Settings" : "Allow Access"}
      </Button>
    </div>
  );
}

interface CalendarBodyProps {
  isLoading: boolean;
  calendarDays: Date[];
  agendaByDate: Map<string, AgendaItem[]>;
  visibleMonth: Date;
  selectedDate: string;
  selectedItems: AgendaItem[];
  onSelectDate: (nextDate: string) => void;
  onOpenMeeting: (meeting: MeetingCalendarItem) => void;
}

export function CalendarBody({
  isLoading,
  calendarDays,
  agendaByDate,
  visibleMonth,
  selectedDate,
  selectedItems,
  onSelectDate,
  onOpenMeeting,
}: CalendarBodyProps) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading calendar
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)] gap-5">
      <CalendarGrid
        calendarDays={calendarDays}
        agendaByDate={agendaByDate}
        visibleMonth={visibleMonth}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
      />
      <AgendaPanel
        selectedDate={selectedDate}
        selectedItems={selectedItems}
        onOpenMeeting={onOpenMeeting}
      />
    </div>
  );
}

interface CalendarGridProps {
  calendarDays: Date[];
  agendaByDate: Map<string, AgendaItem[]>;
  visibleMonth: Date;
  selectedDate: string;
  onSelectDate: (nextDate: string) => void;
}

function CalendarGrid({
  calendarDays,
  agendaByDate,
  visibleMonth,
  selectedDate,
  onSelectDate,
}: CalendarGridProps) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-7 gap-1 pb-2">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-gray-400"
          >
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => (
          <CalendarDayButton
            key={dateKey(day)}
            day={day}
            items={agendaByDate.get(dateKey(day)) ?? []}
            inMonth={day.getMonth() === visibleMonth.getMonth()}
            selected={selectedDate === dateKey(day)}
            onSelectDate={onSelectDate}
          />
        ))}
      </div>
    </section>
  );
}

interface CalendarDayButtonProps {
  day: Date;
  items: AgendaItem[];
  inMonth: boolean;
  selected: boolean;
  onSelectDate: (nextDate: string) => void;
}

function CalendarDayButton({
  day,
  items,
  inMonth,
  selected,
  onSelectDate,
}: CalendarDayButtonProps) {
  const key = dateKey(day);
  const className = selected
    ? "border-gray-900 bg-gray-900 text-white"
    : inMonth
      ? "border-gray-100 bg-white text-gray-900 hover:bg-gray-50"
      : "border-transparent bg-gray-50 text-gray-300";

  return (
    <button
      type="button"
      onClick={() => onSelectDate(key)}
      className={`min-h-[92px] rounded-lg border p-2 text-left transition-colors ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{day.getDate()}</span>
        {items.length > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${selected ? "bg-white/15 text-white" : "bg-gray-100 text-gray-600"}`}
          >
            {items.length}
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        {items.slice(0, 2).map((item) => (
          <div
            key={item.id}
            className={`truncate text-xs ${selected ? "text-white/80" : "text-gray-500"}`}
          >
            {itemTitle(item)}
          </div>
        ))}
      </div>
    </button>
  );
}

function AgendaPanel({
  selectedDate,
  selectedItems,
  onOpenMeeting,
}: {
  selectedDate: string;
  selectedItems: AgendaItem[];
  onOpenMeeting: (meeting: MeetingCalendarItem) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-950">
          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </h2>
        <p className="text-sm text-gray-500">
          {selectedItems.length
            ? `${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`
            : "No events or recordings on this day"}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {selectedItems.map((item) =>
          item.type === "event" ? (
            <AgendaEventCard key={item.id} item={item} onOpenMeeting={onOpenMeeting} />
          ) : (
            <AgendaRecordingButton key={item.id} item={item} onOpenMeeting={onOpenMeeting} />
          ),
        )}
        {!selectedItems.length && (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
            No Calendar events or Orxa recordings for this date.
          </div>
        )}
      </div>
    </aside>
  );
}

function AgendaEventCard({
  item,
  onOpenMeeting,
}: {
  item: Extract<AgendaItem, { type: "event" }>;
  onOpenMeeting: (meeting: MeetingCalendarItem) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-100 p-3">
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
              onClick={() => onOpenMeeting(meeting)}
              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-50"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {meeting.title}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Transcript attached - {meeting.transcript_count} segment
                  {meeting.transcript_count === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgendaRecordingButton({
  item,
  onOpenMeeting,
}: {
  item: Extract<AgendaItem, { type: "recording" }>;
  onOpenMeeting: (meeting: MeetingCalendarItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenMeeting(item.meeting)}
      className="flex w-full gap-3 rounded-lg border border-gray-100 p-3 text-left transition-colors hover:border-gray-200 hover:bg-gray-50"
    >
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">
          {item.meeting.title}
        </span>
        <span className="mt-1 block text-xs text-gray-500">
          {formatTime(item.meeting.created_at)} - no matching Calendar event
        </span>
      </span>
    </button>
  );
}
