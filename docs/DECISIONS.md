# Decisions and deviations from the handoff

The demo follows `docs/HANDOFF.md` except where noted here. Each item says what to change for production.

## Structured output: structured outputs instead of a forced tool call (§3.4)

The handoff asks for a forced `respond_to_policy_query` tool call. Current Sonnet/Opus models reject forced `tool_choice`. The app uses the Messages API **structured outputs** (`output_config.format` with a JSON schema, via the SDK's `messages.parse`) instead. This gives the same guarantee, a schema-valid object with no JSON scraped from text, and the schema matches §3.4 field for field. One addition: checklist items carry `policy_area` so the checklist can be grouped (§5.2).

## Models

- Answers: `claude-sonnet-5-5`, effort `medium` (`high` in Scenario Mode). Prompt caching is on the static rules block. Server-side refusal fallback (`fallbacks: "default"`) is enabled, so a false-positive safety decline is retried automatically. Set `DISABLE_REFUSAL_FALLBACK=1` to turn it off.
- Metadata extraction, query planning and Simplify: `claude-haiku-5-5`, effort `low`.
- Both can be overridden with `ANSWER_MODEL` / `FAST_MODEL`.

## Retrieval

- Hybrid search as specified: pgvector cosine + Postgres full-text, merged with reciprocal rank fusion. There is no separate reranker yet. Voyage `rerank` is the natural next step.
- Query rewriting (follow-ups) and scenario decomposition into policy areas share one small Haiku call. First-turn chat questions skip it.
- Model-facing passage and document IDs are short aliases (`C3`, `D2`) that the server maps back to real IDs. This makes citation errors easier to detect and cheaper to prevent.
- Embeddings: Voyage `voyage-4` at 1024 dimensions, behind the `Embedder` interface. Without `VOYAGE_API_KEY`, the app runs on full-text search only. **Re-index documents after adding the key.**

## Ingestion runs in-request, not on a job queue (§3.3)

Text extraction happens in the admin's browser (PDF.js), as in the prototype. The server then saves pages and extracts metadata. After the admin confirms, it chunks and embeds in one request with a 300-second limit. Status moves through the real states (`extracting → awaiting_metadata_review → chunking → embedding → indexed / failed`), and the UI polls them. This is fine for policy documents of up to a few hundred pages. For bulk loads, move `indexDocument()` to a queue (e.g. Vercel Queues or `pg-boss`). The function is already separate from the route.

## Not in the demo

| Handoff item | Status |
|---|---|
| OCR (§3.3 step 2) | Low-text pages are detected and flagged in the Admin Panel; OCR itself is not run. Add Tesseract or a cloud OCR in `registerDocument()`. |
| Streaming answers (§3.2 step 8) | Answers arrive in one piece, with a progress indicator. Streaming a structured response needs partial-JSON handling; worth adding once latency is measured. |
| SSO and per-user roles (§5.1, §5.7) | A shared demo passcode plus an admin passcode, with signed cookies. History is per browser, not per person. Personas are a free choice (open decision 3). |
| Checklist export (§5.2) | Not built. |

## Security notes

- API keys are read only in `src/server/` and never sent to the browser.
- Original PDFs and forms are served only through signed-in routes (`/api/documents/:id/file`, `/api/forms/:id`), from private Vercel Blob storage.
- Document text is wrapped in `<documents>` and the prompt states it is data, not instructions. Markdown is rendered without raw HTML.
- Rate limits: 10 questions per minute per browser, 15 simplifications per minute overall.
- Every upload, metadata confirmation, lineage change, form change and query is written to `audit_log`.

## Open decisions (owner)

These carry over from handoff §13: hosting, SSO provider, persona gating, DPO sign-off and log retention, corpus maintainer, launch forms, and native-Filipino answering. Also: confirm the referral office names in `src/lib/referrals.ts`.
