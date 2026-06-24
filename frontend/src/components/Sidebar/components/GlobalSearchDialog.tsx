import type React from "react";
import { FileText, MessageSquareText, SearchIcon, X } from "lucide-react";
import type { ChatSession } from "@/types";
import { Dialog, DialogContent, DialogTitle } from "../../ui/dialog";
import { VisuallyHidden } from "../../ui/visually-hidden";
import { relativeTime } from "../utils";
import type { CurrentMeeting, TranscriptSearchResult } from "../types";

interface GlobalSearchDialogProps {
  open: boolean;
  query: string;
  inputRef: React.Ref<HTMLInputElement>;
  matches: {
    chats: ChatSession[];
    meetings: CurrentMeeting[];
  };
  transcriptResults: TranscriptSearchResult[];
  isSearching: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onOpenChat: (session: ChatSession) => void;
  onOpenMeeting: (meeting: CurrentMeeting) => void;
}

export function GlobalSearchDialog({
  open,
  query,
  inputRef,
  matches,
  transcriptResults,
  isSearching,
  onOpenChange,
  onQueryChange,
  onClear,
  onOpenChat,
  onOpenMeeting,
}: GlobalSearchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[40%] max-h-[78vh] overflow-hidden rounded-2xl border-gray-200 p-0 shadow-2xl sm:max-w-2xl">
        <VisuallyHidden>
          <DialogTitle>Search Orxa</DialogTitle>
        </VisuallyHidden>
        <GlobalSearchInput
          query={query}
          inputRef={inputRef}
          onQueryChange={onQueryChange}
          onClear={onClear}
        />
        <div className="max-h-[56vh] overflow-y-auto p-3">
          {!query.trim() ? (
            <EmptySearchPrompt />
          ) : (
            <GlobalSearchResults
              matches={matches}
              transcriptResults={transcriptResults}
              isSearching={isSearching}
              onOpenChat={onOpenChat}
              onOpenMeeting={onOpenMeeting}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GlobalSearchInput({
  query,
  inputRef,
  onQueryChange,
  onClear,
}: {
  query: string;
  inputRef: React.Ref<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="border-b border-gray-100 p-4">
      <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 shadow-sm">
        <SearchIcon className="h-5 w-5 shrink-0 text-gray-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search chats, meetings, and transcripts"
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-gray-900 outline-none placeholder:text-gray-400"
        />
        {query && (
          <button
            type="button"
            onClick={onClear}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptySearchPrompt() {
  return (
    <div className="px-2 py-10 text-center text-sm text-gray-400">
      Search across chats, meeting titles, and transcript text.
    </div>
  );
}

function GlobalSearchResults({
  matches,
  transcriptResults,
  isSearching,
  onOpenChat,
  onOpenMeeting,
}: {
  matches: { chats: ChatSession[]; meetings: CurrentMeeting[] };
  transcriptResults: TranscriptSearchResult[];
  isSearching: boolean;
  onOpenChat: (session: ChatSession) => void;
  onOpenMeeting: (meeting: CurrentMeeting) => void;
}) {
  const hasMatches = matches.chats.length || matches.meetings.length || transcriptResults.length;

  return (
    <div className="space-y-2">
      {matches.chats.slice(0, 6).map((session) => (
        <ChatSearchResult key={`chat-${session.id}`} session={session} onClick={onOpenChat} />
      ))}
      {matches.meetings.slice(0, 6).map((meeting) => (
        <MeetingSearchResult
          key={`meeting-${meeting.id}`}
          meeting={meeting}
          onClick={onOpenMeeting}
        />
      ))}
      {transcriptResults.slice(0, 8).map((result) => (
        <TranscriptSearchResultRow
          key={`transcript-${result.id}-${result.timestamp}`}
          result={result}
          onClick={() => onOpenMeeting({ id: result.id, title: result.title })}
        />
      ))}
      {!hasMatches && !isSearching && (
        <div className="px-2 py-10 text-center text-sm text-gray-400">No matches</div>
      )}
      {isSearching && (
        <div className="px-3 py-3 text-sm text-blue-500">Searching transcripts...</div>
      )}
    </div>
  );
}

function ChatSearchResult({
  session,
  onClick,
}: {
  session: ChatSession;
  onClick: (session: ChatSession) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(session)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
    >
      <MessageSquareText className="h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-gray-900">{session.title}</div>
        {session.last_message && (
          <div className="truncate text-sm text-gray-500">{session.last_message}</div>
        )}
      </div>
      <span className="shrink-0 text-sm text-gray-400">{relativeTime(session.updated_at)}</span>
    </button>
  );
}

function MeetingSearchResult({
  meeting,
  onClick,
}: {
  meeting: CurrentMeeting;
  onClick: (meeting: CurrentMeeting) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(meeting)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
    >
      <FileText className="h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-900">
        {meeting.title}
      </div>
    </button>
  );
}

function TranscriptSearchResultRow({
  result,
  onClick,
}: {
  result: TranscriptSearchResult;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
    >
      <div className="flex items-center gap-3">
        <SearchIcon className="h-4 w-4 shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium text-gray-900">{result.title}</div>
          <div className="line-clamp-2 text-sm leading-5 text-gray-500">{result.matchContext}</div>
        </div>
      </div>
    </button>
  );
}
