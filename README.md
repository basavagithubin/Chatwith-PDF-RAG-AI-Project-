# PDFChat

Chat with your PDFs — upload documents, ask questions, get streaming answers, chapter analysis, and interactive concept graphs.

## Stack

- **API** — Express, TypeScript, BullMQ, pgvector, PDF processing
- **Web** — Vite, React, Tailwind
- **Local dev** — PGlite + Redis (in-memory)

## Quick start

```bash
npm install
cp .env.example .env
npm run dev:local
```

- Frontend: http://localhost:4173/
- API: http://localhost:5000

## Docker

Runs Postgres (pgvector), Redis, the API, and an nginx frontend. Postgres and Redis stay on the internal network. The API is bound to localhost only; the UI is on port 8080.

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and REDIS_PASSWORD before any public deploy
docker compose up --build
```

- App: http://localhost:8080
- API (host only): http://127.0.0.1:5000

## Vercel (frontend only)

The Express API uses Redis, BullMQ workers, and local PDF storage, so it cannot run as a Vercel serverless function. Deploy **`apps/web`** on Vercel and host the API with Docker, Railway, Render, or a VM.

1. Import this GitHub repo in Vercel. Leave **Root Directory** as the repository root so `vercel.json` is used.
2. Vercel installs and builds only the web app (`npm install --prefix apps/web`). Native API packages are not installed, which avoids production build crashes.
3. Set these **Production** environment variables in the Vercel project, then redeploy:

| Variable | Value |
|----------|--------|
| `VITE_API_BASE_URL` | Public API URL, e.g. `https://api.example.com/api` (not `localhost`) |
| `VITE_INSFORGE_URL` | Optional InsForge project URL |
| `VITE_INSFORGE_ANON_KEY` | Optional InsForge anon key |

4. On the API host, add the Vercel origin to `CORS_ORIGINS` (for example `https://your-app.vercel.app`) and restart the API.

`VITE_*` values are baked in at build time. Changing them requires a new Vercel deploy.

Production checklist:

- Change `POSTGRES_PASSWORD` and `REDIS_PASSWORD`
- Set `AUTH_REQUIRED=true` plus `VITE_INSFORGE_URL` and `VITE_INSFORGE_ANON_KEY`
- Set `CORS_ORIGINS` to your public origin
- Rebuild the web image after changing any `VITE_*` value

```bash
docker compose down
```

## Security

- Helmet headers, CORS allowlist, and rate limits on the API
- Optional InsForge JWT checks (`AUTH_REQUIRED=true`)
- PDF-only uploads with size, checksum, and `%PDF-` magic-byte checks
- UUID path checks so document IDs cannot traverse storage
- Production errors do not leak stack details; `/health` hides provider names unless `HEALTH_DETAILS=true`

## Features

- Streaming chat answers (SSE)
- Hybrid RAG (keyword + vector retrieval)
- Chapter analysis and concept graphs
- Per-user rate limiting
- Mock or OpenAI providers (`LLM_PROVIDER=auto`)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run docker:up` | Build and start the full Docker stack |
| `npm run docker:down` | Stop the Docker stack |
| `npm run dev:local` | Start Postgres, Redis, API, and web |
| `npm run build` | Build all workspaces |
| `npm run eval:accuracy` | Score answers against the gold set and compare to the baseline |
| `npm run eval:baseline` | Freeze the current run as the comparison baseline |
| `npm run eval:ground` | Recompute gold `expectedPages` from raw page text |
| `npm run reprocess:all` | Re-extract, re-chunk, and re-embed every document |
| `npm run inspect:state` | Show per-document page/chunk/embedding counts |

## Accuracy workflow

Accuracy is tracked with a gold Q&A set in `apps/api/evals/gold-questions.json`, scored on
retrieval hit rate, retrieval recall, key-fact coverage, and refusal behaviour on
out-of-scope questions.

Ground truth is derived from the raw page text rather than from the retrieval pipeline —
edit each question's `groundTruthTerms` and run `npm run eval:ground` to recompute the
expected pages, so retrieval is never scored against itself.

```bash
npm run eval:baseline    # record where you are today
# ...make a change...
npm run eval:accuracy    # prints the delta against the baseline
```

### Switching to real OpenAI

Embeddings written by one provider are meaningless to another, so the index must be
rebuilt after changing providers:

```bash
# set OPENAI_API_KEY in .env, then
npm run dev:local        # restart so the API picks up the key
npm run reprocess:all    # rebuild pages, chunks, and embeddings
npm run eval:accuracy    # measure the gain
```

`GET /health` reports which providers are actually active.

### OCR

Pages with little or no text layer fall back to OCR via `tesseract.js`, rendered with the
prebuilt `@napi-rs/canvas` (no native toolchain required). Tune with `OCR_RENDER_SCALE`
and `OCR_LANGUAGE`.
