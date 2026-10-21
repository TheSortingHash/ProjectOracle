# DAP Policy Assistant

An internal policy chatbot for the Development Academy of the Philippines (DAP). Staff ask questions and get answers taken only from the policy documents administrators have uploaded. Every answer cites the page it came from, and the cited passage opens highlighted in a built-in PDF viewer.

This is a demo-ready rebuild of the Claude-artifact prototype (`reference/prototype.jsx`), following the handoff in `docs/HANDOFF.md`. What changed from the handoff, and why, is in `docs/DECISIONS.md`.

## What it does

| Feature | How it works |
|---|---|
| Upload and index PDFs | Admins drag and drop PDFs. The browser extracts text page by page. The server suggests metadata (title, issuance no., dates, office, what it amends). An admin confirms it. The document is then chunked by section, embedded, and goes live. |
| Grounded answers | Hybrid search (pgvector similarity + Postgres full-text, merged with reciprocal rank fusion) picks 8–18 passages. Claude must answer only from those. |
| Verified citations | The model cites passage IDs. The server keeps only IDs it actually sent, and anything else is removed and counted. Hover shows the real passage; click opens the PDF at that page with the text highlighted. |
| Amendment warnings | Driven by the admin-confirmed amendment table, not by the model guessing. If an older issuance is retrieved, the newer one is pulled in too. The model can only flag "possible conflict, verify". |
| Three personas | General Staff, Policy Maker, Program Manager. Each changes tone, structure and retrieval emphasis. Stored per message. |
| Scenario audit | Describe a planned activity. It is split into policy areas, each area is searched, and you get a grouped checklist (met / not met / unclear / cannot verify) and an overall status. |
| Forms | The model can only recommend forms from the admin's forms library, and each button downloads the real file. |
| Explain simply / Filipino | A plain-English and conversational Filipino version of any answer, cached after the first request. |
| History and usage | Conversations are saved per browser. The Admin Panel shows usage, token counts, an "unanswered questions" list (gaps in the corpus) and an admin audit trail. |
| Access control | A demo passcode for staff and a separate admin passcode. API keys never reach the browser. |

## Deploying to Vercel (step by step)

You need GitHub (already done: this repo), a Vercel account, and an Anthropic account. Plan on about 20 minutes.

### 1. Get your Anthropic API key

1. Go to **https://console.anthropic.com** and sign up or sign in. Use your work email if DAP will own the account.
2. Open **Settings → Billing** and add credits (prepaid). US$10–20 is plenty for a demo. Pricing is listed at https://www.anthropic.com/pricing.
3. Open **Settings → Limits** and set a **monthly spend limit**, so a demo can never run up a surprise bill.
4. Open **API Keys → Create Key**. Name it, for example, `dap-policy-assistant-demo`.
5. **Copy the key now** (it starts with `sk-ant-`). It is shown only once. Keep it somewhere safe, such as a password manager. Never paste it into code, chat, or a GitHub file.

Rough cost: a typical question sends about 8–12k tokens of policy excerpts to Claude Sonnet 5.5 and gets about 1k back, which is about US$0.03–0.04. A scenario audit costs a bit more. Metadata extraction, query planning and Simplify use Claude Haiku 5.5 and cost a fraction of a cent. The Usage tab shows exact token counts.

### 2. (Recommended) Get a Voyage AI key for vector search

Anthropic recommends Voyage AI for embeddings. Sign up at **https://dash.voyageai.com**, create an API key, and check its free token allowance on their pricing page. Without this key the app still works, but it uses keyword (full-text) search only, which misses paraphrased questions.

### 3. Import the repo into Vercel

1. Go to **https://vercel.com/new** and sign in with GitHub.
2. Import **`thesortinghash/projectoracle`**. Choose the branch you want to deploy, or merge this work to `main` first. Vercel detects Next.js automatically.
3. Click **Deploy**. The first deploy will work, but it will say setup is incomplete. That's expected.

### 4. Add a database (Neon Postgres)

1. In your Vercel project, open **Storage → Create Database → Neon (Serverless Postgres)** and accept the defaults. A Singapore region is closest to the Philippines.
2. Connect it to the project. Vercel adds `DATABASE_URL` automatically.
3. Nothing else is needed. The app creates its tables and enables `pgvector` on first use.

### 5. Add file storage (Vercel Blob)

1. **Storage → Create → Blob**. If asked for access, choose **Private**.
2. Connect it to the project. Vercel adds `BLOB_READ_WRITE_TOKEN`.
3. If you created a *public* store instead, also add `BLOB_ACCESS=public`. Files are still only linked from signed-in pages, but the blob URLs themselves would be public.

### 6. Add environment variables

**Settings → Environment Variables**, for Production (and Preview if you use it):

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the `sk-ant-…` key from step 1 |
| `VOYAGE_API_KEY` | from step 2 (optional) |
| `DEMO_PASSCODE` | the passcode you give staff |
| `ADMIN_PASSCODE` | a different, longer passcode for admins |
| `AUTH_SECRET` | a long random string, e.g. the output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Then go to **Deployments → ⋯ → Redeploy** so the new variables take effect.

### 7. Load documents

1. Open the site, enter the demo passcode, go to **Admin Panel**, and enter the admin passcode.
2. **Setup** should show green checks.
3. **Documents**: drag in your PDFs. For each one, click **Review & index**, check the pre-filled fields against the PDF, and record which earlier issuances it amends or supersedes. Then click **Confirm & index**.
4. Optional: add official forms under **Forms library**. Until you do, the assistant recommends no forms.
5. Back in **Chat**, ask away.

Scanned PDFs (images with no text layer) are flagged in the documents table. OCR is not enabled in the demo, so run those through OCR first (for example, Adobe Acrobat "Recognize Text").

### Logo

The build downloads the DAP logo from the link provided (`https://i.imgur.com/jaEbfAR.png`) into `public/brand/dap-logo.png`, and the vertical logo into `public/brand/dap-vertical.png`. If a download fails, the header shows a gold "DAP" badge instead. To avoid depending on third-party hosts, commit the two files into `public/brand/`, with permission from DAP communications.

## Running locally

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY at minimum
npm run dev                    # http://localhost:3000
```

Without `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`, it uses an embedded PGlite database and local files under `./.data/`. Without `DEMO_PASSCODE`, the passcode gate is off locally. The admin passcode gate is never off on Vercel.

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build and server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | unit tests (chunker, citation validation, session signing) |
| `npm run eval` | run `eval/golden.jsonl` against a deployment (costs API credits; see below) |

## Evaluation

`eval/golden.example.jsonl` shows the format. Copy it to `eval/golden.jsonl` and have DAP staff write 50–100 real questions with the expected issuance, page, and key facts. Include questions the corpus cannot answer, and questions about superseded rules. Then run:

```bash
EVAL_BASE_URL=https://your-app.vercel.app EVAL_PASSCODE=yourpasscode npm run eval
```

It reports, per metric, how many cases passed: refusal accuracy, retrieval, page, warning, answer content and checklist. Run it before and after any prompt or retrieval change.

## Project layout

```
src/app/                 pages and API route handlers
src/components/          chat UI, admin panel, PDF viewer
src/server/              server-only logic (never shipped to the browser)
  answer.ts              chat turn: plan → retrieve → Claude → validate → store
  answer-validate.ts     citation/form/warning validation (unit tested)
  retrieval.ts           hybrid search, RRF, lineage expansion
  ingest/                chunker and ingestion pipeline
  prompts/               versioned prompts and output schemas
  db/                    schema, migrations, driver selection
src/proxy.ts             passcode gate
docs/HANDOFF.md          original specification
docs/DECISIONS.md        deviations from the handoff and open items
reference/prototype.jsx  original artifact prototype (UI reference only)
```

## Before a wider pilot

These are still open, from handoff §13:

- **Data Privacy Act (RA 10173).** Get the DPO's sign-off on sending policy text and staff questions to the Anthropic API, and on how long chat logs are kept.
- **Hosting.** Vercel's free Hobby plan is for non-commercial use. A pilot should move to Vercel Pro or a DAP-approved host.
- **Sign-in.** Replace the shared passcodes with DAP Google Workspace or Microsoft sign-in.
- **Referral offices.** Confirm the office names in `src/lib/referrals.ts`.
