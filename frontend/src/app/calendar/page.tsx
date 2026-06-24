"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { CalendarAccessBanner, CalendarBody, CalendarHeader } from "./calendar-ui";
import {
  CalendarEvent,
  CalendarPermissionStatus,
  MeetingCalendarItem,
  buildAgenda,
  buildCalendarDays,
  calendarRangeForMonth,
  canReadCalendar,
  dateKey,
  parseDate,
  shouldAttemptCalendarRead,
} from "./calendar-model";

type CalendarRange = ReturnType<typeof calendarRangeForMonth>;

async function listCalendarEvents(range: CalendarRange, allowPermissionProbe = false) {
  return invoke<CalendarEvent[]>("list_calendar_events", {
    startUnixMs: range.start.getTime(),
    endUnixMs: range.end.getTime(),
    includeAllDayEvents: false,
    allowPermissionProbe,
  });
}

async function waitForCalendarPermission(initialStatus: CalendarPermissionStatus) {
  let status = initialStatus;

  for (let attempt = 0; attempt < 6 && !canReadCalendar(status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await invoke<CalendarPermissionStatus>("get_calendar_permission_status");
  }

  return status;
}

async function openCalendarSettingsIfBlocked(status: CalendarPermissionStatus) {
  if (status === "denied" || status === "restricted" || status === "write_only") {
    await invoke("open_system_settings", { preferencePane: "Privacy_Calendars" });
    toast.message("Calendar access needs to be enabled in macOS Settings");
  } else {
    toast.warning("Calendar access is not enabled");
  }
}

export default function CalendarPage() {
  const router = useRouter();
  const { setCurrentMeeting } = useSidebar();
  const [meetings, setMeetings] = useState<MeetingCalendarItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<CalendarPermissionStatus>("unknown");
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const range = useMemo(() => calendarRangeForMonth(visibleMonth), [visibleMonth]);

  const loadMeetings = useCallback(async () => {
    setIsLoadingMeetings(true);
    try {
      const loaded = await invoke<MeetingCalendarItem[]>("api_get_meeting_calendar_items");
      setMeetings(loaded);

      if (loaded.length > 0) {
        const newest = parseDate(loaded[0].created_at);
        setVisibleMonth(new Date(newest.getFullYear(), newest.getMonth(), 1));
        setSelectedDate(dateKey(newest));
      }
    } catch (error) {
      console.error("Failed to load meeting calendar items:", error);
      toast.error("Could not load meeting recordings");
    } finally {
      setIsLoadingMeetings(false);
    }
  }, []);

  const loadCalendarEvents = useCallback(async () => {
    setIsLoadingEvents(true);
    try {
      const status = await invoke<CalendarPermissionStatus>("get_calendar_permission_status");
      setPermissionStatus(status);

      if (!shouldAttemptCalendarRead(status)) {
        setCalendarEvents([]);
        return;
      }

      setCalendarEvents(await listCalendarEvents(range));
      setPermissionStatus("full_access");
    } catch (error) {
      console.error("Failed to load macOS Calendar events:", error);
      setCalendarEvents([]);
      toast.error("Could not load macOS Calendar events");
    } finally {
      setIsLoadingEvents(false);
    }
  }, [range]);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    void loadCalendarEvents();
  }, [loadCalendarEvents]);

  const agendaByDate = useMemo(
    () => buildAgenda(calendarEvents, meetings),
    [calendarEvents, meetings],
  );

  const selectedItems = agendaByDate.get(selectedDate) ?? [];
  const isLoading = isLoadingMeetings || isLoadingEvents;

  const openMeeting = (meeting: MeetingCalendarItem) => {
    setCurrentMeeting({ id: meeting.id, title: meeting.title });
    router.push(`/meeting-details?id=${meeting.id}`);
  };

  const requestCalendarAccess = async () => {
    try {
      setIsLoadingEvents(true);
      const requested = await invoke<CalendarPermissionStatus>("request_calendar_permission");
      const status = await waitForCalendarPermission(requested);

      try {
        setCalendarEvents(await listCalendarEvents(range, true));
        setPermissionStatus("full_access");
        return;
      } catch (readError) {
        console.warn("Calendar permission request completed, but read probe failed:", readError);
      }

      setPermissionStatus(status);
      await openCalendarSettingsIfBlocked(status);
    } catch (error) {
      console.error("Failed to request calendar access:", error);
      toast.error("Could not request calendar access");
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <main className="h-full overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-8 py-8">
        <CalendarHeader visibleMonth={visibleMonth} onMoveMonth={moveMonth} />
        <CalendarAccessBanner status={permissionStatus} onRequestAccess={requestCalendarAccess} />
        <CalendarBody
          isLoading={isLoading}
          calendarDays={calendarDays}
          agendaByDate={agendaByDate}
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          selectedItems={selectedItems}
          onSelectDate={setSelectedDate}
          onOpenMeeting={openMeeting}
        />
      </div>
    </main>
  );
}
