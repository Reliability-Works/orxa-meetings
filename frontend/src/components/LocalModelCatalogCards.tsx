import { invoke } from '@tauri-apps/api/core';
import { Download, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  LocalModelCatalogItem,
  runtimeStatusLabel,
} from '@/lib/localModelCatalog';
import { Button } from './ui/button';

interface LocalModelCatalogCardsProps {
  models: LocalModelCatalogItem[];
}

function statusClass(status: LocalModelCatalogItem['runtimeStatus']) {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'adapter_pending') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

async function openSource(url: string) {
  try {
    await invoke('open_external_url', { url });
  } catch (error) {
    console.error('Failed to open model source:', error);
    toast.error('Could not open model page');
  }
}

export function LocalModelCatalogCards({ models }: LocalModelCatalogCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {models.map((model) => (
        <div
          key={model.id}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{model.name}</h3>
                {model.recommended && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    Recommended
                  </span>
                )}
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(model.runtimeStatus)}`}>
                  {runtimeStatusLabel(model.runtimeStatus)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{model.family} · {model.size}</p>
              <p className="mt-2 text-sm text-gray-700">{model.bestFor}</p>
              <p className="mt-1 text-xs text-gray-500">{model.notes}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openSource(model.sourceUrl)}
              >
                <ExternalLink className="h-4 w-4" />
                Source
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled
                title="Download will be enabled after the matching local runtime adapter is wired into Meetily."
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
