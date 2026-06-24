import type React from "react";
import { ChevronDown, ChevronRight, SearchIcon } from "lucide-react";

interface SidebarSectionHeaderProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  onSearch: () => void;
  onAction: () => void;
  actionTitle: string;
  actionIcon: React.ReactNode;
}

export function SidebarSectionHeader({
  title,
  collapsed,
  onToggle,
  onSearch,
  onAction,
  actionTitle,
  actionIcon,
}: SidebarSectionHeaderProps) {
  return (
    <div className="mb-1 mt-3 flex h-7 items-center justify-between px-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1 rounded-md py-1 pr-1 text-left text-[13px] font-medium text-gray-400 hover:text-gray-700"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        <span className="truncate">{title}</span>
      </button>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          title={`Search ${title.toLowerCase()}`}
        >
          <SearchIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onAction}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          title={actionTitle}
        >
          {actionIcon}
        </button>
      </div>
    </div>
  );
}
