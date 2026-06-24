import React, { useContext, useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Info, Loader2, Copy, Check } from "lucide-react";
import { AnalyticsContext } from "./AnalyticsProvider";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { Analytics } from "@/lib/analytics";
import AnalyticsDataModal from "./AnalyticsDataModal";

const ANALYTICS_DEFAULT_OFF_MIGRATION_KEY = "analyticsDefaultOffMigrationV1";

async function persistAnalyticsPreference(enabled: boolean) {
  const store = await load("analytics.json", {
    autoSave: false,
    defaults: {
      analyticsOptedIn: false,
    },
  });
  await store.set("analyticsOptedIn", enabled);
  await store.set(ANALYTICS_DEFAULT_OFF_MIGRATION_KEY, true);
  await store.save();
}

async function trackInvoke(command: string) {
  try {
    await invoke(command);
  } catch (error) {
    console.error(`Failed to run ${command}:`, error);
  }
}

async function enableAnalyticsSession() {
  const userId = await Analytics.getPersistentUserId();
  await Analytics.init();
  await Analytics.identify(userId, {
    app_version: "0.0.1",
    platform: "tauri",
    first_seen: new Date().toISOString(),
    os: navigator.platform,
  });
  await Analytics.startSession(userId);
  await Analytics.trackAppStarted();
  await trackInvoke("track_analytics_enabled");
  console.log("Analytics re-enabled successfully");
}

async function disableAnalyticsSession() {
  await trackInvoke("track_analytics_disabled");
  await Analytics.disable();
  console.log("Analytics disabled successfully");
}

function AnalyticsToggleRow({
  isAnalyticsOptedIn,
  isProcessing,
  onToggle,
}: {
  isAnalyticsOptedIn: boolean;
  isProcessing: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div>
        <h4 className="font-semibold text-gray-800">Enable Analytics</h4>
        <p className="text-sm text-gray-600">
          {isProcessing ? "Updating..." : "Off unless you choose to enable it"}
        </p>
      </div>
      <div className="flex items-center gap-2 ml-4">
        {isProcessing && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
        <Switch checked={isAnalyticsOptedIn} onCheckedChange={onToggle} disabled={isProcessing} />
      </div>
    </div>
  );
}

function UserIdCard({
  isCopied,
  userId,
  onCopy,
}: {
  isCopied: boolean;
  userId: string;
  onCopy: () => void;
}) {
  if (!userId) return null;

  return (
    <div className="p-4 border rounded-lg bg-gray-50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800 mb-1">Your User ID</div>
          <p className="text-xs text-gray-600 mb-2">
            Share this ID when reporting issues to help us investigate your issue logs
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-700 bg-white px-2 py-1 rounded border border-gray-300 font-mono flex-1 truncate">
              {userId}
            </code>
            <Button
              onClick={onCopy}
              variant="outline"
              size="sm"
              className="flex-shrink-0"
              title="Copy User ID"
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-green-600">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPrivacyNotice({ onPrivacyPolicyClick }: { onPrivacyPolicyClick: () => void }) {
  return (
    <div className="flex items-start gap-2 p-2 bg-blue-50 rounded border border-blue-200">
      <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
      <div className="text-xs text-blue-700">
        <p className="mb-1">
          Your meetings, transcripts, and recordings remain completely private and local.
        </p>
        <button
          onClick={onPrivacyPolicyClick}
          className="text-blue-600 hover:text-blue-800 underline hover:no-underline"
        >
          View Privacy Policy
        </button>
      </div>
    </div>
  );
}

export default function AnalyticsConsentSwitch() {
  const { setIsAnalyticsOptedIn, isAnalyticsOptedIn } = useContext(AnalyticsContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [isCopied, setIsCopied] = useState(false);

  // Note: Store loading is handled by AnalyticsProvider to avoid race conditions

  useEffect(() => {
    const loadUserId = async () => {
      if (isAnalyticsOptedIn) {
        try {
          const id = await Analytics.getPersistentUserId();
          setUserId(id);
        } catch (error) {
          console.error("Failed to load user ID:", error);
        }
      } else {
        setUserId("");
      }
    };
    loadUserId();
  }, [isAnalyticsOptedIn]);

  const handleCopyUserId = async () => {
    if (!userId) return;

    try {
      await navigator.clipboard.writeText(userId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);

      // Track that user copied their ID
      await Analytics.track("user_id_copied", {
        user_id: userId,
      });
    } catch (error) {
      console.error("Failed to copy user ID:", error);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!enabled) {
      setShowModal(true);
      await trackInvoke("track_analytics_transparency_viewed");
      return;
    }

    await performToggle(enabled);
  };

  const performToggle = async (enabled: boolean) => {
    setIsAnalyticsOptedIn(enabled);
    setIsProcessing(true);

    try {
      await persistAnalyticsPreference(enabled);
      if (enabled) {
        await enableAnalyticsSession();
      } else {
        await disableAnalyticsSession();
      }
    } catch (error) {
      console.error("Failed to toggle analytics:", error);
      setIsAnalyticsOptedIn(!enabled);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDisable = async () => {
    setShowModal(false);
    await performToggle(false);
  };

  const handleCancelDisable = () => {
    setShowModal(false);
    // Keep analytics enabled, no state change needed
  };

  const handlePrivacyPolicyClick = async () => {
    try {
      await invoke("open_external_url", {
        url: "https://github.com/Reliability-Works/orxa-meetings/blob/main/PRIVACY_POLICY.md",
      });
    } catch (error) {
      console.error("Failed to open privacy policy link:", error);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-800 mb-2">Usage Analytics</h3>
          <p className="text-sm text-gray-600 mb-4">
            Usage analytics is off by default. You can turn it on to share anonymous product and
            performance data; no personal content is collected.
          </p>
        </div>

        <AnalyticsToggleRow
          isAnalyticsOptedIn={isAnalyticsOptedIn}
          isProcessing={isProcessing}
          onToggle={handleToggle}
        />

        {isAnalyticsOptedIn && userId && (
          <UserIdCard isCopied={isCopied} userId={userId} onCopy={handleCopyUserId} />
        )}

        <AnalyticsPrivacyNotice onPrivacyPolicyClick={handlePrivacyPolicyClick} />
      </div>

      <AnalyticsDataModal
        isOpen={showModal}
        onClose={handleCancelDisable}
        onConfirmDisable={handleConfirmDisable}
      />
    </>
  );
}
