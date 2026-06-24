import type React from "react";
import { Download, Loader2, Settings, Upload } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip";

interface SidebarFooterProps {
  pathname: string | null;
  importEnabled: boolean;
  updateVersion?: string;
  updateAvailable?: boolean;
  isDownloading: boolean;
  updateProgress: number;
  updateError: string | null;
  onImportAudio: () => void;
  onSettings: () => void;
  onUpdateClick: () => void;
}

export function SidebarFooter({
  pathname,
  importEnabled,
  updateVersion,
  updateAvailable,
  isDownloading,
  updateProgress,
  updateError,
  onImportAudio,
  onSettings,
  onUpdateClick,
}: SidebarFooterProps) {
  return (
    <div className="shrink-0 border-t border-gray-100 p-2">
      {updateAvailable && (
        <UpdateSidebarNotice
          version={updateVersion}
          isDownloading={isDownloading}
          progress={updateProgress}
          error={updateError}
          onClick={onUpdateClick}
        />
      )}
      <TooltipProvider>
        <div className="flex items-center justify-start gap-1">
          {importEnabled && (
            <IconFooterButton title="Import audio" onClick={onImportAudio}>
              <Upload className="h-4 w-4" />
            </IconFooterButton>
          )}
          <IconFooterButton title="Settings" active={pathname === "/settings"} onClick={onSettings}>
            <Settings className="h-4 w-4" />
          </IconFooterButton>
        </div>
      </TooltipProvider>
    </div>
  );
}

function IconFooterButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 ${
            active ? "bg-gray-100 text-gray-900" : ""
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}

function UpdateSidebarNotice({
  version,
  isDownloading,
  progress,
  error,
  onClick,
}: {
  version?: string;
  isDownloading: boolean;
  progress: number;
  error: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
    >
      <span className="flex items-center gap-2">
        {isDownloading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-500" />
        ) : (
          <Download className="h-4 w-4 shrink-0 text-gray-500" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {error ? "Update failed" : isDownloading ? "Downloading update" : "Update available"}
          </span>
          <span className="block truncate text-xs text-gray-500">
            {error ?? (isDownloading ? `${Math.round(progress)}% complete` : `Version ${version}`)}
          </span>
        </span>
      </span>
      {isDownloading && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-gray-100">
          <span
            className="block h-full rounded-full bg-gray-900 transition-[width] duration-200"
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </span>
      )}
    </button>
  );
}
