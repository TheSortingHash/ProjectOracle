import "server-only";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { PERSONAS, type PersonaKey } from "@/lib/personas";
import type { AssistantPayload, ChatMessageView, FormView, Mode } from "@/lib/types";
import { finalizeAnswer, notFoundPayload, type DocInfo } from "./answer-validate";
import { config } from "./config";
import { db } from "./db";
import { conversations, documents, forms, messages } from "./db/schema";
import { structuredCall } from "./llm/client";
import { ANSWER_RULES, AnswerSchema } from "./prompts/answer.v1";
import { planQueries, retrieve, type LineageEdge, type RetrievedChunk } from "./retrieval";

export class RateLimitError extends Error {
  status = 429;
}

const escapeAttr = (s: string | null | undefined) => (s ?? "").replace(/"/g, "'");

function buildContext(chunks: RetrievedChunk[], lineage: LineageEdge[], docs: Map<string, DocInfo>) {
  const docAlias = new Map<string, string>(); // document id → D#
  const docAliases = new Map<string, string>(); // D# → document id
  const chunkAliases = new Map<string, RetrievedChunk>();
  const byDoc = new Map<string, RetrievedChunk[]>();
  for (const c of chunks) {
    if (!docAlias.has(c.documentId)) {
      const alias = `D${docAlias.size + 1}`;
      docAlias.set(c.documentId, alias);
      docAliases.set(alias, c.documentId);
    }
    byDoc.set(c.documentId, [...(byDoc.get(c.documentId) ?? []), c]);
  }
  // Lineage documents that were not retrieved still get an alias so warnings can name them.
  for (const e of lineage) {
    for (const id of [e.olderDocumentId, e.newerDocumentId]) {
      if (!docAlias.has(id)) {
        const alias = `D${docAlias.size + 1}`;
        docAlias.set(id, alias);
        docAliases.set(alias, id);
      }
    }
  }

  // Newest issuances first, so the governing text is read before what it replaced.
  const dateOf = (id: string) => docs.get(id)?.effectivityDate || docs.get(id)?.dateIssued || "";
  const ordered = [...byDoc.entries()].sort(([a], [b]) => dateOf(b).localeCompare(dateOf(a)));

  let n = 0;
  const docBlocks = ordered.map(([docId, cs]) => {
    const d = docs.get(docId);
    const body = cs
      .sort((a, b) => a.pageStart - b.pageStart)
      .map((c) => {
        const alias = `C${++n}`;
        chunkAliases.set(alias, c);
        const pages = c.pageStart === c.pageEnd ? `${c.pageStart}` : `${c.pageStart}-${c.pageEnd}`;
        return `<chunk id="${alias}" pages="${pages}" section="${escapeAttr(c.sectionLabel)}" policy_area="${escapeAttr(c.policyArea)}">\n${c.content}\n</chunk>`;
      })
      .join("\n");
    return `<document id="${docAlias.get(docId)}" title="${escapeAttr(d?.title)}" issuance_no="${escapeAttr(d?.issuanceNo)}" date_issued="${d?.dateIssued ?? ""}" effectivity_date="${d?.effectivityDate ?? ""}">\n${body}\n</document>`;
  });

  const lineageLines = lineage.map((e) => {
    const older = docs.get(e.olderDocumentId);
    const newer = docs.get(e.newerDocumentId);
    return `${docAlias.get(e.newerDocumentId)} (${escapeAttr(newer?.issuanceNo || newer?.title)}) ${e.relation} ${docAlias.get(e.olderDocumentId)} (${escapeAttr(older?.issuanceNo || older?.title)})${e.scopeNote ? ` — scope: ${e.scopeNote}` : ""}`;
  });

  return {
    text: `<lineage>\n${lineageLines.join("\n") || "(none recorded)"}\n</lineage>\n<documents>\n${docBlocks.join("\n")}\n</documents>`,
    chunkAliases,
    docAliases,
  };
}

async function loadDocInfo(ids: string[]): Promise<Map<string, DocInfo>> {
  if (!ids.length) return new Map();
  const d = await db();
  const list = await d
    .select({
      id: documents.id,
      title: documents.title,
      issuanceNo: documents.issuanceNo,
      dateIssued: documents.dateIssued,
      effectivityDate: documents.effectivityDate,
    })
    .from(documents)
    .where(sql`${documents.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return new Map(list.map((x) => [x.id, x]));
}

export async function activeForms(): Promise<FormView[]> {
  const d = await db();
  return d
    .select({ id: forms.id, name: forms.name, description: forms.description })
    .from(forms)
    .where(eq(forms.isActive, true))
    .orderBy(asc(forms.name));
}

async function enforceRateLimit(clientId: string) {
  const d = await db();
  const since = new Date(Date.now() - 60_000);
  const [{ count }] = await d
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.clientId, clientId), eq(messages.sender, "user"), gt(messages.createdAt, since)));
  if (count >= config.rateLimit.chatPerMinute) {
    throw new RateLimitError("Too many questions in the last minute. Please wait a moment and try again.");
  }
}

export async function answerQuestion(args: {
  clientId: string;
  conversationId: string | null;
  message: string;
  persona: PersonaKey;
  mode: Mode;
}): Promise<{ conversationId: string; user: ChatMessageView; assistant: ChatMessageView }> {
  const { clientId, message, persona, mode } = args;
  const d = await db();
  await enforceRateLimit(clientId);

  let conversationId = args.conversationId;
  if (conversationId) {
    const owned = await d
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, clientId)));
    if (!owned.length) conversationId = null;
  }
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    await d.insert(conversations).values({
      id: conversationId,
      clientId,
      title: message.replace(/\s+/g, " ").slice(0, 80),
      roleAtStart: persona,
    });
  }

  const history = await d
    .select({ sender: messages.sender, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  const recent = history.slice(-config.historyTurns * 2);

  const userMsg = {
    id: crypto.randomUUID(),
    conversationId,
    sender: "user" as const,
    content: message,
    persona,
    mode,
  };
  await d.insert(messages).values(userMsg);

  let payload: AssistantPayload;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let retrievedIds: string[] = [];

  const plan = await planQueries(message, recent, mode);
  if (plan.usage) usage = { inputTokens: plan.usage.inputTokens, outputTokens: plan.usage.outputTokens };
  const { chunks, lineage } = await retrieve({ queries: plan.queries, persona, mode });
  retrievedIds = chunks.map((c) => c.id);

  if (!chunks.length) {
    payload = notFoundPayload(message);
  } else {
    const docIds = [
      ...new Set([...chunks.map((c) => c.documentId), ...lineage.flatMap((e) => [e.olderDocumentId, e.newerDocumentId])]),
    ];
    const docs = await loadDocInfo(docIds);
    const ctx = buildContext(chunks, lineage, docs);
    const allowedForms = await activeForms();

    const formsBlock = allowedForms.length
      ? allowedForms.map((f) => `- ${f.id}: ${f.name}${f.description ? ` — ${f.description}` : ""}`).join("\n")
      : "(no forms in the library)";

    const historyMessages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const h of recent) {
      const role = h.sender === "user" ? "user" : "assistant";
      const last = historyMessages[historyMessages.length - 1];
      if (!last && role === "assistant") continue; // must start with a user turn
      if (last && last.role === role) last.content = `${last.content}\n\n${h.content}`;
      else historyMessages.push({ role, content: h.content });
    }
    if (historyMessages.length && historyMessages[historyMessages.length - 1].role === "user") historyMessages.pop();

    const result = await structuredCall({
      model: config.answerModel,
      schema: AnswerSchema,
      effort: mode === "scenario" ? "high" : "medium",
      fallback: true,
      system: [
        { type: "text", text: ANSWER_RULES, cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: `${PERSONAS[persona].promptBlock}\n\n<allowed_forms>\n${formsBlock}\n</allowed_forms>`,
        },
      ],
      messages: [
        ...historyMessages,
        {
          role: "user",
          content: `${ctx.text}\n\n<mode>${mode}</mode>\n<question>\n${message}\n</question>`,
        },
      ],
    });
    usage = {
      inputTokens: usage.inputTokens + result.usage.inputTokens,
      outputTokens: usage.outputTokens + result.usage.outputTokens,
    };
    payload = finalizeAnswer(result.data, {
      chunkAliases: ctx.chunkAliases,
      docAliases: ctx.docAliases,
      docs,
      lineage,
      allowedForms: new Map(allowedForms.map((f) => [f.id, f])),
      question: message,
      mode,
    });
  }

  const assistantId = crypto.randomUUID();
  await d.insert(messages).values({
    id: assistantId,
    conversationId,
    sender: "assistant",
    content: payload.answer,
    persona,
    mode,
    payload,
    foundInDocuments: payload.foundInDocuments,
    retrievedChunkIds: retrievedIds,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  await d.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

  const now = new Date().toISOString();
  return {
    conversationId,
    user: { id: userMsg.id, sender: "user", content: message, persona, mode, createdAt: now },
    assistant: { id: assistantId, sender: "assistant", persona, mode, payload, createdAt: now },
  };
}
