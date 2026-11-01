const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required.");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

async function init() {
  console.log('Initializing response_cache and retrieval tables...');
  
  await sql.query(`
    CREATE TABLE IF NOT EXISTS response_cache (
      query_hash VARCHAR(64) PRIMARY KEY,
      normalized_query TEXT NOT NULL,
      answer TEXT NOT NULL,
      sources JSONB DEFAULT '[]'::jsonb,
      related_articles JSONB DEFAULT '[]'::jsonb,
      suggested_questions JSONB DEFAULT '[]'::jsonb,
      model_used VARCHAR(64) NOT NULL,
      hit_count INT DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_accessed TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  await sql.query(`
    CREATE INDEX IF NOT EXISTS idx_response_cache_expires ON response_cache (expires_at);
  `);

  await sql.query(`
    CREATE INDEX IF NOT EXISTS idx_response_cache_normalized ON response_cache (normalized_query);
  `);

  console.log('response_cache table and indexes created successfully!');
}

init().catch(console.error);
