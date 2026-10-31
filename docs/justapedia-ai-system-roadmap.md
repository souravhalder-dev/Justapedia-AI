# Justapedia AI System Roadmap

## Product identity

Justapedia AI is not a generic chatbot. Its core identity is:

- Justapedia-powered search
- retrieval-augmented generation
- source-grounded answers with citations
- multilingual understanding and response
- voice-enabled interaction

The assistant may support a broader general-AI fallback mode, but factual answers should prioritize retrieved Justapedia evidence whenever relevant.

## Current implemented baseline

The repository already includes:

- FastAPI backend and Next.js frontend
- live Justapedia API integration
- keyword-based retrieval and chunk ranking
- source persistence and citations
- streaming chat responses
- conversation history and feedback
- answer modes: `auto`, `grounded`, `general`
- response language selection
- browser-based voice input and voice playback
- related article suggestions and follow-up question suggestions
- conversation-aware prompting for follow-up questions

## Core flow

The core flow to preserve and strengthen is:

1. User asks a question
2. System determines whether Justapedia grounding is needed
3. Search Justapedia
4. Retrieve and rank relevant article chunks
5. Build a safe RAG context
6. Generate an answer with citations
7. Stream the answer
8. Show sources, related articles, and follow-up questions

## Phase 2 priorities

### Hybrid retrieval

Add a dedicated search layer that combines:

- Justapedia keyword/API search
- semantic vector search
- metadata weighting
- optional reranking

This layer should expose retrieval debug metadata so results can be inspected and tuned.

### Article indexing pipeline

Add an indexing pipeline that:

- fetches articles from Justapedia
- normalizes and chunks article content
- stores article metadata and chunks
- generates embeddings
- writes embeddings into PostgreSQL with pgvector
- avoids duplicate indexing for unchanged content

### Database expansion

Add storage for:

- `articles`
- `article_chunks`
- `article_embeddings`
- optional indexing job metadata

This should preserve the existing `conversations`, `messages`, `sources`, and `feedback` tables.

### Redis caching

Use Redis for:

- Justapedia search and article caching
- repeated retrieval requests
- embedding generation caching
- repeated question caching where safe

## Multilingual architecture

Multilingual support should include:

- language-aware prompting
- a multilingual embedding model
- cross-language retrieval
- response generation in the user's preferred or detected language

Recommended direction:

- local embedding model through Sentence Transformers
- multilingual model such as a MiniLM or BGE multilingual variant

## Voice architecture

The current browser-based voice layer is a lightweight MVP.

For a stronger production voice stack:

- speech-to-text endpoint under `services/voice/`
- optional local transcription provider
- optional text-to-speech provider
- graceful fallback to browser APIs when backend voice services are unavailable

## Security priorities

The system should continue expanding:

- strict prompt separation
- request validation and size limits
- rate limiting
- safer rendering of external content
- authentication and role checks for admin features
- secure error handling without leaking internals

## Suggested backend target structure

```text
apps/api/app/
├── api/
├── core/
├── db/
├── schemas/
├── services/
│   ├── ai/
│   ├── chat/
│   ├── embeddings/
│   ├── justapedia/
│   ├── rag/
│   ├── search/
│   └── voice/
└── main.py
```

## Suggested implementation order

1. Keep the current core RAG flow stable
2. Add article and chunk persistence models
3. Add indexing and embedding generation
4. Add pgvector-based retrieval and hybrid ranking
5. Add Redis caching
6. Add stronger voice services
7. Add analytics, auth, and admin tools

## Success criteria

The full system should eventually support:

- multilingual questions in natural language
- source-grounded answers with real Justapedia citations
- strong follow-up question understanding
- hybrid keyword + semantic retrieval
- article summarization and exploration
- voice input and voice output
- reliable streaming and conversation history
- modular AI provider replacement without route rewrites
