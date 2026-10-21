import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { handle, HttpError, requireAdmin } from "@/server/http";
import { saveLocal } from "@/server/storage";

// Local-development upload target used when Vercel Blob is not configured.
export const POST = handle(async (request: Request) => {
  await requireAdmin();
  if (config.storage !== "local") throw new HttpError(400, "Use Vercel Blob uploads in this environment.");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file received.");
  if (file.size > 50 * 1024 * 1024) throw new HttpError(413, "File is larger than 50 MB.");
  const key = await saveLocal(file.name, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json({ key });
});
