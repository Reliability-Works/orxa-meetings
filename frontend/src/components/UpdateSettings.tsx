"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCcw } from "lucide-react";

import { updateService, type UpdateInfo, type UpdateProgress } from "@/services/updateService";
import { Button } from "@/components/ui/button";

export function UpdateSettings() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    updateService
      .getCurrentVersion()
      .then(setCurrentVersion)
      .catch((error) => {
        console.error("Failed to load app version:", error);
        setCurrentVersion("Unknown");
      });
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    if (isChecking || isInstalling) return;

    setIsChecking(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setProgress(null);

    try {
      const info = await updateService.checkForUpdates(true);
      setUpdateInfo(info);
      setCurrentVersion(info.currentVersion);
      setStatusMessage(
        info.available
          ? `Version ${info.version} is available.`
          : `Orxa ${info.currentVersion} is up to date.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, isInstalling]);

  const handleInstallUpdate = useCallback(async () => {
    if (!updateInfo?.update || isInstalling) {
      return;
    }

    setIsInstalling(true);
    setErrorMessage(null);
    setProgress({ downloaded: 0, total: 0, percentage: 0 });

    try {
      await updateService.downloadAndInstall(updateInfo.update, setProgress);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setIsInstalling(false);
    }
  }, [isInstalling, updateInfo]);

  const availableVersion = updateInfo?.available ? updateInfo.version : null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Updates</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <SettingsRow
            title="Current version"
            description="The version currently installed on this Mac."
            value={currentVersion ? `v${currentVersion}` : "Loading..."}
          />
          <SettingsRow
            title="Release channel"
            description="Updates are served from Reliability Works GitHub releases."
            value="Stable"
          />
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium text-gray-950">Manual update check</h3>
              <p className="mt-1 text-sm text-gray-500">
                Force Orxa to check the latest published release now.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={isChecking || isInstalling}
            >
              {isChecking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Check for updates
            </Button>
          </div>
        </div>
      </section>

      {statusMessage && (
        <StatusPanel tone={availableVersion ? "update" : "success"}>{statusMessage}</StatusPanel>
      )}

      {errorMessage && <StatusPanel tone="error">{errorMessage}</StatusPanel>}

      {availableVersion && (
        <section>
          <h2 className="mb-3 text-[15px] font-semibold text-gray-950">
            Update v{availableVersion}
          </h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600">
                Download the update, install it, and restart Orxa automatically.
              </p>
              {updateInfo?.body && (
                <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600">
                  {updateInfo.body}
                </pre>
              )}
            </div>

            {progress && (
              <div className="border-t border-gray-100 px-5 py-4">
                <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                  <span>{isInstalling ? "Downloading update" : "Ready"}</span>
                  <span>{progress.percentage}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-gray-900 transition-all"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {formatBytes(progress.downloaded)} of {formatBytes(progress.total)}
                </p>
              </div>
            )}

            <div className="flex justify-end border-t border-gray-100 px-5 py-4">
              <Button
                type="button"
                onClick={handleInstallUpdate}
                disabled={!updateInfo?.update || isInstalling}
              >
                {isInstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isInstalling ? "Installing..." : "Download and restart"}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SettingsRow({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-medium text-gray-950">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <div className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700">
        {value}
      </div>
    </div>
  );
}

function StatusPanel({
  children,
  tone,
}: {
  children: string;
  tone: "success" | "update" | "error";
}) {
  const Icon = tone === "error" ? AlertTriangle : CheckCircle2;
  const colorClass =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-gray-200 bg-gray-50 text-gray-700";

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${colorClass}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
