import { NextRequest } from "next/server";

// Fallback models when primary model encounters rate limit or downtime
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

const MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-31b-it:free",
];

const SYSTEM_PROMPT = `You are Justapedia AI, an intelligent, helpful, and conversational AI assistant designed primarily to help users explore, understand, and contribute to the Justapedia knowledge ecosystem (https://justapedia.org).

Core Operating Principles:
1. Adaptive Conciseness & Scope Matching:
   - Proportional Answers: Match the length, depth, and scope of your response directly to the user's question.
   - Short/Simple Questions: If a user asks a short, straightforward factual question (e.g., "When was X born?", "What is the capital of Y?", "Who founded Z?"), give a clear, direct, and concise answer in 1 to 3 sentences.
   - Comprehensive Explanations: Only provide in-depth explanations, historical background, or multi-section guides when the user explicitly asks to explain, summarize, detail, compare, or when the subject genuinely demands structured elaboration.
2. Natural Synthesis (Never Copy Verbatim):
   - Synthesize retrieved Justapedia knowledge into your own natural phrasing. Do not copy sentences verbatim.
3. Structure & Readability:
   - Use Markdown headings, bullet points, and clean formatting for detailed explanations.
4. Contributor & Editing Guidance:
   - Guide users on article structure (Lead, Body, References, External Links), Neutral Point of View (NPOV), citation formatting (<ref>...</ref>), and wiki markup.
5. Multilingual Fluency:
   - Always reply in the EXACT SAME language the user asked in.
6. Factual Accuracy:
   - Ground your factual assertions in the retrieved Justapedia reference material when available.`;

type JustapediaSearchItem = {
  title: string;
  snippet: string;
  page_id: string;
  url: string;
  score: number;
};

type ArticleChunk = {
  title: string;
  url: string;
  page_id: string;
  snippet: string;
  chunk_text: string;
  relevance_score: number;
};

async function searchJustapedia(query: string): Promise<JustapediaSearchItem[]> {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      utf8: "1",
      list: "search",
      srsearch: query,
      srlimit: "3",
    });
    const res = await fetch(`https://justapedia.org/api.php?${params.toString()}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const search = data?.query?.search || [];
    return search.map((item: { pageid: number; title: string; snippet: string }, idx: number) => ({
      title: item.title,
      page_id: String(item.pageid),
      url: `https://justapedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
      snippet: item.snippet.replace(/<[^>]*>/g, ""),
      score: Math.max(0.1, 1 - idx * 0.2),
    }));
  } catch {
    return [];
  }
}

async function getArticleExtract(title: string): Promise<string> {
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

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const body = await req.json();
  const message: string = (body.message || "").trim();
  const answerMode: string = body.answer_mode || "auto";
  const conversationId: string = body.conversation_id || `conv_${Date.now()}`;
  const responseLanguage: string | null = body.response_language || null;

  const conversationData = {
    id: conversationId,
    title: message.slice(0, 60),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const userMessageData = {
    id: `msg_u_${Date.now()}`,
    role: "user",
    content: message,
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

      const chunks: ArticleChunk[] = [];
      const relatedArticles: { title: string; url: string; snippet: string }[] = [];

      // 2. Perform retrieval if requested
      if (answerMode !== "general") {
        controller.enqueue(
          encoder.encode(sseFormat("status", { message: "Searching Justapedia..." }))
        );
        const searchHits = await searchJustapedia(message);

        if (searchHits.length > 0) {
          controller.enqueue(
            encoder.encode(sseFormat("status", { message: "Reading relevant sources..." }))
          );

          const extractPromises = searchHits.slice(0, 2).map(async (hit) => {
            const extract = await getArticleExtract(hit.title);
            if (extract) {
              const snippet = extract.slice(0, 700);
              chunks.push({
                title: hit.title,
                url: hit.url,
                page_id: hit.page_id,
                snippet: hit.snippet,
                chunk_text: snippet,
                relevance_score: hit.score,
              });
              relatedArticles.push({
                title: hit.title,
                url: hit.url,
                snippet: hit.snippet,
              });
            }
          });

          await Promise.all(extractPromises);
        }
      }

      // Initial assistant message placeholder
      controller.enqueue(
        encoder.encode(
          sseFormat("assistant_message", {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            status: "streaming",
            created_at: new Date().toISOString(),
            sources: chunks,
          })
        )
      );

      // Build context & prompt
      let contextBlock = "";
      if (chunks.length > 0) {
        contextBlock =
          "Retrieved Justapedia Knowledge Sources:\n```text\n" +
          chunks.map((c, i) => `[Source ${i + 1}: ${c.title}]\n${c.chunk_text}`).join("\n\n") +
          "\n```\n\n";
      }

      const langRule = responseLanguage
        ? `Respond completely in ${responseLanguage}.`
        : "Detect the language of the inquiry and respond fluently in that exact same language.";

      const promptMessages = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${langRule}` },
        {
          role: "user",
          content: `${contextBlock}User Question: ${message}\n\nProvide an accurate, naturally written response matching the user's question length.`,
        },
      ];

      // Stream from OpenRouter with model fallback
      controller.enqueue(
        encoder.encode(sseFormat("status", { message: "Generating answer..." }))
      );

      let fullAnswer = "";
      let modelSuccess = false;

      for (const model of MODELS) {
        try {
          const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://justapedia.org",
              "X-Title": "Justapedia AI",
            },
            body: JSON.stringify({
              model,
              messages: promptMessages,
              stream: true,
              temperature: 0.3,
              max_tokens: 2048,
            }),
          });

          if (!openrouterRes.ok || !openrouterRes.body) {
            continue;
          }

          const reader = openrouterRes.body.getReader();
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
                // Ignore parse errors on partial chunks
              }
            }
          }

          if (fullAnswer.trim()) {
            modelSuccess = true;
            break;
          }
        } catch {
          // Fall through to next model
        }
      }

      if (!modelSuccess) {
        fullAnswer =
          "I encountered a temporary connection issue while querying the AI model. Please try asking again in a moment.";
        controller.enqueue(encoder.encode(sseFormat("chunk", { text: fullAnswer })));
      }

      // Final complete message
      const finalAssistantMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: fullAnswer,
        status: "completed",
        created_at: new Date().toISOString(),
        sources: chunks,
      };

      const suggested = chunks.length > 0 ? [
        `What else is known about ${chunks[0].title}?`,
        `How can I improve or edit this topic on Justapedia?`,
      ] : [];

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
