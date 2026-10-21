import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { documentLineage } from "@/server/db/schema";
import { actorName, handle, HttpError, requireAdmin } from "@/server/http";

export const GET = handle(async () => {
  await requireAdmin();
  const d = await db();
  const lineage = await d.select().from(documentLineage).orderBy(desc(documentLineage.createdAt));
  return NextResponse.json({ lineage });
});

const Body = z.object({
  olderDocumentId: z.string().min(1),
  newerDocumentId: z.string().min(1),
  relation: z.enum(["amends", "supersedes", "repeals"]),
  scopeNote: z.string().max(500).nullable().optional(),
});

export const POST = handle(async (request: Request) => {
  const session = await requireAdmin();
  const body = Body.parse(await request.json());
  if (body.olderDocumentId === body.newerDocumentId) throw new HttpError(400, "A document cannot amend itself.");
  const d = await db();
  const id = crypto.randomUUID();
  await d
    .insert(documentLineage)
    .values({ id, ...body, scopeNote: body.scopeNote ?? null, confirmedBy: actorName(session) })
    .onConflictDoUpdate({
      target: [documentLineage.olderDocumentId, documentLineage.newerDocumentId],
      set: { relation: body.relation, scopeNote: body.scopeNote ?? null, confirmedBy: actorName(session) },
    });
  await audit(actorName(session), "lineage.upsert", { type: "lineage", id }, body);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (request: Request) => {
  const session = await requireAdmin();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing id.");
  const d = await db();
  await d.delete(documentLineage).where(eq(documentLineage.id, id));
  await audit(actorName(session), "lineage.delete", { type: "lineage", id });
  return NextResponse.json({ ok: true });
});
