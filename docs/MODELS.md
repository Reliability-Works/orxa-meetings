# Models

Orxa has separate model surfaces for transcription, summaries, chat, and playback.

## Transcription Models

Transcription models capture speech during or after a meeting.

Primary options:

- Parakeet: recommended real-time transcription option where available.
- Local Whisper: higher-accuracy local fallback for retranscription or slower local capture.
- Compact/Lightning variants: smaller or faster choices when hardware is constrained.

Transcription quality depends on the model, microphone/system audio quality, speaker overlap, and whether the recording includes noise or unrelated post-meeting audio.

## Summary Models

Summary models turn transcripts into detailed notes, decisions, risks, questions, and action items/todos.

The summary prompts intentionally prefer expansive coverage over very short summaries. The best local summary model is usually the largest downloaded model that runs acceptably on the Mac.

## Chat Models

Chat models power persistent Orxa chats. They need stronger instruction following and longer context handling than short summary generation because they may combine:

- the current chat history
- selected meeting transcript evidence
- selected meeting summary
- Agent Sources snippets
- recent meeting lists

The Chat settings page should describe chat-specific pros and cons rather than reusing summary-only guidance.

## Playback Models

Playback models are for reading summaries aloud. They should be evaluated separately from transcription and chat because voice quality, latency, and local runtime support are the key tradeoffs.

## Local Model Downloads

The model downloader stores catalog models under app data. Supported download sources are Hugging Face model repositories and GitHub repositories. Each downloaded model writes an `orxa-model-manifest.json` file so the app can report status later.

See `frontend/src-tauri/src/local_models.rs` for the downloader implementation.
