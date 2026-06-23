"use client"

import { Switch } from "./ui/switch"
import { FlaskConical, AlertCircle } from "lucide-react"
import { useConfig } from "@/contexts/ConfigContext"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe'];

  return (
    <div className="space-y-6">
      {/* Yellow Warning Banner */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="text-sm text-amber-800">
          <p className="font-medium">Beta features</p>
          <p className="mt-1">
            These features are still being tested. You may encounter issues, and we appreciate your feedback.
          </p>
        </div>
      </div>

      {/* Dynamic Feature Toggles - Automatically renders all features */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {featureOrder.map((featureKey) => (
          <div
            key={featureKey}
            className="flex min-h-20 items-center justify-between gap-6 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-gray-500" />
                <h3 className="text-[15px] font-medium text-gray-950">{BETA_FEATURE_NAMES[featureKey]}</h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Beta</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{BETA_FEATURE_DESCRIPTIONS[featureKey]}</p>
            </div>

            <Switch
              checked={betaFeatures[featureKey]}
              onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
            />
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        When disabled, beta features will be hidden. Your existing meetings remain unaffected.
      </div>
    </div>
  );
}
