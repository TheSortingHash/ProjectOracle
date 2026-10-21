"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    window.location.href = "/login";
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export type StatusResponse = {
  anthropic: boolean;
  voyage: boolean;
  database: "postgres" | "pglite";
  databaseOk: boolean;
  databaseError: string | null;
  storage: "blob" | "local";
  blobAccess: "public" | "private";
  passcodeGate: boolean;
  adminConfigured: boolean;
  isAdmin: boolean;
  models: { answer: string; fast: string; embeddings: string | null };
  indexedDocuments: number;
};
