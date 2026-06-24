# Calendar Integration

Orxa can read macOS Calendar events and show them alongside local recordings.

## Permissions

Calendar access uses EventKit. The macOS permission prompt must be accepted before real events appear in the Calendar view or before Calendar auto-start can work.

The app bundle includes:

- `NSCalendarsUsageDescription`
- `NSCalendarsFullAccessUsageDescription`

If macOS says permission has already been granted but the app still reports no access, restart Orxa after granting permission so the EventKit status can be refreshed.

## Calendar View

The Calendar page displays:

- Calendar events from macOS Calendar
- standalone Orxa recordings
- recordings attached to matching events

Clicking a Calendar event with an attached Orxa recording opens the transcript/summary flow. Clicking a standalone Orxa recording opens that meeting directly.

## Recording Attachment

Orxa compares a recording start time and inferred duration against Calendar event start/end times. If the recording overlaps an event, it is shown under that event. If no event overlaps, the recording remains a standalone meeting.

This preserves ad hoc recording: you can still record something that was not on the calendar.

## Auto-Start

The General settings page includes Calendar auto-start controls. When enabled, Orxa can start transcription automatically when a Calendar meeting begins. Lead-time settings determine whether recording begins at the start or slightly before the event.

Auto-start is local. Calendar event details are not uploaded by the Calendar integration.
