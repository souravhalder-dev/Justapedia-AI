import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || "";

let sqlClient: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!sqlClient) {
    sqlClient = neon(DATABASE_URL);
  }
  return sqlClient;
}

export async function queryDb<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const sql = getSql();
    // Use sql.query for parameterized queries with placeholders ($1, $2, etc.)
    const rows = (await sql.query(text, params)) as T[];
    return rows;
  } catch (error) {
    console.error("Database query error:", error, "Query:", text);
    return [];
  }
}

// Conversation and Message Models
export interface DbConversation {
  id: string;
  title: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  model: string | null;
  created_at: string;
}

export interface DbSource {
  id: string;
  message_id: string;
  title: string;
  url: string;
  page_id: string | null;
  snippet: string;
  section_title: string | null;
  relevance_score: number;
  created_at: string;
}

export async function listConversations(): Promise<DbConversation[]> {
  return queryDb<DbConversation>(
    "SELECT id, title, user_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50"
  );
}

export async function getConversationWithMessages(conversationId: string) {
  const convs = await queryDb<DbConversation>(
    "SELECT id, title, user_id, created_at, updated_at FROM conversations WHERE id = $1",
    [conversationId]
  );
  if (!convs.length) return null;

  const messages = await queryDb<DbMessage>(
    "SELECT id, conversation_id, role, content, status, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId]
  );

  const messageIds = messages.map((m) => m.id);
  let sources: DbSource[] = [];
  if (messageIds.length > 0) {
    sources = await queryDb<DbSource>(
      "SELECT id, message_id, title, url, page_id, snippet, section_title, relevance_score, created_at FROM sources WHERE message_id = ANY($1) ORDER BY relevance_score DESC",
      [messageIds]
    );
  }

  const messagesWithSources = messages.map((m) => ({
    ...m,
    sources: sources.filter((s) => s.message_id === m.id),
  }));

  return {
    ...convs[0],
    messages: messagesWithSources,
  };
}

export async function upsertConversation(id: string, title: string, userId?: string | null) {
  return queryDb(
    `INSERT INTO conversations (id, title, user_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       updated_at = NOW()`,
    [id, title, userId || null]
  );
}

export async function saveMessage(msg: {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status?: string;
  model?: string | null;
}) {
  return queryDb(
    `INSERT INTO messages (id, conversation_id, role, content, status, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       content = EXCLUDED.content,
       status = EXCLUDED.status,
       model = EXCLUDED.model`,
    [
      msg.id,
      msg.conversation_id,
      msg.role,
      msg.content,
      msg.status || "completed",
      msg.model || null,
    ]
  );
}

export async function saveSources(
  sources: Array<{
    id: string;
    message_id: string;
    title: string;
    url: string;
    page_id?: string | null;
    snippet: string;
    section_title?: string | null;
    relevance_score?: number;
  }>
) {
  for (const s of sources) {
    await queryDb(
      `INSERT INTO sources (id, message_id, title, url, page_id, snippet, section_title, relevance_score, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id,
        s.message_id,
        s.title,
        s.url,
        s.page_id || null,
        s.snippet,
        s.section_title || null,
        s.relevance_score || 0.0,
      ]
    );
  }
}

export async function saveFeedback(fb: {
  id: string;
  message_id: string;
  rating: string;
  reason?: string | null;
  comment?: string | null;
}) {
  return queryDb(
    `INSERT INTO feedback (id, message_id, rating, reason, comment, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [fb.id, fb.message_id, fb.rating, fb.reason || null, fb.comment || null]
  );
}

// Hybrid Search in Indexed Article Chunks
export interface DbArticleChunk {
  id: string;
  article_title: string;
  article_url: string;
  page_id: string | null;
  section_heading: string | null;
  content: string;
  categories: string[];
  language: string;
  rank?: number;
}

export async function searchHybridArticleChunks(
  searchQuery: string,
  limit: number = 6
): Promise<DbArticleChunk[]> {
  try {
    const formattedQuery = searchQuery
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .join(" | ");

    if (!formattedQuery) return [];

    return queryDb<DbArticleChunk>(
      `SELECT id, article_title, article_url, page_id, section_heading, content, categories, language,
              ts_rank_cd(search_vector, to_tsquery('english', $1)) as rank
       FROM article_chunks
       WHERE search_vector @@ to_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [formattedQuery, limit]
    );
  } catch (err) {
    console.warn("Hybrid search warning:", err);
    return [];
  }
}

export async function upsertArticleChunk(chunk: {
  id: string;
  article_title: string;
  article_url: string;
  page_id?: string | null;
  section_heading?: string | null;
  content: string;
  categories?: string[];
  language?: string;
}) {
  return queryDb(
    `INSERT INTO article_chunks (id, article_title, article_url, page_id, section_heading, content, categories, language, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (id) DO UPDATE SET
       content = EXCLUDED.content,
       section_heading = EXCLUDED.section_heading,
       categories = EXCLUDED.categories,
       last_updated = NOW()`,
    [
      chunk.id,
      chunk.article_title,
      chunk.article_url,
      chunk.page_id || null,
      chunk.section_heading || null,
      chunk.content,
      JSON.stringify(chunk.categories || []),
      chunk.language || "en",
    ]
  );
}
