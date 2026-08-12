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
| `npm run eval:accuracy` | Run accuracy eval loop |
