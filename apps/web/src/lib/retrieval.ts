import { DbArticleChunk, searchHybridArticleChunks, upsertArticleChunk } from "./db";

export interface JustapediaSearchItem {
  title: string;
  page_id: string;
  url: string;
  snippet: string;
  score: number;
}

export interface SectionChunk {
  heading: string;
  text: string;
}

export interface ArticleChunk {
  id: string;
  title: string;
  url: string;
  page_id: string | null;
  section_heading: string;
  snippet: string;
  chunk_text: string;
  relevance_score: number;
}

// In-Memory LRU Cache for Article Extracts (1-hour TTL)
const extractCache = new Map<string, { extract: string; timestamp: number }>();
const EXTRACT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function extractSearchEntities(rawQuery: string): string[] {
  const q = rawQuery.trim();
  const candidates: string[] = [];

  const properMatches = q.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  const questionWords = new Set([
    "who", "what", "where", "when", "why", "how", "is", "was", "are",
    "were", "the", "a", "an", "can", "could", "tell", "explain", "about",
  ]);

  if (properMatches) {
    for (const match of properMatches) {
      const trimmed = match.trim();
      if (!questionWords.has(trimmed.toLowerCase()) && trimmed.length > 2) {
        candidates.push(trimmed);
      }
    }
  }

  const words = q
    .replace(/[?.,!\"'()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !questionWords.has(w.toLowerCase()));

  if (words.length >= 2) {
    candidates.push(words.slice(0, 2).join(" "));
  }
  if (words.length >= 3) {
    candidates.push(words.slice(0, 3).join(" "));
  }
  if (words.length > 0) {
    candidates.push(words.join(" "));
  }

  return Array.from(new Set(candidates)).filter(Boolean);
}

export function parseArticleSections(rawText: string): SectionChunk[] {
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

/**
 * Fast Article Full Text Fetcher with In-Memory Cache
 */
export async function getArticleFullText(title: string): Promise<string> {
  const cacheKey = title.toLowerCase().trim();
  const cached = extractCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EXTRACT_CACHE_TTL) {
    return cached.extract;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s fast timeout

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
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
      next: { revalidate: 600 },
    });

    clearTimeout(timeoutId);

    if (!res.ok) return "";
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const firstPage = Object.values(pages)[0] as { extract?: string } | undefined;
    const extract = firstPage?.extract || "";

    if (extract) {
      if (extractCache.size > 200) {
        const firstKey = extractCache.keys().next().value;
        if (firstKey) extractCache.delete(firstKey);
      }
      extractCache.set(cacheKey, { extract, timestamp: Date.now() });
    }

    return extract;
  } catch {
    return "";
  }
}

/**
 * Fast Parallel Justapedia Search
 */
export async function searchJustapediaFast(query: string): Promise<JustapediaSearchItem[]> {
  try {
    const entities = extractSearchEntities(query);
    if (entities.length === 0) return [];

    const results: JustapediaSearchItem[] = [];
    const seenTitles = new Set<string>();

    // Stage 1: Parallel Direct Page Title Lookups (Fastest)
    const directPromises = entities.slice(0, 3).map(async (entity) => {
      try {
        const directUrl = `https://justapedia.org/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(
          entity
        )}&prop=extracts&explaintext=1`;
        const res = await fetch(directUrl, {
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            Accept: "application/json",
          },
          next: { revalidate: 600 },
        });
        if (res.ok) {
          const data = await res.json();
          const pages = data.query?.pages || {};
          const page = Object.values(pages)[0] as { pageid?: number; title?: string; extract?: string };
          if (page && page.pageid && Number(page.pageid) > 0 && page.title && page.extract && page.extract.length > 50) {
            return {
              title: page.title,
              page_id: String(page.pageid),
              url: `https://justapedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
              snippet: page.extract.slice(0, 300),
              score: 2.0,
            };
          }
        }
      } catch {
        // ignore
      }
      return null;
    });

    const directResults = await Promise.all(directPromises);
    for (const r of directResults) {
      if (r && !seenTitles.has(r.title.toLowerCase())) {
        seenTitles.add(r.title.toLowerCase());
        results.push(r);
      }
    }

    if (results.length > 0) {
      return results;
    }

    // Stage 2: OpenSearch Autocompletion
    const osPromises = entities.slice(0, 2).map(async (entity) => {
      try {
        const osParams = new URLSearchParams({
          action: "opensearch",
          format: "json",
          limit: "4",
          search: entity,
        });
        const osRes = await fetch(`https://justapedia.org/api.php?${osParams.toString()}`, {
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            Accept: "application/json",
          },
          next: { revalidate: 300 },
        });
        if (osRes.ok) {
          const osData = await osRes.json();
          const titles: string[] = osData[1] || [];
          const urls: string[] = osData[3] || [];
          return titles.map((t, i) => ({
            title: t,
            page_id: `page_${encodeURIComponent(t)}`,
            url: urls[i] || `https://justapedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`,
            snippet: `Justapedia knowledge article for ${t}`,
            score: 1.0 - i * 0.15,
          }));
        }
      } catch {
        // ignore
      }
      return [];
    });

    const osArrays = await Promise.all(osPromises);
    for (const arr of osArrays) {
      for (const item of arr) {
        if (!seenTitles.has(item.title.toLowerCase())) {
          seenTitles.add(item.title.toLowerCase());
          results.push(item);
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Reranking Layer with Semantic Boost & Strict Subject Isolation
 */
export function rerankChunks(
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

      for (const ent of entities) {
        if (titleLower.includes(ent)) {
          score += 4.0;
        }
      }

      for (const term of queryTerms) {
        if (titleLower.includes(term)) score += 1.0;
        if (headingLower.includes(term)) score += 0.5;
        if (textLower.includes(term)) score += 0.15;
      }

      if (entities.length > 0 && !entities.some((e) => titleLower.includes(e) || textLower.includes(e))) {
        score -= 2.0;
      }

      if (
        headingLower.includes("references") ||
        headingLower.includes("external links") ||
        headingLower.includes("see also")
      ) {
        score -= 1.0;
      }

      return { ...chunk, relevance_score: score };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score);
}
