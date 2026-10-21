import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { forms } from "@/server/db/schema";
import { actorName, handle, HttpError, requireAdmin } from "@/server/http";
import { isValidFileKey } from "@/server/storage";

export const GET = handle(async () => {
  await requireAdmin();
  const d = await db();
  const list = await d.select().from(forms).orderBy(desc(forms.createdAt));
  return NextResponse.json({ forms: list.map((f) => ({ id: f.id, name: f.name, description: f.description, fileName: f.fileName, topics: f.topics, isActive: f.isActive, downloadUrl: `/api/forms/${f.id}` })) });
});

const Body = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().max(500).nullable().optional(),
  topics: z.array(z.string().max(50)).max(20).default([]),
  fileKey: z.string().min(1),
  fileName: z.string().min(1).max(300),
});

function slug(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
  return `${base}-${crypto.randomUUID().slice(0, 4)}`;
}

export const POST = handle(async (request: Request) => {
  const session = await requireAdmin();
  const body = Body.parse(await request.json());
  if (!isValidFileKey(body.fileKey)) throw new HttpError(400, "Invalid file reference.");
  const d = await db();
  const id = slug(body.name);
  await d.insert(forms).values({
    id,
    name: body.name,
    description: body.description ?? null,
    topics: body.topics,
    fileUrl: body.fileKey,
    fileName: body.fileName,
  });
  await audit(actorName(session), "form.create", { type: "form", id }, { name: body.name });
  return NextResponse.json({ id });
});
