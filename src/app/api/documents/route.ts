import { NextResponse } from "next/server";
import { listDocuments } from "@/server/documents";
import { getSession, handle } from "@/server/http";

export const GET = handle(async () => {
  await getSession();
  const docs = await listDocuments({ onlyLive: true });
  return NextResponse.json({ documents: docs.map((doc) => ({ ...doc, suggestedMetadata: undefined })) });
});
