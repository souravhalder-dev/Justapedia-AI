# Deploying Justapedia AI to Vercel

The **frontend** (`apps/web`) is a standard Next.js application that builds cleanly and deploys directly to **Vercel**.

Because the project is a monorepo containing both a FastAPI backend (`apps/api`) and a Next.js frontend (`apps/web`), follow one of the two straightforward deployment methods below:

---

## Architecture Overview

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│        Next.js Frontend         │ ----> │         FastAPI Backend         │
│     (Hosted on Vercel)          │  SSE  │ (Hosted on Render/Railway/VPS)  │
│  https://justapedia-ai.vercel   │       │ https://api-justapedia...com    │
└─────────────────────────────────┘       └─────────────────────────────────┘
                                                           │
                                                           ▼
                                                  Justapedia API & LLM
```

---

## Method 1: Deploying via Vercel Web Dashboard (Recommended)

1. Push your repository to **GitHub** (or GitLab/Bitbucket).
2. Go to **[vercel.com/new](https://vercel.com/new)** and import your GitHub repository.
3. In the **Configure Project** screen:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: Click **Edit** and choose `apps/web`.
4. Under **Environment Variables**, add:
   ```env
   NEXT_PUBLIC_API_BASE_URL=https://your-backend-api-url.com
   ```
5. Click **Deploy**. Vercel will build and assign you a live URL (e.g., `https://justapedia-ai.vercel.app`).

---

## Method 2: Deploying via Vercel CLI (Terminal)

Open PowerShell or terminal in `d:\justapedia\chatbot\apps\web`:

```bash
cd d:\justapedia\chatbot\apps\web
npx vercel
```

1. **Log in**: Follow the browser prompt to authenticate your Vercel account.
2. **Link Project**:
   - `Set up and deploy?` → **Y**
   - `Which scope?` → Select your personal or team account
   - `Link to existing project?` → **N**
   - `Project name?` → `justapedia-ai` (or your preferred name)
   - `In which directory is your code located?` → `./`
3. Deploy to **Production**:
   ```bash
   npx vercel --prod
   ```

---

## Deploying the Backend API (FastAPI)

The FastAPI server needs to be accessible from the internet so your Vercel frontend can connect to it. Recommended free/low-cost platforms for the backend:

### Option A: Render.com
1. Create a **New Web Service** pointing to your repository.
2. **Root Directory**: `apps/api`
3. **Build Command**: `pip install -r pyproject.toml` or `pip install -e .`
4. **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Copy your Render URL into Vercel as `NEXT_PUBLIC_API_BASE_URL`.

### Option B: Railway.app / Fly.io
1. Deploy from the `apps/api` folder using their CLI or GitHub connector.
2. Provide the environment variables from `apps/api/.env`.
