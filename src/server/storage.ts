import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get } from "@vercel/blob";
import { config } from "./config";

// Files are referenced by an opaque key stored in the database:
//   "blob:<vercel blob url>"   (production)
//   "local:<relative path>"   (local development, under ./.data/uploads)
// Browsers never receive the raw location; they go through authenticated routes.

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");
const localPath = (rel: string) => path.join(/*turbopackIgnore: true*/ LOCAL_ROOT, rel);
export const blobAccess = (process.env.BLOB_ACCESS === "public" ? "public" : "private") as "public" | "private";

export function isValidFileKey(key: string): boolean {
  if (key.startsWith("local:")) {
    const rel = key.slice(6);
    return config.storage === "local" && !rel.includes("..") && /^[\w.\-/]+$/.test(rel);
  }
  if (key.startsWith("blob:")) {
    try {
      const u = new URL(key.slice(5));
      return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
    } catch {
      return false;
    }
  }
  return false;
}

export async function saveLocal(fileName: string, bytes: Uint8Array): Promise<string> {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
  const rel = `${crypto.randomUUID()}-${safe}`;
  await mkdir(LOCAL_ROOT, { recursive: true });
  await writeFile(localPath(rel), bytes);
  return `local:${rel}`;
}

export async function openFile(key: string): Promise<{ body: BodyInit; contentType: string } | null> {
  if (!isValidFileKey(key)) return null;
  if (key.startsWith("local:")) {
    try {
      const buf = await readFile(localPath(key.slice(6)));
      return { body: new Uint8Array(buf), contentType: guessType(key) };
    } catch {
      return null;
    }
  }
  const result = await get(key.slice(5), { access: blobAccess });
  if (!result || !result.stream) return null;
  return { body: result.stream as unknown as BodyInit, contentType: guessType(key) };
}

export async function deleteFile(key: string) {
  try {
    if (key.startsWith("local:")) await rm(localPath(key.slice(6)), { force: true });
    else if (key.startsWith("blob:")) await del(key.slice(5));
  } catch (err) {
    console.error("[storage] delete failed", key, err);
  }
}

function guessType(key: string) {
  const ext = key.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
}
