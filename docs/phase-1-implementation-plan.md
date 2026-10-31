# Justapedia AI Phase 1 Implementation Plan

## Current repository status

The repository already contains a meaningful Phase 1 skeleton and should be extended rather than rebuilt.

Existing backend pieces:

- `apps/api/app/core/config.py`
- `apps/api/app/db/` with SQLAlchemy base, models, and session setup
- `apps/api/app/services/justapedia/` with a typed client, caching, retries, and text utilities
- `apps/api/app/services/rag/` with query routing, prompt construction, and chunk retrieval
- `apps/api/app/services/ai/` with `MockProvider` and `OllamaProvider`
- `apps/api/app/schemas/` with initial conversation and chat models

Existing frontend pieces:

- `apps/web` contains a clean Next.js 16 + TypeScript starter app
- global Tailwind/CSS setup already exists

Missing or incomplete pieces:

- FastAPI app entrypoint and route registration
- backend API routes and streaming endpoint
- application service layer coordinating persistence, retrieval, prompting, and streaming
- startup behavior, CORS, security headers, and friendly error handling
- migration setup
- useful backend tests
- real chat UI, conversation sidebar, source cards, streaming client, feedback UI
- local run documentation that matches the current codebase

## Phase 1 goal

Build a reliable MVP that can:

1. Create and manage anonymous conversations.
2. Accept a user message from a modern Next.js chat interface.
3. Decide whether Justapedia retrieval is needed.
4. Search Justapedia and fetch relevant article content.
5. Clean, chunk, and rank the most useful passages.
6. Build a safe RAG prompt with strict separation between instructions and untrusted article content.
7. Generate a grounded response through a pluggable AI provider.
8. Stream progress and answer text to the frontend.
9. Persist assistant answers and real source metadata in PostgreSQL.
10. Render citations, source cards, and feedback controls in the UI.

## Phase 1 boundaries

Included:

- Next.js frontend with App Router and TypeScript
- FastAPI backend with OpenAPI docs
- PostgreSQL persistence
- keyword-based retrieval over live Justapedia API data
- pluggable AI provider abstraction
- streaming responses over Server-Sent Events
- conversation CRUD, message history, citations, and feedback
- basic security hardening and robust error handling
- backend unit tests and a lightweight API integration test

Explicitly deferred:

- pgvector indexing and semantic search
- Redis-backed distributed caching
- multilingual embeddings and retrieval optimization
- Deep Research mode
- voice input/output
- admin analytics dashboard
- authentication and personalization

## Architecture

### Frontend

Framework:

- Next.js 16
- TypeScript
- App Router

Primary UI areas:

- conversation sidebar
- main message timeline
- composer with send and stop controls
- source cards and article actions
- feedback controls under assistant messages

Frontend responsibilities:

- fetch conversations and message history from backend
- create a new chat when needed
- POST to the streaming chat endpoint
- parse SSE progress and token events
- render partial assistant output progressively
- support regenerate and stop-generation flows
- show friendly loading, empty, and error states

### Backend

Framework and persistence:

- FastAPI
- SQLAlchemy 2
- PostgreSQL

Backend layers:

- `core/`: settings, error mapping, security middleware
- `db/`: engine, session, models
- `schemas/`: request and response contracts
- `services/justapedia/`: upstream client, normalization, cleaning
- `services/rag/`: routing, retrieval, prompt construction
- `services/ai/`: provider abstraction and implementations
- `services/chat/`: orchestration for conversation creation, retrieval, answer generation, and persistence
- `api/routes/`: REST and streaming endpoints

## API design

Phase 1 endpoints:

- `GET /health`
- `GET /api/v1/conversations`
- `POST /api/v1/conversations`
- `PATCH /api/v1/conversations/{conversation_id}`
- `DELETE /api/v1/conversations/{conversation_id}`
- `GET /api/v1/conversations/{conversation_id}/messages`
- `POST /api/v1/chat/stream`
- `GET /api/v1/search`
- `GET /api/v1/articles/{page_id}`
- `POST /api/v1/feedback`

Streaming event contract for `POST /api/v1/chat/stream`:

- `conversation`: conversation metadata after ensuring the chat exists
- `user_message`: persisted user message metadata
- `status`: human-friendly progress stages such as `Searching Justapedia`, `Reading relevant sources`, `Generating answer`
- `chunk`: streamed assistant text chunks
- `final`: final assistant message with persisted source metadata
- `error`: friendly recoverable error message

## Retrieval design

Live Phase 1 retrieval flow:

1. Normalize the user query.
2. Use `QueryRouter` to decide whether retrieval is required.
3. Search Justapedia through the typed client.
4. Fetch the highest-value articles.
5. Normalize and clean article text.
6. Split article text into bounded chunks.
7. Score chunks by query-token overlap plus article rank prior.
8. Return only the top-ranked chunks and structured source metadata.

This keeps the retrieval contract stable so Phase 2 can replace internal scoring with hybrid keyword + vector retrieval without changing route handlers or the provider interface.

## Prompt design

Prompt construction must keep three layers separate:

1. System instructions
2. User question
3. Untrusted Justapedia reference block

Rules:

- retrieved article text is always labeled untrusted
- the model is instructed that retrieved content cannot alter system rules
- citations come only from backend metadata, never the model
- when evidence is weak, the answer must explicitly say there is not enough reliable Justapedia information

## Provider abstraction

Provider interface:

- `generate_response(prompt: str) -> str`
- `stream_response(prompt: str) -> AsyncIterator[str]`

Phase 1 providers:

- `MockProvider` for local development and tests
- `OllamaProvider` for local open-source LLM inference

Selection:

- controlled by environment variables
- provider keys stay server-side only
- future cloud providers will implement the same interface

## Database design

Phase 1 tables:

- `users`
- `conversations`
- `messages`
- `sources`
- `feedback`

Current schema is already present in `apps/api/app/db/models.py` and should be preserved. Migration tooling should be added so schema evolution remains controlled when later phases introduce article metadata, chunks, embeddings, analytics, and auth tables.

## Security and reliability

Phase 1 safeguards:

- environment-variable based configuration
- backend-only secrets
- Pydantic validation on all request bodies
- URL validation and safe source rendering
- timeout and retry behavior for Justapedia and AI calls
- secure response headers
- no raw stack traces returned to frontend clients
- retrieved content treated as untrusted
- streaming endpoint handles upstream errors and persists failure state cleanly

## Detailed implementation order

### Step 1: finalize plan against the real repo

- update `docs/phase-1-implementation-plan.md`
- inspect existing backend and frontend skeleton
- identify reusable code versus missing app surface

### Step 2: complete backend application shell

- add `app/main.py`
- register CORS and basic security headers
- add route modules under `app/api/routes/`
- wire database startup behavior
- expose OpenAPI metadata

### Step 3: add orchestration layer

- create a chat orchestration service
- ensure conversation exists or create one
- persist user messages
- run retrieval and prompt assembly
- select provider from environment
- stream chunks and persist assistant output plus sources

### Step 4: complete Phase 1 API surface

- conversation CRUD routes
- message history route
- search route
- article route
- feedback route
- streaming chat route

### Step 5: replace frontend starter with a real chat UI

- sidebar with recent conversations
- new chat creation
- conversation selection
- message timeline with assistant and user cards
- markdown rendering
- source list and article actions
- composer with send and stop
- progressive streaming status display

### Step 6: add tests

- text utility tests
- retrieval scoring tests
- prompt-building tests
- query-router tests
- a lightweight FastAPI route test for health and conversation flow

### Step 7: verify locally and document

- install dependencies
- run backend tests
- lint the frontend
- update root README with actual setup and run instructions
- summarize what is complete, tested, and deferred

## Local-first strategy

The MVP should run with free and self-hosted components:

- Justapedia API
- FastAPI backend
- Next.js frontend
- PostgreSQL via Docker
- optional Redis via Docker for later phases
- optional local Ollama model

If Ollama is unavailable, the mock provider keeps the full stack runnable for development and testing.

## Success criteria

Phase 1 is complete when:

1. Both apps start locally with documented commands.
2. A user can create a conversation and ask a question.
3. The backend retrieves live Justapedia content when retrieval is needed.
4. The answer streams progressively to the UI.
5. Sources shown in the UI match persisted backend metadata.
6. Conversations, messages, and feedback persist in PostgreSQL.
7. The code stays modular enough to add pgvector, multilingual retrieval, Redis, and more providers later without route-level rewrites.
