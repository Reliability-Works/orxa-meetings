import { invoke } from '@tauri-apps/api/core';

export type RuntimeStatus = 'ready' | 'adapter_pending' | 'research';
export type LocalModelDownloadState = 'missing' | 'downloading' | 'downloaded' | 'error';

export interface LocalModelCatalogItem {
  id: string;
  name: string;
  family: string;
  size: string;
  bestFor: string;
  sourceUrl: string;
  runtimeStatus: RuntimeStatus;
  recommended?: boolean;
  notes: string;
}

export interface LocalModelDownloadStatus {
  model_id: string;
  state: LocalModelDownloadState;
  path: string;
  source_url: string | null;
  downloaded_bytes: number;
  total_bytes: number;
  file_count: number;
  updated_at: string | null;
  error: string | null;
}

export const EXPERIMENTAL_TRANSCRIPTION_MODELS: LocalModelCatalogItem[] = [
  {
    id: 'nemotron-3.5-asr-streaming-0.6b',
    name: 'Nemotron 3.5 ASR Streaming 0.6B',
    family: 'NVIDIA streaming ASR',
    size: '~0.6B parameters',
    bestFor: 'Low-latency live meeting transcription',
    sourceUrl: 'https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b',
    runtimeStatus: 'adapter_pending',
    recommended: true,
    notes: 'Closest fit for replacing Lightning with a newer streaming local model.',
  },
  {
    id: 'voxtral-mini-realtime-4b',
    name: 'Voxtral Mini Realtime 4B',
    family: 'Mistral realtime ASR',
    size: '~4B parameters',
    bestFor: 'Higher-quality realtime transcription on stronger Apple silicon',
    sourceUrl: 'https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602',
    runtimeStatus: 'adapter_pending',
    notes: 'Promising realtime quality, but needs an MLX or sidecar runtime before Meetily can run it.',
  },
  {
    id: 'qwen3-asr-1.7b',
    name: 'Qwen3-ASR 1.7B',
    family: 'Qwen ASR',
    size: '~1.7B parameters',
    bestFor: 'Offline retranscription and multilingual accuracy tests',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-ASR-1.7B',
    runtimeStatus: 'adapter_pending',
    notes: 'Better suited to a high-accuracy retranscription path than the current live chunker.',
  },
  {
    id: 'cohere-transcribe-03-2026',
    name: 'Cohere Transcribe 03-2026',
    family: 'Cohere open ASR',
    size: '~2B parameters',
    bestFor: 'Accuracy benchmarking against real Meetily meetings',
    sourceUrl: 'https://huggingface.co/CohereLabs/cohere-transcribe-03-2026',
    runtimeStatus: 'research',
    notes: 'Good leaderboard candidate, but runtime and packaging need validation.',
  },
  {
    id: 'granite-speech-4.1-2b-plus',
    name: 'Granite Speech 4.1 2B Plus',
    family: 'IBM Granite Speech',
    size: '~2B parameters',
    bestFor: 'Speaker-aware offline ASR experiments',
    sourceUrl: 'https://huggingface.co/ibm-granite/granite-speech-4.1-2b-plus',
    runtimeStatus: 'research',
    notes: 'Interesting for speaker-attributed ASR, but not yet wired into Meetily.',
  },
  {
    id: 'moonshine',
    name: 'Moonshine',
    family: 'Useful Sensors ASR',
    size: 'Small local models',
    bestFor: 'Very low-latency local dictation experiments',
    sourceUrl: 'https://github.com/moonshine-ai/moonshine',
    runtimeStatus: 'research',
    notes: 'Worth benchmarking, but likely less meeting-focused than Whisper or streaming ASR models.',
  },
];

export const PLAYBACK_MODELS: LocalModelCatalogItem[] = [
  {
    id: 'kokoro-82m-onnx',
    name: 'Kokoro 82M ONNX',
    family: 'Local TTS',
    size: '~82M parameters',
    bestFor: 'Fast local summary playback',
    sourceUrl: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',
    runtimeStatus: 'adapter_pending',
    recommended: true,
    notes: 'Best first target for a small, fast local playback engine.',
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox',
    family: 'Resemble AI TTS',
    size: 'Medium local TTS stack',
    bestFor: 'More human, expressive summary playback',
    sourceUrl: 'https://github.com/resemble-ai/chatterbox',
    runtimeStatus: 'adapter_pending',
    notes: 'Stronger human-like voice target, with a heavier integration than Kokoro.',
  },
  {
    id: 'dia-1.6b',
    name: 'Dia 1.6B',
    family: 'Dialogue TTS',
    size: '~1.6B parameters',
    bestFor: 'Very natural spoken dialogue experiments',
    sourceUrl: 'https://huggingface.co/nari-labs/Dia-1.6B',
    runtimeStatus: 'research',
    notes: 'High realism, but heavier and less practical as the first playback runtime.',
  },
  {
    id: 'zonos2',
    name: 'Zonos 2',
    family: 'Expressive TTS',
    size: 'Large local TTS stack',
    bestFor: 'Expressive/voice-clone style experiments',
    sourceUrl: 'https://github.com/Zyphra/ZONOS2',
    runtimeStatus: 'research',
    notes: 'Interesting longer-term option once basic local playback is stable.',
  },
];

export function runtimeStatusLabel(status: RuntimeStatus) {
  if (status === 'ready') return 'Ready';
  if (status === 'adapter_pending') return 'Adapter needed';
  return 'Research';
}

export class LocalModelCatalogAPI {
  static async getStatuses(modelIds: string[]) {
    if (modelIds.length === 0) return [];
    return invoke<LocalModelDownloadStatus[]>('local_model_get_statuses', { modelIds });
  }

  static async downloadModel(model: LocalModelCatalogItem) {
    return invoke<LocalModelDownloadStatus>('local_model_download_model', {
      modelId: model.id,
      name: model.name,
      sourceUrl: model.sourceUrl,
    });
  }

  static async openFolder(modelId: string) {
    return invoke<void>('local_model_open_folder', { modelId });
  }
}
