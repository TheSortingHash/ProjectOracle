"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DocumentView } from "@/lib/types";

type Edge = {
  id: string;
  olderDocumentId: string;
  newerDocumentId: string;
  relation: "amends" | "supersedes" | "repeals";
  scopeNote: string | null;
  confirmedBy: string | null;
  createdAt: string;
};

export default function LineageSection() {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [draft, setDraft] = useState({ newerDocumentId: "", relation: "amends", olderDocumentId: "", scopeNote: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [l, d] = await Promise.all([
      api<{ lineage: Edge[] }>("/api/admin/lineage"),
      api<{ documents: DocumentView[] }>("/api/admin/documents"),
    ]);
    setEdges(l.lineage);
    setDocs(d.documents);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const label = (id: string) => {
    const d = docs.find((x) => x.id === id);
    return d ? (d.issuanceNo ? `${d.issuanceNo} — ${d.title}` : d.title) : "(deleted document)";
  };

  const add = async () => {
    setError("");
    try {
      await api("/api/admin/lineage", { method: "POST", json: { ...draft, scopeNote: draft.scopeNote || null } });
      setDraft({ newerDocumentId: "", relation: "amends", olderDocumentId: "", scopeNote: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const select = (key: "newerDocumentId" | "olderDocumentId", placeholder: string) => (
    <select
      value={draft[key]}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
    >
      <option value="">{placeholder}</option>
      {docs.map((d) => (
        <option key={d.id} value={d.id}>
          {d.issuanceNo ? `${d.issuanceNo} — ` : ""}
          {d.title}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700">Record an amendment</h3>
        <p className="mb-3 text-xs text-gray-500">
          Confirmed relationships drive the amendment warnings shown to staff. When an older issuance is retrieved, the
          newer one is pulled into the answer automatically.
        </p>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {select("newerDocumentId", "Newer issuance…")}
          <select
            value={draft.relation}
            onChange={(e) => setDraft((d) => ({ ...d, relation: e.target.value }))}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
          >
            <option value="amends">amends</option>
            <option value="supersedes">supersedes</option>
            <option value="repeals">repeals</option>
          </select>
          {select("olderDocumentId", "Older issuance…")}
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            value={draft.scopeNote}
            onChange={(e) => setDraft((d) => ({ ...d, scopeNote: e.target.value }))}
            placeholder="Scope (optional), e.g. only Section 5 on per diem rates"
            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.newerDocumentId || !draft.olderDocumentId}
            className="flex items-center justify-center gap-1 rounded-lg bg-dap-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Save
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-gray-700">Confirmed relationships ({edges.length})</h3>
        {edges.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">None recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {edges.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2.5 text-xs">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-gray-800">{label(e.newerDocumentId)}</span>
                  <span className="flex items-center gap-1 rounded bg-dap-gold-50 px-1.5 py-0.5 font-bold text-[#7A5F00]">
                    {e.relation} <ArrowRight className="h-3 w-3" />
                  </span>
                  <span className="text-gray-600">{label(e.olderDocumentId)}</span>
                  {e.scopeNote && <span className="basis-full text-gray-400">Scope: {e.scopeNote}</span>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await api(`/api/admin/lineage?id=${e.id}`, { method: "DELETE" });
                    load();
                  }}
                  className="rounded p-1 text-red-500 hover:bg-red-50"
                  aria-label="Delete relationship"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
