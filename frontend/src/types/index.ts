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
  audio_end_time?: number; // Seconds from recording start (e.g., 128.6)
  duration?: number; // Segment duration in seconds (e.g., 3.3)
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
  audio_end_time: number; // Seconds from recording start
  duration: number; // Segment duration in seconds
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
export type SummaryFormat = "legacy" | "markdown" | "blocknote";

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

export interface AskOrxaEvidence {
  transcript_id: string;
  timestamp: string;
  audio_start_time?: number | null;
  speaker?: string | null;
  text: string;
  score: number;
}

export interface AskOrxaResponse {
  meeting_id: string;
  meeting_title: string;
  question: string;
  answer: string;
  evidence: AskOrxaEvidence[];
  generated: boolean;
  model?: string | null;
  warning?: string | null;
}

export interface ChatSession {
  id: string;
  title: string;
  meeting_id?: string | null;
  meeting_title?: string | null;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  evidence: AskOrxaEvidence[];
  model?: string | null;
  warning?: string | null;
  created_at: string;
}

export interface ChatThread {
  session: ChatSession;
  messages: ChatMessage[];
}

export interface ChatSendResponse {
  session: ChatSession;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}
