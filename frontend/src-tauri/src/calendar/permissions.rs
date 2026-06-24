use super::{CalendarEvent, CalendarPermissionStatus};

const START_GRACE_SECONDS: i64 = 60;

pub(super) async fn list_calendar_events(
    start_unix_ms: i64,
    end_unix_ms: i64,
    include_all_day_events: Option<bool>,
    allow_permission_probe: Option<bool>,
) -> Result<Vec<CalendarEvent>, String> {
    if end_unix_ms <= start_unix_ms {
        return Err("Calendar range end must be after start".to_string());
    }

    let include_all_day_events = include_all_day_events.unwrap_or(false);
    let allow_permission_probe = allow_permission_probe.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        platform::calendar_events_in_range(
            start_unix_ms,
            end_unix_ms,
            include_all_day_events,
            allow_permission_probe,
        )
    })
    .await
    .map_err(|error| format!("Failed to join calendar query task: {}", error))?
}

pub(super) async fn upcoming_calendar_events(
    lead_time_minutes: u32,
    include_all_day_events: bool,
) -> Result<Vec<CalendarEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform::upcoming_calendar_events(lead_time_minutes, include_all_day_events)
    })
    .await
    .map_err(|error| format!("Failed to join calendar query task: {}", error))?
}

pub(super) fn calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
    platform::calendar_permission_status()
}

pub(super) async fn request_calendar_access() -> Result<CalendarPermissionStatus, String> {
    tauri::async_runtime::spawn_blocking(platform::request_calendar_access)
        .await
        .map_err(|error| format!("Failed to join calendar permission task: {}", error))?
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
mod platform {
    use super::{CalendarEvent, CalendarPermissionStatus, START_GRACE_SECONDS};
    use block2::RcBlock;
    use objc::rc::autoreleasepool;
    use objc::runtime::{Object, BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use objc2::runtime::Bool as ObjcBool;
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_void};
    use std::ptr;
    use std::sync::mpsc;
    use std::time::Duration;

    const EK_ENTITY_TYPE_EVENT: u64 = 0;

    type Id = *mut Object;

    pub fn calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
        let raw_status = raw_calendar_permission_status();
        let status = status_from_raw(raw_status);
        log::info!(
            "Calendar authorization status: raw={} mapped={:?}",
            raw_status,
            status
        );
        Ok(status)
    }

    pub fn request_calendar_access() -> Result<CalendarPermissionStatus, String> {
        let current = status_from_raw(raw_calendar_permission_status());
        if matches!(
            current,
            CalendarPermissionStatus::FullAccess
                | CalendarPermissionStatus::Denied
                | CalendarPermissionStatus::Restricted
                | CalendarPermissionStatus::Unavailable
        ) {
            return Ok(current);
        }

        unsafe {
            autoreleasepool(|| {
                let store = new_event_store();
                if store.is_null() {
                    return Err("Failed to create EventKit event store".to_string());
                }

                let (sender, receiver) = mpsc::channel();
                let completion: RcBlock<dyn Fn(ObjcBool, *mut c_void)> =
                    RcBlock::new(move |granted: ObjcBool, _error: *mut c_void| {
                        let _ = sender.send(granted.as_bool());
                    });

                let supports_full_access: BOOL = msg_send![store, respondsToSelector: sel!(requestFullAccessToEventsWithCompletion:)];

                if supports_full_access == YES {
                    let _: () =
                        msg_send![store, requestFullAccessToEventsWithCompletion: &*completion];
                } else {
                    let _: () = msg_send![store, requestAccessToEntityType: EK_ENTITY_TYPE_EVENT completion: &*completion];
                }

                let result = receiver
                    .recv_timeout(Duration::from_secs(120))
                    .map_err(|_| "Timed out waiting for calendar permission response".to_string());

                release_object(store);

                match result {
                    Ok(true) => {
                        for _ in 0..10 {
                            let status = status_from_raw(raw_calendar_permission_status());
                            if status == CalendarPermissionStatus::FullAccess {
                                return Ok(status);
                            }
                            if can_probe_calendar_read() {
                                return Ok(CalendarPermissionStatus::FullAccess);
                            }
                            std::thread::sleep(Duration::from_millis(100));
                        }

                        Ok(status_from_raw(raw_calendar_permission_status()))
                    }
                    Ok(false) => {
                        if can_probe_calendar_read() {
                            Ok(CalendarPermissionStatus::FullAccess)
                        } else {
                            Ok(status_from_raw(raw_calendar_permission_status()))
                        }
                    }
                    Err(error) => Err(error),
                }
            })
        }
    }

    pub fn upcoming_calendar_events(
        lead_time_minutes: u32,
        include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let start_ms = now_ms - (START_GRACE_SECONDS * 1_000);
        let end_ms = now_ms + i64::from(lead_time_minutes) * 60_000;

        calendar_events_in_range(
            start_ms,
            end_ms.max(now_ms + 1),
            include_all_day_events,
            false,
        )
    }

    pub fn calendar_events_in_range(
        start_ms: i64,
        end_ms: i64,
        include_all_day_events: bool,
        allow_permission_probe: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        let status = calendar_permission_status()?;
        if !status.can_read_events() {
            match status {
                CalendarPermissionStatus::Denied
                | CalendarPermissionStatus::Restricted
                | CalendarPermissionStatus::WriteOnly
                | CalendarPermissionStatus::Unavailable => {
                    return Err(format!("Calendar access is {:?}", status));
                }
                CalendarPermissionStatus::NotDetermined if !allow_permission_probe => {
                    return Ok(Vec::new());
                }
                _ => {}
            }
        }

        let end_ms = end_ms.max(start_ms + 1);

        read_calendar_events_unchecked(start_ms, end_ms, include_all_day_events)
    }

    fn can_probe_calendar_read() -> bool {
        let now_ms = chrono::Utc::now().timestamp_millis();
        read_calendar_events_unchecked(now_ms, now_ms + 60_000, true).is_ok()
    }

    fn read_calendar_events_unchecked(
        start_ms: i64,
        end_ms: i64,
        include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        let end_ms = end_ms.max(start_ms + 1);

        unsafe {
            autoreleasepool(|| {
                let store = new_event_store();
                if store.is_null() {
                    return Err("Failed to create EventKit event store".to_string());
                }

                let start_date = nsdate_from_unix_ms(start_ms);
                let end_date = nsdate_from_unix_ms(end_ms);
                let predicate: Id = msg_send![store,
                    predicateForEventsWithStartDate: start_date
                    endDate: end_date
                    calendars: ptr::null_mut::<Object>()
                ];

                let ns_events: Id = msg_send![store, eventsMatchingPredicate: predicate];
                let mut events = Vec::new();

                if !ns_events.is_null() {
                    let count: usize = msg_send![ns_events, count];
                    for index in 0..count {
                        let event: Id = msg_send![ns_events, objectAtIndex: index];
                        if event.is_null() {
                            continue;
                        }

                        let is_all_day: BOOL = msg_send![event, isAllDay];
                        let is_all_day = is_all_day == YES;
                        if is_all_day && !include_all_day_events {
                            continue;
                        }

                        if let Some(calendar_event) = calendar_event_from_ek_event(event) {
                            events.push(calendar_event);
                        }
                    }
                }

                release_object(store);

                events.sort_by_key(|event| event.start_unix_ms);
                Ok(events)
            })
        }
    }

    fn raw_calendar_permission_status() -> i64 {
        unsafe {
            let status: i64 = msg_send![class!(EKEventStore), authorizationStatusForEntityType: EK_ENTITY_TYPE_EVENT];
            status
        }
    }

    fn status_from_raw(status: i64) -> CalendarPermissionStatus {
        match status {
            0 => CalendarPermissionStatus::NotDetermined,
            1 => CalendarPermissionStatus::Restricted,
            2 => CalendarPermissionStatus::Denied,
            3 => CalendarPermissionStatus::FullAccess,
            4 => CalendarPermissionStatus::WriteOnly,
            _ => CalendarPermissionStatus::Unknown,
        }
    }

    unsafe fn new_event_store() -> Id {
        let store: Id = msg_send![class!(EKEventStore), alloc];
        let store: Id = msg_send![store, init];
        store
    }

    unsafe fn release_object(object: Id) {
        if !object.is_null() {
            let _: () = msg_send![object, release];
        }
    }

    unsafe fn nsdate_from_unix_ms(unix_ms: i64) -> Id {
        let seconds = unix_ms as f64 / 1_000.0;
        msg_send![class!(NSDate), dateWithTimeIntervalSince1970: seconds]
    }

    unsafe fn calendar_event_from_ek_event(event: Id) -> Option<CalendarEvent> {
        let title_obj: Id = msg_send![event, title];
        let title = nsstring_to_string(title_obj)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Calendar Meeting".to_string());

        let start_date: Id = msg_send![event, startDate];
        let end_date: Id = msg_send![event, endDate];
        if start_date.is_null() || end_date.is_null() {
            return None;
        }

        let start_unix_ms = nsdate_to_unix_ms(start_date);
        let end_unix_ms = nsdate_to_unix_ms(end_date);

        let id_obj: Id = msg_send![event, eventIdentifier];
        let fallback_id = format!("{}:{}", title, start_unix_ms);
        let id = nsstring_to_string(id_obj)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback_id);

        let calendar: Id = msg_send![event, calendar];
        let calendar_title = if calendar.is_null() {
            None
        } else {
            let calendar_title_obj: Id = msg_send![calendar, title];
            nsstring_to_string(calendar_title_obj)
        };

        let is_all_day: BOOL = msg_send![event, isAllDay];
        let is_all_day = is_all_day == YES;

        Some(CalendarEvent {
            id,
            title,
            calendar_title,
            start_unix_ms,
            end_unix_ms,
            is_all_day,
        })
    }

    unsafe fn nsdate_to_unix_ms(date: Id) -> i64 {
        let seconds: f64 = msg_send![date, timeIntervalSince1970];
        (seconds * 1_000.0).round() as i64
    }

    unsafe fn nsstring_to_string(value: Id) -> Option<String> {
        if value.is_null() {
            return None;
        }

        let utf8: *const c_char = msg_send![value, UTF8String];
        if utf8.is_null() {
            return None;
        }

        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{CalendarEvent, CalendarPermissionStatus};

    pub fn calendar_permission_status() -> Result<CalendarPermissionStatus, String> {
        Ok(CalendarPermissionStatus::Unavailable)
    }

    pub fn request_calendar_access() -> Result<CalendarPermissionStatus, String> {
        Ok(CalendarPermissionStatus::Unavailable)
    }

    pub fn upcoming_calendar_events(
        _lead_time_minutes: u32,
        _include_all_day_events: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        Ok(Vec::new())
    }

    pub fn calendar_events_in_range(
        _start_unix_ms: i64,
        _end_unix_ms: i64,
        _include_all_day_events: bool,
        _allow_permission_probe: bool,
    ) -> Result<Vec<CalendarEvent>, String> {
        Ok(Vec::new())
    }
}
