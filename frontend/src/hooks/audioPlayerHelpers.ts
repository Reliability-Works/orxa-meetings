import { invoke } from "@tauri-apps/api/core";
import type { MutableRefObject } from "react";

export async function initializeAudioContext(
  audioRef: MutableRefObject<AudioContext | null>,
  setError: (error: string | null) => void,
) {
  try {
    if (!audioRef.current) {
      console.log("Creating new AudioContext");
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioRef.current = new AudioContextClass();
      console.log("AudioContext created:", {
        state: audioRef.current.state,
        sampleRate: audioRef.current.sampleRate,
      });
    }

    if (audioRef.current.state === "suspended") {
      console.log("Resuming suspended AudioContext");
      await audioRef.current.resume();
      console.log("AudioContext resumed:", audioRef.current.state);
    }

    setError(null);
    return audioRef.current;
  } catch (error) {
    console.error("Error initializing AudioContext:", error);
    setError("Failed to initialize audio");
    return null;
  }
}

export function cleanupAudioResources(args: {
  rafRef: MutableRefObject<number | undefined>;
  sourceRef: MutableRefObject<AudioBufferSourceNode | null>;
  audioRef: MutableRefObject<AudioContext | null>;
}) {
  console.log("Cleaning up audio resources");
  if (args.rafRef.current) {
    cancelAnimationFrame(args.rafRef.current);
  }
  if (args.sourceRef.current) {
    args.sourceRef.current.stop();
  }
  if (args.audioRef.current) {
    args.audioRef.current.close();
  }
}

export function stopPlaybackSource(args: {
  rafRef: MutableRefObject<number | undefined>;
  sourceRef: MutableRefObject<AudioBufferSourceNode | null>;
}) {
  if (args.rafRef.current) {
    cancelAnimationFrame(args.rafRef.current);
    args.rafRef.current = undefined;
  }
  if (!args.sourceRef.current) return;

  try {
    args.sourceRef.current.stop();
    args.sourceRef.current.disconnect();
  } catch (e) {
    console.log("Error stopping source:", e);
  }
  args.sourceRef.current = null;
}

export async function loadAudioBuffer(audioPath: string, audioContext: AudioContext) {
  console.log("Loading audio from:", audioPath);
  const result = await invoke<number[]>("read_audio_file", {
    filePath: audioPath,
  });

  if (!result || result.length === 0) {
    throw new Error("Empty audio data received");
  }

  console.log("Audio file read, size:", result.length, "bytes");
  const audioData = new Uint8Array(result).buffer;
  console.log("Created audio buffer, size:", audioData.byteLength, "bytes");
  return decodeAudioBuffer(audioContext, audioData);
}

function decodeAudioBuffer(audioContext: AudioContext, audioData: ArrayBuffer) {
  return new Promise<AudioBuffer>((resolve, reject) => {
    audioContext.decodeAudioData(
      audioData,
      (buffer) => {
        console.log("Audio decoded successfully:", {
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
          numberOfChannels: buffer.numberOfChannels,
          length: buffer.length,
        });
        resolve(buffer);
      },
      (error) => {
        console.error("Audio decoding failed:", error);
        reject(new Error("Failed to decode audio data: " + error));
      },
    );
  });
}
