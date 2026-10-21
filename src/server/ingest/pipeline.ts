import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { SuggestedMetadata } from "@/lib/types";
import { audit } from "../audit";
import { config } from "../config";
import { db } from "../db";
import { chunks, documentLineage, documentPages, documents, type LineageRelation } from "../db/schema";
import { getEmbedder } from "../embeddings";
import { structuredCall } from "../llm/client";
import { METADATA_SYSTEM, MetadataSchema } from "../prompts/metadata.v1";
import { chunkPages, type PageText } from "./chunker";

// Pages yielding fewer characters than this are probably scanned images.
const LOW_TEXT_THRESHOLD = 40;

export type RegisterInput = {
  title: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  pages: PageText[];
  actor: string;
};

/**
 * Step 1 (after the browser has extracted text and stored the original):
 * save pages, run LLM-assisted metadata extraction, and park the document in
 * `awaiting_metadata_review`. It is not searchable until an admin confirms.
 */
export async function registerDocument(input: RegisterInput) {
  const d = await db();
  const id = crypto.randomUUID();
  const lowTextPages = input.pages.filter((p) => p.text.trim().length < LOW_TEXT_THRESHOLD).map((p) => p.pageNo);

  await d.insert(documents).values({
    id,
    title: input.title,
    fileName: input.fileName,
    fileUrl: input.fileUrl,
    fileSize: input.fileSize,
    pageCount: input.pages.length,
    lowTextPages,
    status: "extracting",
    statusDetail: "Saving extracted text",
    uploadedBy: input.actor,
  });
  await audit(input.actor, "document.upload", { type: "document", id }, { fileName: input.fileName });

  try {
    for (let i = 0; i < input.pages.length; i += 50) {
      await d.insert(documentPages).values(
        input.pages.slice(i, i + 50).map((p) => ({ documentId: id, pageNo: p.pageNo, content: p.text })),
      );
    }

    let suggested: SuggestedMetadata | null = null;
    let detail: string | null = null;
    if (lowTextPages.length === input.pages.length) {
      detail = "No extractable text: this looks like a scanned PDF. OCR is not enabled in the demo.";
    } else if (config.hasAnthropic) {
      await d.update(documents).set({ statusDetail: "Extracting metadata" }).where(eq(documents.id, id));
      suggested = await extractMetadata(id, input.pages);
    } else {
      detail = "Metadata extraction skipped (no ANTHROPIC_API_KEY). Fill in the fields manually.";
    }

    await d
      .update(documents)
      .set({
        status: "awaiting_metadata_review",
        statusDetail: detail,
        suggestedMetadata: suggested,
        title: suggested?.title || input.title,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id));
  } catch (err) {
    await fail(id, err);
  }
  return id;
}

async function extractMetadata(documentId: string, pages: PageText[]): Promise<SuggestedMetadata> {
  const sample = [...pages.slice(0, 3), ...(pages.length > 3 ? pages.slice(-1) : [])]
    .map((p) => `<page number="${p.pageNo}">\n${p.text.slice(0, 8000)}\n</page>`)
    .join("\n");
  const { data } = await structuredCall({
    model: config.fastModel,
    schema: MetadataSchema,
    effort: "low",
    maxTokens: 4000,
    system: [{ type: "text", text: METADATA_SYSTEM }],
    messages: [{ role: "user", content: `<document_pages>\n${sample}\n</document_pages>\n\nExtract the metadata.` }],
  });
  const matches = await matchReferences(documentId, data.references.map((r) => r.cited_issuance));
  return {
    ...data,
    issuance_type: data.issuance_type as SuggestedMetadata["issuance_type"],
    references: data.references.map((r, i) => ({ ...r, matched_document_id: matches[i] })),
  };
}

export function normaliseIssuance(s: string) {
  return s
    .toLowerCase()
    .replace(/\b(no|number|series of|s\.)\b\.?/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** Best-effort match of cited issuances to documents already in the corpus. */
async function matchReferences(selfId: string, cited: string[]): Promise<(string | null)[]> {
  if (!cited.length) return [];
  const d = await db();
  const others = await d
    .select({ id: documents.id, issuanceNo: documents.issuanceNo, title: documents.title })
    .from(documents)
    .where(ne(documents.id, selfId));
  return cited.map((c) => {
    const nc = normaliseIssuance(c);
    const hit = others.find((o) => {
      const no = o.issuanceNo ? normaliseIssuance(o.issuanceNo) : "";
      return (no.length >= 3 && nc.includes(no)) || (o.title.length > 8 && c.toLowerCase().includes(o.title.toLowerCase()));
    });
    return hit?.id ?? null;
  });
}

export type ConfirmInput = {
  title: string;
  issuanceType: string | null;
  issuanceNo: string | null;
  dateIssued: string | null;
  effectivityDate: string | null;
  issuingOffice: string | null;
  /** Documents that THIS document amends / supersedes / repeals. */
  lineage: { olderDocumentId: string; relation: LineageRelation; scopeNote?: string | null }[];
};

/** Step 2: admin confirms metadata + lineage, then the document is chunked, embedded and goes live. */
export async function confirmAndIndex(documentId: string, input: ConfirmInput, actor: string) {
  const d = await db();
  await d
    .update(documents)
    .set({
      title: input.title,
      issuanceType: input.issuanceType || null,
      issuanceNo: input.issuanceNo || null,
      dateIssued: input.dateIssued || null,
      effectivityDate: input.effectivityDate || null,
      issuingOffice: input.issuingOffice || null,
      metadataConfirmedBy: actor,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));

  await d.delete(documentLineage).where(eq(documentLineage.newerDocumentId, documentId));
  for (const l of input.lineage) {
    if (l.olderDocumentId === documentId) continue;
    await d
      .insert(documentLineage)
      .values({
        id: crypto.randomUUID(),
        olderDocumentId: l.olderDocumentId,
        newerDocumentId: documentId,
        relation: l.relation,
        scopeNote: l.scopeNote ?? null,
        confirmedBy: actor,
      })
      .onConflictDoNothing();
  }
  await audit(actor, "document.metadata_confirm", { type: "document", id: documentId }, { ...input });
  await indexDocument(documentId, actor);
}

/** Chunk + embed + write. Also used for re-indexing. */
export async function indexDocument(documentId: string, actor: string) {
  const d = await db();
  try {
    await setStatus(documentId, "chunking", "Splitting into sections");
    const pages = await d
      .select({ pageNo: documentPages.pageNo, text: documentPages.content })
      .from(documentPages)
      .where(eq(documentPages.documentId, documentId))
      .orderBy(documentPages.pageNo);
    const pieces = chunkPages(pages);
    if (!pieces.length) throw new Error("No text could be chunked from this document.");

    const embedder = getEmbedder();
    let vectors: (number[] | null)[] = pieces.map(() => null);
    if (embedder) {
      await setStatus(documentId, "embedding", `Embedding ${pieces.length} chunks with ${embedder.name}`);
      const doc = await d.select({ title: documents.title }).from(documents).where(eq(documents.id, documentId));
      vectors = await embedder.embed(
        pieces.map((p) => `${doc[0]?.title ?? ""}\n${p.sectionLabel ?? ""}\n${p.content}`),
        "document",
      );
    } else {
      await setStatus(documentId, "embedding", "No VOYAGE_API_KEY: skipping vectors (full-text search only)");
    }

    await d.delete(chunks).where(eq(chunks.documentId, documentId));
    const rowsToInsert = pieces.map((p, i) => ({
      id: crypto.randomUUID(),
      documentId,
      ordinal: p.ordinal,
      pageStart: p.pageStart,
      pageEnd: p.pageEnd,
      sectionLabel: p.sectionLabel,
      content: p.content,
      tokenCount: p.tokenCount,
      embedding: vectors[i],
    }));
    for (let i = 0; i < rowsToInsert.length; i += 100) {
      await d.insert(chunks).values(rowsToInsert.slice(i, i + 100));
    }
    await setStatus(
      documentId,
      "indexed",
      embedder ? `${pieces.length} chunks, vectors + full-text` : `${pieces.length} chunks, full-text only`,
    );
    await audit(actor, "document.indexed", { type: "document", id: documentId }, { chunks: pieces.length });
  } catch (err) {
    await fail(documentId, err);
    throw err;
  }
}

async function setStatus(id: string, status: string, detail: string | null) {
  const d = await db();
  await d.update(documents).set({ status, statusDetail: detail, updatedAt: new Date() }).where(eq(documents.id, id));
}

async function fail(id: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[ingest] failed", id, err);
  await setStatus(id, "failed", message.slice(0, 500));
}

export async function setDocumentActive(id: string, isActive: boolean, actor: string) {
  const d = await db();
  await d.update(documents).set({ isActive, updatedAt: new Date() }).where(eq(documents.id, id));
  await audit(actor, isActive ? "document.activate" : "document.deactivate", { type: "document", id });
}

export async function deleteDocument(id: string, actor: string) {
  const d = await db();
  await d.delete(documents).where(and(eq(documents.id, id)));
  await audit(actor, "document.delete", { type: "document", id });
}
