import crypto from "crypto";
import { queryDb } from "./db";

export interface CachedResponse {
  queryHash: string;
  normalizedQuery: string;
  answer: string;
  sources: unknown[];
  relatedArticles: unknown[];
  suggestedQuestions: string[];
  modelUsed: string;
  hitCount: number;
}

// Tier 1: In-Memory L1 Cache for ultra-fast <1ms lookups
interface L1Entry {
  data: CachedResponse;
  expiresAt: number;
}

const L1_MAX_SIZE = 500;
const L1_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours in memory
const l1Cache = new Map<string, L1Entry>();

// Singleflight in-flight request deduplication
const inFlightRequests = new Map<string, Promise<CachedResponse | null>>();

/**
 * Normalizes user question by removing punctuation, lowercasing,
 * collapsing whitespace, and stripping conversational filler phrases.
 */
export function normalizeQuery(query: string): string {
  let cleaned = query.toLowerCase().trim();

  // Strip conversational introductory boilerplate
  cleaned = cleaned.replace(/^(please\s+|can\s+you\s+|could\s+you\s+|tell\s+me\s+about\s+|what\s+is\s+|who\s+was\s+|who\s+is\s+)/i, "");

  // Remove trailing and internal punctuation
  cleaned = cleaned.replace(/[?.,!;:\"'()\[\]{}]/g, " ");

  // Collapse multiple spaces
  cleaned = cleaned.split(/\s+/).filter(Boolean).join(" ");

  return cleaned;
}

export function hashQuery(normalized: string, language?: string | null): string {
  const langKey = language ? language.toLowerCase().trim() : "default";
  return crypto.createHash("sha256").update(`${langKey}:::${normalized}`).digest("hex");
}

/**
 * Multi-Tier Cache Lookup:
 * 1. Checks in-memory L1 cache (<1ms)
 * 2. Checks Neon PostgreSQL L2 cache (~30-60ms)
 */
export async function getCachedResponse(
  rawQuery: string,
  language?: string | null
): Promise<CachedResponse | null> {
  const normalized = normalizeQuery(rawQuery);
  if (normalized.length < 3) return null;

  const hash = hashQuery(normalized, language);

  // 1. Check L1 In-Memory Cache
  const l1 = l1Cache.get(hash);
  if (l1) {
    if (Date.now() < l1.expiresAt) {
      l1.data.hitCount++;
      return l1.data;
    }
    l1Cache.delete(hash);
  }

  // 2. Check Neon PostgreSQL L2 Cache
  try {
    const rows = await queryDb<{
      query_hash: string;
      normalized_query: string;
      answer: string;
      sources: unknown;
      related_articles: unknown;
      suggested_questions: unknown;
      model_used: string;
      hit_count: number;
      expires_at: string;
    }>(
      `SELECT query_hash, normalized_query, answer, sources, related_articles, suggested_questions, model_used, hit_count, expires_at
       FROM response_cache
       WHERE query_hash = $1 AND expires_at > NOW()`,
      [hash]
    );

    if (rows.length > 0) {
      const row = rows[0];
      const cached: CachedResponse = {
        queryHash: row.query_hash,
        normalizedQuery: row.normalized_query,
        answer: row.answer,
        sources: Array.isArray(row.sources) ? row.sources : [],
        relatedArticles: Array.isArray(row.related_articles) ? row.related_articles : [],
        suggestedQuestions: Array.isArray(row.suggested_questions) ? row.suggested_questions as string[] : [],
        modelUsed: row.model_used,
        hitCount: (row.hit_count || 1) + 1,
      };

      // Populate L1 cache
      if (l1Cache.size >= L1_MAX_SIZE) {
        const firstKey = l1Cache.keys().next().value;
        if (firstKey) l1Cache.delete(firstKey);
      }
      l1Cache.set(hash, { data: cached, expiresAt: Date.now() + L1_TTL_MS });

      // Asynchronously update hit count in database
      queryDb(
        "UPDATE response_cache SET hit_count = hit_count + 1, last_accessed = NOW() WHERE query_hash = $1",
        [hash]
      ).catch(() => {});

      return cached;
    }
  } catch (err) {
    console.warn("L2 cache read error:", err);
  }

  return null;
}

/**
 * Stores Q&A in both L1 (Memory) and L2 (Neon PostgreSQL) caches
 */
export async function setCachedResponse(
  rawQuery: string,
  answer: string,
  sources: unknown[],
  relatedArticles: unknown[],
  suggestedQuestions: string[],
  modelUsed: string,
  language?: string | null,
  ttlDays: number = 7
): Promise<void> {
  if (!answer || answer.length < 20) return;

  const normalized = normalizeQuery(rawQuery);
  if (normalized.length < 3) return;

  const hash = hashQuery(normalized, language);

  const cached: CachedResponse = {
    queryHash: hash,
    normalizedQuery: normalized,
    answer,
    sources,
    relatedArticles,
    suggestedQuestions,
    modelUsed,
    hitCount: 1,
  };

  // 1. Store in L1 Cache
  if (l1Cache.size >= L1_MAX_SIZE) {
    const firstKey = l1Cache.keys().next().value;
    if (firstKey) l1Cache.delete(firstKey);
  }
  l1Cache.set(hash, { data: cached, expiresAt: Date.now() + L1_TTL_MS });

  // 2. Asynchronously store in Neon PostgreSQL L2 Cache
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  queryDb(
    `INSERT INTO response_cache (
      query_hash, normalized_query, answer, sources, related_articles, suggested_questions, model_used, hit_count, created_at, last_accessed, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW(), NOW(), $8)
    ON CONFLICT (query_hash) DO UPDATE SET
      answer = EXCLUDED.answer,
      sources = EXCLUDED.sources,
      related_articles = EXCLUDED.related_articles,
      suggested_questions = EXCLUDED.suggested_questions,
      model_used = EXCLUDED.model_used,
      last_accessed = NOW(),
      expires_at = EXCLUDED.expires_at`,
    [
      hash,
      normalized,
      answer,
      JSON.stringify(sources || []),
      JSON.stringify(relatedArticles || []),
      JSON.stringify(suggestedQuestions || []),
      modelUsed,
      expiresAt,
    ]
  ).catch((err) => {
    console.warn("Failed to persist to L2 cache:", err);
  });
}

/**
 * Singleflight helper to deduplicate simultaneous identical questions
 */
export function getInFlight(hash: string): Promise<CachedResponse | null> | undefined {
  return inFlightRequests.get(hash);
}

export function setInFlight(hash: string, promise: Promise<CachedResponse | null>): void {
  inFlightRequests.set(hash, promise);
  promise.finally(() => inFlightRequests.delete(hash));
}
