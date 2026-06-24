import type React from "react";
import { CalendarDays, Home, SearchIcon } from "lucide-react";

interface TopNavProps {
  pathname: string | null;
  onNavigate: (href: string) => void;
  onSearch: () => void;
}

export function TopNav({ pathname, onNavigate, onSearch }: TopNavProps) {
  return (
    <div className="space-y-0.5 px-3">
      <TopNavButton active={pathname === "/"} onClick={() => onNavigate("/")}>
        <Home className="h-4 w-4" />
        <span>Home</span>
      </TopNavButton>
      <TopNavButton active={pathname === "/calendar"} onClick={() => onNavigate("/calendar")}>
        <CalendarDays className="h-4 w-4" />
        <span>Calendar</span>
      </TopNavButton>
      <TopNavButton onClick={onSearch}>
        <SearchIcon className="h-4 w-4" />
        <span>Search</span>
      </TopNavButton>
    </div>
  );
}

function TopNavButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[14px] text-gray-800 ${
        active ? "bg-gray-100" : "hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
