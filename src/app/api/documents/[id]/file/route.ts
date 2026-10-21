import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema";
import { getSession, handle, HttpError } from "@/server/http";
import { openFile } from "@/server/storage";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/documents/[id]/file">) => {
  await getSession();
  const { id } = await ctx.params;
  const d = await db();
  const [doc] = await d.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new HttpError(404, "Document not found.");
  const file = await openFile(doc.fileUrl);
  if (!file) throw new HttpError(404, "Original file is missing from storage.");
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
});
