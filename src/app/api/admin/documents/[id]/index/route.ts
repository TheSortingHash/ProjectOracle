import { NextResponse } from "next/server";
import { z } from "zod";
import { actorName, handle, requireAdmin } from "@/server/http";
import { confirmAndIndex, indexDocument } from "@/server/ingest/pipeline";

// Chunking + embedding a long manual can take a while.
export const maxDuration = 300;

const dateOrEmpty = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable();

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    metadata: z.object({
      title: z.string().trim().min(1).max(500),
      issuanceType: z.string().max(100).nullable(),
      issuanceNo: z.string().max(200).nullable(),
      dateIssued: dateOrEmpty,
      effectivityDate: dateOrEmpty,
      issuingOffice: z.string().max(300).nullable(),
    }),
    lineage: z
      .array(
        z.object({
          olderDocumentId: z.string().min(1),
          relation: z.enum(["amends", "supersedes", "repeals"]),
          scopeNote: z.string().max(500).nullable().optional(),
        }),
      )
      .max(50),
  }),
  z.object({ action: z.literal("reindex") }),
]);

export const POST = handle(async (request: Request, ctx: RouteContext<"/api/admin/documents/[id]/index">) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const body = Body.parse(await request.json());
  if (body.action === "confirm") {
    await confirmAndIndex(id, { ...body.metadata, lineage: body.lineage }, actorName(session));
  } else {
    await indexDocument(id, actorName(session));
  }
  return NextResponse.json({ ok: true });
});
