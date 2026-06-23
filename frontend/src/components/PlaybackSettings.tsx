import { Volume2 } from 'lucide-react';
import { LocalModelCatalogCards } from './LocalModelCatalogCards';
import { PLAYBACK_MODELS } from '@/lib/localModelCatalog';

export function PlaybackSettings() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
            <Volume2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Summary Playback</h3>
            <p className="mt-1 text-sm text-gray-600">
              Meeting summaries can be read aloud today with the local macOS speech engine from the summary toolbar. Kokoro is the best first downloaded-model adapter target; richer voices can follow once playback is stable.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Playback Model Downloads</h3>
        <p className="mt-1 text-sm text-gray-600">
          These options track the local models worth wiring into Meetily. Downloads are disabled until the matching TTS runtime is added.
        </p>
        <div className="mt-5">
          <LocalModelCatalogCards models={PLAYBACK_MODELS} />
        </div>
      </div>
    </div>
  );
}
