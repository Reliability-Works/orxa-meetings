"use client";

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Database,
  FileClock,
  FolderSearch,
  Loader2,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type AgentSourceConfig = {
  id: string;
  label: string;
  enabled: boolean;
  paths: string[];
  indexFullContent: boolean;
  discovered: boolean;
};

type AgentSourceSearchResult = {
  id: string;
  sourceId: string;
  sourceLabel: string;
  title: string;
  path: string;
  projectPath?: string | null;
  sessionDate?: string | null;
  modifiedAt: string;
  snippet: string;
  score: number;
};

type AgentSourceReindexResult = {
  scannedFiles: number;
  indexedDocuments: number;
  skippedFiles: number;
  sources: number;
};

function formatDate(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function sourcePathText(source: AgentSourceConfig) {
  return source.paths.join("\n");
}

function AgentSourcesLoading() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-gray-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading agent sources
    </div>
  );
}

function AgentSourcesHeader({ isSaving, isScanning, enabledCount, onSave, onReindex }: any) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-gray-950">
          <FolderSearch className="h-4 w-4" />
          Local agent history
        </div>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Index Codex, Claude, Cursor, and memory folders so chat can recall prior work.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving || isScanning}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
        <Button size="sm" onClick={onReindex} disabled={isScanning || enabledCount === 0}>
          {isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Reindex
        </Button>
      </div>
    </div>
  );
}

function AgentSourceRow({ source, index, updateSource }: any) {
  return (
    <div
      className={`grid gap-3 px-4 py-3 lg:grid-cols-[minmax(180px,240px)_1fr_auto] ${
        index > 0 ? "border-t border-gray-100" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <Switch
          checked={source.enabled}
          onCheckedChange={(enabled) => updateSource(source.id, { enabled })}
          className="mt-1"
        />
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-gray-950">{source.label}</div>
          <div className="mt-0.5 text-[12px] text-gray-500">
            {source.discovered ? "Default path found" : "Path not found yet"}
          </div>
        </div>
      </div>
      <Textarea
        value={sourcePathText(source)}
        onChange={(event) =>
          updateSource(source.id, {
            paths: event.target.value
              .split("\n")
              .map((path) => path.trim())
              .filter(Boolean),
          })
        }
        placeholder="One folder or file path per line"
        className="min-h-16 resize-y text-[12px] leading-5"
      />
      <label className="flex items-center gap-2 self-start pt-1 text-[12px] text-gray-500">
        <Switch
          checked={source.indexFullContent}
          onCheckedChange={(indexFullContent) => updateSource(source.id, { indexFullContent })}
        />
        Full content
      </label>
    </div>
  );
}

function AgentSearchPanel({ query, setQuery, searchSources, isSearching, results, lastScan }: any) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Search className="h-4 w-4 text-gray-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void searchSources();
          }}
          placeholder="Search prior agent work..."
          className="h-8 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
        />
        <Button size="sm" onClick={searchSources} disabled={isSearching}>
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {results.length === 0 ? (
          <div className="px-4 py-10 text-sm text-gray-500">
            {lastScan
              ? "Search results will appear here."
              : "Reindex enabled sources first, then search across prior agent sessions."}
          </div>
        ) : (
          results.map((result: AgentSourceSearchResult, index: number) => (
            <AgentSearchResult key={result.id} result={result} index={index} />
          ))
        )}
      </div>
    </div>
  );
}

function AgentSearchResult({ result, index }: any) {
  return (
    <div className={`px-4 py-3 ${index > 0 ? "border-t border-gray-100" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              {result.sourceLabel}
            </span>
            <span className="text-[12px] text-gray-400">
              {formatDate(result.sessionDate || result.modifiedAt)}
            </span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-gray-950">{result.title}</div>
          <div className="mt-1 line-clamp-3 text-[13px] leading-5 text-gray-600">
            {result.snippet}
          </div>
          <div className="mt-1 truncate text-[11px] text-gray-400">
            {result.projectPath || result.path}
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-gray-400">score {result.score}</div>
      </div>
    </div>
  );
}

function AgentSidePanel({
  activityDate,
  setActivityDate,
  loadActivity,
  isSearching,
  enabledCount,
  lastScan,
}: any) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-gray-950">
          <FileClock className="h-4 w-4" />
          Activity by day
        </div>
        <input
          type="date"
          value={activityDate}
          onChange={(event) => setActivityDate(event.target.value)}
          className="mt-3 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm"
        />
        <Button
          className="mt-3 w-full"
          variant="outline"
          size="sm"
          onClick={loadActivity}
          disabled={isSearching}
        >
          Show day
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-gray-950">
          <Database className="h-4 w-4" />
          Index status
        </div>
        <div className="mt-3 space-y-1 text-[13px] text-gray-500">
          <div>{enabledCount} enabled sources</div>
          {lastScan ? (
            <>
              <div>{lastScan.indexedDocuments} indexed documents</div>
              <div>{lastScan.skippedFiles} skipped files</div>
            </>
          ) : (
            <div>No scan run this session</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentSourcesPrivacyNote() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
      <p>
        Agent history stays local in Orxa’s SQLite database. This indexes paths you enable here; it
        does not connect to Jira, Linear, GitHub, Slack, or any external task manager.
      </p>
    </div>
  );
}

export function AgentSourcesSettings() {
  const [sources, setSources] = useState<AgentSourceConfig[]>([]);
  const [query, setQuery] = useState("");
  const [activityDate, setActivityDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [results, setResults] = useState<AgentSourceSearchResult[]>([]);
  const [lastScan, setLastScan] = useState<AgentSourceReindexResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const enabledCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources]);

  const loadSources = async () => {
    setIsLoading(true);
    try {
      const next = await invoke<AgentSourceConfig[]>("agent_sources_get_config");
      setSources(next);
    } catch (error) {
      console.error("Failed to load agent sources:", error);
      toast.error("Could not load agent sources");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSources();
  }, []);

  const updateSource = (id: string, patch: Partial<AgentSourceConfig>) => {
    setSources((current) =>
      current.map((source) => (source.id === id ? { ...source, ...patch } : source)),
    );
  };

  const saveSources = async () => {
    setIsSaving(true);
    try {
      const saved = await invoke<AgentSourceConfig[]>("agent_sources_save_config", { sources });
      setSources(saved);
      toast.success("Agent sources saved");
    } catch (error) {
      console.error("Failed to save agent sources:", error);
      toast.error("Could not save agent sources");
    } finally {
      setIsSaving(false);
    }
  };

  const reindex = async () => {
    setIsScanning(true);
    try {
      await invoke("agent_sources_save_config", { sources });
      const scan = await invoke<AgentSourceReindexResult>("agent_sources_reindex");
      setLastScan(scan);
      toast.success("Agent history indexed", {
        description: `${scan.indexedDocuments} documents from ${scan.scannedFiles} files`,
      });
    } catch (error) {
      console.error("Failed to index agent sources:", error);
      toast.error("Could not index agent sources");
    } finally {
      setIsScanning(false);
    }
  };

  const searchSources = async () => {
    setIsSearching(true);
    try {
      const hits = await invoke<AgentSourceSearchResult[]>("agent_sources_search", {
        query: query.trim(),
        sourceIds: null,
        limit: 30,
      });
      setResults(hits);
    } catch (error) {
      console.error("Failed to search agent sources:", error);
      toast.error("Could not search agent sources");
    } finally {
      setIsSearching(false);
    }
  };

  const loadActivity = async () => {
    setIsSearching(true);
    try {
      const hits = await invoke<AgentSourceSearchResult[]>("agent_sources_activity_on", {
        day: activityDate,
        sourceIds: null,
        limit: 50,
      });
      setResults(hits);
    } catch (error) {
      console.error("Failed to load agent activity:", error);
      toast.error("Could not load agent activity");
    } finally {
      setIsSearching(false);
    }
  };

  if (isLoading) {
    return <AgentSourcesLoading />;
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <AgentSourcesHeader
          isSaving={isSaving}
          isScanning={isScanning}
          enabledCount={enabledCount}
          onSave={saveSources}
          onReindex={reindex}
        />

        {sources.map((source, index) => (
          <AgentSourceRow
            key={source.id}
            source={source}
            index={index}
            updateSource={updateSource}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <AgentSearchPanel
          query={query}
          setQuery={setQuery}
          searchSources={searchSources}
          isSearching={isSearching}
          results={results}
          lastScan={lastScan}
        />
        <AgentSidePanel
          activityDate={activityDate}
          setActivityDate={setActivityDate}
          loadActivity={loadActivity}
          isSearching={isSearching}
          enabledCount={enabledCount}
          lastScan={lastScan}
        />
      </div>
      <AgentSourcesPrivacyNote />
    </div>
  );
}
