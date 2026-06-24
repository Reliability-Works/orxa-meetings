"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatSession } from "@/types";

export function useChatSessions(pathname: string | null) {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    const syncActiveChat = () => {
      if (typeof window === "undefined" || pathname !== "/chat") {
        setActiveChatId(null);
        return;
      }

      setActiveChatId(new URLSearchParams(window.location.search).get("id"));
    };

    syncActiveChat();
    window.addEventListener("popstate", syncActiveChat);
    window.addEventListener("orxa-chat-route-changed", syncActiveChat);

    return () => {
      window.removeEventListener("popstate", syncActiveChat);
      window.removeEventListener("orxa-chat-route-changed", syncActiveChat);
    };
  }, [pathname]);

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await invoke<ChatSession[]>("chat_list_sessions", { limit: 80 });
      setChatSessions(sessions);
    } catch (error) {
      console.error("Failed to load chats:", error);
      setChatSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadChatSessions();

    const handler = () => void loadChatSessions();
    window.addEventListener("orxa-chat-sessions-changed", handler);

    return () => window.removeEventListener("orxa-chat-sessions-changed", handler);
  }, [loadChatSessions]);

  return {
    chatSessions,
    activeChatId,
    setActiveChatId,
  };
}
