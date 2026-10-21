"use client";
import { upload } from "@vercel/blob/client";
import { api, type StatusResponse } from "./api";

/** Stores an original file and returns the opaque storage key the server expects. */
export async function storeFile(
  file: File,
  status: Pick<StatusResponse, "storage" | "blobAccess">,
  folder: "documents" | "forms",
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (status.storage === "blob") {
    const blob = await upload(`${folder}/${file.name}`, file, {
      access: status.blobAccess,
      handleUploadUrl: "/api/admin/blob-upload",
      multipart: file.size > 8 * 1024 * 1024,
      onUploadProgress: (e) => onProgress?.(e.percentage),
    });
    return `blob:${blob.url}`;
  }
  const body = new FormData();
  body.append("file", file);
  const r = await api<{ key: string }>("/api/admin/files", { method: "POST", body });
  onProgress?.(100);
  return r.key;
}
