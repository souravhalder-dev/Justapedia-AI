"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

function CodeBlock({
  language,
  value,
}: {
  language: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (typeof navigator !== "undefined" && value) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="relative my-3 rounded-xl border border-slate-700/60 bg-[#0c1017] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#111722]/80 text-slate-400">
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-300 font-semibold">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 hover:text-white transition text-[11px] font-medium"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <div className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-slate-200">
        <code>{value}</code>
      </div>
    </div>
  );
}

function sanitizeAndFormatContent(raw: string): string {
  if (!raw) return "";

  let cleaned = raw;

  // Replace literal string &lt;br&gt; or &lt;br/&gt; that leaked into text with actual HTML break
  cleaned = cleaned.replace(/&lt;br\s*\/?&gt;/gi, "<br />");
  cleaned = cleaned.replace(/&lt;p&gt;/gi, "<p>").replace(/&lt;\/p&gt;/gi, "</p>");
  cleaned = cleaned.replace(/&lt;span&gt;/gi, "<span>").replace(/&lt;\/span&gt;/gi, "</span>");

  // If text contains unescaped <br> outside code blocks, ensure it doesn't break ReactMarkdown
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n\n");

  // Remove any stray MediaWiki source markers if any leaked
  cleaned = cleaned.replace(/\[\d+\]/g, "");

  return cleaned;
}

export function MarkdownContent({ content }: { content: string }) {
  const formatted = sanitizeAndFormatContent(content);

  return (
    <div className="prose prose-slate max-w-none text-[14px] leading-7 dark:prose-invert prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-white prose-p:my-2 prose-ul:my-2 prose-li:my-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isCodeBlock = match || String(children).includes("\n");
            const codeString = String(children).replace(/\n$/, "");

            if (isCodeBlock) {
              return (
                <CodeBlock
                  language={match ? match[1] : ""}
                  value={codeString}
                />
              );
            }

            return (
              <code
                className="rounded-md bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 font-mono text-[13px] text-cyan-600 dark:text-cyan-400 border border-slate-200/50 dark:border-slate-700/50"
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 underline underline-offset-2 transition"
                {...props}
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="my-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#101420]/50 backdrop-blur">
                <table className="w-full text-left text-xs border-collapse">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/50 px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-b border-slate-100 dark:border-slate-800/60 px-4 py-2 text-slate-700 dark:text-slate-300">
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-3 border-l-4 border-cyan-500 bg-cyan-500/5 px-4 py-2 rounded-r-xl italic text-slate-700 dark:text-slate-300">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {formatted}
      </ReactMarkdown>
    </div>
  );
}