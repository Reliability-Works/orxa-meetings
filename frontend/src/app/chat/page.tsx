"use client";

import { FormEvent, RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { AlertCircle, ArrowUp, Bot, Loader2, Mic, Search, User } from "lucide-react";
import { ChatMessage, ChatSendResponse, ChatThread } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MeetingOption {
  id: string;
  title: string;
}

function formatTime(seconds?: number | null, fallback?: string) {
  if (typeof seconds !== "number") return fallback || "--:--";
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${isUser ? "bg-gray-900 text-white" : "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"}`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        {!isUser && message.warning && (
          <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{message.warning}</span>
          </div>
        )}
        {!isUser && message.evidence.length > 0 && (
          <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">
              {message.evidence.length} transcript moments
            </summary>
            <div className="mt-2 space-y-2">
              {message.evidence.slice(0, 6).map((item) => (
                <div
                  key={item.transcript_id}
                  className="rounded-md bg-white p-2 ring-1 ring-gray-100"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-blue-600">
                      [{formatTime(item.audio_start_time, item.timestamp)}]
                    </span>
                    <span className="truncate text-gray-500">{item.speaker || "Unknown"}</span>
                  </div>
                  <p className="line-clamp-3 leading-5 text-gray-700">{item.text}</p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
      {isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
        <Bot className="h-4 w-4" />
      </div>
      <div className="rounded-2xl bg-white px-4 py-3 text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Thinking
      </div>
    </div>
  );
}

function ChatConversation({
  isLoading,
  messages,
  isSending,
  messagesEndRef,
}: {
  isLoading: boolean;
  messages: ChatMessage[];
  isSending: boolean;
  messagesEndRef: RefObject<HTMLDivElement>;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading chat
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full">
          <h1 className="mb-8 text-center text-4xl font-normal tracking-normal text-gray-950">
            What should we work out from this meeting?
          </h1>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-5 pb-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isSending && <ThinkingBubble />}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatComposer({
  input,
  setInput,
  isSending,
  selectedMeeting,
  selectedMeetingId,
  setSelectedMeetingId,
  meetings,
  submit,
}: {
  input: string;
  setInput: (value: string) => void;
  isSending: boolean;
  selectedMeeting?: MeetingOption;
  selectedMeetingId: string;
  setSelectedMeetingId: (value: string) => void;
  meetings: MeetingOption[];
  submit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="shrink-0 bg-white px-6 pb-5 pt-3">
      <form onSubmit={submit} className="mx-auto max-w-4xl">
        <div className="rounded-[22px] border border-gray-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.08)]">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Do anything"
            className="min-h-[96px] w-full resize-none rounded-t-[22px] border-0 bg-transparent px-5 py-5 text-base text-gray-950 outline-none placeholder:text-gray-300"
          />

          <div className="flex items-center justify-between gap-3 px-4 pb-4">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-gray-500"
              >
                <Search className="h-5 w-5" />
              </Button>
              <Select
                value={selectedMeetingId || "none"}
                onValueChange={(value) => setSelectedMeetingId(value === "none" ? "" : value)}
              >
                <SelectTrigger className="h-9 max-w-[360px] rounded-full border border-gray-200 bg-white px-3 text-gray-700 shadow-none">
                  <Mic className="mr-2 h-4 w-4 text-gray-500" />
                  <SelectValue placeholder="Select meeting" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">No meeting selected</SelectItem>
                  {meetings.map((meeting) => (
                    <SelectItem key={meeting.id} value={meeting.id}>
                      {meeting.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-500">
              {selectedMeeting && (
                <span className="hidden max-w-[260px] truncate md:inline">
                  {selectedMeeting.title}
                </span>
              )}
              <Button
                type="submit"
                size="icon"
                disabled={isSending || input.trim().length < 2}
                className="h-10 w-10 rounded-full bg-gray-900 text-white hover:bg-black"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id");
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId),
    [meetings, selectedMeetingId],
  );

  useEffect(() => {
    const loadMeetings = async () => {
      try {
        const nextMeetings = await invoke<MeetingOption[]>("api_get_meetings", { authToken: null });
        setMeetings(nextMeetings);
        if (!sessionId && nextMeetings.length > 0) {
          setSelectedMeetingId(nextMeetings[0].id);
        }
      } catch (error) {
        console.error("Failed to load meetings:", error);
        toast.error("Could not load meetings");
      }
    };

    void loadMeetings();
  }, [sessionId]);

  useEffect(() => {
    const loadThread = async () => {
      if (!sessionId) {
        setMessages([]);
        return;
      }

      setIsLoading(true);
      try {
        const thread = await invoke<ChatThread>("chat_get_session", { sessionId });
        setMessages(thread.messages);
        setSelectedMeetingId(thread.session.meeting_id || "");
      } catch (error) {
        console.error("Failed to load chat:", error);
        toast.error("Could not load chat");
      } finally {
        setIsLoading(false);
      }
    };

    void loadThread();
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = input.trim();
    if (clean.length < 2) return;

    setInput("");
    setIsSending(true);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      session_id: sessionId || "pending",
      role: "user",
      content: clean,
      evidence: [],
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const response = await invoke<ChatSendResponse>("chat_send_message", {
        sessionId,
        meetingId: selectedMeetingId || null,
        message: clean,
      });

      setMessages((current) => [
        ...current.filter((message) => message.id !== optimistic.id),
        response.user_message,
        response.assistant_message,
      ]);
      window.dispatchEvent(new CustomEvent("orxa-chat-sessions-changed"));

      if (!sessionId) {
        router.replace(`/chat?id=${response.session.id}`);
        window.dispatchEvent(new CustomEvent("orxa-chat-route-changed"));
      }
    } catch (error) {
      console.error("Chat failed:", error);
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setInput(clean);
      toast.error("The chat agent could not answer", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-8">
          <ChatConversation
            isLoading={isLoading}
            messages={messages}
            isSending={isSending}
            messagesEndRef={messagesEndRef}
          />
        </div>
      </div>
      <ChatComposer
        input={input}
        setInput={setInput}
        isSending={isSending}
        selectedMeeting={selectedMeeting}
        selectedMeetingId={selectedMeetingId}
        setSelectedMeetingId={setSelectedMeetingId}
        meetings={meetings}
        submit={submit}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="h-full bg-white" />}>
      <ChatPageContent />
    </Suspense>
  );
}
