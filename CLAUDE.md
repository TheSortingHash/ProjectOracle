# DAP Policy Assistant

Internal RAG chatbot for Development Academy of the Philippines policies. Next.js 16 (App Router), TypeScript, Tailwind v4, Drizzle on Postgres + pgvector (PGlite locally), Anthropic TypeScript SDK, Voyage embeddings, Vercel Blob.

Full spec: docs/HANDOFF.md. Deviations: docs/DECISIONS.md. Prototype UI reference: reference/prototype.jsx (UI behavior only; do not copy its data flow).

@AGENTS.md

## Non-negotiables
- Answers come only from retrieved chunks. No outside knowledge.
- Model output is schema-constrained (structured outputs via `structuredCall` in src/server/llm/client.ts). Never parse JSON from free text.
- Citations are chunk aliases validated server-side (src/server/answer-validate.ts).
- Amendment warnings come from the document_lineage table.
- No secrets in client code; anything importing a key lives in src/server/ with `import "server-only"`.

## Commands
- dev: npm run dev (uses ./.data PGlite + local uploads when DATABASE_URL / BLOB_READ_WRITE_TOKEN are unset)
- checks: npm run lint && npm run typecheck && npm test
- build: npm run build
- eval: EVAL_BASE_URL=... EVAL_PASSCODE=... npm run eval

## Conventions
- Server logic in src/server/. Prompts in src/server/prompts/ as versioned files (`*.v1.ts`); bump the version when changing behavior.
- DB schema changes: append a migration to src/server/db/migrations.ts (never edit a shipped one) and mirror it in schema.ts.
- Brand tokens in src/app/globals.css: dap-blue #1C2790, dap-gold #CDAE2C.
- PDF.js: use the legacy build (src/lib/pdf-client.ts); the modern build needs very recent browsers.
