import { RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { markdownToSpeechText, summaryDataToMarkdown } from '@/lib/summaryText';
import Analytics from '@/lib/analytics';

interface UseSummaryPlaybackProps {
  meetingId: string;
  meetingTitle: string;
  aiSummary: Summary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef>;
}

function chooseVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  const preferredNames = ['Samantha', 'Daniel', 'Serena', 'Karen', 'Moira', 'Tessa', 'Alex'];
  return (
    voices.find((voice) => voice.localService && preferredNames.some((name) => voice.name.includes(name))) ||
    voices.find((voice) => voice.localService && voice.lang.toLowerCase().startsWith('en')) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ||
    null
  );
}

export function useSummaryPlayback({
  meetingId,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
}: UseSummaryPlaybackProps) {
  const [isPlayingSummary, setIsPlayingSummary] = useState(false);

  const isSummaryPlaybackSupported = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
    []
  );

  const stopSummaryPlayback = useCallback(() => {
    if (!isSummaryPlaybackSupported) return;
    window.speechSynthesis.cancel();
    setIsPlayingSummary(false);
  }, [isSummaryPlaybackSupported]);

  useEffect(() => stopSummaryPlayback, [meetingId, stopSummaryPlayback]);

  const playSummary = useCallback(async () => {
    if (!isSummaryPlaybackSupported) {
      toast.error('Summary playback is not available on this device');
      return;
    }

    let summaryMarkdown = '';
    if (blockNoteSummaryRef.current?.getMarkdown) {
      summaryMarkdown = await blockNoteSummaryRef.current.getMarkdown();
    }
    if (!summaryMarkdown.trim()) {
      summaryMarkdown = summaryDataToMarkdown(aiSummary);
    }

    const speechText = markdownToSpeechText(`# ${meetingTitle}\n\n${summaryMarkdown}`);
    if (!speechText) {
      toast.error('No summary content available to read');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.voice = chooseVoice();
    utterance.rate = 0.98;
    utterance.pitch = 1;
    utterance.onend = () => setIsPlayingSummary(false);
    utterance.onerror = () => {
      setIsPlayingSummary(false);
      toast.error('Summary playback stopped');
    };

    setIsPlayingSummary(true);
    window.speechSynthesis.speak(utterance);
    await Analytics.trackFeatureUsed('summary_playback');
  }, [aiSummary, blockNoteSummaryRef, isSummaryPlaybackSupported, meetingTitle]);

  return {
    isPlayingSummary,
    isSummaryPlaybackSupported,
    playSummary,
    stopSummaryPlayback,
  };
}
