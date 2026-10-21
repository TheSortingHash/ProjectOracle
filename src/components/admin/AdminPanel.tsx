"use client";
import { useState } from "react";
import { BarChart3, FileStack, GitBranch, KeyRound, ListChecks, Loader2, ScrollText } from "lucide-react";
import type { ViewerTarget } from "@/components/PdfViewer";
import { api, type StatusResponse } from "@/lib/api";
import DocumentsSection from "./DocumentsSection";
import FormsSection from "./FormsSection";
import LineageSection from "./LineageSection";
import SetupChecklist from "./SetupChecklist";
import UsageSection from "./UsageSection";

const SECTIONS = [
  ["documents", "Documents", FileStack],
  ["lineage", "Amendments", GitBranch],
  ["forms", "Forms library", ScrollText],
  ["usage", "Usage", BarChart3],
  ["setup", "Setup", ListChecks],
] as const;
type Section = (typeof SECTIONS)[number][0];

export default function AdminPanel({
  status,
  onChanged,
  onOpen,
}: {
  status: StatusResponse | null;
  onChanged: () => void;
  onOpen: (t: ViewerTarget) => void;
}) {
  const [section, setSection] = useState<Section>("documents");

  if (!status) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-dap-blue" />
      </div>
    );
  }
  if (!status.isAdmin) return <AdminGate status={status} onDone={onChanged} />;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
        <div className="mb-5 border-b border-gray-200 pb-4">
          <h2 className="text-lg font-bold text-gray-800">Admin Panel</h2>
          <p className="text-sm text-gray-500">
            Upload and confirm DAP policy issuances. The assistant answers <strong>only</strong> from documents indexed here.
          </p>
        </div>
        <div className="mb-5 flex flex-wrap gap-1.5">
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                section === key ? "bg-dap-blue text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        {section === "documents" && <DocumentsSection status={status} onChanged={onChanged} onOpen={onOpen} />}
        {section === "lineage" && <LineageSection />}
        {section === "forms" && <FormsSection status={status} />}
        {section === "usage" && <UsageSection />}
        {section === "setup" && <SetupChecklist status={status} />}
      </div>
    </div>
  );
}

function AdminGate({ status, onDone }: { status: StatusResponse; onDone: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/api/auth/login", { method: "POST", json: { passcode, scope: "admin" } });
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-3 flex items-center gap-2 text-dap-blue">
          <KeyRound className="h-5 w-5" />
          <h2 className="font-bold">Administrator access</h2>
        </div>
        {status.adminConfigured ? (
          <>
            <p className="mb-3 text-xs text-gray-500">Enter the admin passcode to manage policy documents.</p>
            <input
              type="password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-dap-blue focus:outline-none"
              placeholder="Admin passcode"
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy || !passcode}
              className="mt-3 w-full rounded-lg bg-dap-blue py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Checking…" : "Unlock Admin Panel"}
            </button>
          </>
        ) : (
          <p className="text-xs text-gray-600">
            The Admin Panel is disabled because <code>ADMIN_PASSCODE</code> is not set. Add it in Vercel → Settings →
            Environment Variables and redeploy.
          </p>
        )}
      </form>
    </div>
  );
}
