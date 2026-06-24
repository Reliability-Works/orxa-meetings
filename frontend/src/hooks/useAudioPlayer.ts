import { useState, useEffect, useRef } from "react";
import {
  cleanupAudioResources,
  initializeAudioContext,
  loadAudioBuffer,
  stopPlaybackSource,
} from "./audioPlayerHelpers";

export const useAudioPlayer = (audioPath: string | null) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const rafRef = useRef<number>();
  const seekTimeRef = useRef<number>(0);

  const initAudioContext = () => initializeAudioContext(audioRef, setError);

  // Cleanup function
  useEffect(() => {
    return () => {
      cleanupAudioResources({ rafRef, sourceRef, audioRef });
    };
  }, []);

  const loadAudio = async () => {
    if (!audioPath) {
      console.log("No audio path provided");
      return;
    }

    try {
      // Initialize context first
      const audioContext = await initAudioContext();
      if (!audioContext) {
        console.error("Failed to initialize audio context");
        return;
      }

      const audioBuffer = await loadAudioBuffer(audioPath, audioContext);
      audioBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);
      setCurrentTime(0);
      setError(null);
      console.log("Audio loaded and ready to play");
    } catch (error) {
      console.error("Error loading audio:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
      }
      setError("Failed to load audio file");
    }
  };

  // Load audio when path changes
  useEffect(() => {
    console.log("Audio path changed:", audioPath);
    if (audioPath) {
      loadAudio();
    }
  }, [audioPath]);

  const stopPlayback = () => {
    console.log("Stopping playback");
    stopPlaybackSource({ rafRef, sourceRef });
    setIsPlaying(false);
  };

  const play = async () => {
    console.log("Play requested");

    try {
      // Initialize context if needed
      const audioContext = await initAudioContext();
      if (!audioContext) {
        throw new Error("Audio context initialization failed");
      }
      if (!audioRef.current) {
        throw new Error("Audio context is null after initialization");
      }
      if (!audioBufferRef.current) {
        throw new Error("No audio buffer loaded - try loading the audio file first");
      }
      if (audioRef.current.state !== "running") {
        throw new Error(`Audio context is in invalid state: ${audioRef.current.state}`);
      }

      // Stop any existing playback
      stopPlayback();

      // Create and setup new source
      console.log("Creating new audio source");
      sourceRef.current = audioRef.current.createBufferSource();
      sourceRef.current.buffer = audioBufferRef.current;

      console.log("Audio buffer details:", {
        duration: audioBufferRef.current.duration,
        sampleRate: audioBufferRef.current.sampleRate,
        numberOfChannels: audioBufferRef.current.numberOfChannels,
        length: audioBufferRef.current.length,
      });

      sourceRef.current.connect(audioRef.current.destination);

      // Setup ended callback
      sourceRef.current.onended = () => {
        console.log("Playback ended naturally");
        stopPlayback();
        setCurrentTime(0);
      };

      // Start playback from the seek time
      const startTime = seekTimeRef.current;
      startTimeRef.current = audioRef.current.currentTime - startTime;
      console.log("Starting playback", {
        startTime,
        contextTime: audioRef.current.currentTime,
        seekTime: seekTimeRef.current,
      });

      sourceRef.current.start(0, startTime);
      setIsPlaying(true);
      setError(null);

      // Setup time update
      const updateTime = () => {
        if (!audioRef.current || !sourceRef.current) {
          console.log("Update cancelled - context or source is null");
          return;
        }

        const newTime = audioRef.current.currentTime - startTimeRef.current;

        if (newTime >= duration) {
          console.log("Playback finished");
          stopPlayback();
          setCurrentTime(0);
          seekTimeRef.current = 0;
        } else {
          setCurrentTime(newTime);
          seekTimeRef.current = newTime;
          rafRef.current = requestAnimationFrame(updateTime);
        }
      };

      rafRef.current = requestAnimationFrame(updateTime);
    } catch (error) {
      console.error("Error during playback:", error);
      setError("Failed to play audio");
      stopPlayback();
    }
  };

  const seek = async (time: number) => {
    console.log("Seek requested:", time);
    if (time < 0) time = 0;
    if (time > duration) time = duration;

    const wasPlaying = isPlaying;

    // Stop current playback
    stopPlayback();

    // Update both current time and seek time reference
    seekTimeRef.current = time;
    setCurrentTime(time);

    // If it was playing before, restart playback at new position
    if (wasPlaying) {
      console.log("Restarting playback at:", time);
      await play();
    }
  };

  const pause = () => {
    console.log("Pause requested");
    stopPlayback();
  };

  return {
    isPlaying,
    currentTime,
    duration,
    error,
    play,
    pause,
    seek,
  };
};
