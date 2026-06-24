"use client";

import React, { createContext, ReactNode, useEffect } from "react";
import Analytics from "@/lib/analytics";
import { load } from "@tauri-apps/plugin-store";

interface AnalyticsProviderProps {
  children: ReactNode;
}

interface AnalyticsContextType {
  isAnalyticsOptedIn: boolean;
  setIsAnalyticsOptedIn: (optedIn: boolean) => void;
}

export const AnalyticsContext = createContext<AnalyticsContextType>({
  isAnalyticsOptedIn: false,
  setIsAnalyticsOptedIn: () => {},
});

export default function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  useEffect(() => {
    const disableAnalytics = async () => {
      const store = await load("analytics.json", {
        autoSave: false,
        defaults: {
          analyticsOptedIn: false,
        },
      });

      await store.set("analyticsOptedIn", false);
      await store.save();
      await Analytics.disable();
    };

    disableAnalytics().catch(console.error);
  }, []);

  return (
    <AnalyticsContext.Provider
      value={{ isAnalyticsOptedIn: false, setIsAnalyticsOptedIn: () => {} }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
}
