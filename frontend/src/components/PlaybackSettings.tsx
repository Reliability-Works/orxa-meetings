import { Volume2 } from 'lucide-react';
import { LocalModelCatalogCards } from './LocalModelCatalogCards';
import { PLAYBACK_MODELS } from '@/lib/localModelCatalog';

export function PlaybackSettings() {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Summary playback</h2>
        <div className="flex items-start gap-2">
          <Volume2 className="mt-0.5 h-4 w-4 text-gray-500" />
          <div>
            <h3 className="text-[15px] font-medium text-gray-950">Local speech</h3>
            <p className="mt-1 text-sm text-gray-500">
              Meeting summaries can be read aloud today with the local macOS speech engine from the summary toolbar. Kokoro is the best first downloaded-model adapter target; richer voices can follow once playback is stable.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-gray-950">Playback model downloads</h2>
        <p className="mb-4 text-sm text-gray-500">
          Download local TTS model artifacts for the playback engines worth wiring into Orxa. Downloaded models are cached locally; playback runtime adapters are still labelled where needed.
        </p>
        <LocalModelCatalogCards models={PLAYBACK_MODELS} />
      </section>
    </div>
  );
}
