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

## Features

- Streaming chat answers (SSE)
- Hybrid RAG (keyword + vector retrieval)
- Chapter analysis and concept graphs
- Per-user rate limiting
- Mock or OpenAI providers (`LLM_PROVIDER=auto`)

## Scripts

| Command | Description |
|---------|-------------|
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
