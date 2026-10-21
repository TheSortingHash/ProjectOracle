// Runs the golden question set against a running deployment and reports
// retrieval, refusal, warning and answer checks. Every question is a real
// model call, so this costs API credits.
//
//   EVAL_BASE_URL=https://your-app.vercel.app EVAL_PASSCODE=... npm run eval [-- eval/golden.jsonl]
import { readFileSync } from "node:fs";

type Case = {
  id: string;
  persona: "general_staff" | "policy_maker" | "program_manager";
  mode: "chat" | "scenario";
  question: string;
  expect: {
    found: boolean;
    documents?: string[]; // substrings of issuance no. or title that should be cited
    pages?: number[];
    warning?: boolean;
    answer_contains?: string[];
    checklist_min?: number;
  };
};

type Payload = {
  foundInDocuments: boolean;
  answer: string;
  warnings: { kind: string }[];
  citations: { documentTitle: string; issuanceNo: string | null; pageStart: number; pageEnd: number }[];
  checklist: unknown[];
};

const base = (process.env.EVAL_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const file = process.argv[2] ?? "eval/golden.jsonl";
const cases: Case[] = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

async function main() {
  let cookie = "";
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.EVAL_PASSCODE ?? "" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (!login.ok) throw new Error(`Login failed (${login.status}). Set EVAL_PASSCODE.`);

  const rows: { id: string; checks: Record<string, boolean> }[] = [];
  for (const c of cases) {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ conversationId: null, message: c.question, persona: c.persona, mode: c.mode }),
    });
    if (!res.ok) {
      rows.push({ id: c.id, checks: { request: false } });
      console.error(c.id, res.status, await res.text());
      continue;
    }
    const p = ((await res.json()) as { assistant: { payload: Payload } }).assistant.payload;
    const checks: Record<string, boolean> = { refusal: p.foundInDocuments === c.expect.found };
    const cited = p.citations.map((x) => `${x.issuanceNo ?? ""} ${x.documentTitle}`.toLowerCase());
    if (c.expect.documents)
      checks.retrieval = c.expect.documents.every((d) => cited.some((x) => x.includes(d.toLowerCase())));
    if (c.expect.pages)
      checks.pages = c.expect.pages.every((pg) => p.citations.some((x) => x.pageStart <= pg && pg <= x.pageEnd));
    if (c.expect.warning !== undefined)
      checks.warning = p.warnings.some((w) => w.kind === "confirmed") === c.expect.warning;
    if (c.expect.answer_contains)
      checks.answer = c.expect.answer_contains.every((s) => p.answer.toLowerCase().includes(s.toLowerCase()));
    if (c.expect.checklist_min !== undefined) checks.checklist = p.checklist.length >= c.expect.checklist_min;
    rows.push({ id: c.id, checks });
    console.log(`${Object.values(checks).every(Boolean) ? "PASS" : "FAIL"}  ${c.id}  ${JSON.stringify(checks)}`);
  }

  const metrics = new Map<string, { pass: number; total: number }>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.checks)) {
      const m = metrics.get(k) ?? { pass: 0, total: 0 };
      m.total++;
      if (v) m.pass++;
      metrics.set(k, m);
    }
  console.log("\nMetric          pass/total");
  for (const [k, m] of metrics) console.log(`${k.padEnd(16)}${m.pass}/${m.total}`);
  const allPass = rows.every((r) => Object.values(r.checks).every(Boolean));
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
