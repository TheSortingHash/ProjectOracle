import { NextResponse } from "next/server";
import { z } from "zod";
import { listDocuments } from "@/server/documents";
import { actorName, handle, HttpError, requireAdmin } from "@/server/http";
import { registerDocument } from "@/server/ingest/pipeline";
import { isValidFileKey } from "@/server/storage";

export const maxDuration = 120;

export const GET = handle(async () => {
  await requireAdmin();
  return NextResponse.json({ documents: await listDocuments() });
});

const Body = z.object({
  fileKey: z.string().min(1),
  fileName: z.string().min(1).max(300),
  fileSize: z.number().int().nonnegative(),
  pages: z
    .array(z.object({ pageNo: z.number().int().positive(), text: z.string().max(200_000) }))
    .min(1)
    .max(2000),
});

export const POST = handle(async (request: Request) => {
  const session = await requireAdmin();
  const body = Body.parse(await request.json());
  if (!isValidFileKey(body.fileKey)) throw new HttpError(400, "Invalid file reference.");
  const id = await registerDocument({
    title: body.fileName.replace(/\.pdf$/i, ""),
    fileName: body.fileName,
    fileUrl: body.fileKey,
    fileSize: body.fileSize,
    pages: body.pages,
    actor: actorName(session),
  });
  return NextResponse.json({ id });
});
