import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { documentLineage, documents } from "@/server/db/schema";
import { toView } from "@/server/documents";
import { actorName, handle, HttpError, requireAdmin } from "@/server/http";
import { deleteDocument, setDocumentActive } from "@/server/ingest/pipeline";
import { deleteFile } from "@/server/storage";

type Ctx = RouteContext<"/api/admin/documents/[id]">;

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const d = await db();
  const [doc] = await d.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new HttpError(404, "Document not found.");
  const lineage = await d
    .select()
    .from(documentLineage)
    .where(or(eq(documentLineage.olderDocumentId, id), eq(documentLineage.newerDocumentId, id)));
  return NextResponse.json({ document: toView(doc), lineage });
});

const Patch = z.object({ isActive: z.boolean() });

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const body = Patch.parse(await request.json());
  await setDocumentActive(id, body.isActive, actorName(session));
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const d = await db();
  const [doc] = await d.select({ fileUrl: documents.fileUrl }).from(documents).where(eq(documents.id, id));
  if (!doc) throw new HttpError(404, "Document not found.");
  await deleteDocument(id, actorName(session));
  await deleteFile(doc.fileUrl);
  await audit(actorName(session), "document.file_deleted", { type: "document", id });
  return NextResponse.json({ ok: true });
});
