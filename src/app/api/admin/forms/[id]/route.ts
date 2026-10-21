import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { forms } from "@/server/db/schema";
import { actorName, handle, HttpError, requireAdmin } from "@/server/http";
import { deleteFile } from "@/server/storage";

type Ctx = RouteContext<"/api/admin/forms/[id]">;

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const { isActive } = z.object({ isActive: z.boolean() }).parse(await request.json());
  const d = await db();
  await d.update(forms).set({ isActive }).where(eq(forms.id, id));
  await audit(actorName(session), isActive ? "form.activate" : "form.deactivate", { type: "form", id });
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const d = await db();
  const [form] = await d.select().from(forms).where(eq(forms.id, id));
  if (!form) throw new HttpError(404, "Form not found.");
  await d.delete(forms).where(eq(forms.id, id));
  await deleteFile(form.fileUrl);
  await audit(actorName(session), "form.delete", { type: "form", id });
  return NextResponse.json({ ok: true });
});
