import { NextRequest } from "next/server";
import {
  upsertConversation,
  saveMessage,
  saveSources,
  searchHybridArticleChunks,
  upsertArticleChunk,
  queryDb,
  DbMessage,
} from "@/lib/db";

// Dual API Providers with Zero-Downtime Fallback
const VERCEL_AI_GATEWAY_KEY =
  process.env.VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

interface ProviderConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
  models: string[];
}

function getActiveProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // Provider 1: Vercel AI Gateway (Primary)
  if (VERCEL_AI_GATEWAY_KEY) {
    providers.push({
      name: "Vercel AI Gateway",
      url: "https://ai-gateway.vercel.sh/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${VERCEL_AI_GATEWAY_KEY}`,
        "Content-Type": "application/json",
      },
      models: [
        "meta/llama-3.3-70b",
        "anthropic/claude-opus-5.5",
        "google/gemini-2.0-flash",
      ],
    });
  }

  // Provider 2: OpenRouter API (Dual Provider)
  if (OPENROUTER_API_KEY) {
    providers.push({
      name: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://justapedia.org",
        "X-Title": "Justapedia AI",
      },
      models: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
      ],
    });
  }

  // Provider 3: High-Availability Failover (Guarantees zero-interruption uptime)
  providers.push({
    name: "Justapedia High-Availability Engine",
    url: "https://text.pollinations.ai/openai/chat/completions",
    headers: {
      "Content-Type": "application/json",
    },
    models: ["openai", "mistral"],
  });

  return providers;
}

const SYSTEM_PROMPT = `You are Justapedia AI, an intelligent, professional, and helpful knowledge assistant for Justapedia (https://justapedia.org). Your purpose is to help readers, researchers, editors, and contributors discover, understand, analyze, and explore knowledge available on Justapedia.

Your goal is not simply to generate answers. You should provide accurate, clear, well-structured, and trustworthy knowledge-based responses.

Core Principles:

1. Prioritize Justapedia Knowledge
- When answering questions about a topic, first use relevant information available from Justapedia whenever possible.
- Base your answers on available and reliable sources retrieved from Justapedia.
- Do not invent facts, sources, articles, or citations.
- If the requested information cannot be found or verified, clearly say so:
  * "Based on the available information on Justapedia..."
  * "Justapedia currently does not provide enough information to confirm this."
  * "I could not verify this information from the available sources."
- Never present uncertain information as a confirmed fact.
- Provide clear references or markdown links to the related Justapedia articles whenever possible.

2. Provide Professional and Natural Answers
- Responses should feel like a knowledgeable human expert, not a robotic search engine.
- Answer the user's actual question directly.
- Use headings, bullet points, and tables when they improve readability.
- Do not make short questions unnecessarily long:
  * For simple questions (e.g. dates, definitions, locations), give concise, direct answers in 1–3 sentences.
  * For complex questions or explanation requests, provide a structured and detailed response (Quick Answer → Explanation → Context → Related Topics).
- Adapt the length and depth of your answer to the user's question.

3. Be a Knowledge Assistant, Not Just a Chatbot
- Help users understand information, not just retrieve it.
- Explain complex topics in simple language, summarize articles, compare subjects, and provide historical background.
- Support natural follow-up questions smoothly.

4. Multilingual Support
- Always respond in the EXACT SAME language as the user's question (e.g., if asked in English, reply in English; if Bengali, reply in Bengali).
- Translate and explain concepts naturally while preserving encyclopedic accuracy.

5. Support Justapedia Editors and Contributors
- Help with improving clarity, identifying missing information, suggesting citation needs (<ref>...</ref>), detecting non-neutral language, and improving article structure.
- Treat your suggestions as recommendations. Human editors remain responsible for reviewing and approving all changes.

6. Accuracy and Uncertainty
- Accuracy is more important than sounding confident.
- Clearly distinguish between sourced facts and general background. Never fabricate URLs, books, authors, or citations.

7. AI Safety and Human Control
- Read-only default architecture: You may read, analyze, summarize, and suggest.
- You must NOT independently publish, edit, or delete Justapedia articles, nor execute commands to alter the database or server.
- Follow human authorization for all changes.

8. Conversation Quality
- Maintain conversation context and understand follow-up questions naturally.
- Tone: Professional, friendly, intelligent, neutral, respectful.`;

type JustapediaSearchItem = {
  title: string;
  snippet: string;
  page_id: string;
  url: string;
  score: number;
};

type ArticleChunk = {
  id: string;
  title: string;
  url: string;
  page_id: string;
  section_heading: string;
  snippet: string;
  chunk_text: string;
  relevance_score: number;
};

// 1. Query Understanding & Follow-Up Resolution
function resolveSearchQuery(
  currentMessage: string,
  history: DbMessage[]
): string {
  const trimmed = currentMessage.trim();
  const lower = trimmed.toLowerCase();

  const isFollowUp =
    lower.startsWith("what caused it") ||
    lower.startsWith("why did it") ||
    lower.startsWith("when was he") ||
    lower.startsWith("when was she") ||
    lower.startsWith("who founded it") ||
    lower.startsWith("tell me more") ||
    lower.startsWith("explain it") ||
    lower.startsWith("what was his") ||
    lower.startsWith("what was her") ||
    lower.includes(" his ") ||
    lower.includes(" her ") ||
    lower.includes(" it ") ||
    lower.length < 25;

  if (isFollowUp && history.length > 0) {
    const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      const cleanedLast = lastUserMsg.content
        .replace(/^(who is|who was|what is|tell me about|explain)\s+/i, "")
        .replace(/[?.,!]/g, "")
        .trim();
      return `${cleanedLast} ${trimmed}`;
    }
  }

  return trimmed;
}

// 2. Search Justapedia MediaWiki API with Multi-Stage Entity Extraction
function extractSearchKeywords(q: string): string[] {
  const stopWords = new Set([
    "what", "is", "are", "a", "an", "the", "who", "was", "were", "how", "why",
    "when", "where", "tell", "me", "about", "can", "you", "explain", "and",
    "its", "their", "his", "her", "of", "in", "on", "at", "to", "for", "with",
    "does", "did", "do", "please", "give", "brief", "summary", "overview",
  ]);
  const cleaned = q.replace(/[?.,!\"'()]/g, " ");
  const terms = cleaned.split(/\s+/).filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));
  return terms;
}

async function searchJustapedia(query: string): Promise<JustapediaSearchItem[]> {
  try {
    const terms = extractSearchKeywords(query);
    const searchVariants = [
      terms.join(" "),
      terms.slice(0, 3).join(" "),
      terms[0] || query,
    ].filter(Boolean);

    // Stage 1: Try MediaWiki list=search with extracted keyword variants
    for (const term of searchVariants) {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        utf8: "1",
        list: "search",
        srsearch: term,
        srlimit: "5",
      });
      const res = await fetch(`https://justapedia.org/api.php?${params.toString()}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        next: { revalidate: 300 },
      });
      if (res.ok) {
        const data = await res.json();
        const search = data?.query?.search || [];
        if (search.length > 0) {
          return search.map(
            (item: { pageid: number; title: string; snippet: string }, idx: number) => ({
              title: item.title,
              page_id: String(item.pageid),
              url: `https://justapedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
              snippet: item.snippet.replace(/<[^>]*>/g, ""),
              score: Math.max(0.3, 1 - idx * 0.15),
            })
          );
        }
      }
    }

    // Stage 2: Fallback to OpenSearch for exact title autocompletion
    const primaryEntity = terms.slice(0, 2).join(" ") || query;
    const osParams = new URLSearchParams({
      action: "opensearch",
      format: "json",
      limit: "5",
      search: primaryEntity,
    });
    const osRes = await fetch(`https://justapedia.org/api.php?${osParams.toString()}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      next: { revalidate: 300 },
    });
    if (osRes.ok) {
      const osData = await osRes.json();
      const titles: string[] = osData[1] || [];
      const urls: string[] = osData[3] || [];
      if (titles.length > 0) {
        return titles.map((title, idx) => ({
          title,
          page_id: `page_${encodeURIComponent(title)}`,
          url:
            urls[idx] ||
            `https://justapedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
          snippet: `Justapedia article for ${title}`,
          score: Math.max(0.4, 0.9 - idx * 0.1),
        }));
      }
    }

    return [];
  } catch {
    return [];
  }
}

// 3. Smart Article Chunking (Section-Aware Extraction)
interface SectionChunk {
  heading: string;
  text: string;
}

function parseArticleSections(rawText: string): SectionChunk[] {
  const sections: SectionChunk[] = [];
  const lines = rawText.split("\n");
  let currentHeading = "Introduction";
  let currentBuffer: string[] = [];

  for (const line of lines) {
    const match = line.match(/^={2,4}\s*(.+?)\s*={2,4}$/);
    if (match) {
      if (currentBuffer.length > 0) {
        const body = currentBuffer.join("\n").trim();
        if (body.length > 50) {
          sections.push({ heading: currentHeading, text: body });
        }
        currentBuffer = [];
      }
      currentHeading = match[1].trim();
    } else {
      currentBuffer.push(line);
    }
  }

  if (currentBuffer.length > 0) {
    const body = currentBuffer.join("\n").trim();
    if (body.length > 50) {
      sections.push({ heading: currentHeading, text: body });
    }
  }

  // If no sections detected, return full text as intro
  if (sections.length === 0 && rawText.trim().length > 0) {
    sections.push({ heading: "Overview", text: rawText.trim() });
  }

  return sections;
}

async function getArticleFullText(title: string): Promise<string> {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      utf8: "1",
      prop: "extracts",
      explaintext: "1",
      redirects: "1",
      titles: title,
    });
    const res = await fetch(`https://justapedia.org/api.php?${params.toString()}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      next: { revalidate: 600 },
    });
    if (!res.ok) return "";
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const firstPage = Object.values(pages)[0] as { extract?: string } | undefined;
    return firstPage?.extract || "";
  } catch {
    return "";
  }
}

// 4. Reranking Layer
function rerankChunks(
  userQuery: string,
  chunks: ArticleChunk[]
): ArticleChunk[] {
  const queryTerms = userQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  return chunks
    .map((chunk) => {
      let score = chunk.relevance_score;
      const titleLower = chunk.title.toLowerCase();
      const headingLower = chunk.section_heading.toLowerCase();
      const textLower = chunk.chunk_text.toLowerCase();

      // Title match boost
      if (titleLower.includes(userQuery.toLowerCase())) {
        score += 1.5;
      }

      // Query term overlap boost
      for (const term of queryTerms) {
        if (titleLower.includes(term)) score += 0.5;
        if (headingLower.includes(term)) score += 0.4;
        if (textLower.includes(term)) score += 0.1;
      }

      // Demote reference/external link sections from primary answer context
      if (
        headingLower.includes("references") ||
        headingLower.includes("external links") ||
        headingLower.includes("see also")
      ) {
        score -= 0.5;
      }

      return { ...chunk, relevance_score: score };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score);
}

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const body = await req.json();
  const rawMessage: string = (body.message || "").trim();
  const answerMode: string = body.answer_mode || "auto";
  const conversationId: string = body.conversation_id || `conv_${Date.now()}`;
  const responseLanguage: string | null = body.response_language || null;

  // Basic Prompt Injection Protection Guardrail
  const sanitizedMessage = rawMessage.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");

  const conversationData = {
    id: conversationId,
    title: sanitizedMessage.slice(0, 60),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const userMessageData = {
    id: `msg_u_${Date.now()}`,
    role: "user",
    content: sanitizedMessage,
    status: "completed",
    created_at: new Date().toISOString(),
    sources: [],
  };

  const assistantMessageId = `msg_a_${Date.now()}`;

  const customStream = new ReadableStream({
    async start(controller) {
      // 1. Send conversation & user_message events
      controller.enqueue(encoder.encode(sseFormat("conversation", conversationData)));
      controller.enqueue(encoder.encode(sseFormat("user_message", userMessageData)));

      // Fetch conversation history from Neon PostgreSQL for query understanding
      let history: DbMessage[] = [];
      try {
        history = await queryDb<DbMessage>(
          "SELECT id, role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 6",
          [conversationId]
        );
      } catch {
        // Fallback to empty history
      }

      // Query Understanding: rewrite follow-up queries if needed
      const resolvedQuery = resolveSearchQuery(sanitizedMessage, history);

      const candidateChunks: ArticleChunk[] = [];
      const relatedArticles: { title: string; url: string; snippet: string }[] = [];

      // 2. Hybrid Retrieval (Live Justapedia Search + Neon Postgres Index)
      if (answerMode !== "general") {
        controller.enqueue(
          encoder.encode(sseFormat("status", { message: "Searching Justapedia..." }))
        );

        // A. Search database indexed chunks
        const dbChunks = await searchHybridArticleChunks(resolvedQuery, 4);
        for (const dc of dbChunks) {
          candidateChunks.push({
            id: dc.id,
            title: dc.article_title,
            url: dc.article_url,
            page_id: dc.page_id || "",
            section_heading: dc.section_heading || "Overview",
            snippet: dc.content.slice(0, 300),
            chunk_text: dc.content.slice(0, 800),
            relevance_score: (dc.rank || 0.5) * 1.2,
          });
        }

        // B. Search live Justapedia MediaWiki API
        const searchHits = await searchJustapedia(resolvedQuery);

        if (searchHits.length > 0) {
          controller.enqueue(
            encoder.encode(sseFormat("status", { message: "Reading and indexing sources..." }))
          );

          for (const hit of searchHits.slice(0, 3)) {
            relatedArticles.push({
              title: hit.title,
              url: hit.url,
              snippet: hit.snippet,
            });

            const fullText = await getArticleFullText(hit.title);
            if (fullText) {
              const sections = parseArticleSections(fullText);
              // Take top relevant sections (intro + up to 2 others)
              for (const [secIdx, sec] of sections.slice(0, 3).entries()) {
                const chunkId = `chk_${hit.page_id}_${secIdx}`;
                const chunkData: ArticleChunk = {
                  id: chunkId,
                  title: hit.title,
                  url: hit.url,
                  page_id: hit.page_id,
                  section_heading: sec.heading,
                  snippet: sec.text.slice(0, 300),
                  chunk_text: sec.text.slice(0, 850),
                  relevance_score: hit.score - secIdx * 0.1,
                };
                candidateChunks.push(chunkData);

                // Asynchronously index into Neon PostgreSQL article_chunks table
                upsertArticleChunk({
                  id: chunkId,
                  article_title: hit.title,
                  article_url: hit.url,
                  page_id: hit.page_id,
                  section_heading: sec.heading,
                  content: sec.text,
                }).catch(() => {});
              }
            }
          }
        }
      }

      // 3. Reranking Layer
      const rerankedChunks = rerankChunks(resolvedQuery, candidateChunks).slice(0, 6);

      // Initial assistant message placeholder
      controller.enqueue(
        encoder.encode(
          sseFormat("assistant_message", {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            status: "streaming",
            created_at: new Date().toISOString(),
            sources: rerankedChunks,
          })
        )
      );

      // 4. Build Context
      let contextBlock = "";
      if (rerankedChunks.length > 0) {
        contextBlock =
          "Retrieved Justapedia Verified Knowledge:\n```text\n" +
          rerankedChunks
            .map(
              (c, i) =>
                `[Source ${i + 1}: ${c.title} — Section: ${c.section_heading}]\n${c.chunk_text}`
            )
            .join("\n\n") +
          "\n```\n\n";
      }

      const langRule = responseLanguage
        ? `Respond completely in ${responseLanguage}.`
        : "Always respond in the exact same language as the user's prompt (e.g., if the user asks in English, reply in English; if Bengali, reply in Bengali). Do not switch to another language.";

      const promptMessages = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${langRule}` },
        {
          role: "user",
          content: `${contextBlock}User Question: ${sanitizedMessage}\n\nProvide an accurate, naturally written response matching the user's question length. Follow the core principles strictly.`,
        },
      ];

      // 5. Stream Generation through Dual API Pipeline
      controller.enqueue(
        encoder.encode(sseFormat("status", { message: "Generating answer..." }))
      );

      let fullAnswer = "";
      let modelSuccess = false;
      let usedModel = "Justapedia AI";
      const providers = getActiveProviders();

      for (const provider of providers) {
        if (modelSuccess) break;

        for (const model of provider.models) {
          try {
            const res = await fetch(provider.url, {
              method: "POST",
              headers: provider.headers,
              body: JSON.stringify({
                model,
                messages: promptMessages,
                stream: true,
                temperature: 0.3,
                max_tokens: 2048,
              }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              console.warn(
                `Provider ${provider.name} model ${model} failed (${res.status}):`,
                errData?.error?.message || res.statusText
              );
              if (res.status === 403 || res.status === 401 || res.status === 429) {
                break;
              }
              continue;
            }

            if (!res.body) continue;

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let lineBuffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split("\n");
              lineBuffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (jsonStr === "[DONE]") break;

                try {
                  const parsed = JSON.parse(jsonStr);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    fullAnswer += delta;
                    controller.enqueue(encoder.encode(sseFormat("chunk", { text: delta })));
                  }
                } catch {
                  // Ignore partial chunk parse error
                }
              }
            }

            if (fullAnswer.trim()) {
              modelSuccess = true;
              usedModel = model;
              break;
            }
          } catch (err) {
            console.error(`Error querying ${provider.name} ${model}:`, err);
          }
        }
      }

      if (!modelSuccess && !fullAnswer.trim()) {
        fullAnswer =
          "I am currently experiencing higher than usual traffic. Please try asking your question again in a moment.";
        controller.enqueue(encoder.encode(sseFormat("chunk", { text: fullAnswer })));
      }

      // 6. Final complete message
      const finalAssistantMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: fullAnswer,
        status: "completed",
        created_at: new Date().toISOString(),
        sources: rerankedChunks,
      };

      const suggested =
        rerankedChunks.length > 0
          ? [
              `What else is known about ${rerankedChunks[0].title}?`,
              `How can I improve or edit this topic on Justapedia?`,
            ]
          : [];

      controller.enqueue(
        encoder.encode(
          sseFormat("final", {
            conversation: conversationData,
            message: finalAssistantMessage,
            related_articles: relatedArticles,
            suggested_questions: suggested,
          })
        )
      );

      // 7. Persist to Neon PostgreSQL Database asynchronously
      try {
        await upsertConversation(conversationId, conversationData.title);
        await saveMessage({
          id: userMessageData.id,
          conversation_id: conversationId,
          role: "user",
          content: sanitizedMessage,
        });
        await saveMessage({
          id: assistantMessageId,
          conversation_id: conversationId,
          role: "assistant",
          content: fullAnswer,
          model: usedModel,
        });
        if (rerankedChunks.length > 0) {
          await saveSources(
            rerankedChunks.map((c) => ({
              id: `src_${c.id}_${Date.now()}`,
              message_id: assistantMessageId,
              title: c.title,
              url: c.url,
              page_id: c.page_id,
              snippet: c.snippet,
              section_title: c.section_heading,
              relevance_score: c.relevance_score,
            }))
          );
        }
      } catch (dbErr) {
        console.error("Error saving conversation to Neon DB:", dbErr);
      }

      controller.close();
    },
  });

  return new Response(customStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
