"use client";
import { useEffect, useState } from "react";
import { Eye, GitBranch, Info, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { ViewerTarget } from "@/components/PdfViewer";
import { api } from "@/lib/api";
import { ISSUANCE_TYPES, type DocumentView } from "@/lib/types";

type Relation = "amends" | "supersedes" | "repeals";
type LineageRow = { olderDocumentId: string; relation: Relation; scopeNote: string };
type ApiLineage = { olderDocumentId: string; newerDocumentId: string; relation: Relation; scopeNote: string | null };

export default function ReviewDialog({
  doc,
  allDocs,
  onClose,
  onConfirm,
  onOpen,
}: {
  doc: DocumentView;
  allDocs: DocumentView[];
  onClose: () => void;
  onConfirm: (body: unknown) => void;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    title: doc.title,
    issuanceType: doc.issuanceType ?? "",
    issuanceNo: doc.issuanceNo ?? "",
    dateIssued: doc.dateIssued ?? "",
    effectivityDate: doc.effectivityDate ?? "",
    issuingOffice: doc.issuingOffice ?? "",
  });
  const [lineage, setLineage] = useState<LineageRow[]>([]);
  const [unmatched, setUnmatched] = useState<{ relation: Relation; cited: string }[]>([]);
  const [fromAi, setFromAi] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ document: DocumentView; lineage: ApiLineage[] }>(`/api/admin/documents/${doc.id}`);
        const s = r.document.suggestedMetadata;
        const confirmed = Boolean(r.document.issuanceNo || r.document.issuanceType);
        if (s && !confirmed) {
          setFromAi(true);
          setForm({
            title: s.title || r.document.title,
            issuanceType: s.issuance_type || "",
            issuanceNo: s.issuance_no,
            dateIssued: isDate(s.date_issued) ? s.date_issued : "",
            effectivityDate: isDate(s.effectivity_date) ? s.effectivity_date : "",
            issuingOffice: s.issuing_office,
          });
        }
        const existing = r.lineage.filter((l) => l.newerDocumentId === doc.id);
        if (existing.length) {
          setLineage(existing.map((l) => ({ olderDocumentId: l.olderDocumentId, relation: l.relation, scopeNote: l.scopeNote ?? "" })));
        } else if (s) {
          setLineage(
            s.references
              .filter((x) => x.matched_document_id)
              .map((x) => ({ olderDocumentId: x.matched_document_id!, relation: x.relation, scopeNote: "" })),
          );
        }
        if (s) setUnmatched(s.references.filter((x) => !x.matched_document_id).map((x) => ({ relation: x.relation, cited: x.cited_issuance })));
      } finally {
        setLoading(false);
      }
    })();
  }, [doc.id]);

  const others = allDocs.filter((d) => d.id !== doc.id);
  const valid = form.title.trim().length > 0 && lineage.every((l) => l.olderDocumentId);

  const field = (key: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-semibold text-gray-600">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-dap-blue focus:outline-none"
        {...props}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Review document metadata"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-800">Review metadata before indexing</h3>
            <p className="truncate text-xs text-gray-500">{doc.fileName}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onOpen({ title: doc.title, fileUrl: doc.fileUrl, page: 1 })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-dap-blue hover:bg-dap-blue-50"
            >
              <Eye className="h-3.5 w-3.5" /> View PDF
            </button>
            <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-dap-blue" />
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {fromAi && (
              <p className="flex items-start gap-2 rounded-lg bg-dap-blue-50 p-2.5 text-xs text-dap-blue">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Fields were pre-filled from the document text. Check each one against the PDF; what you confirm here is
                the source of truth for citations and amendment warnings.
              </p>
            )}
            {doc.statusDetail && doc.status === "awaiting_metadata_review" && (
              <p className="flex items-start gap-2 rounded-lg bg-yellow-50 p-2.5 text-xs text-yellow-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {doc.statusDetail}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">{field("title", "Title")}</div>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-semibold text-gray-600">Issuance type</span>
                <select
                  value={form.issuanceType}
                  onChange={(e) => setForm((f) => ({ ...f, issuanceType: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-dap-blue focus:outline-none"
                >
                  <option value="">—</option>
                  {ISSUANCE_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              {field("issuanceNo", "Issuance number", { placeholder: "e.g. AO No. 2024-01" })}
              {field("dateIssued", "Date issued", { type: "date" })}
              {field("effectivityDate", "Effectivity date", { type: "date" })}
              <div className="sm:col-span-2">{field("issuingOffice", "Issuing office")}</div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                  <GitBranch className="h-3.5 w-3.5" /> This document amends, supersedes or repeals…
                </p>
                <button
                  type="button"
                  disabled={!others.length}
                  onClick={() => setLineage((l) => [...l, { olderDocumentId: "", relation: "amends", scopeNote: "" }])}
                  className="flex items-center gap-1 text-xs font-semibold text-dap-blue disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {lineage.length === 0 && (
                <p className="text-xs text-gray-400">No relationships. Add one if this issuance changes an earlier one.</p>
              )}
              <ul className="space-y-2">
                {lineage.map((l, i) => (
                  <li key={i} className="grid gap-1.5 rounded-lg bg-gray-50 p-2 sm:grid-cols-[110px_1fr_auto]">
                    <select
                      value={l.relation}
                      onChange={(e) =>
                        setLineage((ls) => ls.map((x, j) => (j === i ? { ...x, relation: e.target.value as Relation } : x)))
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="amends">amends</option>
                      <option value="supersedes">supersedes</option>
                      <option value="repeals">repeals</option>
                    </select>
                    <select
                      value={l.olderDocumentId}
                      onChange={(e) => setLineage((ls) => ls.map((x, j) => (j === i ? { ...x, olderDocumentId: e.target.value } : x)))}
                      className="min-w-0 rounded-md border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="">Select the earlier document…</option>
                      {others.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.issuanceNo ? `${d.issuanceNo} — ` : ""}
                          {d.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setLineage((ls) => ls.filter((_, j) => j !== i))}
                      className="justify-self-end rounded p-1 text-red-500 hover:bg-red-50"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <input
                      value={l.scopeNote}
                      onChange={(e) => setLineage((ls) => ls.map((x, j) => (j === i ? { ...x, scopeNote: e.target.value } : x)))}
                      placeholder="Scope (optional), e.g. Section 4 on travel allowance rates"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs sm:col-span-3"
                    />
                  </li>
                ))}
              </ul>
              {unmatched.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <p className="font-semibold">Cited in the text but not found in the corpus:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {unmatched.map((u, i) => (
                      <li key={i}>
                        {u.relation} {u.cited}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1">Upload those issuances, then edit this document&apos;s metadata to link them.</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t bg-gray-50 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !valid}
            onClick={() =>
              onConfirm({
                action: "confirm",
                metadata: {
                  title: form.title.trim(),
                  issuanceType: form.issuanceType || null,
                  issuanceNo: form.issuanceNo.trim() || null,
                  dateIssued: form.dateIssued || null,
                  effectivityDate: form.effectivityDate || null,
                  issuingOffice: form.issuingOffice.trim() || null,
                },
                lineage: lineage.map((l) => ({ ...l, scopeNote: l.scopeNote.trim() || null })),
              })
            }
            className="rounded-lg bg-dap-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-dap-blue-dark disabled:opacity-40"
          >
            Confirm &amp; index
          </button>
        </div>
      </div>
    </div>
  );
}

function isDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
