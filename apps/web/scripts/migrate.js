const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL || "";

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log('Connecting to Neon PostgreSQL...');
  await sql.query('CREATE EXTENSION IF NOT EXISTS vector;');

  console.log('Creating users table...');
  await sql.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      display_name VARCHAR(255),
      preferred_language VARCHAR(32),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Creating conversations table...');
  await sql.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(255) DEFAULT 'New Discussion',
      user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Creating messages table...');
  await sql.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(36) PRIMARY KEY,
      conversation_id VARCHAR(36) REFERENCES conversations(id) ON DELETE CASCADE,
      role VARCHAR(32) NOT NULL,
      content TEXT NOT NULL,
      status VARCHAR(32) DEFAULT 'completed',
      model VARCHAR(120),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Creating sources table...');
  await sql.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id VARCHAR(36) PRIMARY KEY,
      message_id VARCHAR(36) REFERENCES messages(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      url VARCHAR(1000) NOT NULL,
      page_id VARCHAR(64),
      snippet TEXT NOT NULL,
      section_title VARCHAR(255),
      relevance_score FLOAT DEFAULT 0.0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Creating feedback table...');
  await sql.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id VARCHAR(36) PRIMARY KEY,
      message_id VARCHAR(36) REFERENCES messages(id) ON DELETE CASCADE,
      rating VARCHAR(16) NOT NULL,
      reason VARCHAR(120),
      comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Creating article_chunks table for hybrid RAG search...');
  await sql.query(`
    CREATE TABLE IF NOT EXISTS article_chunks (
      id VARCHAR(64) PRIMARY KEY,
      article_title VARCHAR(500) NOT NULL,
      article_url VARCHAR(1000) NOT NULL,
      page_id VARCHAR(64),
      section_heading VARCHAR(255),
      content TEXT NOT NULL,
      categories JSONB DEFAULT '[]',
      language VARCHAR(32) DEFAULT 'en',
      last_updated TIMESTAMPTZ DEFAULT NOW(),
      search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(article_title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(section_heading, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'C')
      ) STORED
    );
  `);

  await sql.query(`
    CREATE INDEX IF NOT EXISTS idx_article_chunks_search ON article_chunks USING GIN(search_vector);
  `);
  await sql.query(`
    CREATE INDEX IF NOT EXISTS idx_article_chunks_title ON article_chunks (article_title);
  `);
  await sql.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id);
  `);

  console.log('All migrations applied successfully to Neon PostgreSQL!');
}

migrate()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  });
