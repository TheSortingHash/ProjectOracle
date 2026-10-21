"use client";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import type { StatusResponse } from "@/lib/api";

type Item = { ok: boolean | "warn"; title: string; detail: string };

export default function SetupChecklist({ status }: { status: StatusResponse }) {
  const items: Item[] = [
    {
      ok: status.anthropic,
      title: "Anthropic API key",
      detail: status.anthropic
        ? `Answers use ${status.models.answer}; metadata, query planning and Simplify use ${status.models.fast}.`
        : "Set ANTHROPIC_API_KEY. Without it the assistant cannot answer.",
    },
    {
      ok: status.voyage ? true : "warn",
      title: "Vector embeddings (Voyage AI)",
      detail: status.voyage
        ? `Hybrid search: ${status.models.embeddings} vectors + Postgres full-text.`
        : "Optional. Set VOYAGE_API_KEY for semantic search; until then retrieval uses full-text search only. Re-index documents after adding it.",
    },
    {
      ok: status.databaseOk ? (status.database === "postgres" ? true : "warn") : false,
      title: "Database",
      detail: !status.databaseOk
        ? `Cannot connect: ${status.databaseError}`
        : status.database === "postgres"
          ? "Connected to Postgres (pgvector)."
          : "Using the local PGlite file database. Fine for development; set DATABASE_URL (Neon) for deployments.",
    },
    {
      ok: status.storage === "blob" ? true : "warn",
      title: "File storage",
      detail:
        status.storage === "blob"
          ? `Vercel Blob (${status.blobAccess} access). Originals are served only through signed-in routes.`
          : "Local disk (./.data/uploads). Connect a Vercel Blob store for deployments.",
    },
    {
      ok: status.passcodeGate ? true : "warn",
      title: "Demo passcode",
      detail: status.passcodeGate
        ? "Visitors must enter DEMO_PASSCODE."
        : "DEMO_PASSCODE is not set, so anyone with the link can use the app.",
    },
    {
      ok: status.adminConfigured,
      title: "Admin passcode",
      detail: status.adminConfigured ? "Admin Panel is protected." : "Set ADMIN_PASSCODE to enable the Admin Panel.",
    },
  ];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-gray-700">Setup checklist</h3>
      <ul className="divide-y divide-gray-100">
        {items.map((it) => (
          <li key={it.title} className="flex gap-3 py-2.5">
            {it.ok === true ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            ) : it.ok === "warn" ? (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <div>
              <p className="text-sm font-semibold text-gray-800">{it.title}</p>
              <p className="text-xs text-gray-500">{it.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-400">Step-by-step instructions are in the repository README (Deploying to Vercel).</p>
    </div>
  );
}
