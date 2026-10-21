"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Power, Trash2, Upload } from "lucide-react";
import { api, type StatusResponse } from "@/lib/api";
import { storeFile } from "@/lib/upload-client";

type Form = {
  id: string;
  name: string;
  description: string | null;
  fileName: string;
  topics: string[];
  isActive: boolean;
  downloadUrl: string;
};

export default function FormsSection({ status }: { status: StatusResponse }) {
  const [forms, setForms] = useState<Form[]>([]);
  const [draft, setDraft] = useState({ name: "", description: "", topics: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ forms: Form[] }>("/api/admin/forms");
    setForms(r.forms);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    load().catch((e) => setError(e.message));
  }, [load]);

  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fileKey = await storeFile(file, status, "forms");
      await api("/api/admin/forms", {
        method: "POST",
        json: {
          name: draft.name,
          description: draft.description || null,
          topics: draft.topics.split(",").map((t) => t.trim()).filter(Boolean),
          fileKey,
          fileName: file.name,
        },
      });
      setDraft({ name: "", description: "", topics: "" });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the form.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700">Add an official form</h3>
        <p className="mb-3 text-xs text-gray-500">
          The assistant can only recommend forms from this library, and every button downloads the real file.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Form name, e.g. Application for Leave"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <input
            value={draft.topics}
            onChange={(e) => setDraft((d) => ({ ...d, topics: e.target.value }))}
            placeholder="Topics, comma-separated (leave, travel…)"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <input
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="When is it used? (helps the assistant pick the right form)"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm sm:col-span-2"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-dap-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-dap-blue"
          />
          <button
            type="button"
            onClick={save}
            disabled={busy || !file || draft.name.trim().length < 2}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-dap-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add form
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-gray-700">Forms library ({forms.length})</h3>
        {forms.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No forms yet. Until you add some, the assistant recommends none.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {forms.map((f) => (
              <li key={f.id} className={`flex items-start gap-3 py-2.5 ${f.isActive ? "" : "opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800">{f.name}</p>
                  <p className="text-xs text-gray-500">
                    {f.description || "No description"} · <code className="text-[10px]">{f.id}</code>
                  </p>
                  {f.topics.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.topics.map((t) => (
                        <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <a href={f.downloadUrl} className="rounded p-1.5 text-dap-blue hover:bg-dap-blue-50" aria-label="Download">
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    await api(`/api/admin/forms/${f.id}`, { method: "PATCH", json: { isActive: !f.isActive } });
                    load();
                  }}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
                  aria-label={f.isActive ? "Deactivate" : "Activate"}
                  title={f.isActive ? "Deactivate" : "Activate"}
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Delete the form "${f.name}"?`)) return;
                    await api(`/api/admin/forms/${f.id}`, { method: "DELETE" });
                    load();
                  }}
                  className="rounded p-1.5 text-red-500 hover:bg-red-50"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
