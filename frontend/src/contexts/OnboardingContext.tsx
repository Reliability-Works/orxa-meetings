"use client";

import React, { createContext, useContext } from "react";
import { useOnboardingController } from "./onboardingContextHooks";
import type { OnboardingContextType } from "./onboardingContextTypes";

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const onboarding = useOnboardingController();

  return <OnboardingContext.Provider value={onboarding}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}
