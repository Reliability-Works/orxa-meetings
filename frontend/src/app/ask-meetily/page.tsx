"use client";

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  MessageSquareText,
  Search,
  Sparkles,
} from 'lucide-react';
import { AskMeetilyResponse } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MeetingOption {
  id: string;
  title: string;
}

function formatTime(seconds?: number | null, fallback?: string) {
  if (typeof seconds !== 'number') return fallback || '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export default function AskMeetilyPage() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<AskMeetilyResponse | null>(null);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(true);
  const [isAsking, setIsAsking] = useState(false);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId),
    [meetings, selectedMeetingId]
  );

  useEffect(() => {
    const loadMeetings = async () => {
      setIsLoadingMeetings(true);
      try {
        const nextMeetings = await invoke<MeetingOption[]>('api_get_meetings', { authToken: null });
        setMeetings(nextMeetings);
        if (nextMeetings.length > 0) {
          setSelectedMeetingId(nextMeetings[0].id);
        }
      } catch (error) {
        console.error('Failed to load meetings:', error);
        toast.error('Could not load meetings');
      } finally {
        setIsLoadingMeetings(false);
      }
    };

    void loadMeetings();
  }, []);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedMeetingId) {
      toast.error('Choose a meeting first');
      return;
    }
    if (question.trim().length < 3) {
      toast.error('Ask a slightly longer question');
      return;
    }

    setIsAsking(true);
    setResponse(null);
    try {
      const result = await invoke<AskMeetilyResponse>('ask_meetily_meeting', {
        meetingId: selectedMeetingId,
        question,
      });
      setResponse(result);
    } catch (error) {
      console.error('Ask Meetily failed:', error);
      toast.error('Ask Meetily could not answer', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-6xl px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Ask Meetily</h1>
                <p className="text-sm text-gray-500">
                  Query one meeting and get transcript-backed evidence.
                </p>
              </div>
            </div>
            {selectedMeeting && (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/meeting-details?id=${selectedMeeting.id}`)}
              >
                Open Meeting
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-8">
          <form onSubmit={ask} className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Meeting</label>
                <Select
                  value={selectedMeetingId}
                  onValueChange={(value) => {
                    setSelectedMeetingId(value);
                    setResponse(null);
                  }}
                  disabled={isLoadingMeetings || meetings.length === 0}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder={isLoadingMeetings ? 'Loading meetings...' : 'Choose a meeting'} />
                  </SelectTrigger>
                  <SelectContent>
                    {meetings.map((meeting) => (
                      <SelectItem key={meeting.id} value={meeting.id}>
                        {meeting.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="ask-meetily-question" className="mb-2 block text-sm font-medium text-gray-700">
                  Question
                </label>
                <div className="flex gap-2">
                  <textarea
                    id="ask-meetily-question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    className="min-h-24 flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="What did we decide about the Kubernetes PR, and what does it mean?"
                  />
                  <Button type="submit" disabled={isAsking || !selectedMeetingId} className="self-start">
                    {isAsking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Ask
                  </Button>
                </div>
              </div>
            </div>
          </form>

          {response && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <h2 className="text-sm font-semibold text-gray-900">Answer</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {response.generated ? response.model || 'Generated' : 'Evidence fallback'}
                  </span>
                </div>

                {response.warning && (
                  <div className="mb-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{response.warning}</p>
                  </div>
                )}

                <div className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                  {response.answer}
                </div>
              </section>

              <aside className="rounded-md border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-4 py-3">
                  <h2 className="text-sm font-semibold text-gray-900">Evidence</h2>
                  <p className="text-xs text-gray-500">{response.evidence.length} transcript moments</p>
                </div>
                <div className="max-h-[640px] divide-y divide-gray-100 overflow-y-auto">
                  {response.evidence.map((item) => (
                    <button
                      key={item.transcript_id}
                      type="button"
                      onClick={() => router.push(`/meeting-details?id=${response.meeting_id}`)}
                      className="block w-full px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-blue-600">
                          [{formatTime(item.audio_start_time, item.timestamp)}]
                        </span>
                        <span className="truncate text-xs text-gray-500">
                          {item.speaker || 'Unknown'}
                        </span>
                      </div>
                      <p className="line-clamp-4 text-sm leading-5 text-gray-700">{item.text}</p>
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
