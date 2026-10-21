import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { PERSONAS, type PersonaKey } from "@/lib/personas";
import type { Mode } from "@/lib/types";
import { config } from "./config";
import { db, rows } from "./db";
import type { LineageRelation } from "./db/schema";
import { getEmbedder, toPgVector } from "./embeddings";
import { structuredCall, type Usage } from "./llm/client";
import { PLANNER_SYSTEM } from "./prompts/planner.v1";

export type RetrievedChunk = {
  id: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  sectionLabel: string | null;
  content: string;
  documentTitle: string;
  issuanceType: string | null;
  issuanceNo: string | null;
  dateIssued: string | null;
  effectivityDate: string | null;
  policyArea: string;
  score: number;
};

export type LineageEdge = {
  olderDocumentId: string;
  newerDocumentId: string;
  relation: LineageRelation;
  scopeNote: string | null;
};

export type PlannedQuery = { area: string; query: string };

const PlanSchema = z.object({
  queries: z
    .array(z.object({ area: z.string(), query: z.string() }))
    .describe("1 query for a normal question; one per policy area (max 6) for a scenario."),
});

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from how i if in into is it its may me my of on or our shall should so that the their them there these this to us was we what when where which who will with would you your".split(
    " ",
  ),
);

/** Builds an OR-style tsquery string from free text; returns null if nothing is left. */
export function toTsQuery(text: string): string | null {
  const terms = Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
    ),
  ).slice(0, 30);
  return terms.length ? terms.join(" | ") : null;
}

/** Reciprocal rank fusion of several ranked id lists. */
export function rrf(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return scores;
}

/**
 * Turns the user's message (plus history) into standalone search queries.
 * Plain first-turn questions skip the model call entirely.
 */
export async function planQueries(
  message: string,
  history: { sender: "user" | "assistant"; content: string }[],
  mode: Mode,
): Promise<{ queries: PlannedQuery[]; usage: Usage | null }> {
  if (mode === "chat" && history.length === 0) return { queries: [{ area: "General", query: message }], usage: null };
  if (!config.hasAnthropic) return { queries: [{ area: "General", query: message }], usage: null };

  const transcript = history
    .slice(-4)
    .map((h) => `${h.sender === "user" ? "User" : "Assistant"}: ${h.content.slice(0, 1500)}`)
    .join("\n");
  const { data, usage } = await structuredCall({
    model: config.fastModel,
    schema: PlanSchema,
    effort: "low",
    maxTokens: 2000,
    system: [{ type: "text", text: PLANNER_SYSTEM }],
    messages: [
      {
        role: "user",
        content: `<mode>${mode}</mode>\n<recent_conversation>\n${transcript || "(none)"}\n</recent_conversation>\n<latest_message>\n${message}\n</latest_message>`,
      },
    ],
  });
  const queries = data.queries.filter((q) => q.query.trim()).slice(0, mode === "scenario" ? 6 : 2);
  return { queries: queries.length ? queries : [{ area: "General", query: message }], usage };
}

type SearchOpts = { limit: number; documentIds?: string[]; vector?: number[] | null };

async function searchIds(query: string, opts: SearchOpts): Promise<string[][]> {
  const d = await db();
  const docFilter = opts.documentIds?.length
    ? sql`AND c.document_id IN (${sql.join(opts.documentIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const lists: string[][] = [];

  const tsq = toTsQuery(query);
  if (tsq) {
    const ft = await rows<{ id: string }>(
      d,
      sql`SELECT c.id FROM chunks c JOIN documents doc ON doc.id = c.document_id
          WHERE doc.status = 'indexed' AND doc.is_active AND c.tsv @@ to_tsquery('english', ${tsq}) ${docFilter}
          ORDER BY ts_rank_cd(c.tsv, to_tsquery('english', ${tsq})) DESC
          LIMIT ${opts.limit}`,
    );
    lists.push(ft.map((r) => r.id));
  }
  if (opts.vector) {
    const vec = toPgVector(opts.vector);
    const vs = await rows<{ id: string }>(
      d,
      sql`SELECT c.id FROM chunks c JOIN documents doc ON doc.id = c.document_id
          WHERE doc.status = 'indexed' AND doc.is_active AND c.embedding IS NOT NULL ${docFilter}
          ORDER BY c.embedding <=> ${vec}::vector
          LIMIT ${opts.limit}`,
    );
    lists.push(vs.map((r) => r.id));
  }
  return lists;
}

async function loadChunks(ids: string[]): Promise<Omit<RetrievedChunk, "policyArea" | "score">[]> {
  if (!ids.length) return [];
  const d = await db();
  return rows(
    d,
    sql`SELECT c.id, c.document_id AS "documentId", c.page_start AS "pageStart", c.page_end AS "pageEnd",
               c.section_label AS "sectionLabel", c.content,
               doc.title AS "documentTitle", doc.issuance_type AS "issuanceType", doc.issuance_no AS "issuanceNo",
               to_char(doc.date_issued, 'YYYY-MM-DD') AS "dateIssued",
               to_char(doc.effectivity_date, 'YYYY-MM-DD') AS "effectivityDate"
        FROM chunks c JOIN documents doc ON doc.id = c.document_id
        WHERE c.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
  );
}

export async function loadLineage(documentIds: string[]): Promise<LineageEdge[]> {
  if (!documentIds.length) return [];
  const d = await db();
  return rows<LineageEdge>(
    d,
    sql`SELECT l.older_document_id AS "olderDocumentId", l.newer_document_id AS "newerDocumentId",
               l.relation, l.scope_note AS "scopeNote"
        FROM document_lineage l
        JOIN documents newer ON newer.id = l.newer_document_id
        WHERE newer.status = 'indexed' AND newer.is_active
          AND (l.older_document_id IN (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})
               OR l.newer_document_id IN (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)}))`,
  );
}

export async function retrieve(args: {
  queries: PlannedQuery[];
  persona: PersonaKey;
  mode: Mode;
}): Promise<{ chunks: RetrievedChunk[]; lineage: LineageEdge[]; usedVectors: boolean }> {
  const { queries, persona, mode } = args;
  const limit = config.retrieval.candidatesPerQuery;
  const max = mode === "scenario" ? config.retrieval.maxChunksScenario : config.retrieval.maxChunks;

  const embedder = getEmbedder();
  let vectors: (number[] | null)[] = queries.map(() => null);
  if (embedder) {
    try {
      vectors = await embedder.embed(queries.map((q) => q.query), "query");
    } catch (err) {
      console.error("[retrieval] query embedding failed, using full-text only", err);
    }
  }

  // Rank per sub-query, then interleave so every policy area is represented.
  const perQuery: { area: string; ranked: [string, number][] }[] = [];
  for (let i = 0; i < queries.length; i++) {
    const lists = await searchIds(queries[i].query, { limit, vector: vectors[i] });
    const fused = [...rrf(lists).entries()].sort((a, b) => b[1] - a[1]);
    perQuery.push({ area: queries[i].area, ranked: fused });
  }
  const chosen = new Map<string, { area: string; score: number }>();
  for (let rank = 0; chosen.size < max && perQuery.some((q) => q.ranked.length > rank); rank++) {
    for (const q of perQuery) {
      const hit = q.ranked[rank];
      if (hit && !chosen.has(hit[0]) && chosen.size < max) chosen.set(hit[0], { area: q.area, score: hit[1] });
    }
  }

  let retrieved: RetrievedChunk[] = (await loadChunks([...chosen.keys()])).map((c) => {
    const hit = chosen.get(c.id)!;
    return { ...c, policyArea: hit.area, score: hit.score };
  });

  const boost = PERSONAS[persona].retrievalBoost ?? [];
  for (const c of retrieved) if (c.issuanceType && boost.includes(c.issuanceType)) c.score *= 1.15;

  // Lineage: if a retrieved document has been amended/superseded, make sure the
  // newer issuance is in context too (follow the chain up to 3 hops).
  const lineage: LineageEdge[] = [];
  const seenEdges = new Set<string>();
  for (let hop = 0; hop < 3; hop++) {
    const docIds = [...new Set(retrieved.map((c) => c.documentId))];
    const edges = (await loadLineage(docIds)).filter((e) => !seenEdges.has(`${e.olderDocumentId}>${e.newerDocumentId}`));
    if (!edges.length) break;
    edges.forEach((e) => {
      seenEdges.add(`${e.olderDocumentId}>${e.newerDocumentId}`);
      lineage.push(e);
    });
    const missingNewer = [...new Set(edges.map((e) => e.newerDocumentId))].filter((id) => !docIds.includes(id));
    if (!missingNewer.length) break;
    const extraIds: string[] = [];
    for (let i = 0; i < queries.length; i++) {
      const lists = await searchIds(queries[i].query, { limit: 3, documentIds: missingNewer, vector: vectors[i] });
      extraIds.push(...[...rrf(lists).keys()].slice(0, 3));
    }
    if (!extraIds.length) {
      // Nothing matched the query terms: include the opening sections instead.
      const d = await db();
      const first = await rows<{ id: string }>(
        d,
        sql`SELECT id FROM chunks WHERE document_id IN (${sql.join(missingNewer.map((id) => sql`${id}`), sql`, `)})
            AND ordinal < 2`,
      );
      extraIds.push(...first.map((r) => r.id));
    }
    const fresh = [...new Set(extraIds)].filter((id) => !retrieved.some((c) => c.id === id));
    retrieved = retrieved.concat(
      (await loadChunks(fresh)).map((c) => ({ ...c, policyArea: queries[0].area, score: 0 })),
    );
  }

  retrieved.sort((a, b) => b.score - a.score);
  return { chunks: retrieved, lineage, usedVectors: vectors.some(Boolean) };
}
