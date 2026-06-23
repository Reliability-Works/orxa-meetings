export interface Message {
  id: string;
  content: string;
  timestamp: string;
}

export interface Transcript {
  id: string;
  text: string;
  timestamp: string; // Wall-clock time (e.g., "14:30:05")
  speaker?: string | null;
  sequence_id?: number;
  chunk_start_time?: number; // Legacy field
  is_partial?: boolean;
  confidence?: number;
  // NEW: Recording-relative timestamps for playback sync
  audio_start_time?: number; // Seconds from recording start (e.g., 125.3)
  audio_end_time?: number;   // Seconds from recording start (e.g., 128.6)
  duration?: number;          // Segment duration in seconds (e.g., 3.3)
}

export interface TranscriptUpdate {
  text: string;
  timestamp: string; // Wall-clock time for reference
  source: string;
  speaker?: string | null;
  sequence_id: number;
  chunk_start_time: number; // Legacy field
  is_partial: boolean;
  confidence: number;
  // NEW: Recording-relative timestamps for playback sync
  audio_start_time: number; // Seconds from recording start
  audio_end_time: number;   // Seconds from recording start
  duration: number;          // Segment duration in seconds
}

export interface Block {
  id: string;
  type: string;
  content: string;
  color: string;
}

export interface Section {
  title: string;
  blocks: Block[];
}

export interface Summary {
  [key: string]: Section;
}

export interface ApiResponse {
  message: string;
  num_chunks: number;
  data: any[];
}

export interface SummaryResponse {
  status: string;
  summary: Summary;
  raw_summary?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// BlockNote-specific types
export type SummaryFormat = 'legacy' | 'markdown' | 'blocknote';

export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

export interface SummaryDataResponse {
  markdown?: string;
  summary_json?: BlockNoteBlock[];
  // Legacy format fields
  MeetingName?: string;
  _section_order?: string[];
  [key: string]: any; // For legacy section data
}

// Pagination types for optimized transcript loading
export interface MeetingMetadata {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_path?: string;
}

export interface PaginatedTranscriptsResponse {
  transcripts: Transcript[];
  total_count: number;
  has_more: boolean;
}

// Transcript segment data for virtualized display
export interface TranscriptSegmentData {
  id: string;
  timestamp: number; // audio_start_time in seconds
  endTime?: number; // audio_end_time in seconds
  text: string;
  speaker?: string | null;
  confidence?: number;
}

export type WorkItemKind = 'action' | 'decision' | 'risk' | 'question';
export type WorkItemStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'dismissed';
export type WorkRoleScope = 'engineering' | 'product' | 'sales_cs' | 'people' | 'leadership' | 'general';

export interface WorkItem {
  id: string;
  meeting_id: string;
  meeting_title?: string | null;
  kind: WorkItemKind;
  title: string;
  details?: string | null;
  owner?: string | null;
  due_date?: string | null;
  status: WorkItemStatus;
  role_scope?: WorkRoleScope | string | null;
  evidence?: string | null;
  agent_notes?: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface WorkContextPack {
  id: string;
  meeting_id: string;
  meeting_title?: string | null;
  work_item_id?: string | null;
  title: string;
  role_scope: WorkRoleScope | string;
  pack_markdown: string;
  source_kind: string;
  created_at: string;
  updated_at: string;
}

export interface WorkHubSyncResult {
  meeting_id: string;
  inserted_or_updated: number;
  item_count: number;
  items: WorkItem[];
}

export interface WorkHubOverview {
  open_actions: number;
  in_progress_actions: number;
  blocked_actions: number;
  recent_items: WorkItem[];
  stale_items: WorkItem[];
}

export interface WorkRoleOutput {
  meeting_id: string;
  role_scope: WorkRoleScope | string;
  markdown: string;
}

export interface WorkRecurringMemory {
  meeting_id: string;
  title_pattern: string;
  related_meetings: Array<{ id: string; title: string; created_at: string }>;
  markdown: string;
}

export interface WorkPreMeetingBrief {
  id: string;
  meeting_id?: string | null;
  title: string;
  starts_at?: string | null;
  attendee_hint?: string | null;
  brief_markdown: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface AskMeetilyEvidence {
  transcript_id: string;
  timestamp: string;
  audio_start_time?: number | null;
  speaker?: string | null;
  text: string;
  score: number;
}

export interface AskMeetilyResponse {
  meeting_id: string;
  meeting_title: string;
  question: string;
  answer: string;
  evidence: AskMeetilyEvidence[];
  generated: boolean;
  model?: string | null;
  warning?: string | null;
}
