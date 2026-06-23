"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Clipboard,
  FileStack,
  ListChecks,
  Loader2,
  RefreshCcw,
  ShieldQuestion,
  Sparkles,
} from 'lucide-react';
import {
  WorkContextPack,
  WorkHubSyncResult,
  WorkItem,
  WorkItemKind,
  WorkItemStatus,
  WorkPreMeetingBrief,
  WorkRecurringMemory,
  WorkRoleOutput,
  WorkRoleScope,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type WorkHubPanelView = 'captured' | 'context' | 'brief';

type WorkHubPanelProps = {
  meetingId: string;
  meetingTitle: string;
  view?: WorkHubPanelView;
  hideHeader?: boolean;
  compact?: boolean;
};

const KINDS: Array<{ value: WorkItemKind; label: string; icon: typeof ListChecks }> = [
  { value: 'action', label: 'Actions', icon: ListChecks },
  { value: 'decision', label: 'Decisions', icon: CheckCircle2 },
  { value: 'risk', label: 'Risks', icon: AlertTriangle },
  { value: 'question', label: 'Questions', icon: ShieldQuestion },
];

const STATUSES: WorkItemStatus[] = ['open', 'in_progress', 'blocked', 'done', 'dismissed'];
const ROLES: Array<{ value: WorkRoleScope; label: string }> = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'product', label: 'Product' },
  { value: 'sales_cs', label: 'Sales / CS' },
  { value: 'people', label: 'People' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'general', label: 'General' },
];

function statusLabel(status: WorkItemStatus | string) {
  return status.replace('_', ' ');
}

function statusClass(status: WorkItemStatus | string) {
  if (status === 'done') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'blocked') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'in_progress') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'dismissed') return 'bg-gray-100 text-gray-500 border-gray-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export function WorkHubPanel({
  meetingId,
  meetingTitle,
  view,
  hideHeader = false,
  compact = false,
}: WorkHubPanelProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [roleScope, setRoleScope] = useState<WorkRoleScope>('engineering');
  const [selectedItemId, setSelectedItemId] = useState<string>('meeting');
  const [markdown, setMarkdown] = useState('');
  const [briefTitle, setBriefTitle] = useState(meetingTitle);
  const [briefStartsAt, setBriefStartsAt] = useState('');
  const [briefAttendeeHint, setBriefAttendeeHint] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const grouped = useMemo(() => {
    return KINDS.reduce<Record<WorkItemKind, WorkItem[]>>((acc, kind) => {
      acc[kind.value] = items.filter((item) => item.kind === kind.value);
      return acc;
    }, { action: [], decision: [], risk: [], question: [] });
  }, [items]);

  const selectedItem = useMemo(() => {
    return selectedItemId === 'meeting'
      ? null
      : items.find((item) => item.id === selectedItemId) ?? null;
  }, [items, selectedItemId]);

  const sync = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await invoke<WorkHubSyncResult>('workhub_sync_meeting', { meetingId });
      setItems(result.items);
      if (result.item_count === 0) {
        toast.info('No Work Hub items found yet', {
          description: 'Generate or refresh a summary, then sync again.',
        });
      }
    } catch (error) {
      console.error('Failed to sync Work Hub:', error);
      toast.error('Could not sync Work Hub items');
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    setBriefTitle(meetingTitle);
  }, [meetingTitle]);

  useEffect(() => {
    void sync();
  }, [sync]);

  const updateStatus = async (item: WorkItem, status: WorkItemStatus) => {
    const previousItems = items;
    setItems((current) => current.map((candidate) => (
      candidate.id === item.id ? { ...candidate, status } : candidate
    )));
    try {
      const updated = await invoke<WorkItem>('workhub_update_item_status', {
        itemId: item.id,
        status,
        agentNotes: status === 'done' ? 'Marked done in Meetily Work Hub' : null,
      });
      setItems((current) => current.map((candidate) => (
        candidate.id === item.id ? updated : candidate
      )));
    } catch (error) {
      setItems(previousItems);
      console.error('Failed to update work item:', error);
      toast.error('Could not update item status');
    }
  };

  const generateContextPack = async () => {
    setIsGenerating(true);
    try {
      const pack = await invoke<WorkContextPack>('workhub_create_context_pack', {
        meetingId,
        workItemId: selectedItem?.id ?? null,
        roleScope,
      });
      setMarkdown(pack.pack_markdown);
      toast.success('Context pack generated');
    } catch (error) {
      console.error('Failed to create context pack:', error);
      toast.error('Could not generate context pack');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateRoleOutput = async () => {
    setIsGenerating(true);
    try {
      const output = await invoke<WorkRoleOutput>('workhub_get_role_output', {
        meetingId,
        roleScope,
      });
      setMarkdown(output.markdown);
    } catch (error) {
      console.error('Failed to create role output:', error);
      toast.error('Could not generate role output');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateRecurringMemory = async () => {
    setIsGenerating(true);
    try {
      const memory = await invoke<WorkRecurringMemory>('workhub_get_recurring_memory', { meetingId });
      setMarkdown(memory.markdown);
    } catch (error) {
      console.error('Failed to create recurring memory:', error);
      toast.error('Could not generate recurring memory');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateBrief = async () => {
    setIsGenerating(true);
    try {
      const brief = await invoke<WorkPreMeetingBrief>('workhub_create_pre_meeting_brief', {
        title: briefTitle || meetingTitle,
        startsAt: briefStartsAt || null,
        attendeeHint: briefAttendeeHint || null,
        relatedMeetingId: meetingId,
      });
      setMarkdown(brief.brief_markdown);
      toast.success('Pre-meeting brief generated');
    } catch (error) {
      console.error('Failed to create pre-meeting brief:', error);
      toast.error('Could not generate pre-meeting brief');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyMarkdown = async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    toast.success('Copied to clipboard');
  };

  const showCaptured = !view || view === 'captured';
  const showContext = !view || view === 'context';
  const showBrief = !view || view === 'brief';
  const showGeneratedMarkdown = !view || view === 'context' || view === 'brief';
  const contentSpacing = compact ? 'p-4 space-y-5' : 'p-5 space-y-6';
  const statsGrid = compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 xl:grid-cols-4 gap-3';
  const twoColumnGrid = compact ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 xl:grid-cols-2 gap-3';
  const actionGrid = compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 xl:grid-cols-4 gap-2';

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
      {!hideHeader && (
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Work Hub</h2>
            <p className="text-xs text-gray-500">Actions, agent context, decisions, risks, and pre-meeting memory.</p>
          </div>
          <Button variant="outline" size="sm" onClick={sync} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
            Sync
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className={contentSpacing}>
          {hideHeader && (
            <div className="flex items-center justify-end">
              <Button variant="outline" size="sm" onClick={sync} disabled={isLoading}>
                {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
                Sync
              </Button>
            </div>
          )}

          {showCaptured && (
            <>
              <div className={statsGrid}>
                {KINDS.map(({ value, label, icon: Icon }) => (
                  <div key={value} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Icon className="w-4 h-4" />
                      {label}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-gray-900">{grouped[value].length}</div>
                  </div>
                ))}
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">Captured Work</h3>
                  <span className="text-xs text-gray-500">{items.length} total</span>
                </div>

                {items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-gray-300 p-5 text-sm text-gray-500">
                    No work items yet. Sync after a summary exists, or regenerate the summary with action items.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {KINDS.map(({ value, label }) => (
                      <div key={value}>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</h4>
                        <div className="space-y-2">
                          {grouped[value].length === 0 ? (
                            <p className="text-xs text-gray-400">None captured.</p>
                          ) : grouped[value].map((item) => (
                            <div key={item.id} className="rounded-md border border-gray-200 bg-white p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900">{item.title}</p>
                                  <p className="mt-1 text-xs text-gray-500">
                                    Owner: {item.owner || 'Unknown'} · Due: {item.due_date || 'TBD'} · Source: {item.source}
                                  </p>
                                </div>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusClass(item.status)}`}>
                                  {statusLabel(item.status)}
                                </span>
                              </div>
                              {item.evidence && (
                                <p className="mt-2 text-xs text-gray-600 line-clamp-2">{item.evidence}</p>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {STATUSES.map((status) => (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() => updateStatus(item, status)}
                                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                                      item.status === status
                                        ? statusClass(status)
                                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                  >
                                    {statusLabel(status)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {showContext && (
            <section className="space-y-3 border-t border-gray-200 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Agent Context</h3>
                <p className="text-xs text-gray-500">Generate a clean handoff for Codex, Claude, or a role-specific staff workflow.</p>
              </div>

              <div className={twoColumnGrid}>
                <Select value={roleScope} onValueChange={(value) => setRoleScope(value as WorkRoleScope)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Role lens" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Target item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">Whole meeting</SelectItem>
                    {items.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className={actionGrid}>
                <Button variant="outline" size="sm" onClick={generateContextPack} disabled={isGenerating}>
                  <FileStack />
                  Context
                </Button>
                <Button variant="outline" size="sm" onClick={generateRoleOutput} disabled={isGenerating}>
                  <BriefcaseBusiness />
                  Role Output
                </Button>
                <Button variant="outline" size="sm" onClick={generateRecurringMemory} disabled={isGenerating}>
                  <Sparkles />
                  Memory
                </Button>
                <Button variant="outline" size="sm" onClick={copyMarkdown} disabled={!markdown}>
                  <Clipboard />
                  Copy
                </Button>
              </div>
            </section>
          )}

          {showBrief && (
            <section className="space-y-3 border-t border-gray-200 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Pre-Meeting Brief</h3>
                <p className="text-xs text-gray-500">Use this meeting as the local history anchor for the next one.</p>
              </div>
              <div className={twoColumnGrid}>
                <Input value={briefTitle} onChange={(event) => setBriefTitle(event.target.value)} placeholder="Next meeting title" />
                <Input value={briefStartsAt} onChange={(event) => setBriefStartsAt(event.target.value)} placeholder="Starts at, e.g. 2026-06-23 10:00" />
              </div>
              <Input value={briefAttendeeHint} onChange={(event) => setBriefAttendeeHint(event.target.value)} placeholder="Attendees or objective" />
              <Button variant="outline" size="sm" onClick={generateBrief} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Generate Brief
              </Button>
            </section>
          )}

          {showGeneratedMarkdown && (
            <section className="space-y-3 border-t border-gray-200 pt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900">Generated Markdown</h3>
                {isGenerating && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </div>
              <Textarea
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                placeholder="Generated context packs, role outputs, recurring memory, and briefs appear here."
                className="min-h-[260px] font-mono text-xs"
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
