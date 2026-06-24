import { Plus } from "lucide-react";
import type { ChatSession } from "@/types";
import { relativeTime } from "../utils";
import { SearchField } from "./SearchField";
import { SidebarSectionHeader } from "./SectionHeader";

interface ChatSectionProps {
  sessions: ChatSession[];
  activeChatId: string | null;
  collapsed: boolean;
  searchOpen: boolean;
  searchQuery: string;
  onToggle: () => void;
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onOpenChat: (session: ChatSession) => void;
  onCreateChat: () => void;
}

export function ChatSection({
  sessions,
  activeChatId,
  collapsed,
  searchOpen,
  searchQuery,
  onToggle,
  onToggleSearch,
  onSearchChange,
  onClearSearch,
  onOpenChat,
  onCreateChat,
}: ChatSectionProps) {
  return (
    <>
      <SidebarSectionHeader
        title="Chats"
        collapsed={collapsed}
        onToggle={onToggle}
        onSearch={onToggleSearch}
        onAction={onCreateChat}
        actionTitle="New chat"
        actionIcon={<Plus className="h-3.5 w-3.5" />}
      />
      {!collapsed && searchOpen && (
        <SearchField
          placeholder="Search chats..."
          value={searchQuery}
          onChange={onSearchChange}
          onClear={onClearSearch}
        />
      )}
      {!collapsed && (
        <div className="max-h-[30%] min-h-[72px] overflow-y-auto pr-1">
          {sessions.map((session) => (
            <ChatRow
              key={session.id}
              session={session}
              active={activeChatId === session.id}
              onClick={() => onOpenChat(session)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ChatRow({
  session,
  active,
  onClick,
}: {
  session: ChatSession;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] ${
        active ? "bg-gray-100 text-gray-950" : "text-gray-800 hover:bg-gray-50"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      <span className="shrink-0 text-[13px] text-gray-400">{relativeTime(session.updated_at)}</span>
    </button>
  );
}
