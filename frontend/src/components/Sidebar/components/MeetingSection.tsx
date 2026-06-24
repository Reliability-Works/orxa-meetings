import type React from "react";
import { FileText, Mic, Pencil, Square, Trash2 } from "lucide-react";
import type { CurrentMeeting } from "../types";
import { SearchField } from "./SearchField";
import { SidebarSectionHeader } from "./SectionHeader";

interface MeetingSectionProps {
  meetings: CurrentMeeting[];
  currentMeeting: CurrentMeeting | null;
  pathname: string | null;
  isRecording: boolean;
  collapsed: boolean;
  searchOpen: boolean;
  searchQuery: string;
  onToggle: () => void;
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onOpenMeeting: (meeting: CurrentMeeting) => void;
  onEditMeeting: (meetingId: string, title: string) => void;
  onDeleteMeeting: (meetingId: string) => void;
  onRecordingToggle: () => void;
}

export function MeetingSection({
  meetings,
  currentMeeting,
  pathname,
  isRecording,
  collapsed,
  searchOpen,
  searchQuery,
  onToggle,
  onToggleSearch,
  onSearchChange,
  onClearSearch,
  onOpenMeeting,
  onEditMeeting,
  onDeleteMeeting,
  onRecordingToggle,
}: MeetingSectionProps) {
  return (
    <>
      <SidebarSectionHeader
        title="Meetings"
        collapsed={collapsed}
        onToggle={onToggle}
        onSearch={onToggleSearch}
        onAction={onRecordingToggle}
        actionTitle={isRecording ? "Recording in progress" : "Start meeting recording"}
        actionIcon={
          isRecording ? (
            <Square className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )
        }
      />
      {!collapsed && searchOpen && (
        <SearchField
          placeholder="Search meetings..."
          value={searchQuery}
          onChange={onSearchChange}
          onClear={onClearSearch}
        />
      )}
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {meetings.map((meeting) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              active={Boolean(
                pathname?.includes("/meeting-details") && currentMeeting?.id === meeting.id,
              )}
              onOpen={() => onOpenMeeting(meeting)}
              onEdit={() => onEditMeeting(meeting.id, meeting.title)}
              onDelete={() => onDeleteMeeting(meeting.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function MeetingRow({
  meeting,
  active,
  onOpen,
  onEdit,
  onDelete,
}: {
  meeting: CurrentMeeting;
  active: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group">
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[14px] leading-5 ${
          active ? "bg-gray-100 text-gray-950" : "text-gray-800 hover:bg-gray-50"
        }`}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        <span className="min-w-0 flex-1 truncate">{meeting.title}</span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <MeetingRowAction className="hover:bg-blue-50 hover:text-blue-600" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </MeetingRowAction>
          <MeetingRowAction className="hover:bg-red-50 hover:text-red-600" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </MeetingRowAction>
        </span>
      </button>
    </div>
  );
}

function MeetingRowAction({
  className,
  onClick,
  children,
}: {
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`rounded-md p-1 ${className}`}
    >
      {children}
    </span>
  );
}
