import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import type { DocumentStatus, DocumentView, SuggestedMetadata } from "@/lib/types";
import { db } from "./db";
import { chunks, documents, type DocumentRow } from "./db/schema";

export function toView(d: DocumentRow, chunkCount?: number): DocumentView {
  return {
    id: d.id,
    title: d.title,
    fileName: d.fileName,
    issuanceType: d.issuanceType,
    issuanceNo: d.issuanceNo,
    dateIssued: d.dateIssued,
    effectivityDate: d.effectivityDate,
    issuingOffice: d.issuingOffice,
    fileUrl: `/api/documents/${d.id}/file`,
    fileSize: d.fileSize,
    pageCount: d.pageCount,
    lowTextPages: d.lowTextPages,
    status: d.status as DocumentStatus,
    statusDetail: d.statusDetail,
    isActive: d.isActive,
    uploadedBy: d.uploadedBy,
    createdAt: d.createdAt.toISOString(),
    chunkCount,
    suggestedMetadata: (d.suggestedMetadata as SuggestedMetadata | null) ?? null,
  };
}

export async function listDocuments(opts: { onlyLive?: boolean } = {}): Promise<DocumentView[]> {
  const d = await db();
  const counts = d
    .select({ documentId: chunks.documentId, n: sql<number>`count(*)::int`.as("n") })
    .from(chunks)
    .groupBy(chunks.documentId)
    .as("counts");
  const list = await d
    .select({ doc: documents, n: counts.n })
    .from(documents)
    .leftJoin(counts, eq(counts.documentId, documents.id))
    .where(opts.onlyLive ? sql`${documents.status} = 'indexed' AND ${documents.isActive}` : undefined)
    .orderBy(desc(documents.createdAt));
  return list.map((r) => toView(r.doc, r.n ?? 0));
}
