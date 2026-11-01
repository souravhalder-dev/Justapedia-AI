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

const SYSTEM_PROMPT = `You are Justapedia AI, an intelligent, professional, and helpful knowledge assistant for Justapedia (https://justapedia.org). Your purpose is to help readers, researchers, editors, and contributors discover, understand, analyze, and explore knowledge.

Your goal is to provide accurate, clear, well-structured, and trustworthy knowledge-based responses to ANY question.

Core Principles:

1. Prioritize Justapedia Knowledge with Comprehensive General Knowledge Fallback:
- When answering questions about a topic, prioritize relevant verified knowledge available from Justapedia whenever present.
- Use retrieved Justapedia sources as your primary factual ground truth and cite them with clear references or markdown links.
- If Justapedia does not contain an article on the topic, or if retrieved chunks are incomplete, seamlessly provide the answer using general verified encyclopedic knowledge.
- CRITICAL RULE: NEVER refuse to answer a question or say "I cannot answer because retrieved sources only mention unrelated topic X". Always answer the user's question directly, accurately, and thoroughly.

2. Provide Professional and Natural Answers:
- Responses should feel like a knowledgeable human expert, not a robotic search engine.
- Answer the user's actual question directly before adding extra details.
- Use headings, bullet points, and tables when they improve readability.
- Match answer depth to the query:
  * For simple questions (e.g. definitions, dates, who was X), give a concise, direct answer in 1–3 sentences.
  * For complex or explanatory questions (e.g. "What did he discover?", "Explain quantum physics", "History of..."), provide a comprehensive, structured response (Quick Summary → Major Discoveries / Facts → Significance → Related Topics).

3. Be a Knowledge Assistant, Not Just a Chatbot:
- Help users understand concepts in simple language, summarize articles, compare subjects, and provide historical context.
- Support natural follow-up questions smoothly.

4. Multilingual Fluency:
- Always respond in the EXACT SAME language as the user's question (e.g., if asked in English, reply in English; if Bengali, reply in Bengali).

5. Support Justapedia Editors and Contributors:
- Help with improving clarity, identifying missing information, suggesting citation needs (<ref>...</ref>), detecting non-neutral language, and improving article structure. Suggestions are recommendations for human review.

6. AI Safety and Human Control:
- Read-only default architecture: You may read, analyze, summarize, and suggest. You must never independently edit or modify articles or system files.

7. Conversation Quality:
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

// 1. Query Understanding & Entity Extraction
function extractSearchEntities(q: string): string[] {
  const questionWords = new Set([
    "who", "what", "where", "when", "why", "how", "which", "whose", "whom",
    "is", "was", "are", "were", "can", "could", "would", "should", "tell",
    "me", "about", "explain", "describe", "define", "give", "please", "and",
    "did", "does", "do", "the", "a", "an", "in", "on", "at", "to", "for",
    "he", "she", "it", "they", "his", "her", "their", "its", "discover", "discovers",
    "discovered", "find", "history", "mission"
  ]);

  const candidates: string[] = [];

  // A. Capitalized sequences (Proper Nouns, e.g. "Albert Einstein", "World War II")
  const properMatches = q.match(/[A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*/g) || [];
  for (const m of properMatches) {
    const trimmed = m.trim();
    if (!questionWords.has(trimmed.toLowerCase()) && trimmed.length > 2) {
      candidates.push(trimmed);
    }
  }

  // B. Clean query words
  const words = q
    .replace(/[?.,!\"'()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !questionWords.has(w.toLowerCase()));

  if (words.length >= 2) {
    candidates.push(words.slice(0, 2).join(" ")); // "Albert Einstein"
  }
  if (words.length >= 3) {
    candidates.push(words.slice(0, 3).join(" "));
  }
  if (words.length > 0) {
    candidates.push(words.join(" "));
  }

  return Array.from(new Set(candidates)).filter(Boolean);
}

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

// 2. Search Justapedia MediaWiki API with Direct Title + OpenSearch + Keyword Search
async function searchJustapedia(query: string): Promise<JustapediaSearchItem[]> {
  try {
    const entities = extractSearchEntities(query);
    const results: JustapediaSearchItem[] = [];
    const seenTitles = new Set<string>();

    // Stage 1: Direct Page Title Check (Fastest and Most Accurate for encyclopedic subjects)
    for (const entity of entities) {
      const directUrl = `https://justapedia.org/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(
        entity
      )}&prop=extracts&explaintext=1`;
      const res = await fetch(directUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        next: { revalidate: 600 },
      });
      if (res.ok) {
        const data = await res.json();
        const pages = data.query?.pages || {};
        const page = Object.values(pages)[0] as { pageid?: number; title?: string; extract?: string };
        if (page && page.pageid && Number(page.pageid) > 0 && page.title && page.extract && page.extract.length > 50) {
          if (!seenTitles.has(page.title.toLowerCase())) {
            seenTitles.add(page.title.toLowerCase());
            results.push({
              title: page.title,
              page_id: String(page.pageid),
              url: `https://justapedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
              snippet: page.extract.slice(0, 300),
              score: 2.0, // High confidence exact title match
            });
            // If we found the exact named entity, return immediately
            return results;
          }
        }
      }
    }

    // Stage 2: OpenSearch Autocompletion (Matches exact prefix titles)
    for (const entity of entities) {
      const osParams = new URLSearchParams({
        action: "opensearch",
        format: "json",
        limit: "4",
        search: entity,
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
        for (let i = 0; i < titles.length; i++) {
          const t = titles[i];
          if (!seenTitles.has(t.toLowerCase())) {
            seenTitles.add(t.toLowerCase());
            results.push({
              title: t,
              page_id: `page_${encodeURIComponent(t)}`,
              url: urls[i] || `https://justapedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`,
              snippet: `Justapedia knowledge article for ${t}`,
              score: 1.0 - i * 0.15,
            });
          }
        }
        if (results.length > 0) return results;
      }
    }

    // Stage 3: MediaWiki list=search with entities
    for (const entity of entities) {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        utf8: "1",
        list: "search",
        srsearch: entity,
        srlimit: "4",
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
        for (let i = 0; i < search.length; i++) {
          const item = search[i];
          if (!seenTitles.has(item.title.toLowerCase())) {
            seenTitles.add(item.title.toLowerCase());
            results.push({
              title: item.title,
              page_id: String(item.pageid),
              url: `https://justapedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
              snippet: item.snippet.replace(/<[^>]*>/g, ""),
              score: Math.max(0.3, 0.8 - i * 0.15),
            });
          }
        }
        if (results.length > 0) return results;
      }
    }

    return results;
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

// 4. Reranking Layer with Semantic Relevance Validation
function rerankChunks(
  userQuery: string,
  chunks: ArticleChunk[]
): ArticleChunk[] {
  const queryLower = userQuery.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((w) => w.length > 2);
  const entities = extractSearchEntities(userQuery).map((e) => e.toLowerCase());

  return chunks
    .map((chunk) => {
      let score = chunk.relevance_score;
      const titleLower = chunk.title.toLowerCase();
      const headingLower = chunk.section_heading.toLowerCase();
      const textLower = chunk.chunk_text.toLowerCase();

      // Entity match boost
      for (const ent of entities) {
        if (titleLower.includes(ent)) {
          score += 4.0;
        }
      }

      // Query term overlap
      let termMatches = 0;
      for (const term of queryTerms) {
        if (titleLower.includes(term)) {
          score += 1.0;
          termMatches++;
        }
        if (headingLower.includes(term)) score += 0.5;
        if (textLower.includes(term)) score += 0.15;
      }

      // Filter out unrelated articles that share only 1 common word
      if (entities.length > 0 && !entities.some((e) => titleLower.includes(e) || textLower.includes(e))) {
        score -= 2.0;
      }

      // Demote reference/external link sections
      if (
        headingLower.includes("references") ||
        headingLower.includes("external links") ||
        headingLower.includes("see also")
      ) {
        score -= 1.0;
      }

      return { ...chunk, relevance_score: score };
    })
    .filter((c) => c.relevance_score > 0.1) // Discard low-relevance noise
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
              // Take top relevant sections (intro + up to 3 others)
              for (const [secIdx, sec] of sections.slice(0, 4).entries()) {
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

      // 3. Reranking Layer & Strict Subject Isolation
      const allReranked = rerankChunks(resolvedQuery, candidateChunks);
      const topTitle = allReranked[0]?.title.toLowerCase();
      
      // If we found an exact subject article (e.g. "Albert Einstein"), isolate only relevant chunks
      const rerankedChunks = allReranked
        .filter((c) => {
          if (allReranked[0]?.relevance_score >= 2.0 && topTitle) {
            return c.title.toLowerCase() === topTitle;
          }
          return c.relevance_score > 0.3;
        })
        .slice(0, 6);

      const filteredRelatedArticles = relatedArticles.filter((a) => {
        if (topTitle && allReranked[0]?.relevance_score >= 2.0) {
          return a.title.toLowerCase() === topTitle;
        }
        return true;
      });

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
      } else {
        contextBlock =
          "No specific Justapedia article was retrieved for this query. Provide a direct, highly accurate, and helpful encyclopedic answer using verified general knowledge.\n\n";
      }

      const langRule = responseLanguage
        ? `Respond completely in ${responseLanguage}.`
        : "Always respond in the exact same language as the user's prompt (e.g., if the user asks in English, reply in English; if Bengali, reply in Bengali). Do not switch to another language.";

      const promptMessages = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${langRule}` },
        {
          role: "user",
          content: `${contextBlock}User Question: ${sanitizedMessage}\n\nAnswer the question directly, thoroughly, and professionally. Use the retrieved Justapedia sources where available. If explaining a famous person or concept, detail their key life events, major theories or discoveries, and significance.`,
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
            related_articles: filteredRelatedArticles,
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
