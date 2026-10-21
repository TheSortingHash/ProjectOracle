# DAP Policy Assistant: Handoff for Claude Code

**Owner:** Joseph Hans M. Ancheta (Dean), Finance Department, Development Academy of the Philippines
**Status:** Working browser prototype (single React artifact). Moving to a production-grade web app.
**Purpose of this document:** Give Claude Code everything needed to rebuild the prototype as a scalable, secure internal application without access to the original chat history.

---

## 1. What this application is

An internal policy chatbot for DAP staff. Users ask questions about DAP internal policies (administrative orders, memorandum circulars, program guidelines, travel and procurement manuals) and get answers grounded only in documents that admins have uploaded. No outside knowledge is allowed in answers.

The app adapts answers to three user roles, can audit a described scenario against policy, flags amended rules, cites sources down to the page, links to a PDF viewer, suggests forms, and can restate any answer in plain English and Filipino.

---

## 2. Current prototype: what exists

Single-file React component (`App.jsx`) rendered as a Claude artifact. Paste the latest artifact code into `reference/prototype.jsx` in the new repo so Claude Code can read it for UI behavior. Do not reuse its data flow.

### 2.1 Layout
- Top nav bar (DAP Blue) with header logo, title "Policy Assistant", subtitle "Development Academy of the Philippines", and two tabs: **Chat Interface** and **Admin Panel**. Right side shows indexed document count.
- Collapsible left sidebar (240px) in Chat: role dropdown, Scenario Mode toggle, active persona badge, list of indexed documents (clickable to open viewer).
- Central chat window. User bubbles right-aligned in DAP Blue. Assistant bubbles left-aligned, white, with bot avatar and persona badge above.

### 2.2 Features as built
| Feature | Prototype behavior |
|---|---|
| Multi-PDF upload | Drag and drop or browse, multiple files. Text extracted in browser with PDF.js (page-delimited). |
| Ingestion status | Four-step bar: Extracting Text, Chunking, Embedding, Saving to Vector DB. Only step 1 is real; steps 2 to 4 are timed animations. |
| Indexed policies table | Document name, date, size, characters extracted, status, remove action. |
| Role personas | General Staff, Policy Maker, Program Manager. Implemented only as text injected into the system prompt. Switching role clears history. |
| Persona badge | Shown above each assistant reply. |
| Amendment warnings | Yellow alert box: "The [Year] rule was amended by [Newer Document]." Populated only if the model decides to. |
| Citations | List of document plus page under each reply. Hover shows a text snippet (first 280 characters of the document, not the cited page). Click opens PDF viewer at page 1. |
| PDF viewer | Modal, PDF.js canvas render, page next/previous. |
| Scenario Mode | Toggle switches input to a 4-row textarea (Ctrl+Enter submits). Reply renders a checkbox compliance checklist. |
| Form download buttons | Rendered from model output. Buttons do nothing; no forms exist. |
| Simplify / Tagalog | Button under each reply. Separate API call returns plain English and Filipino versions. |

### 2.3 How the prototype calls the model
- Browser calls `https://api.anthropic.com/v1/messages` directly (works only inside the artifact sandbox).
- Model: `claude-sonnet-4-20250514`.
- The full extracted text of every uploaded PDF is placed in the system prompt on every request.
- Conversation history is sent as text turns.
- Model is told to reply with a JSON object: `answer`, `warnings[]`, `citations[]`, `forms[]`, `complianceChecklist[]`. Client parses it with a multi-step extractor.

### 2.4 Known problems (reasons to rebuild, not patch)
1. **Not real RAG.** All document text is re-sent on every query. Cost and latency scale with corpus size, and it will hit context limits once DAP uploads a realistic policy library.
2. **API key exposure.** Any deployment outside the artifact would put the key in the browser.
3. **Fragile structured output.** JSON-in-text parsing has failed repeatedly, especially in Scenario Mode with long checklists. Raw JSON leaked into the chat more than once.
4. **Citations are unverified.** The model writes the document name and page as free text. Nothing checks that the cited page contains the claim. The viewer always opens at page 1.
5. **Amendment detection is a guess.** It relies on the model noticing supersession language within one prompt. No document metadata or lineage exists.
6. **Forms are fictional.** The model may invent form names. Buttons are not wired to files.
7. **No persistence.** Documents and chats vanish on reload. No users, no audit trail.
8. **No OCR.** Scanned PDFs produce empty text.
9. **Personas are tone only.** Same retrieval, same UI, no access control.

---

## 3. Target architecture

### 3.1 Recommended stack
Adjust if DAP ICT has standards; flag conflicts rather than silently swapping.

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | Next.js (App Router), TypeScript, Tailwind | Server routes hold the API key. |
| Database | PostgreSQL with `pgvector` | One store for documents, chunks, embeddings, chats, audit logs. |
| Embeddings | Voyage AI (Anthropic's recommended embedding provider) | Confirm current model name in Voyage docs. Keep the embedding call behind an interface so the provider can change. |
| LLM | Anthropic Messages API via official TypeScript SDK | Answering on a Sonnet-class model; Simplify/Tagalog and metadata extraction on a Haiku-class model. Check docs.claude.com for current model strings before coding. |
| PDF parsing | `pdfjs-dist` server-side, page by page | Keep page numbers on every chunk. |
| OCR fallback | Tesseract (via `tesseract.js` or a worker container) | Trigger when a page yields little or no text. |
| Background jobs | Postgres-backed queue (e.g. `pg-boss`) or BullMQ + Redis | Ingestion must not run inside a request. |
| File storage | Local disk or S3-compatible bucket | Originals kept for the viewer. |
| Auth | DAP Google Workspace or Microsoft SSO, whichever DAP uses | Confirm with ICT. Roles stored in DB. |

### 3.2 Request flow (chat)
1. User sends message with role and mode.
2. Server rewrites the query if needed (follow-ups that depend on history), then runs hybrid retrieval: vector similarity plus Postgres full-text search, merged and reranked. Return top 8 to 12 chunks.
3. Server attaches lineage for each retrieved document (what it supersedes, what supersedes it).
4. Server calls Claude with: system prompt (persona block + rules), retrieved chunks each tagged with `chunk_id`, `document_title`, `issuance_no`, `effectivity_date`, `page`, plus the allowed forms list.
5. Claude must answer through a forced tool call (see 3.4). No free-text JSON.
6. Server validates every citation `chunk_id` against the chunks it sent. Drop or flag any citation that does not match.
7. Server stores the turn and returns the structured payload to the client.
8. Stream the `answer` field to the UI if feasible; render warnings, checklist, forms, citations once the tool call completes.

### 3.3 Ingestion flow
1. Admin uploads one or more PDFs. Originals saved. Job queued per file.
2. Extract text per page. OCR any page under a text threshold.
3. LLM-assisted metadata extraction (Haiku-class): title, issuance type (AO, MC, Office Order, Guideline, Manual), issuance number, date issued, effectivity date, issuing office, and any documents it says it amends, supersedes, or repeals.
4. Admin reviews and confirms metadata in the Admin Panel before the document goes live. This is the source of truth for amendment warnings.
5. Chunk by structure where possible (section headings, numbered provisions), otherwise ~500 to 800 tokens with overlap. Every chunk keeps `document_id`, `page_start`, `page_end`, `section_label`.
6. Embed chunks and write to `pgvector`.
7. Status moves through real states: `uploaded`, `extracting`, `ocr`, `awaiting_metadata_review`, `chunking`, `embedding`, `indexed`, `failed`. The four-step progress UI from the prototype maps onto these.

### 3.4 Structured output via tool use
Define one tool, `respond_to_policy_query`, and force it with `tool_choice: { type: "tool", name: "respond_to_policy_query" }`. Suggested input schema:

```json
{
  "type": "object",
  "required": ["answer", "found_in_documents", "citations"],
  "properties": {
    "found_in_documents": { "type": "boolean" },
    "answer": { "type": "string", "description": "Markdown allowed. Plain prose for General Staff." },
    "warnings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["older_document_id", "newer_document_id", "topic"],
        "properties": {
          "older_document_id": { "type": "string" },
          "newer_document_id": { "type": "string" },
          "topic": { "type": "string" }
        }
      }
    },
    "citations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["chunk_id"],
        "properties": {
          "chunk_id": { "type": "string" },
          "supports": { "type": "string", "description": "Short note on which claim this supports." }
        }
      }
    },
    "forms": {
      "type": "array",
      "items": { "type": "string", "description": "Form ID from the allowed forms list only." }
    },
    "compliance_checklist": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["requirement", "status", "chunk_id"],
        "properties": {
          "requirement": { "type": "string" },
          "status": { "type": "string", "enum": ["met", "unmet", "unclear", "cannot_verify"] },
          "chunk_id": { "type": "string" }
        }
      }
    },
    "compliance_summary": {
      "type": "object",
      "properties": {
        "overall": { "type": "string", "enum": ["compliant", "partially_compliant", "non_compliant", "cannot_determine"] },
        "gaps": { "type": "string" },
        "next_steps": { "type": "string" }
      }
    }
  }
}
```

The server resolves `chunk_id` to document title, issuance number, and page for display. The model never writes display citation strings itself. Warnings are cross-checked against the lineage table; a warning the lineage table does not support is shown as "possible conflict, verify" rather than as a confirmed amendment.

### 3.5 Prompt caching
Put the static system prompt (rules, persona block, forms list) first and mark it for caching. Retrieved chunks change per query and go after the cache breakpoint.

---

## 4. Data model (starting point)

```
users            (id, email, name, role, office, created_at)
documents        (id, title, issuance_type, issuance_no, date_issued, effectivity_date,
                  issuing_office, file_path, page_count, status, uploaded_by, metadata_confirmed_by,
                  created_at, updated_at, is_active)
document_lineage (id, older_document_id, newer_document_id, relation  -- amends | supersedes | repeals,
                  scope_note, confirmed_by, created_at)
chunks           (id, document_id, page_start, page_end, section_label, content,
                  tsv tsvector, embedding vector(N), token_count)
ingestion_jobs   (id, document_id, state, error, started_at, finished_at)
forms            (id, name, description, file_path, topics text[], is_active)
conversations    (id, user_id, role_at_start, created_at)
messages         (id, conversation_id, sender, content, persona, mode, payload jsonb,
                  retrieved_chunk_ids text[], input_tokens, output_tokens, created_at)
simplifications  (message_id, plain_english, filipino, created_at)
audit_log        (id, user_id, action, target_type, target_id, detail jsonb, created_at)
```

---

## 5. Feature specifications

### 5.1 Roles and personas
Persona is a config object, not scattered strings:

```ts
type Persona = {
  key: "general_staff" | "policy_maker" | "program_manager";
  label: string;
  badgeColors: { bg: string; fg: string };
  promptBlock: string;      // tone and structure rules
  retrievalBoost?: string[]; // optional issuance types or tags to favor
};
```

Behavior per persona (carry these into `promptBlock`):

- **General Staff:** plain language, no jargon, explain any unavoidable term. Order: direct answer, short explanation, numbered steps if procedural, forms, citations. Focus on leave, travel, attendance, reimbursements, office procedure.
- **Policy Maker:** precise and formal. Lead with any amendment warning. Name issuance numbers, effectivity dates, issuing office. When two documents conflict, present both and state which is later. When asked to help draft, flag conflicts with existing issuances and list what the new issuance should reference or repeal; do not draft the full issuance.
- **Program Manager:** exact amounts, thresholds, deadlines, approving authority. Numbered procedures. Use program-specific guidelines (PMDP, BAGANI, others in the corpus) over general rules when both exist, and say when no program-specific document was found.

Open question for the owner: should Policy Maker and Program Manager be gated by user role, or remain a free choice in the sidebar as in the prototype?

### 5.2 Scenario Mode
- Sidebar toggle; input becomes a textarea; submit button reads "Audit".
- Retrieval should run multiple sub-queries (one per policy area detected in the scenario: travel, procurement, honoraria, leave, etc.) and merge results, since a single embedding of a long scenario retrieves poorly.
- Render checklist grouped by policy area. Status icons for `met`, `unmet`, `unclear`, `cannot_verify`. Each item links to its citation.
- Render compliance summary below the checklist.
- Offer "Export checklist" (PDF or DOCX) as a later enhancement.

### 5.3 Amendment and conflict warnings
- Source of truth is `document_lineage`, confirmed by an admin.
- After retrieval, if any retrieved chunk belongs to a document that has a newer amending or superseding document, show the warning even if the model did not raise it.
- Copy: "Warning: The [year] rule in [older issuance] was amended by [newer issuance]."
- If the newer document is also retrieved, prefer it. If it is not, retrieve from it explicitly before answering.

### 5.4 Citations and PDF viewer
- Citations show issuance number or title plus page.
- Hover card shows the actual cited chunk text (not the start of the document), document title, page.
- Click opens the viewer at the cited page with the cited text highlighted (PDF.js text layer search for the chunk's first sentence is good enough for v1).
- Viewer: page navigation, zoom, download original, close on Escape or backdrop.

### 5.5 Forms
- Admin maintains a `forms` library with real files.
- The allowed form IDs and names are passed to the model; schema restricts the model to those IDs.
- Buttons download the real file. Unknown IDs are dropped server-side.

### 5.6 Simplify / Filipino
- Button under each assistant message.
- Separate endpoint, Haiku-class model, forced tool call returning `{ plain_english, filipino }`.
- Must not add facts not in the original answer. Cache result in `simplifications`.
- Filipino should be conversational; Taglish is acceptable where it reads more naturally.

### 5.7 Chat history
- Conversations persist per user. Sidebar or drawer to reopen past conversations.
- Role and mode stored per message, not only per conversation.

### 5.8 Admin Panel
- Multi-file drag and drop upload.
- Per-file live status from `ingestion_jobs` (poll or server-sent events).
- Metadata review form after extraction; document is not searchable until confirmed.
- Lineage editor: pick "this document amends / supersedes / repeals" another document.
- Indexed policies table: title, issuance no., effectivity date, pages, status, uploaded by, actions (view, edit metadata, re-index, deactivate).
- Forms library management.
- Usage view: queries per day, tokens, top unanswered questions (where `found_in_documents = false`). The unanswered list tells admins which documents are missing.

### 5.9 Out-of-scope and refusals
When retrieval returns nothing relevant or the model sets `found_in_documents = false`, show: "I cannot find this information in the uploaded DAP policy documents." Then show the referral office if a topic match exists (see section 8).

---

## 6. System prompt baseline

Carry these rules into the cached system prompt. Persona block is appended per request.

1. Answer only from the provided document chunks. No outside knowledge.
2. If the chunks do not answer the question, set `found_in_documents` to false and say so. Do not guess.
3. Every factual claim must be supported by at least one `chunk_id` in `citations`.
4. Never invent issuance numbers, amounts, dates, names, or forms.
5. When chunks from an older and a newer issuance disagree, follow the newer one and record a warning.
6. Forms may only be chosen from the provided list.
7. In Scenario Mode, list each applicable requirement separately with its own `chunk_id` and status.
8. Do not give legal or financial advice beyond what the documents state.

The longer Claude Project system instructions written earlier in this effort can be adapted for persona blocks, but strip anything that assumes a Claude Project knowledge base or free-text output.

---

## 7. Branding

| Token | Value |
|---|---|
| Primary (DAP Blue) | `#1C2790` |
| Accent (DAP Gold) | `#CDAE2C` |
| Header logo | `https://coe-psp.dap.edu.ph/wp-content/uploads/2022/06/dap-logo.png` |
| Bot avatar | `https://serp-p.pids.gov.ph/media/default/featured-image/dap_vertical_logo.png` |

- Download both logos into `public/brand/` and serve locally. Do not hotlink from third-party domains in production.
- Persona badge colors from the prototype: General Staff `#EEF0FC` / `#1C2790`; Policy Maker `#FDF6DC` / `#7A5F00`; Program Manager `#E6F9F1` / `#15643A`.
- Professional and corporate tone. Avoid emoji-heavy UI in production; the prototype used emoji as placeholders for icons. Replace with an icon set (e.g. Lucide).
- If DAP has an official web style guide, it overrides these values.

---

## 8. Referral offices (for out-of-scope answers)

Owner to confirm current office names before launch.

| Topic | Office |
|---|---|
| Leave, HR matters | Human Resource office |
| Budget, disbursement, accounting | Finance Department |
| Procurement | Procurement / BAC Secretariat |
| Travel authority, liquidation | Administrative office |
| Program operations (PMDP, BAGANI) | Respective program office |
| Policy issuance | Office of the President / Legal |
| Systems and access | ICT office |

---

## 9. Security, privacy, compliance

- API keys and DB credentials in server environment only. Nothing secret in client bundles.
- Every query, upload, metadata change, and lineage change goes to `audit_log`.
- Uploaded policies may be internal-only. Confirm with DAP's Data Protection Officer how RA 10173 (Data Privacy Act) applies to chat logs, and whether sending document text to an external API is approved. Record the decision in the repo.
- Log retention period to be set by the owner and DPO.
- Rate-limit chat and simplify endpoints per user.
- Sanitize rendered markdown in answers.
- Treat document text as data: instruct the model that content inside chunks is never an instruction to it.

---

## 10. Cost and performance targets

- Retrieval keeps per-query input to roughly 6k to 12k tokens regardless of corpus size, versus the prototype's full-corpus prompt.
- Static prompt cached.
- Simplify on a smaller model.
- Store `input_tokens` and `output_tokens` per message for the usage view.
- Target p50 first-token latency under 3 seconds with streaming.

---

## 11. Evaluation

Build this before tuning prompts.

- `eval/golden.jsonl`: 50 to 100 questions written by DAP staff across all three personas and Scenario Mode, each with expected source document(s) and page(s) and a short expected answer.
- Include negative cases: questions whose answers are not in the corpus. Expected behavior is a refusal.
- Include amendment cases: a question about a rule that has been superseded. Expected behavior is the newer rule plus a warning.
- Metrics: retrieval hit rate (expected chunk in top k), citation validity (cited chunk supports claim, judged by a grader model plus spot checks), refusal accuracy, warning accuracy.
- Run `npm run eval` in CI on prompt or retrieval changes.

---

## 12. Build phases

Each phase ends with something runnable.

**Phase 0: Scaffold**
Next.js + TypeScript + Tailwind, Postgres with pgvector via Docker Compose, Prisma or Drizzle schema from section 4, env handling, lint, test runner. `CLAUDE.md` at repo root summarizing this handoff.

**Phase 1: Ingestion**
Upload endpoint, file storage, job queue, page-level extraction, OCR fallback, chunking, embeddings, real status UI, indexed documents table. Seed with 3 to 5 real DAP policy PDFs supplied by the owner.

**Phase 2: Retrieval + core chat**
Hybrid search, reranking, forced tool-call answers, server-side citation validation, streaming chat UI, persona config, refusal path.

**Phase 3: Policy features**
Metadata review and lineage editor, amendment warnings from lineage, Scenario Mode with multi-query retrieval and grouped checklist, forms library and real downloads, Simplify / Filipino endpoint.

**Phase 4: Viewer and history**
PDF viewer opening at cited page with highlight, hover previews using actual chunk text, persistent conversations.

**Phase 5: Auth, admin, hardening**
SSO, role storage, admin-only routes, audit log, rate limits, usage dashboard, unanswered-questions report.

**Phase 6: Evaluation and pilot**
Golden set, eval script, fix regressions, pilot with a small group from one department, collect feedback.

---

## 13. Open decisions for the owner

1. Hosting: DAP on-premise server or a cloud provider? Any government cloud requirements from DAP ICT?
2. SSO provider used by DAP staff.
3. Are personas user-selectable or tied to the logged-in user's role?
4. DPO sign-off on sending policy text and staff questions to the Anthropic API, and on log retention.
5. Who maintains the corpus and confirms metadata and lineage after each new issuance?
6. Which forms go into the forms library at launch, and their official file versions.
7. Is a Filipino answer mode needed beyond the Simplify button (e.g. answer natively in Filipino when asked in Filipino)?

---

## 14. Suggested `CLAUDE.md` for the repo

```md
# DAP Policy Assistant

Internal RAG chatbot for Development Academy of the Philippines policies.
Full spec: docs/HANDOFF.md. Prototype UI reference: reference/prototype.jsx (UI behavior only; do not copy its data flow).

## Non-negotiables
- Answers come only from retrieved chunks. No outside knowledge.
- Model output goes through the forced tool `respond_to_policy_query`. Never parse JSON from free text.
- Citations are chunk IDs validated server-side.
- Amendment warnings come from the document_lineage table.
- No secrets in client code.

## Commands
- dev: npm run dev
- db: docker compose up -d && npm run db:migrate
- test: npm test
- eval: npm run eval

## Conventions
- TypeScript strict. Server logic in src/server/. Prompts in src/server/prompts/ as versioned files.
- Brand tokens in tailwind config: dap-blue #1C2790, dap-gold #CDAE2C.
```
