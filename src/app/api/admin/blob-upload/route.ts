import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { handle, HttpError, requireAdmin } from "@/server/http";

// Issues short-lived client tokens so the browser uploads originals straight to
// Vercel Blob (bypassing the 4.5 MB function body limit).
export const POST = handle(async (request: Request) => {
  const body = (await request.json()) as HandleUploadBody;
  if (body.type === "blob.generate-client-token") await requireAdmin();
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, "Vercel Blob is not connected.");
  const result = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maximumSizeInBytes: 50 * 1024 * 1024,
      addRandomSuffix: true,
    }),
  });
  return NextResponse.json(result);
});
