import { RadioTower } from 'lucide-react';
import { LocalModelCatalogCards } from './LocalModelCatalogCards';
import { EXPERIMENTAL_TRANSCRIPTION_MODELS } from '@/lib/localModelCatalog';

export function ExperimentalTranscriptionModels() {
  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-700">
          <RadioTower className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">Next-Gen Transcription Candidates</h3>
          <p className="mt-1 text-sm text-gray-600">
            Download newer local ASR candidates for benchmarking against Lightning and Local Whisper. Downloaded assets are cached locally; models with pending adapters are not selectable for live transcription yet.
          </p>
        </div>
      </div>
      <LocalModelCatalogCards models={EXPERIMENTAL_TRANSCRIPTION_MODELS} />
    </div>
  );
}
