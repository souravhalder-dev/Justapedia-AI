"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  deleteConversation,
  deleteMessage,
  listConversations,
  listMessages,
  renameConversation,
  streamChat,
  submitFeedback,
} from "@/lib/api";
import type {
  AnswerMode,
  ChatRequest,
  Conversation,
  Message,
  RelatedArticle,
  Source,
} from "@/lib/types";

// ─── Actions & Modes ──────────────────────────────────────────────────────────

const ARTICLE_ACTIONS = [
  { label: "Summarize", prompt: "Summarize this article with key findings and background.", action: "summarize" },
  { label: "Contributor Guide", prompt: "How can I improve or expand this article on Justapedia?", action: "contributor_guide" },
  { label: "Key Points", prompt: "Extract the core facts, dates, and significance of this article.", action: "key_points" },
  { label: "Citation & Sources", prompt: "Suggest reliable citation structures and bibliography for this topic.", action: "citations" },
];

const ANSWER_MODES: { value: AnswerMode; label: string; desc: string; icon: string }[] = [
  { value: "auto", label: "Auto Grounded", desc: "Justapedia search with adaptive, scope-matched AI answer", icon: "✨" },
  { value: "grounded", label: "Justapedia Only", desc: "Strict reference-based synthesis with citations", icon: "📚" },
  { value: "general", label: "Justapedia AI", desc: "Direct AI responses for editing, drafting, and open questions", icon: "💡" },
];

const LANG_OPTIONS = [
  { value: "auto", label: "Auto (Match Query)" },
  { value: "English", label: "English" },
  { value: "Bengali", label: "বাংলা (Bengali)" },
  { value: "Hindi", label: "हिन्दी (Hindi)" },
  { value: "Arabic", label: "العربية (Arabic)" },
  { value: "Spanish", label: "Español (Spanish)" },
  { value: "French", label: "Français (French)" },
  { value: "German", label: "Deutsch (German)" },
  { value: "Urdu", label: "اردو (Urdu)" },
];

const EXPLORE_QUESTION_POOL = [
  "What is the history and mission of Justapedia?",
  "Who was Albert Einstein and what did he discover?",
  "How does quantum computing work and what are its applications?",
  "What triggered the Renaissance in Europe?",
  "How do black holes form in space?",
  "What is the importance of the Rosetta Stone?",
  "How does photosynthesis convert light into chemical energy?",
  "Who was Isaac Newton and what are his laws of motion?",
  "What caused the fall of the Western Roman Empire?",
  "How does CRISPR gene editing technology function?",
  "What are the major biomes of Earth and how do they differ?",
  "Who was Alan Turing and why is he called the father of computing?",
  "What is the significance of the Magna Carta in legal history?",
  "How do vaccines train the human immune system?",
  "What is the theory of plate tectonics?",
  "Who was Ada Lovelace and what was her contribution to computing?",
  "What are the origins and significance of the Silk Road?",
  "How does the James Webb Space Telescope observe distant galaxies?",
];

const CONTRIBUTOR_ITEMS = [
  "How do I create and structure a new article on Justapedia?",
  "How do I add citations and references in wiki format?",
  "What are Justapedia's guidelines for Neutral Point of View (NPOV)?",
];

// ─── Browser Speech Recognition Types ─────────────────────────────────────────

type SpeechEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal?: boolean;
      [index: number]: { transcript: string };
    };
  };
};

type BrowserSR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserWin = Window & typeof globalThis & {
  SpeechRecognition?: new () => BrowserSR;
  webkitSpeechRecognition?: new () => BrowserSR;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function langToCode(lang: string) {
  const map: Record<string, string> = {
    English: "en-US",
    Bengali: "bn-BD",
    Hindi: "hi-IN",
    Arabic: "ar-SA",
    Spanish: "es-ES",
    French: "fr-FR",
    German: "de-DE",
    Urdu: "ur-PK",
  };
  return map[lang] ?? "en-US";
}

function cleanForSpeech(text: string) {
  return text.replace(/[#*`_\[\]()>~]/g, "").replace(/\n+/g, " ").trim();
}

function sortConvs(items: Conversation[]) {
  return [...items].sort((a, b) =>
    new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()
  );
}

function findLastUser(messages: Message[], beforeId: string) {
  const idx = messages.findIndex((m) => m.id === beforeId);
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]?.content ?? null;
  }
  return null;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const IconSparkles = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
  </svg>
);

const IconSend = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const IconMic = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${active ? "text-rose-500 animate-pulse" : ""}`}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const IconSpeaker = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 ${active ? "text-cyan-500" : ""}`}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const IconThumbUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
);

const IconThumbDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
    <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconMenu = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconChevron = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconBook = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
);

function TypingCursor() {
  return (
    <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-gradient-to-t from-cyan-400 to-blue-500 rounded-sm animate-[blink_0.9s_step-end_infinite]" />
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  conversations,
  activeId,
  onOpen,
  onNew,
  onRename,
  onDelete,
  onClose,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (c: Conversation) => void;
  onDelete: (c: Conversation) => void;
  onClose?: () => void;
}) {
  const groups = useMemo(() => {
    const today: Conversation[] = [];
    const week: Conversation[] = [];
    const older: Conversation[] = [];
    const now = Date.now();
    for (const c of conversations) {
      const ms = now - new Date(c.updated_at ?? c.created_at).getTime();
      if (ms < 86_400_000) today.push(c);
      else if (ms < 7 * 86_400_000) week.push(c);
      else older.push(c);
    }
    return [
      { label: "Today", items: today },
      { label: "Previous 7 Days", items: week },
      { label: "Older", items: older },
    ].filter((g) => g.items.length > 0);
  }, [conversations]);

  return (
    <div className="flex h-full flex-col bg-[#0b0f19] border-r border-slate-800/60 text-slate-200">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800/40">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 shadow-md shadow-cyan-500/20 text-white font-extrabold text-base">
            J
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0b0f19]" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-white block">Justapedia AI</span>
            <span className="text-[10px] text-cyan-400 font-medium tracking-wide">Knowledge & Editing Hub</span>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden transition"
          >
            <IconClose />
          </button>
        )}
      </div>

      {/* New chat button */}
      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 p-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]"
        >
          <IconPlus />
          <span>New Discussion</span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {conversations.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            <p>No conversations saved yet.</p>
            <p className="mt-1 text-[11px] text-slate-600">Start asking questions or draft an article!</p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  onOpen={onOpen}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Contributor Quicklinks */}
      <div className="border-t border-slate-800/60 p-3 bg-slate-900/40">
        <a
          href="https://justapedia.org"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition"
        >
          <IconBook />
          <span>Visit Justapedia Wiki</span>
        </a>
      </div>
    </div>
  );
}

function ConvItem({
  conv,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onOpen: (id: string) => void;
  onRename: (c: Conversation) => void;
  onDelete: (c: Conversation) => void;
}) {
  return (
    <div
      className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 transition-all ${
        active
          ? "bg-gradient-to-r from-blue-900/50 to-indigo-900/30 text-white font-medium border border-blue-500/30 shadow-sm"
          : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(conv.id)}
        className="min-w-0 flex-1 text-left mr-2"
      >
        <p className="truncate text-xs leading-5">{conv.title}</p>
        <p className="text-[10px] text-slate-500">{formatDate(conv.updated_at ?? conv.created_at)}</p>
      </button>

      {/* Always-accessible Action Buttons (visible on hover, or slightly faded normally) */}
      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename(conv);
          }}
          title="Rename discussion"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700/80 hover:text-white transition"
        >
          <IconEdit />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(conv);
          }}
          title="Delete conversation"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/30 hover:text-rose-300 transition"
        >
          <IconTrash />
        </button>
      </div>
    </div>
  );
}

// ─── Message Bubble Component ─────────────────────────────────────────────────

function MessageBubble({
  message,
  conversationId,
  isStreaming,
  onAction,
  onFeedback,
  onRegenerate,
  onSpeak,
  onStopSpeaking,
  isSpeaking,
  onSuggestedQuestion,
  onDeleteMessage,
}: {
  message: Message;
  conversationId: string | null;
  isStreaming: boolean;
  onAction: (source: Source, action: (typeof ARTICLE_ACTIONS)[number]) => void;
  onFeedback: (rating: "positive" | "negative") => void;
  onRegenerate: () => void;
  onSpeak: () => void;
  onStopSpeaking: () => void;
  isSpeaking: boolean;
  onSuggestedQuestion: (q: string) => void;
  onDeleteMessage: (msgId: string) => void;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isAI = message.role === "assistant";
  const isLive = isAI && message.status === "streaming" && isStreaming;
  const hasSources = isAI && message.sources.length > 0;
  const hasRelated = isAI && (message.related_articles?.length ?? 0) > 0;
  const hasSuggested = isAI && (message.suggested_questions?.length ?? 0) > 0;

  function handleCopy() {
    if (typeof navigator !== "undefined" && message.content) {
      navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className={`group flex gap-3.5 my-4 transition-all duration-300 animate-[fadeIn_0.3s_ease-out] ${isAI ? "justify-start" : "justify-end"}`}>
      {isAI && (
        <div className="relative mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 shadow-md shadow-blue-500/20 text-white font-extrabold text-sm">
          J
          {isLive && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
            </span>
          )}
        </div>
      )}

      <div className={`flex max-w-[88%] md:max-w-[80%] flex-col gap-2 ${isAI ? "" : "items-end"}`}>
        {/* Main Content Bubble */}
        <div
          className={`relative rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-sm transition-all ${
            isAI
              ? "bg-white/90 dark:bg-[#151926]/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800/80 backdrop-blur-md rounded-tl-sm shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
              : "bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 text-white rounded-tr-sm shadow-md shadow-blue-600/20"
          }`}
        >
          {isAI ? (
            <div className="prose prose-slate max-w-none text-[14px] leading-7 dark:prose-invert prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-white prose-p:my-2 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:bg-[#0b0e14] prose-pre:border prose-pre:border-slate-800 prose-pre:p-4 prose-code:rounded prose-code:bg-slate-100 dark:prose-code:bg-slate-800/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-cyan-600 dark:prose-code:text-cyan-400 prose-ul:my-2 prose-li:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || (isLive ? "" : "Thinking...")}
              </ReactMarkdown>
              {isLive && <TypingCursor />}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{message.content}</p>
          )}
        </div>

        {/* Action & Badge Row */}
        <div className="flex items-center justify-between w-full px-1">
          <div className="flex items-center gap-2">
            {isAI ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  hasSources
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20"
                }`}
              >
                {hasSources ? "📚 Justapedia Verified" : "💡 Justapedia AI"}
              </span>
            ) : null}
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
              {formatDate(message.created_at)}
            </span>
          </div>

          {/* Action Toolbar with Individual Message Delete */}
          <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
            {isAI && !isLive && (
              <>
                <ActionBtn title={copied ? "Copied!" : "Copy response"} onClick={handleCopy}>
                  <IconCopy />
                </ActionBtn>
                <ActionBtn title={isSpeaking ? "Stop speech" : "Read aloud"} onClick={isSpeaking ? onStopSpeaking : onSpeak}>
                  <IconSpeaker active={isSpeaking} />
                </ActionBtn>
                <ActionBtn title="Helpful" onClick={() => onFeedback("positive")}>
                  <IconThumbUp />
                </ActionBtn>
                <ActionBtn title="Needs Improvement" onClick={() => onFeedback("negative")}>
                  <IconThumbDown />
                </ActionBtn>
                <ActionBtn title="Regenerate answer" onClick={onRegenerate}>
                  <IconRefresh />
                </ActionBtn>
              </>
            )}
            {/* Delete this single question/answer */}
            <button
              type="button"
              onClick={() => onDeleteMessage(message.id)}
              title={isAI ? "Delete this response" : "Delete this question"}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-500 dark:hover:text-rose-400 transition"
            >
              <IconTrash />
            </button>
          </div>
        </div>

        {/* Source References Accordion */}
        {hasSources && (
          <div className="w-full rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-[#121622]/80 backdrop-blur overflow-hidden transition">
            <button
              type="button"
              onClick={() => setSourcesOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-cyan-500 transition"
            >
              <span className="flex items-center gap-2">
                <span>Retrieved Justapedia Articles ({message.sources.length})</span>
              </span>
              <span className={`transition-transform duration-200 ${sourcesOpen ? "rotate-180 text-cyan-400" : ""}`}>
                <IconChevron />
              </span>
            </button>
            {sourcesOpen && (
              <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 px-4 pb-4 pt-3">
                {message.sources.map((src) => (
                  <SourceCard key={src.id} source={src} onAction={onAction} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Related Wiki Articles */}
        {hasRelated && (
          <div className="w-full space-y-2 mt-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Related Justapedia Articles
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {message.related_articles!.map((art) => (
                <a
                  key={`${art.title}-${art.url}`}
                  href={art.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group/art rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/70 dark:bg-[#141824]/70 p-3 text-xs transition hover:border-cyan-500/50 hover:bg-cyan-500/5"
                >
                  <p className="font-semibold text-slate-800 dark:text-slate-200 group-hover/art:text-cyan-500 transition flex items-center gap-1.5">
                    <span>{art.title}</span>
                    <span className="opacity-0 group-hover/art:opacity-100 transition-opacity">↗</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-slate-500 dark:text-slate-400">{art.snippet}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Follow-ups */}
        {hasSuggested && (
          <div className="w-full space-y-2 mt-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Suggested Explorations
            </p>
            <div className="flex flex-wrap gap-2">
              {message.suggested_questions!.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSuggestedQuestion(q)}
                  className="rounded-full border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#161b29] px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-500 text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isAI && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200">
          U
        </div>
      )}
    </div>
  );
}

function ActionBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition"
    >
      {children}
    </button>
  );
}

function SourceCard({
  source,
  onAction,
}: {
  source: Source;
  onAction: (src: Source, action: (typeof ARTICLE_ACTIONS)[number]) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/80 bg-white/60 dark:bg-[#161a29]/60 p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline"
        >
          {source.title} ↗
        </a>
      </div>
      <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">{source.snippet}</p>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {ARTICLE_ACTIONS.map((action) => (
          <button
            key={action.action}
            type="button"
            onClick={() => onAction(source, action)}
            disabled={!source.page_id}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition hover:border-cyan-500 hover:text-cyan-500 disabled:opacity-40"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Welcome Dashboard ────────────────────────────────────────────────────────

function WelcomeScreen({ onPrompt }: { onPrompt: (q: string) => void }) {
  const [randomQuestions, setRandomQuestions] = useState<string[]>([]);

  const pickRandomQuestions = useCallback(() => {
    const shuffled = [...EXPLORE_QUESTION_POOL].sort(() => 0.5 - Math.random());
    setRandomQuestions(shuffled.slice(0, 3));
  }, []);

  useEffect(() => {
    pickRandomQuestions();
  }, [pickRandomQuestions]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center max-w-3xl mx-auto animate-[fadeIn_0.5s_ease-out]">
      <div className="relative mb-6">
        <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 opacity-30 blur-lg" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 text-white shadow-xl font-black text-2xl">
          J
        </div>
      </div>

      <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Justapedia AI Contributor & Knowledge Hub
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Ask anything in any language. Simple questions receive concise, direct answers, while complex topics receive thorough explanations. Assisting Justapedia readers and article contributors.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 w-full text-left">
        {/* Explore Knowledge with Randomize Feature */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-[#121624]/70 p-4 backdrop-blur shadow-sm space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            <div className="flex items-center gap-2">
              <span>🔍</span>
              <span>Explore Knowledge</span>
            </div>
            <button
              type="button"
              onClick={pickRandomQuestions}
              title="Shuffle random questions"
              className="flex items-center gap-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/40 transition active:scale-95"
            >
              <span>🎲</span>
              <span>Shuffle</span>
            </button>
          </div>
          <div className="space-y-1.5">
            {randomQuestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onPrompt(prompt)}
                className="w-full text-left rounded-xl p-2.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-500 transition-colors border border-transparent hover:border-cyan-500/20"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Contributor & Article Assistant */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-[#121624]/70 p-4 backdrop-blur shadow-sm space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            <span>✍️</span>
            <span>Contributor & Article Assistant</span>
          </div>
          <div className="space-y-1.5">
            {CONTRIBUTOR_ITEMS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onPrompt(prompt)}
                className="w-full text-left rounded-xl p-2.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-500 transition-colors border border-transparent hover:border-cyan-500/20"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ChatApp Orchestrator ────────────────────────────────────────────────

export function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("auto");
  const [lang, setLang] = useState("auto");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceIn, setVoiceIn] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const srRef = useRef<BrowserSR | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [activeId, conversations],
  );

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusText]);

  // Voice capabilities detection
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bw = window as BrowserWin;
    const hasSR = Boolean(bw.SpeechRecognition || bw.webkitSpeechRecognition);
    const hasSS = Boolean(window.speechSynthesis);
    setVoiceIn(hasSR);
    setVoiceOut(hasSS);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        srRef.current?.abort();
      } catch {
        // ignore
      }
      if (typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

  // Auto-resize input textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const refreshConvs = useCallback(async (preferred?: string | null) => {
    setIsLoading(true);
    setErrorText(null);
    try {
      const items = await listConversations();
      setConversations(sortConvs(items));
      const nextId = preferred ?? activeId ?? items[0]?.id ?? null;
      setActiveId(nextId);
      if (nextId) {
        const msgs = await listMessages(nextId);
        setMessages(msgs);
      } else {
        setMessages([]);
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Failed to load conversations.");
    } finally {
      setIsLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    void refreshConvs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openConv(id: string) {
    setActiveId(id);
    setErrorText(null);
    setSidebarOpen(false);
    try {
      const msgs = await listMessages(id);
      setMessages(msgs);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Failed to load messages.");
    }
  }

  function handleNewChat() {
    setActiveId(null);
    setMessages([]);
    setErrorText(null);
    setStatusText("");
    setDraft("");
    setSidebarOpen(false);
  }

  async function handleRename(conv: Conversation) {
    const title = window.prompt("Rename discussion title", conv.title);
    if (!title?.trim()) return;
    try {
      const updated = await renameConversation(conv.id, title.trim());
      setConversations((cs) => sortConvs(cs.map((c) => (c.id === updated.id ? updated : c))));
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Failed to rename conversation.");
    }
  }

  async function handleDelete(conv: Conversation) {
    if (!window.confirm(`Delete conversation "${conv.title}"?`)) return;
    try {
      await deleteConversation(conv.id);
      const rest = conversations.filter((c) => c.id !== conv.id);
      setConversations(rest);
      if (activeId === conv.id) {
        const nextId = rest[0]?.id ?? null;
        setActiveId(nextId);
        if (nextId) {
          const msgs = await listMessages(nextId);
          setMessages(msgs);
        } else {
          setMessages([]);
        }
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Failed to delete conversation.");
    }
  }

  async function handleDeleteMessage(msgId: string) {
    if (!activeId) {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      return;
    }

    if (!window.confirm("Delete this message from the history?")) return;

    try {
      await deleteMessage(activeId, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Failed to delete message.");
    }
  }

  async function handleSend(custom?: Partial<ChatRequest>) {
    const msg = (custom?.message ?? draft).trim();
    if (!msg || isStreaming) return;

    setErrorText(null);
    setIsStreaming(true);
    setStatusText("Processing query...");
    if (!custom?.message) setDraft("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const payload: ChatRequest = {
      conversation_id: custom?.conversation_id ?? activeId,
      message: msg,
      article_action: custom?.article_action ?? null,
      article_page_id: custom?.article_page_id ?? null,
      answer_mode: custom?.answer_mode ?? answerMode,
      response_language: custom?.response_language ?? (lang === "auto" ? null : lang),
    };

    try {
      await streamChat(payload, ctrl.signal, (event, data) => {
        if (event === "conversation") {
          const c = data as Conversation;
          setActiveId(c.id);
          setConversations((cs) => {
            const exists = cs.find((x) => x.id === c.id);
            return sortConvs(exists ? cs.map((x) => (x.id === c.id ? c : x)) : [c, ...cs]);
          });
        }
        if (event === "user_message") setMessages((ms) => [...ms, data as Message]);
        if (event === "assistant_message") setMessages((ms) => [...ms, data as Message]);
        if (event === "status") setStatusText((data as { message: string }).message);
        if (event === "chunk") {
          const { text } = data as { text: string };
          setMessages((ms) => {
            const next = [...ms];
            const last = next.at(-1);
            if (!last || last.role !== "assistant") return ms;
            next[next.length - 1] = { ...last, content: last.content + text };
            return next;
          });
        }
        if (event === "final") {
          const { conversation, message, related_articles, suggested_questions } = data as {
            conversation: Conversation;
            message: Message;
            related_articles: RelatedArticle[];
            suggested_questions: string[];
          };
          setStatusText("");
          setConversations((cs) => sortConvs(cs.map((c) => (c.id === conversation.id ? conversation : c))));
          setMessages((ms) => {
            const next = [...ms];
            const idx = next.findIndex((m) => m.id === message.id);
            const enriched = { ...message, related_articles, suggested_questions };
            if (idx >= 0) next[idx] = enriched;
            else next.push(enriched);
            return next;
          });
          if (autoSpeak) void speakMsg(message.content, message.id);
        }
        if (event === "error") {
          const { message: errMsg } = data as { message: string };
          setErrorText(errMsg);
          setStatusText("Could not complete the response.");
        }
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setErrorText(e instanceof Error ? e.message : "Streaming encountered an issue.");
      } else {
        setStatusText("Stopped.");
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStatusText("Stopped.");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ── Robust Microphone Handler ──
  async function toggleListening() {
    if (isListening) {
      try {
        srRef.current?.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      setStatusText("");
      return;
    }

    const bw = window as BrowserWin;
    const SR = bw.SpeechRecognition || bw.webkitSpeechRecognition;
    if (!SR) {
      setErrorText("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    // Explicitly prompt for mic permission if needed
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release stream immediately; SpeechRecognition will acquire it
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch (permErr) {
      setErrorText("Microphone permission was denied. Please allow microphone access in your browser settings.");
      return;
    }

    try {
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = langToCode(lang);

      recognition.onstart = () => {
        setIsListening(true);
        setErrorText(null);
        setStatusText("Listening... Speak now");
      };

      recognition.onresult = (e: SpeechEvent) => {
        let interim = "";
        let final = "";

        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const res = e.results[i];
          if (res?.isFinal) {
            final += res[0]?.transcript ?? "";
          } else {
            interim += res?.[0]?.transcript ?? "";
          }
        }

        const captured = final || interim;
        if (captured) {
          setDraft((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${captured.trim()}` : captured.trim();
          });
        }
      };

      recognition.onerror = (e) => {
        setIsListening(false);
        if (e.error === "no-speech") {
          setStatusText("No speech detected. Click the mic to try again.");
        } else if (e.error === "not-allowed") {
          setErrorText("Microphone permission was denied. Please check your browser's site permissions.");
        } else {
          setErrorText(`Voice input error: ${e.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setStatusText("");
        srRef.current = null;
      };

      srRef.current = recognition;
      recognition.start();
    } catch (err) {
      setIsListening(false);
      setErrorText(err instanceof Error ? err.message : "Failed to initialize microphone.");
    }
  }

  async function speakMsg(content: string, id: string) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(cleanForSpeech(content));
    utt.lang = langToCode(lang);
    utt.rate = 1;
    utt.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
    utt.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utt);
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }

  async function handleFeedback(message: Message, rating: "positive" | "negative") {
    try {
      let reason: string | null = null;
      if (rating === "negative") reason = window.prompt("Optional contributor feedback:");
      await submitFeedback({ message_id: message.id, rating, reason });
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : "Failed to record feedback.");
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc] text-slate-900 dark:bg-[#090d16] dark:text-slate-100">
      {/* ── Mobile Sidebar Overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Left Sidebar ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 shrink-0 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onOpen={openConv}
          onNew={handleNewChat}
          onRename={handleRename}
          onDelete={handleDelete}
          onClose={() => setSidebarOpen(false)}
        />
      </aside>

      {/* ── Main Canvas ── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Navbar */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/70 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0b0f19]/80 z-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition lg:hidden"
            >
              <IconMenu />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                  {activeConv?.title ?? "New Discussion"}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-cyan-400">
                  <IconSparkles />
                  Justapedia AI
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Adaptive answers & encyclopedic contributor assistant
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                showSettings
                  ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                  : "border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:border-slate-300"
              }`}
            >
              ⚙ Controls
            </button>
            <button
              type="button"
              onClick={handleNewChat}
              className="hidden sm:flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:from-blue-500 hover:to-cyan-500 transition active:scale-[0.98]"
            >
              <IconPlus />
              New
            </button>
          </div>
        </header>

        {/* Expandable Configuration Toolbar */}
        {showSettings && (
          <div className="shrink-0 border-b border-slate-200/80 bg-white/95 px-4 py-3.5 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0e1320]/95 animate-[slideDown_0.2s_ease-out]">
            <div className="mx-auto flex max-w-4xl flex-wrap items-end gap-5">
              {/* Answer Mode */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Response Strategy
                </label>
                <div className="flex gap-1.5">
                  {ANSWER_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      title={m.desc}
                      onClick={() => setAnswerMode(m.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        answerMode === m.value
                          ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                      }`}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language Selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Target Language
                </label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#151a29] px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-cyan-500"
                >
                  {LANG_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Speech Controls */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Voice Accessibility
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={toggleListening}
                    disabled={!voiceIn}
                    title={isListening ? "Stop microphone" : "Voice input"}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                      isListening
                        ? "border-rose-400 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 shadow-sm shadow-rose-500/20"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    <IconMic active={isListening} />
                    {isListening ? "Listening..." : "Dictate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAutoSpeak((s) => !s)}
                    disabled={!voiceOut}
                    title="Read responses aloud automatically"
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                      autoSpeak
                        ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    <IconSpeaker active={autoSpeak} />
                    {autoSpeak ? "Speech On" : "Speech Off"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Chat Stream */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-4 py-6">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 dark:border-slate-700 border-t-cyan-500" />
                <p className="text-xs text-slate-400">Loading Justapedia AI context...</p>
              </div>
            ) : messages.length === 0 ? (
              <WelcomeScreen onPrompt={(q) => handleSend({ message: q })} />
            ) : (
              <div className="space-y-4 pb-2">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    conversationId={activeId}
                    isStreaming={isStreaming}
                    onAction={(src, action) =>
                      handleSend({
                        conversation_id: activeId,
                        message: action.prompt,
                        article_action: action.action,
                        article_page_id: src.page_id ?? null,
                        answer_mode: "grounded",
                        response_language: lang === "auto" ? null : lang,
                      })
                    }
                    onFeedback={(r) => handleFeedback(m, r)}
                    onRegenerate={() =>
                      handleSend({
                        conversation_id: activeId,
                        message: findLastUser(messages, m.id) ?? "Please review and complete the answer.",
                        answer_mode: answerMode,
                        response_language: lang === "auto" ? null : lang,
                      })
                    }
                    onSpeak={() => speakMsg(m.content, m.id)}
                    onStopSpeaking={stopSpeaking}
                    isSpeaking={speakingId === m.id}
                    onSuggestedQuestion={(q) =>
                      handleSend({ conversation_id: activeId, message: q, answer_mode: "auto" })
                    }
                    onDeleteMessage={handleDeleteMessage}
                  />
                ))}

                {/* Progress / Status indicator */}
                {statusText && (
                  <div className="flex justify-center my-3 animate-[fadeIn_0.2s_ease-out]">
                    <div className="flex items-center gap-2.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#121624]/80 px-4 py-1.5 text-xs text-slate-600 dark:text-slate-300 shadow-sm backdrop-blur">
                      {isStreaming && (
                        <span className="flex gap-1">
                          <span className="h-1.5 w-1.5 animate-[bounce_1s_infinite_0ms] rounded-full bg-cyan-400" />
                          <span className="h-1.5 w-1.5 animate-[bounce_1s_infinite_150ms] rounded-full bg-blue-500" />
                          <span className="h-1.5 w-1.5 animate-[bounce_1s_infinite_300ms] rounded-full bg-indigo-500" />
                        </span>
                      )}
                      <span>{statusText}</span>
                    </div>
                  </div>
                )}

                {errorText && (
                  <div className="mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 p-3.5 text-xs text-rose-700 dark:text-rose-300">
                    <span className="text-base">⚠️</span>
                    <span>{errorText}</span>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        {/* Input Composer */}
        <div className="shrink-0 border-t border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0b0f19]/80">
          <form
            className="mx-auto max-w-4xl"
            onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
          >
            <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#121624]/95 p-3 shadow-md focus-within:border-cyan-500/80 focus-within:ring-2 focus-within:ring-cyan-500/20 transition">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask any question or request help editing a Justapedia article..."
                className="max-h-[220px] flex-1 resize-none bg-transparent text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 leading-relaxed"
                disabled={isStreaming && !draft}
              />
              <div className="flex shrink-0 items-center gap-1.5">
                {voiceIn && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    title={isListening ? "Stop voice capture" : "Speak question"}
                    className={`rounded-xl p-2 transition ${
                      isListening
                        ? "bg-rose-500/20 text-rose-500 ring-2 ring-rose-500/30"
                        : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                    }`}
                  >
                    <IconMic active={isListening} />
                  </button>
                )}
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    title="Stop generation"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-white shadow-sm hover:bg-rose-600 transition"
                  >
                    <IconStop />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    title="Send message"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-cyan-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                  >
                    <IconSend />
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Credits & Info Bar */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <span>Developer: <strong className="text-slate-700 dark:text-slate-300 font-semibold">Sourav Halder</strong></span>
                <span>•</span>
                <a
                  href="mailto:skhsouravhalder@gmail.com"
                  className="text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  skhsouravhalder@gmail.com
                </a>
              </div>
              <div className="text-slate-400 dark:text-slate-500">
                Justapedia AI · Knowledge & Contributor Assistant
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
