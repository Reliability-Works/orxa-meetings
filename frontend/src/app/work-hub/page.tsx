"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Inbox,
  Loader2,
  RefreshCcw,
  ShieldQuestion,
} from 'lucide-react';
import { WorkHubOverview, WorkItem, WorkItemKind, WorkItemStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = 'all';
const KINDS: Array<{ value: WorkItemKind | typeof ALL; label: string }> = [
  { value: ALL, label: 'All work' },
  { value: 'action', label: 'Actions' },
  { value: 'decision', label: 'Decisions' },
  { value: 'risk', label: 'Risks' },
  { value: 'question', label: 'Questions' },
];

const STATUSES: Array<{ value: WorkItemStatus | typeof ALL; label: string }> = [
  { value: ALL, label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'dismissed', label: 'Dismissed' },
];

function kindIcon(kind: WorkItemKind) {
  if (kind === 'decision') return CheckCircle2;
  if (kind === 'risk') return AlertTriangle;
  if (kind === 'question') return ShieldQuestion;
  return Circle;
}

function statusClass(status: WorkItemStatus | string) {
  if (status === 'done') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'blocked') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'in_progress') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'dismissed') return 'bg-gray-100 text-gray-500 border-gray-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function statusLabel(status: string) {
  return status.replace('_', ' ');
}

export default function WorkHubPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<WorkHubOverview | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [kind, setKind] = useState<WorkItemKind | typeof ALL>(ALL);
  const [status, setStatus] = useState<WorkItemStatus | typeof ALL>('open');
  const [isLoading, setIsLoading] = useState(false);

  const filteredLabel = useMemo(() => {
    const kindLabel = KINDS.find((item) => item.value === kind)?.label ?? 'All work';
    const statusLabelValue = STATUSES.find((item) => item.value === status)?.label ?? 'All statuses';
    return `${kindLabel} · ${statusLabelValue}`;
  }, [kind, status]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nextOverview, nextItems] = await Promise.all([
        invoke<WorkHubOverview>('workhub_get_overview'),
        invoke<WorkItem[]>('workhub_list_items', {
          kind: kind === ALL ? null : kind,
          status: status === ALL ? null : status,
          meetingId: null,
          limit: 200,
        }),
      ]);
      setOverview(nextOverview);
      setItems(nextItems);
    } catch (error) {
      console.error('Failed to load Work Hub:', error);
      toast.error('Could not load Work Hub');
    } finally {
      setIsLoading(false);
    }
  }, [kind, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (item: WorkItem, nextStatus: WorkItemStatus) => {
    const previous = items;
    setItems((current) => current.map((candidate) => (
      candidate.id === item.id ? { ...candidate, status: nextStatus } : candidate
    )));
    try {
      const updated = await invoke<WorkItem>('workhub_update_item_status', {
        itemId: item.id,
        status: nextStatus,
        agentNotes: nextStatus === 'done' ? 'Completed from Work Hub inbox' : null,
      });
      setItems((current) => current.map((candidate) => (
        candidate.id === item.id ? updated : candidate
      )));
      await load();
    } catch (error) {
      setItems(previous);
      console.error('Failed to update Work Hub item:', error);
      toast.error('Could not update status');
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <Inbox className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Work Hub</h1>
                <p className="text-sm text-gray-500">{filteredLabel}</p>
              </div>
            </div>
            <Button variant="outline" onClick={load} disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">Open actions</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{overview?.open_actions ?? 0}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">In progress</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{overview?.in_progress_actions ?? 0}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">Blocked</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{overview?.blocked_actions ?? 0}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={kind} onValueChange={(value) => setKind(value as WorkItemKind | typeof ALL)}>
              <SelectTrigger className="sm:w-56 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={(value) => setStatus(value as WorkItemStatus | typeof ALL)}>
              <SelectTrigger className="sm:w-56 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
            <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">Inbox</h2>
              <span className="text-xs text-gray-500">{items.length} items</span>
            </div>

            {items.length === 0 ? (
              <div className="p-8 text-sm text-gray-500">
                No Work Hub items match these filters yet. Open a meeting, sync its Work Hub tab, then come back here.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {items.map((item) => {
                  const Icon = kindIcon(item.kind);
                  return (
                    <div key={item.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-gray-500" />
                            <p className="text-sm font-medium text-gray-900">{item.title}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => router.push(`/meeting-details?id=${item.meeting_id}`)}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                          >
                            {item.meeting_title || item.meeting_id}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          {item.evidence && (
                            <p className="mt-2 text-sm text-gray-600 line-clamp-2">{item.evidence}</p>
                          )}
                          <p className="mt-2 text-xs text-gray-500">
                            Owner: {item.owner || 'Unknown'} · Due: {item.due_date || 'TBD'} · Source: {item.source}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                          <Select value={item.status} onValueChange={(value) => updateStatus(item, value as WorkItemStatus)}>
                            <SelectTrigger className="w-36 h-8 bg-white text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUSES.filter((option) => option.value !== ALL).map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
