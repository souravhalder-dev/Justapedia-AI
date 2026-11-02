const config = {
  openrouter_api_key: process.env.OPENROUTER_API_KEY || "",
  openrouter_chat_model:
    process.env.OPENROUTER_CHAT_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
  // Supports both exact property name and the typo alias from the snippet
  opernrouter_chat_model:
    process.env.OPENROUTER_CHAT_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
  openrouter_fallback_chat_models:
    process.env.OPENROUTER_FALLBACK_CHAT_MODELS ||
    "nvidia/nemotron-3.5-lightning:free,liquid/lfm-2.5-2.6b:free,google/gemma-4-31b-it:free",
  openrouter_embedding_model:
    process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/nemotron-3-embed-1b:free",
  frontend_url: process.env.FRONTEND_URL || "https://ig.justapedia.org",
  database_url: process.env.DATABASE_URL || "",
};

export default config;
