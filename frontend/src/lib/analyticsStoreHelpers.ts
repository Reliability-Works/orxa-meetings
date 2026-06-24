import type { DeviceInfo } from "./analytics";

export async function getPersistentUserIdFromStore(): Promise<string> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    let userId = await store.get<string>("user_id");

    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await store.set("user_id", userId);
      await store.set("is_first_launch", true);
      await store.save();
    }

    return userId;
  } catch (error) {
    console.error("Failed to get persistent user ID:", error);
    let userId = sessionStorage.getItem("orxa_user_id");
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem("orxa_user_id", userId);
      sessionStorage.setItem("is_first_launch", "true");
    }
    return userId;
  }
}

export async function checkAndTrackFirstLaunchInStore(trackUserFirstLaunch: () => Promise<void>) {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const isFirstLaunch = await store.get<boolean>("is_first_launch");

    if (isFirstLaunch) {
      await trackUserFirstLaunch();
      await store.set("is_first_launch", false);
      await store.save();
    }
  } catch (error) {
    console.error("Failed to check first launch:", error);
    const isFirstLaunch = sessionStorage.getItem("is_first_launch") === "true";
    if (isFirstLaunch) {
      await trackUserFirstLaunch();
      sessionStorage.removeItem("is_first_launch");
    }
  }
}

export async function checkAndTrackDailyUsageInStore(trackDailyActiveUser: () => Promise<void>) {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const today = new Date().toISOString().split("T")[0];
    const lastTrackedDate = await store.get<string>("last_daily_tracked");

    if (lastTrackedDate !== today) {
      await trackDailyActiveUser();
      await store.set("last_daily_tracked", today);
      await store.save();
    }
  } catch (error) {
    console.error("Failed to check daily usage:", error);
  }
}

export async function calculateDaysSinceInStore(dateKey: string): Promise<number | null> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const dateStr = await store.get<string>(dateKey);
    if (!dateStr) return null;
    const diffMs = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch (error) {
    console.error(`Failed to calculate days since ${dateKey}:`, error);
    return null;
  }
}

export async function updateMeetingCountInStore(): Promise<void> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const totalMeetings = ((await store.get<number>("total_meetings")) || 0) + 1;
    await store.set("total_meetings", totalMeetings);
    await store.set("last_meeting_date", new Date().toISOString());

    const today = new Date().toISOString().split("T")[0];
    const dailyCounts = (await store.get<Record<string, number>>("daily_meeting_counts")) || {};
    dailyCounts[today] = (dailyCounts[today] || 0) + 1;
    await store.set("daily_meeting_counts", dailyCounts);
    await store.save();
  } catch (error) {
    console.error("Failed to update meeting count:", error);
  }
}

export async function getMeetingsCountTodayFromStore(): Promise<number> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const today = new Date().toISOString().split("T")[0];
    const dailyCounts = (await store.get<Record<string, number>>("daily_meeting_counts")) || {};
    return dailyCounts[today] || 0;
  } catch (error) {
    console.error("Failed to get meetings count today:", error);
    return 0;
  }
}

export async function hasUsedFeatureBeforeInStore(featureName: string): Promise<boolean> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const features = (await store.get<Record<string, any>>("features_used")) || {};
    return !!features[featureName];
  } catch (error) {
    console.error(`Failed to check feature usage for ${featureName}:`, error);
    return false;
  }
}

export async function markFeatureUsedInStore(featureName: string): Promise<void> {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load("analytics.json");
    const features = (await store.get<Record<string, any>>("features_used")) || {};

    if (!features[featureName]) {
      features[featureName] = {
        first_used: new Date().toISOString(),
        use_count: 1,
      };
    } else {
      features[featureName].use_count++;
    }

    await store.set("features_used", features);
    await store.save();
  } catch (error) {
    console.error(`Failed to mark feature used for ${featureName}:`, error);
  }
}

export async function getPlatformFromNavigator(): Promise<string> {
  try {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("mac")) return "macOS";
    if (userAgent.includes("win")) return "Windows";
    if (userAgent.includes("linux")) return "Linux";
    return "unknown";
  } catch (error) {
    console.error("Failed to get platform:", error);
    return "unknown";
  }
}

export async function getOSVersionFromNavigator(): Promise<string> {
  try {
    const platform = await getPlatformFromNavigator();
    return `${platform} (${navigator.userAgent})`;
  } catch (error) {
    console.error("Failed to get OS version:", error);
    return "unknown";
  }
}

export async function detectDeviceInfo(): Promise<DeviceInfo> {
  try {
    const platform = await getPlatformFromNavigator();
    const osVersion = await getOSVersionFromNavigator();
    const userAgent = navigator.userAgent.toLowerCase();
    let architecture = "unknown";

    if (userAgent.includes("arm") || userAgent.includes("aarch64")) {
      architecture = "aarch64";
    } else if (userAgent.includes("x86_64") || userAgent.includes("x64")) {
      architecture = "x86_64";
    } else if (userAgent.includes("x86")) {
      architecture = "x86";
    }

    return {
      platform,
      os_version: osVersion,
      architecture,
    };
  } catch (error) {
    console.error("Failed to get device info:", error);
    return {
      platform: "unknown",
      os_version: "unknown",
      architecture: "unknown",
    };
  }
}
