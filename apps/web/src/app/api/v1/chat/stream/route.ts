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
import { getAuthUser } from "@/lib/auth";
import {
  getCachedResponse,
  setCachedResponse,
} from "@/lib/cache";
import {
  getAvailableProviders,
  classifyQueryComplexity,
  isProviderAvailable,
  recordProviderSuccess,
  recordProviderFailure,
} from "@/lib/providers";
import {
  searchJustapediaFast,
  getArticleFullText,
  parseArticleSections,
  rerankChunks,
  ArticleChunk,
} from "@/lib/retrieval";
import { chatModel } from "@/lib/langchain";

const SYSTEM_PROMPT = `You are Justapedia AI, an intelligent, professional, and helpful knowledge assistant for Justapedia (https://justapedia.org). Your purpose is to help readers, researchers, editors, and contributors explore and understand knowledge in a direct, natural, and engaging style.

CRITICAL IDENTITY RULE: You are Justapedia AI, powered by open knowledge and open-source models for Justapedia. NEVER identify yourself as OpenAI, ChatGPT, or GPT-4, and never mention third-party AI limits. You represent Justapedia.

Core Operating Principles:

1. Prioritize Justapedia Knowledge with General Knowledge Fallback:
- When answering questions about a topic, prioritize relevant verified knowledge available from Justapedia whenever present.
- If Justapedia does not contain an article on the topic, or if retrieved chunks are incomplete, seamlessly provide the answer using general verified encyclopedic knowledge.
- CRITICAL RULE: NEVER refuse to answer a question or say "I cannot answer because retrieved sources only mention unrelated topic X". Always answer the user's question directly, accurately, and thoroughly.

2. ABSOLUTELY NO META-DISCLAIMERS OR PREAMBLE:
- NEVER start your response with meta-commentary like:
  * "Based on the retrieved Justapedia sources..."
  * "The available content covers X but does not include Y..."
  * "I'll provide a comprehensive answer using general verified encyclopedic knowledge..."
  * "Based on available information..."
- Start DIRECTLY with the answer on the very first word!

3. INLINE WIKILINKS (NO BOTTOM SOURCE LISTS):
- DO NOT append a separate "Sources:", "References:", "Citations:", or "Related articles:" section at the bottom of your answer.
- INSTEAD, naturally wikilink key concepts, historical figures, theories, and articles to Justapedia directly within your prose!
- Format wikilinks as standard Markdown links: [Article Title](https://justapedia.org/wiki/Article_Title) (with spaces replaced by underscores) or MediaWiki syntax [[Article Title]].
- When you draw facts from retrieved Justapedia articles, naturally link to those article(s) at their first mention in your text (e.g. "...as developed by [Albert Einstein](https://justapedia.org/wiki/Albert_Einstein) in his work on [general relativity](https://justapedia.org/wiki/General_relativity)...").
- Keep the output clean, natural, and conversational.

4. CLEAN FORMATTING & RENDERING:
- Use clean standard Markdown (headings #, ##, bold **, bullet points -, numbered lists, tables, code blocks).
- NEVER output raw literal HTML tags like "<br>", "<p>", or "<span>".

5. Provide Professional and Natural Answers:
- Responses should feel like a knowledgeable human expert.
- Answer the user's actual question directly.
- Match answer depth to the query:
  * Simple questions (e.g. definitions, dates, who was X): give a concise, direct answer in 1–3 sentences.
  * Complex or explanatory questions (e.g. "What did he discover?", "Explain quantum computing"): provide a comprehensive, structured response (Summary → Core Concepts / Discoveries → Significance).

6. Multilingual Fluency:
- Always respond in the EXACT SAME language as the user's question (e.g., if asked in English, reply in English; if Bengali, reply in Bengali).`;

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

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // 1. Backend Authorization Check
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return new Response(
      JSON.stringify({ error: "Authentication required. Please log in with your Justapedia account." }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const body = await req.json().catch(() => ({}));
  const rawMessage = (body.message || "").trim();
  const conversationId = body.conversation_id || `conv_${Date.now()}`;
  const answerMode = body.answer_mode || "auto";
  const responseLanguage = body.response_language || null;

  if (!rawMessage) {
    return new Response(JSON.stringify({ error: "Message is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sanitizedMessage = rawMessage.slice(0, 4000);
  const userMessageId = `msg_user_${Date.now()}`;
  const assistantMessageId = `msg_ai_${Date.now()}`;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Emit conversation metadata
      controller.enqueue(
        encoder.encode(
          sseFormat("conversation", {
            id: conversationId,
            title: sanitizedMessage.slice(0, 45),
            created_at: new Date().toISOString(),
          })
        )
      );

      // Emit user message confirmation
      controller.enqueue(
        encoder.encode(
          sseFormat("user_message", {
            id: userMessageId,
            role: "user",
            content: sanitizedMessage,
            status: "completed",
            created_at: new Date().toISOString(),
            sources: [],
          })
        )
      );

      // Async DB record user message
      upsertConversation(conversationId, sanitizedMessage.slice(0, 45), authUser.id).catch(() => {});
      saveMessage({
        id: userMessageId,
        conversation_id: conversationId,
        role: "user",
        content: sanitizedMessage,
        status: "completed",
      }).catch(() => {});

      // ─── TIER 1 & 2 CACHE CHECK (Ultra-Fast Response) ────────────────────────
      const cached = await getCachedResponse(sanitizedMessage, responseLanguage);
      if (cached && cached.answer) {
        const cacheHitTtft = Date.now() - startTime;
        console.log(`[Cache HIT] Query: "${sanitizedMessage.slice(0, 30)}" in ${cacheHitTtft}ms`);

        // Emit initial placeholder
        controller.enqueue(
          encoder.encode(
            sseFormat("assistant_message", {
              id: assistantMessageId,
              role: "assistant",
              content: "",
              status: "streaming",
              created_at: new Date().toISOString(),
              sources: [],
            })
          )
        );

        // Fast progressive stream for natural UX (in chunks of ~20-30 chars)
        const fullText = cached.answer;
        const chunkSize = 28;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const slice = fullText.slice(i, i + chunkSize);
          controller.enqueue(encoder.encode(sseFormat("chunk", { text: slice })));
        }

        const totalCacheTime = Date.now() - startTime;

        // Emit final event
        controller.enqueue(
          encoder.encode(
            sseFormat("final", {
              conversation: {
                id: conversationId,
                title: sanitizedMessage.slice(0, 45),
                updated_at: new Date().toISOString(),
              },
              message: {
                id: assistantMessageId,
                role: "assistant",
                content: fullText,
                status: "completed",
                model: `${cached.modelUsed} (Cached)`,
                created_at: new Date().toISOString(),
                sources: [],
              },
              related_articles: cached.relatedArticles || [],
              suggested_questions: cached.suggestedQuestions || [],
            })
          )
        );

        // Emit Telemetry
        controller.enqueue(
          encoder.encode(
            sseFormat("telemetry", {
              cache_hit: true,
              ttft_ms: cacheHitTtft,
              total_ms: totalCacheTime,
              model: cached.modelUsed,
              provider: "Ultra-Fast Cache",
            })
          )
        );

        // Save assistant message to DB
        saveMessage({
          id: assistantMessageId,
          conversation_id: conversationId,
          role: "assistant",
          content: fullText,
          status: "completed",
          model: `${cached.modelUsed} (Cached)`,
        }).catch(() => {});

        controller.close();
        return;
      }

      // ─── CACHE MISS: PARALLEL RETRIEVAL & AI INFERENCE ───────────────────────
      controller.enqueue(
        encoder.encode(sseFormat("status", { message: "Exploring Justapedia knowledge..." }))
      );

      // Fetch last 4 messages for conversational context
      let history: DbMessage[] = [];
      try {
        history = await queryDb<DbMessage>(
          "SELECT id, conversation_id, role, content, status, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 4",
          [conversationId]
        );
        history.reverse();
      } catch {
        history = [];
      }

      const resolvedQuery = resolveSearchQuery(sanitizedMessage, history);
      let candidateChunks: ArticleChunk[] = [];
      const relatedArticles: { title: string; url: string; snippet: string }[] = [];

      if (answerMode !== "general") {
        // Run Fast Search & DB Hybrid Search in Parallel
        const [searchHits, hybridHits] = await Promise.all([
          searchJustapediaFast(resolvedQuery),
          searchHybridArticleChunks(resolvedQuery, 4).catch(() => []),
        ]);

        // Integrate hybrid DB hits if available
        for (const h of hybridHits) {
          candidateChunks.push({
            id: h.id,
            title: h.article_title,
            url: h.article_url,
            page_id: h.page_id || `page_${encodeURIComponent(h.article_title)}`,
            section_heading: h.section_heading || "Article Extract",
            snippet: h.content.slice(0, 300),
            chunk_text: h.content.slice(0, 850),
            relevance_score: 1.2 + (h.rank || 0),
          });
        }

        // Fetch section extracts for top 2 search hits in parallel
        if (searchHits.length > 0) {
          const topHits = searchHits.slice(0, 2);
          const extractPromises = topHits.map(async (hit) => {
            relatedArticles.push({
              title: hit.title,
              url: hit.url,
              snippet: hit.snippet,
            });

            const fullText = await getArticleFullText(hit.title);
            if (!fullText) return [];

            const sections = parseArticleSections(fullText);
            const chunks: ArticleChunk[] = [];

            for (const [secIdx, sec] of sections.slice(0, 3).entries()) {
              const chunkId = `chk_${hit.page_id}_${secIdx}`;
              chunks.push({
                id: chunkId,
                title: hit.title,
                url: hit.url,
                page_id: hit.page_id,
                section_heading: sec.heading,
                snippet: sec.text.slice(0, 300),
                chunk_text: sec.text.slice(0, 850),
                relevance_score: hit.score - secIdx * 0.1,
              });

              upsertArticleChunk({
                id: chunkId,
                article_title: hit.title,
                article_url: hit.url,
                page_id: hit.page_id,
                section_heading: sec.heading,
                content: sec.text,
              }).catch(() => {});
            }
            return chunks;
          });

          const extractedArrays = await Promise.all(extractPromises);
          for (const arr of extractedArrays) {
            candidateChunks.push(...arr);
          }
        }
      }

      // Rerank chunks
      const allReranked = rerankChunks(resolvedQuery, candidateChunks);
      const topTitle = allReranked[0]?.title.toLowerCase();

      const rerankedChunks = allReranked
        .filter((c) => {
          if (allReranked[0]?.relevance_score >= 2.0 && topTitle) {
            return c.title.toLowerCase() === topTitle;
          }
          return c.relevance_score > 0.3;
        })
        .slice(0, 4);

      // Initial assistant message placeholder
      controller.enqueue(
        encoder.encode(
          sseFormat("assistant_message", {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            status: "streaming",
            created_at: new Date().toISOString(),
            sources: [],
          })
        )
      );

      // Build Context Block with Available Justapedia Articles to Wikilink
      let contextBlock = "";
      if (rerankedChunks.length > 0) {
        const uniqueArticles = Array.from(
          new Map(rerankedChunks.map((c) => [c.title, c.url])).entries()
        );
        const articleLinksHint = uniqueArticles
          .map(([t, u]) => `* [${t}](${u})`)
          .join("\n");

        contextBlock =
          "Retrieved Justapedia Verified Knowledge:\n```text\n" +
          rerankedChunks
            .map(
              (c, i) =>
                `[Source ${i + 1}: ${c.title} — Section: ${c.section_heading}]\n${c.chunk_text}`
            )
            .join("\n\n") +
          "\n```\n\n" +
          `Available Justapedia Articles to Wikilink:\n${articleLinksHint}\n\n` +
          "Wikilink Instruction: Naturally embed inline markdown links [Article Title](https://justapedia.org/wiki/Article_Title) or wiki syntax [[Article Title]] when mentioning these subjects in your prose. Do not append a separate source list at the bottom.\n\n";
      }

      const langRule = responseLanguage
        ? `Respond completely in ${responseLanguage}.`
        : "Always respond in the exact same language as the user's prompt (e.g. if the user asks in English, reply in English; if Bengali, reply in Bengali).";

      // Prepare previous conversation history turns (up to last 6 turns)
      const historyTurns = history
        .filter((h) => h.content && h.content.trim() && h.id !== userMessageId)
        .slice(-6)
        .map((h) => ({
          role: (h.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
          content: h.content,
        }));

      const promptMessages = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${langRule}` },
        ...historyTurns,
        {
          role: "user",
          content: `${contextBlock}User Question: ${sanitizedMessage}\n\nAnswer the question directly, thoroughly, and professionally.`,
        },
      ];

      // ─── INTELLIGENT MODEL ROUTING & MULTI-PROVIDER FALLBACK ───────────────
      const complexity = classifyQueryComplexity(sanitizedMessage, rerankedChunks.length > 0);
      const providers = getAvailableProviders();

      let fullAnswer = "";
      let modelSuccess = false;
      let usedModelName = "Justapedia AI";
      let usedProviderId = "unknown";
      let ttftMs = 0;

      for (const provider of providers) {
        if (modelSuccess) break;

        // Circuit breaker check
        if (!isProviderAvailable(provider.id)) {
          console.warn(`[Skip] Provider ${provider.name} currently in cooldown.`);
          continue;
        }

        const modelList =
          complexity === "simple"
            ? [...provider.fastModels, ...provider.strongModels]
            : [...provider.strongModels, ...provider.fastModels];

        for (const model of modelList) {
          if (modelSuccess) break;

          const providerStart = Date.now();
          const abortController = new AbortController();

          // 12s First-Token Timeout: Prevents premature aborts while queueing on free inference clusters
          let hasFirstToken = false;
          const timeoutId = setTimeout(() => {
            if (!hasFirstToken) {
              abortController.abort();
              console.warn(`[Timeout] ${provider.name} (${model}) did not send first token in 12s.`);
            }
          }, 12000);

          try {
            const requestPayload: Record<string, unknown> = {
              model,
              messages: promptMessages,
              stream: true,
              temperature: 0.3,
              max_tokens: provider.maxTokens || 2048,
            };

            // Enable automatic provider-side model fallback on OpenRouter
            if (provider.id === "openrouter") {
              requestPayload.models = [
                model,
                "nvidia/nemotron-3-ultra-550b-a55b:free",
                "nvidia/nemotron-3.5-lightning:free",
                "liquid/lfm-2.5-2.6b:free",
              ];
            }

            const res = await fetch(provider.url, {
              method: "POST",
              headers: provider.headers,
              body: JSON.stringify(requestPayload),
              signal: abortController.signal,
            });

            if (!res.ok) {
              clearTimeout(timeoutId);
              const isRate = res.status === 429;
              recordProviderFailure(provider.id, isRate);
              console.warn(`Provider ${provider.name} (${model}) HTTP ${res.status}`);
              if (isRate) break; // Break out of this provider to next one
              continue;
            }

            if (!res.body) {
              clearTimeout(timeoutId);
              continue;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let lineBuffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split("\n");
              lineBuffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine.startsWith(":") || trimmedLine === "data: [DONE]") {
                  continue;
                }

                if (trimmedLine.startsWith("data: ")) {
                  try {
                    const jsonStr = trimmedLine.slice(6);
                    const parsed = JSON.parse(jsonStr);
                    const delta =
                      parsed.choices?.[0]?.delta?.content ||
                      parsed.choices?.[0]?.text ||
                      "";
                    const reasoningDelta =
                      parsed.choices?.[0]?.delta?.reasoning || "";

                    // If reasoning or content has arrived, mark first token received to stop timeout
                    if (!hasFirstToken && (delta || reasoningDelta)) {
                      hasFirstToken = true;
                      clearTimeout(timeoutId);
                      ttftMs = Date.now() - startTime;
                    }

                    if (delta) {
                      fullAnswer += delta;
                      controller.enqueue(encoder.encode(sseFormat("chunk", { text: delta })));
                    }
                  } catch {
                    // Ignore malformed chunk
                  }
                }
              }
            }

            if (fullAnswer.trim().length > 10) {
              modelSuccess = true;
              usedModelName = model;
              usedProviderId = provider.name;
              recordProviderSuccess(provider.id, Date.now() - providerStart, ttftMs);
            }
          } catch (err: unknown) {
            clearTimeout(timeoutId);
            const isAbort = (err as Error)?.name === "AbortError";
            if (!isAbort) {
              recordProviderFailure(provider.id, false);
            }
          }
        }
      }

      // Robust fallback 1: LangChain ChatOpenAI with automatic retry logic
      if (!modelSuccess || !fullAnswer.trim()) {
        try {
          console.log("[Fallback] Invoking LangChain chatModel fallback...");
          const langChainRes = await chatModel.invoke(promptMessages);
          const answerText =
            typeof langChainRes.content === "string"
              ? langChainRes.content
              : Array.isArray(langChainRes.content)
              ? langChainRes.content
                  .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
                  .join("")
              : "";

          if (answerText && answerText.trim().length > 10) {
            fullAnswer = answerText.trim();
            modelSuccess = true;
            usedModelName = "nvidia/nemotron-3-ultra-550b-a55b:free";
            usedProviderId = "Justapedia AI (LangChain)";
            // Stream the response smoothly in small chunks
            const chunkSize = 24;
            for (let i = 0; i < fullAnswer.length; i += chunkSize) {
              const slice = fullAnswer.slice(i, i + chunkSize);
              controller.enqueue(encoder.encode(sseFormat("chunk", { text: slice })));
            }
          }
        } catch (langChainErr) {
          console.warn("[Fallback] LangChain fallback error:", langChainErr);
        }
      }

      // Robust fallback 2: Synthesize directly from retrieved Justapedia knowledge
      if (!modelSuccess || !fullAnswer.trim()) {
        if (rerankedChunks.length > 0) {
          const mainChunk = rerankedChunks[0];
          fullAnswer = `${mainChunk.chunk_text}\n\n*Read more on Justapedia: [${mainChunk.title}](${mainChunk.url})*`;
          modelSuccess = true;
          usedModelName = "Justapedia Knowledge Core";
          usedProviderId = "Justapedia Engine";
          controller.enqueue(encoder.encode(sseFormat("chunk", { text: fullAnswer })));
        } else {
          fullAnswer =
            "I am ready to assist you with Justapedia articles, research, and general encyclopedic knowledge. Please ask any specific question to get started!";
          controller.enqueue(encoder.encode(sseFormat("chunk", { text: fullAnswer })));
        }
      }

      const totalTimeMs = Date.now() - startTime;

      // Asynchronously store to L1 and L2 Caches
      if (modelSuccess && fullAnswer.length > 20) {
        setCachedResponse(
          sanitizedMessage,
          fullAnswer,
          [],
          relatedArticles,
          [],
          usedModelName,
          responseLanguage
        ).catch(() => {});
      }

      // Emit final completion event
      controller.enqueue(
        encoder.encode(
          sseFormat("final", {
            conversation: {
              id: conversationId,
              title: sanitizedMessage.slice(0, 45),
              updated_at: new Date().toISOString(),
            },
            message: {
              id: assistantMessageId,
              role: "assistant",
              content: fullAnswer,
              status: "completed",
              model: usedModelName,
              created_at: new Date().toISOString(),
              sources: [],
            },
            related_articles: relatedArticles,
            suggested_questions: [],
          })
        )
      );

      // Emit Telemetry
      controller.enqueue(
        encoder.encode(
          sseFormat("telemetry", {
            cache_hit: false,
            ttft_ms: ttftMs || (Date.now() - startTime),
            total_ms: totalTimeMs,
            model: usedModelName,
            provider: usedProviderId,
          })
        )
      );

      // Save assistant message and sources to DB asynchronously
      saveMessage({
        id: assistantMessageId,
        conversation_id: conversationId,
        role: "assistant",
        content: fullAnswer,
        status: "completed",
        model: usedModelName,
      }).catch(() => {});

      if (rerankedChunks.length > 0) {
        saveSources(
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
        ).catch(() => {});
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
