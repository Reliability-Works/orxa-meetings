"use client";

import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface SummaryErrorStateProps {
  error: string | null;
}

interface SummaryLoadingStateProps {
  status: "processing" | "summarizing" | "regenerating";
}

export function SummaryErrorState({ error }: SummaryErrorStateProps) {
  return (
    <div className="w-full p-4 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-center mb-2">
        <ExclamationTriangleIcon className="h-5 w-5 text-red-500 mr-2" />
        <h3 className="text-red-700 font-medium">Error Generating Summary</h3>
      </div>
      <p className="text-red-600 text-sm">{error}</p>
      <p className="text-red-500 text-xs mt-2">
        Please check your model configuration and API keys, or try again.
      </p>
    </div>
  );
}

export function SummaryLoadingState({ status }: SummaryLoadingStateProps) {
  return (
    <div className="w-full p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center space-x-3">
        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
        <div>
          <h3 className="text-blue-700 font-medium">
            {status === "processing" ? "Processing Transcript" : "Generating Summary"}
          </h3>
          <p className="text-blue-600 text-sm">
            {status === "processing"
              ? "Analyzing your transcript..."
              : "Creating a detailed summary of your meeting..."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SummaryEmptyState() {
  return (
    <div className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
      <p className="text-gray-600">No summary content available.</p>
      <p className="text-gray-500 text-sm mt-1">Try generating a new summary.</p>
    </div>
  );
}
