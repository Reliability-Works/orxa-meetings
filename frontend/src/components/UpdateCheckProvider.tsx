"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { updateService, UpdateInfo, UpdateProgress } from "@/services/updateService";
import { UpdateDialog } from "./UpdateDialog";
import { setUpdateDialogCallback, showUpdateNotification } from "./UpdateNotification";
import { toast } from "sonner";

interface UpdateCheckContextType {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isDownloading: boolean;
  updateProgress: UpdateProgress | null;
  updateError: string | null;
  checkForUpdates: (force?: boolean) => Promise<void>;
  showUpdateDialog: () => void;
  installUpdate: () => Promise<void>;
}

const UpdateCheckContext = createContext<UpdateCheckContextType | undefined>(undefined);

export function UpdateCheckProvider({ children }: { children: React.ReactNode }) {
  const [showDialog, setShowDialog] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleShowDialog = useCallback(() => {
    setShowDialog(true);
  }, []);

  const { updateInfo, isChecking, checkForUpdates } = useUpdateCheck({
    checkOnMount: true,
    showNotification: true,
    onUpdateAvailable: (info) => {
      // Show notification, dialog will be shown when user clicks notification
      showUpdateNotification(info, handleShowDialog);
    },
  });

  const installUpdate = useCallback(async () => {
    if (isDownloading) return;

    setUpdateError(null);
    setUpdateProgress({ downloaded: 0, total: 0, percentage: 0 });
    setIsDownloading(true);

    try {
      const updateToInstall =
        updateInfo?.update ?? (await updateService.checkForUpdates(true)).update;
      if (!updateToInstall) {
        throw new Error("Update is no longer available");
      }

      await updateService.downloadAndInstall(updateToInstall, setUpdateProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateError(message);
      setIsDownloading(false);
      toast.error("Update failed", { description: message });
    }
  }, [isDownloading, updateInfo]);

  useEffect(() => {
    // Register the callback so UpdateNotification can trigger the dialog
    setUpdateDialogCallback(handleShowDialog);
    return () => {
      setUpdateDialogCallback(() => {});
    };
  }, [handleShowDialog]);

  // Listen for tray menu events
  useEffect(() => {
    const handleTrayCheck = () => {
      checkForUpdates(true); // Force check from tray
      setShowDialog(true);
    };

    window.addEventListener("check-updates-from-tray", handleTrayCheck);
    return () => window.removeEventListener("check-updates-from-tray", handleTrayCheck);
  }, [checkForUpdates]);

  return (
    <UpdateCheckContext.Provider
      value={{
        updateInfo,
        isChecking,
        isDownloading,
        updateProgress,
        updateError,
        checkForUpdates,
        showUpdateDialog: handleShowDialog,
        installUpdate,
      }}
    >
      {children}
      <UpdateDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        updateInfo={updateInfo}
        isDownloading={isDownloading}
        progress={updateProgress}
        error={updateError}
        onInstall={installUpdate}
      />
    </UpdateCheckContext.Provider>
  );
}

export function useUpdateCheckContext() {
  const context = useContext(UpdateCheckContext);
  if (context === undefined) {
    throw new Error("useUpdateCheckContext must be used within UpdateCheckProvider");
  }
  return context;
}
