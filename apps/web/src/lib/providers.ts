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
  // Open circuit breaker for 60s on rate limit, or 30s on repeated errors
  const cooldownSec = isRateLimit ? 60 : h.consecutiveFailures >= 2 ? 30 : 5;
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

  // 1. Groq API (Free Tier: 30 RPM, 14,400 RPD, 500-1000 tokens/sec)
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
      fastModels: ["llama-3.1-8b-instant"],
      strongModels: ["llama-3.3-70b-versatile"],
      maxTokens: 2048,
    });
  }

  // 2. Cerebras Inference (Free Tier: 30 RPM, 1,800+ tokens/sec)
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

  // 3. Google Gemini API (Free Tier: 15 RPM, 1,500 RPD)
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
      fastModels: ["gemini-2.0-flash-lite"],
      strongModels: ["gemini-2.0-flash"],
      maxTokens: 2048,
    });
  }

  // 4. OpenRouter Free Tier (Configured with verified active models)
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
        "liquid/lfm-2.5-2.6b:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
      ],
      strongModels: [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "google/gemma-4-31b-it:free",
        "nvidia/nemotron-3.5-lightning:free",
      ],
      maxTokens: 2048,
    });
  }

  // 5. Vercel AI Gateway (If present)
  const vercelGatewayKey =
    process.env.VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY || "";
  if (vercelGatewayKey) {
    providers.push({
      id: "vercel_gateway",
      name: "Vercel AI Gateway",
      url: "https://ai-gateway.vercel.sh/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${vercelGatewayKey}`,
        "Content-Type": "application/json",
      },
      fastModels: ["google/gemini-2.0-flash"],
      strongModels: ["meta/llama-3.3-70b", "google/gemini-2.0-flash"],
      maxTokens: 2048,
    });
  }

  // 6. Zero-Config High-Availability Free Failover (100% Free Uptime Guarantee)
  providers.push({
    id: "pollinations",
    name: "Justapedia High-Availability Engine",
    url: "https://text.pollinations.ai/openai/chat/completions",
    headers: {
      "Content-Type": "application/json",
    },
    fastModels: ["openai", "mistral"],
    strongModels: ["openai", "mistral"],
    maxTokens: 2048,
  });

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
