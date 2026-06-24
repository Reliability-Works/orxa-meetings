"use client";

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranscriptSearchResult } from "../types";

export function useTranscriptSearch() {
  const [searchResults, setSearchResults] = useState<TranscriptSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchTranscripts = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);
      const results = await invoke<TranscriptSearchResult[]>("api_search_transcripts", { query });
      setSearchResults(results);
    } catch (error) {
      console.error("Error searching transcripts:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  return {
    searchResults,
    isSearching,
    searchTranscripts,
  };
}
