import { ChevronDown, ChevronRight } from "lucide-react";
import { ModelProvider, ProviderGuidance } from "@/components/model-settings/modelSettingsTypes";

interface ProviderGuidancePanelProps {
  provider: ModelProvider;
  guidance: ProviderGuidance;
  isOpen: boolean;
  onToggle: () => void;
}

export function ProviderGuidancePanel({
  provider,
  guidance,
  isOpen,
  onToggle,
}: ProviderGuidancePanelProps) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{guidance.label}</span>
        {provider === "builtin-ai" && (
          <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
            Best
          </span>
        )}
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-3">
          <div className="grid gap-3 text-xs text-gray-600 sm:grid-cols-2">
            <div className="rounded-md bg-emerald-50 p-3 text-emerald-900">
              <p className="font-semibold">Pros</p>
              <ul className="mt-1 space-y-1">
                {guidance.pros.map((item) => (
                  <li key={item}>+ {item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md bg-gray-50 p-3 text-gray-700">
              <p className="font-semibold text-gray-900">Cons</p>
              <ul className="mt-1 space-y-1">
                {guidance.cons.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
