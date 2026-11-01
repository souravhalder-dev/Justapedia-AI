"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AuthLogin } from "./auth-login";
import { MarkdownContent } from "./markdown-content";
import {
  deleteConversation,
  deleteMessage,
  getMe,
  listConversations,
  listMessages,
  logout,
  renameConversation,
  streamChat,
  submitFeedback,
} from "@/lib/api";
import type {
  AnswerMode,
  AuthUser,
  ChatRequest,
  Conversation,
  Message,
} from "@/lib/types";

// ─── Modes & Configuration ───────────────────────────────────────────────────

const ANSWER_MODES: { value: AnswerMode; label: string; desc: string; icon: string }[] = [
  { value: "auto", label: "Auto Grounded", desc: "Justapedia search with adaptive, scope-matched AI answer", icon: "✨" },
  { value: "grounded", label: "Justapedia Only", desc: "Strict Justapedia encyclopedia reference synthesis", icon: "📚" },
  { value: "general", label: "Justapedia AI", desc: "Direct AI answers for editing, drafting, and open topics", icon: "💡" },
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

const IconJustapedia = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
    />
    <circle cx="12" cy="10" r="2" fill="currentColor" stroke="none" />
  </svg>
);

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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${active ? "animate-pulse text-rose-500" : ""}`}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const IconSpeaker = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${active ? "text-cyan-400" : ""}`}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const IconThumbUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
);

const IconThumbDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
  </svg>
);

const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// ─── Sub-Components ───────────────────────────────────────────────────────────

function TypingCursor() {
  return (
    <span className="inline-block h-4 w-1.5 translate-y-0.5 rounded bg-cyan-400 animate-[blink_0.8s_infinite] ml-1" />
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

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isStreaming,
  onFeedback,
  onRegenerate,
  onSpeak,
  onStopSpeaking,
  isSpeaking,
  onSuggestedQuestion,
  onDeleteMessage,
  userName = "User",
}: {
  message: Message;
  conversationId: string | null;
  isStreaming: boolean;
  onFeedback: (rating: "positive" | "negative") => void;
  onRegenerate: () => void;
  onSpeak: () => void;
  onStopSpeaking: () => void;
  isSpeaking: boolean;
  onSuggestedQuestion: (q: string) => void;
  onDeleteMessage: (msgId: string) => void;
  userName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const isAI = message.role === "assistant";
  const isLive = isAI && message.status === "streaming" && isStreaming;
  const hasSuggested = isAI && (message.suggested_questions?.length ?? 0) > 0;

  function handleCopy() {
    if (typeof navigator !== "undefined" && message.content) {
      navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className={`group flex gap-3.5 my-5 transition-all duration-300 animate-[fadeIn_0.3s_ease-out] ${
        isAI ? "justify-start" : "justify-end"
      }`}
    >
      {/* AI Avatar */}
      {isAI && (
        <div className="relative mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 shadow-md shadow-blue-500/20 text-white font-black text-sm">
          <IconJustapedia className="h-5 w-5 text-white" />
          {isLive && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
            </span>
          )}
        </div>
      )}

      <div className={`flex max-w-[90%] md:max-w-[82%] flex-col gap-2 ${isAI ? "" : "items-end"}`}>
        {/* Main Content Bubble */}
        <div
          className={`relative rounded-3xl px-5 py-4 text-sm leading-relaxed shadow-sm transition-all ${
            isAI
              ? "bg-white/90 dark:bg-[#131722]/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800/80 backdrop-blur-md rounded-tl-sm shadow-[0_4px_24px_rgba(0,0,0,0.04)]"
              : "bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 text-white rounded-tr-sm shadow-md shadow-blue-600/20"
          }`}
        >
          {isAI ? (
            <div>
              <MarkdownContent content={message.content || (isLive ? "" : "Synthesizing Justapedia knowledge...")} />
              {isLive && <TypingCursor />}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{message.content}</p>
          )}
        </div>

        {/* Action & Badge Row (Clean - No Sources Accordion) */}
        <div className="flex items-center justify-between w-full px-1">
          <div className="flex items-center gap-2">
            {isAI ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                <IconSparkles />
                <span>Justapedia AI</span>
              </span>
            ) : null}
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
              {formatDate(message.created_at)}
            </span>
          </div>

          {/* Action Toolbar */}
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
            {/* Delete single message */}
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

        {/* Suggested Follow-ups */}
        {hasSuggested && (
          <div className="w-full space-y-2 mt-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Suggested Explorations
            </p>
            <div className="flex flex-wrap gap-2">
              {message.suggested_questions!.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSuggestedQuestion(q)}
                  className="rounded-full border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#151926] px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 transition hover:border-cyan-500/50 hover:bg-cyan-500/10 hover:text-cyan-500 text-left shadow-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Avatar */}
      {!isAI && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 text-xs font-extrabold text-slate-800 dark:text-slate-100 shadow-sm">
          {userName.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

// ─── Welcome Dashboard ────────────────────────────────────────────────────────

function WelcomeScreen({
  userName,
  onPrompt,
}: {
  userName: string;
  onPrompt: (q: string) => void;
}) {
  const [randomQuestions, setRandomQuestions] = useState<string[]>([]);

  const pickRandomQuestions = useCallback(() => {
    const shuffled = [...EXPLORE_QUESTION_POOL].sort(() => 0.5 - Math.random());
    setRandomQuestions(shuffled.slice(0, 3));
  }, []);

  useEffect(() => {
    pickRandomQuestions();
  }, [pickRandomQuestions]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center max-w-3xl mx-auto animate-[fadeIn_0.5s_ease-out]">
      {/* Animated Glowing Emblem */}
      <div className="relative mb-6">
        <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 opacity-40 blur-xl animate-pulse-glow" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-tr from-[#0f172a] via-[#1e293b] to-[#0f172a] border border-cyan-500/40 text-cyan-400 shadow-2xl">
          <IconJustapedia className="h-10 w-10 text-cyan-400" />
        </div>
      </div>

      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-400 mb-3">
        <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
        <span>Welcome back, {userName}</span>
      </div>

      <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
        Justapedia AI
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Your intelligent knowledge and contributor assistant. Ask questions in any language, research encyclopedic topics, or collaborate on improving Justapedia articles.
      </p>

      {/* Suggested Exploration Grid */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 w-full text-left">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-[#121624]/70 p-4.5 backdrop-blur shadow-sm space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            <div className="flex items-center gap-2">
              <span>🔍</span>
              <span>Explore Knowledge</span>
            </div>
            <button
              type="button"
              onClick={pickRandomQuestions}
              title="Shuffle prompts"
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-cyan-500 transition"
            >
              <IconRefresh />
              <span>Shuffle</span>
            </button>
          </div>
          <div className="space-y-2">
            {randomQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onPrompt(q)}
                className="w-full text-left rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 p-3 text-xs text-slate-700 dark:text-slate-300 hover:border-cyan-500 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-cyan-500/5 transition shadow-sm leading-snug"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-[#121624]/70 p-4.5 backdrop-blur shadow-sm space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            <span>✍️</span>
            <span>Contributor Hub</span>
          </div>
          <div className="space-y-2">
            {CONTRIBUTOR_ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onPrompt(item)}
                className="w-full text-left rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 p-3 text-xs text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-500/5 transition shadow-sm leading-snug"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Chat Application ────────────────────────────────────────────────────

export function ChatApp() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load conversations.";
      if (msg.includes("Unauthorized") || msg.includes("401")) {
        setAuthUser(null);
      } else {
        setErrorText(msg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeId]);

  // Check auth session on startup
  useEffect(() => {
    async function checkAuth() {
      try {
        const state = await getMe();
        if (state.authenticated && state.user) {
          setAuthUser(state.user);
          await refreshConvs();
        } else {
          setAuthUser(null);
        }
      } catch {
        setAuthUser(null);
      } finally {
        setAuthChecking(false);
      }
    }
    void checkAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore
    }
    setAuthUser(null);
    setConversations([]);
    setMessages([]);
    setActiveId(null);
  }

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
    try {
      await deleteMessage(activeId, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStatusText("");
  }

  function toggleListening() {
    if (isListening) {
      srRef.current?.stop();
      setIsListening(false);
      return;
    }

    if (typeof window === "undefined") return;
    const bw = window as BrowserWin;
    const SRClass = bw.SpeechRecognition || bw.webkitSpeechRecognition;
    if (!SRClass) return;

    try {
      const recognizer = new SRClass();
      recognizer.continuous = false;
      recognizer.interimResults = false;
      recognizer.lang = lang === "auto" ? "en-US" : langToCode(lang);

      recognizer.onstart = () => setIsListening(true);
      recognizer.onend = () => setIsListening(false);
      recognizer.onerror = () => setIsListening(false);
      recognizer.onresult = (e: SpeechEvent) => {
        const text = e.results[0]?.[0]?.transcript ?? "";
        if (text) {
          setDraft((prev) => (prev ? `${prev} ${text}` : text));
        }
      };

      srRef.current = recognizer;
      recognizer.start();
    } catch {
      setIsListening(false);
    }
  }

  function speakMsg(text: string, msgId: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (speakingId === msgId) {
      setSpeakingId(null);
      return;
    }
    const clean = cleanForSpeech(text);
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    if (lang !== "auto") {
      utterance.lang = langToCode(lang);
    }
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(msgId);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    setSpeakingId(null);
  }

  async function handleSend(override?: Partial<ChatRequest>) {
    const rawMessage = override?.message ?? draft;
    const message = rawMessage.trim();
    if (!message || isStreaming) return;

    setErrorText(null);
    setStatusText("Synthesizing Justapedia knowledge...");
    setIsStreaming(true);
    setDraft("");

    const tempUserMsgId = `temp_user_${Date.now()}`;
    const tempAiMsgId = `temp_ai_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const userMessage: Message = {
      id: tempUserMsgId,
      role: "user",
      content: message,
      status: "completed",
      created_at: nowIso,
      sources: [],
    };

    const aiMessage: Message = {
      id: tempAiMsgId,
      role: "assistant",
      content: "",
      status: "streaming",
      created_at: nowIso,
      sources: [],
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);

    const reqPayload: ChatRequest = {
      conversation_id: override?.conversation_id ?? activeId,
      message,
      answer_mode: override?.answer_mode ?? answerMode,
      response_language: override?.response_language ?? (lang === "auto" ? null : lang),
    };

    const controller = new AbortController();
    abortRef.current = controller;

    let streamedText = "";

    try {
      await streamChat(reqPayload, controller.signal, (event, data) => {
        if (event === "status") {
          const s = data as { message: string };
          setStatusText(s.message);
        } else if (event === "chunk") {
          const c = data as { text: string };
          streamedText += c.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAiMsgId ? { ...m, content: streamedText } : m
            )
          );
        } else if (event === "conversation") {
          const conv = data as Conversation;
          setActiveId(conv.id);
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === conv.id);
            if (exists) {
              return sortConvs(prev.map((c) => (c.id === conv.id ? conv : c)));
            }
            return sortConvs([conv, ...prev]);
          });
        } else if (event === "final") {
          const fin = data as {
            conversation: Conversation;
            message: Message;
            suggested_questions?: string[];
          };
          setActiveId(fin.conversation.id);
          setConversations((prev) =>
            sortConvs([
              fin.conversation,
              ...prev.filter((c) => c.id !== fin.conversation.id),
            ])
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAiMsgId
                ? {
                    ...fin.message,
                    content: streamedText || fin.message.content,
                    status: "completed",
                    suggested_questions: fin.suggested_questions ?? [],
                  }
                : m
            )
          );
          if (autoSpeak && streamedText) {
            speakMsg(streamedText, fin.message.id);
          }
        } else if (event === "error") {
          const err = data as { message: string };
          setErrorText(err.message);
        }
      });
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        setStatusText("Response stopped.");
      } else {
        const msg = err instanceof Error ? err.message : "Error streaming answer.";
        if (msg.includes("Unauthorized") || msg.includes("401")) {
          setAuthUser(null);
        } else {
          setErrorText(msg);
        }
      }
    } finally {
      setIsStreaming(false);
      setStatusText("");
      abortRef.current = null;
    }
  }

  async function handleFeedback(msg: Message, rating: "positive" | "negative") {
    try {
      await submitFeedback({
        message_id: msg.id,
        rating,
      });
      alert(rating === "positive" ? "Thank you for your feedback!" : "Feedback recorded. We'll work on improving this response.");
    } catch {
      // ignore
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ─── Loading Screen ───────────────────────────────────────────────────────────
  if (authChecking) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-950 text-white gap-4">
        <div className="relative">
          <div className="absolute -inset-3 rounded-full bg-cyan-500/20 blur-xl animate-pulse-glow" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 text-white shadow-xl">
            <IconJustapedia className="h-9 w-9 text-white" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
          <span>Connecting to Justapedia AI...</span>
        </div>
      </div>
    );
  }

  // ─── Unauthenticated Screen ───────────────────────────────────────────────────
  if (!authUser) {
    return (
      <AuthLogin
        onLoginSuccess={(user) => {
          setAuthUser(user);
          void refreshConvs();
        }}
      />
    );
  }

  // ─── Main Authenticated Interface ─────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#090d16] dark:text-slate-100 font-sans">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity"
        />
      )}

      {/* Modern Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800/80 dark:bg-[#0b0f19]/90 transition-transform duration-300 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 px-4 dark:border-slate-800/80">
          <a
            href="https://justapedia.org"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition">
              <IconJustapedia className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-sm tracking-tight text-slate-900 dark:text-white flex items-center gap-1">
                Justapedia AI
              </span>
              <span className="block text-[10px] text-cyan-600 dark:text-cyan-400 font-medium">
                Knowledge Assistant
              </span>
            </div>
          </a>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
          >
            ✕
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            type="button"
            onClick={handleNewChat}
            className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 p-2.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:opacity-95 active:scale-[0.98] transition cursor-pointer"
          >
            <IconPlus />
            <span>New Discussion</span>
          </button>
        </div>

        {/* Discussion History List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Recent Discussions
          </div>

          {conversations.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
              No discussions yet. Start a conversation below!
            </div>
          ) : (
            conversations.map((c) => {
              const active = c.id === activeId;
              return (
                <div
                  key={c.id}
                  onClick={() => openConv(c.id)}
                  className={`group relative flex items-center justify-between rounded-xl px-3 py-2 text-xs transition cursor-pointer ${
                    active
                      ? "bg-slate-100 dark:bg-slate-800/80 font-semibold text-cyan-600 dark:text-cyan-400 shadow-sm"
                      : "text-slate-600 hover:bg-slate-100/60 dark:text-slate-400 dark:hover:bg-slate-800/40"
                  }`}
                >
                  <span className="truncate flex-1 pr-2">{c.title || "Untitled Discussion"}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRename(c);
                      }}
                      className="p-1 hover:text-cyan-500"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(c);
                      }}
                      className="p-1 hover:text-rose-500"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* User Profile & Logout Bottom Bar */}
        <div className="border-t border-slate-200/80 p-3 bg-slate-50/50 dark:border-slate-800/80 dark:bg-[#0d121e]/50">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 p-2.5 bg-white/80 dark:bg-[#121624]/80 shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-xs font-black text-white shadow-sm">
                {authUser.username.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                  {authUser.username}
                </div>
                <div className="text-[10px] text-cyan-600 dark:text-cyan-400">
                  Justapedia Member
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              title="Sign Out"
              className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 dark:hover:text-rose-400 transition"
            >
              <IconLogout />
            </button>
          </div>

          <div className="mt-2.5 text-center text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
            Built for Justapedia by{" "}
            <span className="font-semibold text-slate-600 dark:text-slate-400">Sourav Halder</span>
          </div>
        </div>
      </aside>

      {/* Main Chat Interface */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Top Header Navigation */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0b0f19]/80 z-20">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
            >
              ☰
            </button>

            <div className="flex items-center gap-2">
              <a
                href="https://justapedia.org"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 group"
                title="Open Justapedia Online Encyclopedia"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-white shadow-sm">
                  <IconJustapedia className="h-4 w-4" />
                </div>
                <h1 className="font-bold text-sm text-slate-800 dark:text-slate-100 group-hover:text-cyan-500 transition">
                  {activeConv?.title || "Justapedia AI"}
                </h1>
              </a>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Online
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              title="Assistant Settings & Response Mode"
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                showSettings
                  ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                  : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
              }`}
            >
              <IconSettings />
              <span className="hidden sm:inline">Options</span>
            </button>
          </div>
        </header>

        {/* Expandable Options Drawer */}
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
              <WelcomeScreen
                userName={authUser.username}
                onPrompt={(q) => handleSend({ message: q })}
              />
            ) : (
              <div className="space-y-4 pb-2">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    conversationId={activeId}
                    isStreaming={isStreaming}
                    userName={authUser.username}
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
                placeholder="Ask any question or collaborate on Justapedia articles..."
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
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-cyan-600 to-indigo-600 text-white shadow-md shadow-blue-500/20 hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 cursor-pointer"
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
                Justapedia AI · Knowledge & Contributor Platform
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}