'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Download,
  FileText,
  Home,
  Loader2,
  MessageSquareText,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  SearchIcon,
  Settings,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { ChatSession } from '@/types';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useUpdateCheckContext } from '@/components/UpdateCheckProvider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';

const COLLAPSED_WIDTH = 0;
const DEFAULT_SIDEBAR_WIDTH = 286;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 440;
const TITLEBAR_CONTROL_OFFSET = 82;
const TITLEBAR_CONTROL_LIFT = -4;
const TITLEBAR_BUTTON_CLASS = 'flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900';
const TITLEBAR_FORWARD_BUTTON_CLASS = 'flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-700';

function relativeTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function SidebarSectionHeader({
  title,
  onSearch,
  onAction,
  actionTitle,
  actionIcon,
}: {
  title: string;
  onSearch: () => void;
  onAction: () => void;
  actionTitle: string;
  actionIcon: React.ReactNode;
}) {
  return (
    <div className="mb-1 mt-4 flex h-8 items-center justify-between px-3">
      <h2 className="text-[15px] font-medium text-gray-400">{title}</h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          title={`Search ${title.toLowerCase()}`}
        >
          <SearchIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onAction}
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          title={actionTitle}
        >
          {actionIcon}
        </button>
      </div>
    </div>
  );
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
  } = useSidebar();
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const {
    updateInfo,
    isDownloading: isUpdateDownloading,
    updateProgress,
    updateError,
    showUpdateDialog,
    installUpdate,
  } = useUpdateCheckContext();

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [meetingSearchOpen, setMeetingSearchOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [meetingSearchQuery, setMeetingSearchQuery] = useState('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
    const stored = Number(window.localStorage.getItem('orxa-sidebar-width'));
    if (!Number.isFinite(stored)) return DEFAULT_SIDEBAR_WIDTH;
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored));
  });
  const [isResizing, setIsResizing] = useState(false);
  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: '',
  });
  const [editingTitle, setEditingTitle] = useState('');
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const isFullScreenRoute = pathname?.startsWith('/settings');

  useEffect(() => {
    const syncActiveChat = () => {
      if (typeof window === 'undefined' || pathname !== '/chat') {
        setActiveChatId(null);
        return;
      }
      setActiveChatId(new URLSearchParams(window.location.search).get('id'));
    };

    syncActiveChat();
    window.addEventListener('popstate', syncActiveChat);
    window.addEventListener('orxa-chat-route-changed', syncActiveChat);
    return () => {
      window.removeEventListener('popstate', syncActiveChat);
      window.removeEventListener('orxa-chat-route-changed', syncActiveChat);
    };
  }, [pathname]);

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await invoke<ChatSession[]>('chat_list_sessions', { limit: 80 });
      setChatSessions(sessions);
    } catch (error) {
      console.error('Failed to load chats:', error);
      setChatSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadChatSessions();
    const handler = () => void loadChatSessions();
    window.addEventListener('orxa-chat-sessions-changed', handler);
    return () => window.removeEventListener('orxa-chat-sessions-changed', handler);
  }, [loadChatSessions]);

  useEffect(() => {
    if (globalSearchOpen) {
      globalSearchInputRef.current?.focus();
    }
  }, [globalSearchOpen]);

  useEffect(() => {
    const width = isCollapsed ? COLLAPSED_WIDTH : sidebarWidth;
    document.documentElement.style.setProperty('--orxa-sidebar-width', `${width}px`);
  }, [isCollapsed, sidebarWidth]);

  useEffect(() => {
    if (!isResizing || isCollapsed) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, event.clientX));
      setSidebarWidth(nextWidth);
      window.localStorage.setItem('orxa-sidebar-width', String(nextWidth));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isCollapsed, isResizing]);

  const filteredChats = useMemo(() => {
    const query = chatSearchQuery.trim().toLowerCase();
    if (!query) return chatSessions;
    return chatSessions.filter((session) => {
      return (
        session.title.toLowerCase().includes(query) ||
        session.last_message?.toLowerCase().includes(query) ||
        session.meeting_title?.toLowerCase().includes(query)
      );
    });
  }, [chatSearchQuery, chatSessions]);

  const globalSearchMatches = useMemo(() => {
    const query = globalSearchQuery.trim().toLowerCase();
    if (!query) {
      return { chats: [] as ChatSession[], meetings: [] as CurrentMeeting[] };
    }

    return {
      chats: chatSessions.filter((session) =>
        session.title.toLowerCase().includes(query) ||
        session.last_message?.toLowerCase().includes(query) ||
        session.meeting_title?.toLowerCase().includes(query)
      ),
      meetings: meetings.filter((meeting) => meeting.title.toLowerCase().includes(query)),
    };
  }, [chatSessions, globalSearchQuery, meetings]);

  const filteredMeetings = useMemo(() => {
    const query = meetingSearchQuery.trim().toLowerCase();
    if (!query) return meetings;
    return meetings.filter((meeting) => {
      return meeting.title.toLowerCase().includes(query);
    });
  }, [meetingSearchQuery, meetings]);

  const handleMeetingSearchChange = (value: string) => {
    setMeetingSearchQuery(value);
  };

  useEffect(() => {
    const query = globalSearchQuery.trim();
    if (!query) {
      void searchTranscripts('');
      return;
    }

    const timeout = window.setTimeout(() => {
      void searchTranscripts(query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [globalSearchQuery, searchTranscripts]);

  const handleDelete = async (itemId: string) => {
    try {
      await invoke('api_delete_meeting', { meetingId: itemId });
      const updatedMeetings = meetings.filter((meeting: CurrentMeeting) => meeting.id !== itemId);
      setMeetings(updatedMeetings);
      Analytics.trackMeetingDeleted(itemId);
      toast.success('Meeting deleted successfully');

      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error('Failed to delete meeting', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({ isOpen: true, meetingId, currentTitle });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;
    if (!meetingId) return;
    if (!newTitle) {
      toast.error('Meeting title cannot be empty');
      return;
    }

    try {
      await invoke('api_save_meeting_title', { meetingId, title: newTitle });
      const updatedMeetings = meetings.map((meeting: CurrentMeeting) =>
        meeting.id === meetingId ? { ...meeting, title: newTitle } : meeting
      );
      setMeetings(updatedMeetings);
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');
      toast.success('Meeting title updated successfully');
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error('Failed to update meeting title', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const openGlobalSearch = () => {
    setGlobalSearchOpen(true);
  };

  const closeGlobalSearch = () => {
    setGlobalSearchOpen(false);
    setGlobalSearchQuery('');
    void searchTranscripts('');
  };

  const openMeetingFromSearch = (meeting: CurrentMeeting) => {
    setCurrentMeeting({ id: meeting.id, title: meeting.title });
    closeGlobalSearch();
    router.push(`/meeting-details?id=${meeting.id}`);
  };

  const openChatFromSearch = (session: ChatSession) => {
    setActiveChatId(session.id);
    closeGlobalSearch();
    router.push(`/chat?id=${session.id}`);
  };

  const renderTitlebarControls = () => (
    <TooltipProvider>
      <div className="fixed left-0 top-0 z-50 h-10 w-[190px] bg-transparent">
        <div
          className="flex h-10 items-center gap-1 pr-3"
          style={{ paddingLeft: TITLEBAR_CONTROL_OFFSET, transform: `translateY(${TITLEBAR_CONTROL_LIFT}px)` }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={toggleCollapse} className={TITLEBAR_BUTTON_CLASS} aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => window.history.back()} className={TITLEBAR_BUTTON_CLASS} aria-label="Go back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Go back</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => window.history.forward()} className={TITLEBAR_FORWARD_BUTTON_CLASS} aria-label="Go forward">
                <ArrowRight className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Go forward</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );

  if (isFullScreenRoute || isCollapsed) {
    return renderTitlebarControls();
  }

  return (
    <div
      className="fixed left-0 top-0 z-40 h-screen bg-white"
      style={{ width: sidebarWidth }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-px bg-gray-200"
      />
      <div
        className={`relative flex h-screen flex-col bg-white ${isResizing ? '' : 'transition-[width] duration-200'}`}
        style={{ width: sidebarWidth }}
      >
        {!isCollapsed && (
          <button
            type="button"
            aria-label="Resize sidebar"
            className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize bg-transparent hover:bg-gray-200"
            onMouseDown={(event) => {
              event.preventDefault();
              setIsResizing(true);
            }}
          />
        )}

        <>
            <div
              className="flex h-10 shrink-0 items-center gap-1 pr-3"
              style={{ paddingLeft: TITLEBAR_CONTROL_OFFSET, transform: `translateY(${TITLEBAR_CONTROL_LIFT}px)` }}
            >
              <button
                type="button"
                onClick={toggleCollapse}
                className={TITLEBAR_BUTTON_CLASS}
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => window.history.back()}
                className={TITLEBAR_BUTTON_CLASS}
                aria-label="Go back"
                title="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => window.history.forward()}
                className={TITLEBAR_FORWARD_BUTTON_CLASS}
                aria-label="Go forward"
                title="Go forward"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 px-2">
              <button
                type="button"
                onClick={() => router.push('/')}
                className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[15px] text-gray-800 ${pathname === '/' ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
              >
                <Home className="h-4 w-4" />
                <span>Home</span>
              </button>
              <button
                type="button"
                onClick={() => router.push('/calendar')}
                className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[15px] text-gray-800 ${pathname === '/calendar' ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
              >
                <CalendarDays className="h-4 w-4" />
                <span>Calendar</span>
              </button>
              <button
                type="button"
                onClick={openGlobalSearch}
                className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[15px] text-gray-800 hover:bg-gray-100"
              >
                <SearchIcon className="h-4 w-4" />
                <span>Search</span>
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2">
              <SidebarSectionHeader
                title="Chats"
                onSearch={() => setChatSearchOpen((open) => !open)}
                onAction={() => {
                  setActiveChatId(null);
                  router.push('/chat');
                }}
                actionTitle="New chat"
                actionIcon={<Plus className="h-4 w-4" />}
              />
              {chatSearchOpen && (
                <div className="mb-2 px-1">
                  <InputGroup>
                    <InputGroupInput
                      placeholder="Search chats..."
                      value={chatSearchQuery}
                      onChange={(event) => setChatSearchQuery(event.target.value)}
                    />
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    {chatSearchQuery && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton onClick={() => setChatSearchQuery('')}>
                          <X />
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                </div>
              )}
              <div className="max-h-[34%] min-h-[120px] overflow-y-auto pr-1">
                {filteredChats.map((session) => {
                  const active = activeChatId === session.id;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => {
                        setActiveChatId(session.id);
                        router.push(`/chat?id=${session.id}`);
                      }}
                      className={`group flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[15px] ${active ? 'bg-gray-100 text-gray-950' : 'text-gray-800 hover:bg-gray-50'}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{session.title}</span>
                      <span className="shrink-0 text-sm text-gray-400">{relativeTime(session.updated_at)}</span>
                    </button>
                  );
                })}
              </div>

              <SidebarSectionHeader
                title="Meetings"
                onSearch={() => setMeetingSearchOpen((open) => !open)}
                onAction={handleRecordingToggle}
                actionTitle={isRecording ? 'Recording in progress' : 'Start meeting recording'}
                actionIcon={isRecording ? <Square className="h-4 w-4 text-red-500" /> : <Mic className="h-4 w-4" />}
              />
              {meetingSearchOpen && (
                <div className="mb-2 px-1">
                  <InputGroup>
                    <InputGroupInput
                      placeholder="Search meetings..."
                      value={meetingSearchQuery}
                      onChange={(event) => handleMeetingSearchChange(event.target.value)}
                    />
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    {meetingSearchQuery && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton onClick={() => handleMeetingSearchChange('')}>
                          <X />
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {filteredMeetings.map((meeting) => {
                  const active = pathname?.includes('/meeting-details') && currentMeeting?.id === meeting.id;
                  return (
                    <div key={meeting.id} className="group">
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentMeeting({ id: meeting.id, title: meeting.title });
                          router.push(`/meeting-details?id=${meeting.id}`);
                        }}
                        className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[15px] ${active ? 'bg-gray-100 text-gray-950' : 'text-gray-800 hover:bg-gray-50'}`}
                      >
                        <FileText className="h-4 w-4 shrink-0 text-gray-500" />
                        <span className="min-w-0 flex-1 truncate">{meeting.title}</span>
                        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleEditStart(meeting.id, meeting.title);
                            }}
                            className="rounded-md p-1 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteModalState({ isOpen: true, itemId: meeting.id });
                            }}
                            className="rounded-md p-1 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 border-t border-gray-100 p-2">
              {updateInfo?.available && (
                <UpdateSidebarNotice
                  version={updateInfo.version}
                  isDownloading={isUpdateDownloading}
                  progress={updateProgress?.percentage ?? 0}
                  error={updateError}
                  onClick={() => {
                    if (isUpdateDownloading || updateError) {
                      showUpdateDialog();
                    } else {
                      void installUpdate();
                    }
                  }}
                />
              )}
              <TooltipProvider>
                <div className="flex items-center justify-center gap-1">
                  {betaFeatures.importAndRetranscribe && (
                    <IconFooterButton title="Import audio" onClick={() => openImportDialog()}>
                      <Upload className="h-4 w-4" />
                    </IconFooterButton>
                  )}
                  <IconFooterButton title="Settings" active={pathname === '/settings'} onClick={() => router.push('/settings')}>
                    <Settings className="h-4 w-4" />
                  </IconFooterButton>
                </div>
              </TooltipProvider>
            </div>
        </>
      </div>

      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={() => {
          if (deleteModalState.itemId) {
            void handleDelete(deleteModalState.itemId);
          }
          setDeleteModalState({ isOpen: false, itemId: null });
        }}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      <Dialog open={globalSearchOpen} onOpenChange={(open) => {
        if (open) {
          setGlobalSearchOpen(true);
        } else {
          closeGlobalSearch();
        }
      }}>
        <DialogContent className="top-[40%] max-h-[78vh] overflow-hidden rounded-2xl border-gray-200 p-0 shadow-2xl sm:max-w-2xl">
          <VisuallyHidden>
            <DialogTitle>Search Orxa</DialogTitle>
          </VisuallyHidden>
          <div className="border-b border-gray-100 p-4">
            <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 shadow-sm">
              <SearchIcon className="h-5 w-5 shrink-0 text-gray-400" />
              <input
                ref={globalSearchInputRef}
                value={globalSearchQuery}
                onChange={(event) => setGlobalSearchQuery(event.target.value)}
                placeholder="Search chats, meetings, and transcripts"
                className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-gray-900 outline-none placeholder:text-gray-400"
              />
              {globalSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setGlobalSearchQuery('');
                    void searchTranscripts('');
                    globalSearchInputRef.current?.focus();
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[56vh] overflow-y-auto p-3">
            {!globalSearchQuery.trim() ? (
              <div className="px-2 py-10 text-center text-sm text-gray-400">
                Search across chats, meeting titles, and transcript text.
              </div>
            ) : (
              <div className="space-y-2">
                {globalSearchMatches.chats.slice(0, 6).map((session) => (
                  <button
                    key={`chat-${session.id}`}
                    type="button"
                    onClick={() => openChatFromSearch(session)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <MessageSquareText className="h-4 w-4 shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium text-gray-900">{session.title}</div>
                      {session.last_message && (
                        <div className="truncate text-sm text-gray-500">{session.last_message}</div>
                      )}
                    </div>
                    <span className="shrink-0 text-sm text-gray-400">{relativeTime(session.updated_at)}</span>
                  </button>
                ))}

                {globalSearchMatches.meetings.slice(0, 6).map((meeting) => (
                  <button
                    key={`meeting-${meeting.id}`}
                    type="button"
                    onClick={() => openMeetingFromSearch(meeting)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-900">{meeting.title}</div>
                  </button>
                ))}

                {searchResults.slice(0, 8).map((result: any) => (
                  <button
                    key={`transcript-${result.id}-${result.timestamp}`}
                    type="button"
                    onClick={() => openMeetingFromSearch({ id: result.id, title: result.title })}
                    className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <SearchIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium text-gray-900">{result.title}</div>
                        <div className="line-clamp-2 text-sm leading-5 text-gray-500">{result.matchContext}</div>
                      </div>
                    </div>
                  </button>
                ))}

                {!globalSearchMatches.chats.length && !globalSearchMatches.meetings.length && !searchResults.length && !isSearching && (
                  <div className="px-2 py-10 text-center text-sm text-gray-400">No matches</div>
                )}
                {isSearching && (
                  <div className="px-3 py-3 text-sm text-blue-500">Searching transcripts...</div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="mb-4 text-lg font-semibold">Edit Meeting Title</h3>
            <label htmlFor="meeting-title" className="mb-2 block text-sm font-medium text-gray-700">
              Meeting Title
            </label>
            <input
              id="meeting-title"
              type="text"
              value={editingTitle}
              onChange={(event) => setEditingTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleEditConfirm();
                } else if (event.key === 'Escape') {
                  handleEditCancel();
                }
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter meeting title"
              autoFocus
            />
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleEditConfirm()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function IconFooterButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 ${active ? 'bg-gray-100 text-gray-900' : ''}`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}

function UpdateSidebarNotice({
  version,
  isDownloading,
  progress,
  error,
  onClick,
}: {
  version?: string;
  isDownloading: boolean;
  progress: number;
  error: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-gray-800 shadow-sm transition-colors hover:bg-gray-50"
    >
      <span className="flex items-center gap-2">
        {isDownloading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-500" />
        ) : (
          <Download className="h-4 w-4 shrink-0 text-gray-500" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {error ? 'Update failed' : isDownloading ? 'Downloading update' : 'Update available'}
          </span>
          <span className="block truncate text-xs text-gray-500">
            {error ?? (isDownloading ? `${Math.round(progress)}% complete` : `Version ${version}`)}
          </span>
        </span>
      </span>
      {isDownloading && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-gray-100">
          <span
            className="block h-full rounded-full bg-gray-900 transition-[width] duration-200"
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </span>
      )}
    </button>
  );
}

export default Sidebar;
