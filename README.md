# Justapedia AI

Justapedia AI is a local-first, source-grounded chatbot for Justapedia. The current implementation focuses on a strong Phase 1 MVP: live Justapedia retrieval, RAG orchestration, pluggable AI providers, streaming responses, PostgreSQL-backed chat history, source cards, and a polished Next.js chat UI.

## Repository layout

- `apps/api`: FastAPI backend
- `apps/web`: Next.js frontend
- `docs/phase-1-implementation-plan.md`: Phase 1 implementation plan and architecture notes
- `.env.example`: shared environment variable template
- `docker-compose.yml`: local PostgreSQL and Redis services

## Phase 1 status

Implemented in this repository:

- Justapedia API client with retries, timeout handling, and in-memory request caching
- keyword-based retrieval pipeline with chunking and scoring
- RAG prompt builder with strict untrusted-context separation
- AI provider abstraction with `mock` and `ollama` providers
- FastAPI routes for health, conversations, messages, streaming chat, search, article lookup, and feedback
- PostgreSQL-ready SQLAlchemy models for conversations, messages, sources, users, and feedback
- Next.js chat interface with conversation sidebar, streaming answer rendering, Markdown output, source cards, article actions, regenerate, stop, and feedback controls
- backend tests for prompting, retrieval, utilities, routing, and the streaming chat flow

Deferred to later phases:

- pgvector semantic search and indexing
- Redis-backed shared caching
- multilingual embedding retrieval
- Deep Research mode
- voice support
- admin analytics
- authentication and personalization

## Environment setup

Copy the template and adjust values as needed:

```powershell
Copy-Item '.env.example' '.env'
```

Important variables:

- `JUSTAPEDIA_API_URL`
- `AI_PROVIDER`
- `AI_MODEL`
- `OLLAMA_BASE_URL`
- `DATABASE_URL`
- `NEXT_PUBLIC_API_BASE_URL`

Recommended local defaults:

- `AI_PROVIDER=mock` for development without a local model
- `AI_PROVIDER=ollama` when Ollama is running locally
- `DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/justapedia_ai`

## Backend setup

From `apps/api`:

```powershell
python -m pip install alembic cachetools fastapi httpx pydantic-settings 'psycopg[binary]' python-multipart sqlalchemy 'uvicorn[standard]' pytest pytest-asyncio
```

Run the API server:

```powershell
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

OpenAPI documentation will be available at:

- `http://localhost:8000/docs`
- `http://localhost:8000/redoc`

## Frontend setup

From `apps/web`:

```powershell
npm install
npm run dev
```

The frontend will run at:

- `http://localhost:3000`

## Database and local services

The repository includes a `docker-compose.yml` file for PostgreSQL and Redis:

```powershell
docker compose up -d
```

During local development, the FastAPI app auto-creates tables on startup from the SQLAlchemy models. For later production hardening, schema changes should move behind explicit migrations.

## Verification

Backend tests:

```powershell
python -m pytest
```

Frontend lint:

```powershell
npm run lint
```

Frontend production build:

```powershell
npm run build
```

## How chat works

The current Phase 1 request flow is:

1. User sends a question from the Next.js UI.
2. FastAPI decides whether Justapedia retrieval is needed.
3. The Justapedia client searches and fetches relevant articles.
4. The retrieval service cleans, chunks, and ranks article passages.
5. The backend builds a grounded prompt with untrusted Justapedia context.
6. The selected AI provider streams the answer.
7. The backend persists the assistant message and source metadata.
8. The frontend renders the answer progressively and shows the source cards.

## Provider options

### Mock provider

Best for local UI and API development when you do not want model dependencies.

```env
AI_PROVIDER=mock
```

### Ollama provider

Best for free local LLM inference.

```env
AI_PROVIDER=ollama
AI_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://localhost:11434
```

## Notes

- Justapedia content is treated as untrusted reference material in prompts.
- Citations come from backend retrieval metadata, not from model-generated links.
- Secrets remain server-side only.
- The architecture is intentionally modular so semantic search, Redis, auth, and additional providers can be added later without rewriting the core chat flow.
