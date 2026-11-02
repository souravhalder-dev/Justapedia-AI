export interface ProviderConfig {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  fastModels: string[];
  strongModels: string[];
  maxTokens?: number;
}

export interface ProviderHealth {
  consecutiveFailures: number;
  circuitOpenUntil: number; // timestamp in ms
  lastLatencyMs: number;
  lastTtftMs: number;
  successCount: number;
}

const healthMap = new Map<string, ProviderHealth>();

function getHealth(id: string): ProviderHealth {
  let h = healthMap.get(id);
  if (!h) {
    h = {
      consecutiveFailures: 0,
      circuitOpenUntil: 0,
      lastLatencyMs: 0,
      lastTtftMs: 0,
      successCount: 0,
    };
    healthMap.set(id, h);
  }
  return h;
}

export function recordProviderSuccess(id: string, latencyMs: number, ttftMs: number) {
  const h = getHealth(id);
  h.consecutiveFailures = 0;
  h.circuitOpenUntil = 0;
  h.lastLatencyMs = latencyMs;
  h.lastTtftMs = ttftMs;
  h.successCount++;
}

export function recordProviderFailure(id: string, isRateLimit: boolean = false) {
  const h = getHealth(id);
  h.consecutiveFailures++;
  // Brief cooldown: 10s on rate limit, or 5s on error so subsequent requests are not blocked
  const cooldownSec = isRateLimit ? 10 : 5;
  h.circuitOpenUntil = Date.now() + cooldownSec * 1000;
  console.warn(`[CircuitBreaker] Provider ${id} tripped. Cooldown: ${cooldownSec}s.`);
}

export function isProviderAvailable(id: string): boolean {
  const h = getHealth(id);
  if (h.circuitOpenUntil > 0) {
    if (Date.now() < h.circuitOpenUntil) {
      return false; // Circuit is open (in cooldown)
    }
    // Cooldown expired, half-open probe
    h.circuitOpenUntil = 0;
  }
  return true;
}

/**
 * Builds the prioritized list of 100% free inference providers.
 */
export function getAvailableProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // 1. Google Gemini Free Engine (High Intelligence, Verified Encyclopedic Accuracy, 15 RPM, 1,500 RPD)
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (geminiKey) {
    providers.push({
      id: "gemini",
      name: "Google Gemini Free Engine",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      headers: {
        Authorization: `Bearer ${geminiKey}`,
        "Content-Type": "application/json",
      },
      fastModels: ["gemini-flash-lite-latest", "gemini-3.5-flash"],
      strongModels: ["gemini-3.5-flash", "gemini-flash-lite-latest"],
      maxTokens: 2048,
    });
  }

  // 2. OpenRouter NVIDIA Cluster (Flagship 550B Parameters & High Accuracy)
  const openRouterKey = process.env.OPENROUTER_API_KEY || "";
  if (openRouterKey) {
    providers.push({
      id: "openrouter",
      name: "OpenRouter Free Cluster",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://justapedia.org",
        "X-Title": "Justapedia AI",
      },
      fastModels: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
      ],
      strongModels: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3.5-lightning:free",
        "liquid/lfm-2.5-2.6b:free",
      ],
      maxTokens: 2048,
    });
  }

  // 3. Groq LPU Engine (Ultra-Fast 100-200ms failover, 30 RPM, 14,400 RPD)
  const groqKey = process.env.GROQ_API_KEY || "";
  if (groqKey) {
    providers.push({
      id: "groq",
      name: "Groq LPU Engine",
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      fastModels: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"],
      strongModels: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"],
      maxTokens: 2048,
    });
  }

  // 4. Cerebras Inference (Free CS-3 Engine if key is provided)
  const cerebrasKey = process.env.CEREBRAS_API_KEY || "";
  if (cerebrasKey) {
    providers.push({
      id: "cerebras",
      name: "Cerebras CS-3 Engine",
      url: "https://api.cerebras.ai/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${cerebrasKey}`,
        "Content-Type": "application/json",
      },
      fastModels: ["llama3.1-8b"],
      strongModels: ["llama-3.3-70b"],
      maxTokens: 2048,
    });
  }

  return providers;
}

/**
 * Intelligent Model Routing:
 * Classifies query complexity to pick optimal model size.
 */
export function classifyQueryComplexity(
  query: string,
  hasSources: boolean
): "simple" | "complex" {
  const trimmed = query.trim().toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;

  // Simple greetings or brief questions
  if (wordCount <= 6 && !hasSources) {
    return "simple";
  }

  // Complex markers: comparison, historical breakdown, technical, synthesis
  if (
    wordCount > 12 ||
    hasSources ||
    trimmed.includes("compare") ||
    trimmed.includes("difference") ||
    trimmed.includes("explain why") ||
    trimmed.includes("history of") ||
    trimmed.includes("theory") ||
    trimmed.includes("how does")
  ) {
    return "complex";
  }

  return "simple";
}
