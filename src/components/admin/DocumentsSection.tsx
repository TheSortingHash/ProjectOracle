"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Power,
  RefreshCw,
  ScanSearch,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import type { ViewerTarget } from "@/components/PdfViewer";
import { api, type StatusResponse } from "@/lib/api";
import { extractPages } from "@/lib/pdf-client";
import type { DocumentStatus, DocumentView } from "@/lib/types";
import { storeFile } from "@/lib/upload-client";
import ReviewDialog from "./ReviewDialog";

type QueueItem = {
  key: string;
  name: string;
  stage: "uploading" | "extracting" | "registering" | "done" | "error";
  detail: string;
};

const PIPELINE = ["Upload & extract text", "Metadata review", "Chunking", "Embedding", "Indexed"];
const STAGE_INDEX: Record<DocumentStatus, number> = {
  uploaded: 0,
  extracting: 0,
  awaiting_metadata_review: 1,
  chunking: 2,
  embedding: 3,
  indexed: 5,
  failed: -1,
};
const BUSY: DocumentStatus[] = ["uploaded", "extracting", "chunking", "embedding"];

const STATUS_BADGE: Record<DocumentStatus, { label: string; cls: string }> = {
  uploaded: { label: "Uploaded", cls: "bg-gray-100 text-gray-700" },
  extracting: { label: "Extracting", cls: "bg-dap-blue-100 text-dap-blue" },
  awaiting_metadata_review: { label: "Needs review", cls: "bg-dap-gold-50 text-[#7A5F00]" },
  chunking: { label: "Chunking", cls: "bg-dap-blue-100 text-dap-blue" },
  embedding: { label: "Embedding", cls: "bg-dap-blue-100 text-dap-blue" },
  indexed: { label: "Indexed", cls: "bg-green-100 text-green-800" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700" },
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function DocumentsSection({
  status,
  onChanged,
  onOpen,
}: {
  status: StatusResponse;
  onChanged: () => void;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [reviewing, setReviewing] = useState<DocumentView | null>(null);
  const [indexing, setIndexing] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ documents: DocumentView[] }>("/api/admin/documents");
      setDocs(r.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    load();
  }, [load]);

  // Poll while anything is in flight so the real pipeline state shows live.
  const busy = docs.some((d) => BUSY.includes(d.status)) || indexing.size > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [busy, load]);

  const setItem = (key: string, patch: Partial<QueueItem>) =>
    setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const ingest = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return setError("Only PDF files can be indexed.");
    setError("");
    const items = pdfs.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, stage: "extracting" as const, detail: "Reading PDF" }));
    setQueue((q) => [...items, ...q]);
    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      const key = items[i].key;
      try {
        const pages = await extractPages(await file.arrayBuffer(), (p, total) =>
          setItem(key, { detail: `Extracting text: page ${p} of ${total}` }),
        );
        setItem(key, { stage: "uploading", detail: "Uploading original" });
        const fileKey = await storeFile(file, status, "documents", (pct) =>
          setItem(key, { detail: `Uploading original: ${Math.round(pct)}%` }),
        );
        setItem(key, { stage: "registering", detail: "Saving text and extracting metadata" });
        await api("/api/admin/documents", {
          method: "POST",
          json: { fileKey, fileName: file.name, fileSize: file.size, pages },
        });
        setItem(key, { stage: "done", detail: "Ready for metadata review" });
        await load();
      } catch (err) {
        setItem(key, { stage: "error", detail: err instanceof Error ? err.message : "Failed" });
      }
    }
  };

  const runIndex = async (docId: string, body: unknown) => {
    setIndexing((s) => new Set(s).add(docId));
    try {
      await api(`/api/admin/documents/${docId}/index`, { method: "POST", json: body });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Indexing failed.");
    } finally {
      setIndexing((s) => {
        const n = new Set(s);
        n.delete(docId);
        return n;
      });
      load();
    }
  };

  const toggleActive = async (d: DocumentView) => {
    await api(`/api/admin/documents/${d.id}`, { method: "PATCH", json: { isActive: !d.isActive } });
    await load();
    onChanged();
  };

  const remove = async (d: DocumentView) => {
    if (!confirm(`Delete "${d.title}" and its index? This cannot be undone.`)) return;
    await api(`/api/admin/documents/${d.id}`, { method: "DELETE" });
    await load();
    onChanged();
  };

  const visibleQueue = queue.filter((q) => q.stage !== "done").slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-dap-blue">
          <UploadCloud className="h-4 w-4" /> Upload policy documents (PDF)
        </h3>
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            ingest(Array.from(e.dataTransfer.files));
          }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition sm:p-10 ${
            dragOver ? "border-dap-blue bg-dap-blue-50" : "border-gray-300 bg-gray-50 hover:border-dap-blue-200"
          }`}
        >
          <UploadCloud className="mx-auto mb-2 h-9 w-9 text-dap-blue/60" />
          <p className="text-sm font-semibold text-gray-700">
            Drag and drop PDFs here, or <span className="text-dap-blue">browse</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Multiple files supported · text is extracted in your browser, then chunked and embedded on the server
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              ingest(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        {error && (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </p>
        )}
        {visibleQueue.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {visibleQueue.map((q) => (
              <li key={q.key} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                {q.stage === "error" ? (
                  <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-dap-blue" />
                )}
                <span className="truncate font-medium text-gray-700">{q.name}</span>
                <span className={`ml-auto shrink-0 ${q.stage === "error" ? "text-red-600" : "text-gray-500"}`}>{q.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <ol className="mt-4 hidden grid-cols-5 gap-2 text-center text-[11px] text-gray-400 sm:grid">
          {PIPELINE.map((s, i) => (
            <li key={s}>
              <div className="mb-1 h-1.5 rounded-full bg-gray-200" style={{ opacity: 1 - i * 0.12 }} />
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">Policy documents</h3>
          <span className="text-xs text-gray-400">
            {docs.filter((d) => d.status === "indexed" && d.isActive).length} live · {docs.length} total
          </span>
        </div>
        {docs.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No documents yet.</div>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] tracking-wide text-gray-400 uppercase">
                  <th className="pr-3 pb-2 font-bold">Document</th>
                  <th className="pr-3 pb-2 font-bold">Issuance no.</th>
                  <th className="pr-3 pb-2 font-bold">Effectivity</th>
                  <th className="pr-3 pb-2 font-bold">Pages</th>
                  <th className="pr-3 pb-2 font-bold">Status</th>
                  <th className="pb-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const badge = STATUS_BADGE[d.status];
                  const working = BUSY.includes(d.status) || indexing.has(d.id);
                  return (
                    <tr key={d.id} className={`border-b border-gray-50 align-top ${d.isActive ? "" : "opacity-50"}`}>
                      <td className="max-w-[260px] py-2.5 pr-3">
                        <button
                          type="button"
                          onClick={() => onOpen({ title: d.title, fileUrl: d.fileUrl, page: 1 })}
                          className="flex items-start gap-1.5 text-left text-xs font-medium text-dap-blue hover:underline"
                        >
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="line-clamp-2">{d.title}</span>
                        </button>
                        <span className="mt-0.5 block truncate pl-5 text-[10px] text-gray-400">
                          {d.fileName} · {kb(d.fileSize)} · uploaded {d.createdAt.slice(0, 10)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-gray-600">{d.issuanceNo || "—"}</td>
                      <td className="py-2.5 pr-3 text-xs text-gray-600">{d.effectivityDate || d.dateIssued || "—"}</td>
                      <td className="py-2.5 pr-3 text-xs text-gray-600">
                        {d.pageCount}
                        {d.lowTextPages.length > 0 && (
                          <span
                            className="ml-1 inline-flex items-center gap-0.5 text-amber-600"
                            title={`Little or no text on page(s) ${d.lowTextPages.slice(0, 20).join(", ")}. These may be scanned images; OCR is not enabled in the demo.`}
                          >
                            <ScanSearch className="h-3 w-3" />
                            {d.lowTextPages.length}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
                          {working && <Loader2 className="h-3 w-3 animate-spin" />}
                          {d.status === "indexed" && <CheckCircle2 className="h-3 w-3" />}
                          {badge.label}
                          {!d.isActive && " (inactive)"}
                        </span>
                        {d.statusDetail && <span className="mt-0.5 block max-w-[220px] text-[10px] text-gray-400">{d.statusDetail}</span>}
                        {STAGE_INDEX[d.status] >= 0 && STAGE_INDEX[d.status] < 5 && (
                          <div className="mt-1 flex gap-0.5">
                            {PIPELINE.map((_, i) => (
                              <span
                                key={i}
                                className={`h-1 w-5 rounded-full ${
                                  i < STAGE_INDEX[d.status] ? "bg-green-500" : i === STAGE_INDEX[d.status] ? "bg-dap-blue" : "bg-gray-200"
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {(d.status === "awaiting_metadata_review" || d.status === "indexed" || d.status === "failed") && (
                            <ActionBtn
                              primary={d.status === "awaiting_metadata_review"}
                              disabled={working}
                              onClick={() => setReviewing(d)}
                              label={d.status === "awaiting_metadata_review" ? "Review & index" : "Edit metadata"}
                              icon={Eye}
                            />
                          )}
                          {(d.status === "indexed" || d.status === "failed") && d.chunkCount !== undefined && (
                            <ActionBtn
                              disabled={working}
                              onClick={() => runIndex(d.id, { action: "reindex" })}
                              label="Re-index"
                              icon={RefreshCw}
                            />
                          )}
                          {d.status === "indexed" && (
                            <ActionBtn onClick={() => toggleActive(d)} label={d.isActive ? "Deactivate" : "Activate"} icon={Power} />
                          )}
                          <ActionBtn danger disabled={working} onClick={() => remove(d)} label="Delete" icon={Trash2} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewing && (
        <ReviewDialog
          doc={reviewing}
          allDocs={docs}
          onClose={() => setReviewing(null)}
          onOpen={onOpen}
          onConfirm={(body) => {
            const id = reviewing.id;
            setReviewing(null);
            runIndex(id, body);
          }}
        />
      )}
    </div>
  );
}

function ActionBtn(props: {
  label: string;
  icon: typeof Eye;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-40 ${
        props.primary
          ? "bg-dap-blue text-white hover:bg-dap-blue-dark"
          : props.danger
            ? "text-red-600 hover:bg-red-50"
            : "text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
      }`}
    >
      <Icon className="h-3 w-3" />
      {props.label}
    </button>
  );
}
