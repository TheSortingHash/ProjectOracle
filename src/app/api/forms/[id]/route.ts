import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { forms } from "@/server/db/schema";
import { getSession, handle, HttpError } from "@/server/http";
import { openFile } from "@/server/storage";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/forms/[id]">) => {
  await getSession();
  const { id } = await ctx.params;
  const d = await db();
  const [form] = await d.select().from(forms).where(and(eq(forms.id, id), eq(forms.isActive, true)));
  if (!form) throw new HttpError(404, "Form not found.");
  const file = await openFile(form.fileUrl);
  if (!file) throw new HttpError(404, "Form file is missing from storage.");
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${form.fileName.replace(/"/g, "")}"`,
    },
  });
});
