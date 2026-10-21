"use client";
import { useCallback, useEffect, useState } from "react";
import { LogOut, MessagesSquare, Settings2 } from "lucide-react";
import AdminPanel from "@/components/admin/AdminPanel";
import { HeaderLogo } from "@/components/brand";
import ChatView from "@/components/chat/ChatView";
import PdfViewer, { type ViewerTarget } from "@/components/PdfViewer";
import { api, type StatusResponse } from "@/lib/api";
import type { DocumentView } from "@/lib/types";

export default function PolicyApp() {
  const [tab, setTab] = useState<"chat" | "admin">("chat");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ documents: DocumentView[] }>("/api/documents"),
      ]);
      setStatus(s);
      setDocuments(d.documents);
    } catch {}
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    refresh();
    try {
      // Restoring a per-browser preference after hydration.
      if (localStorage.getItem("dap.tab") === "admin") setTab("admin");
    } catch {}
  }, [refresh]);

  const switchTab = (t: "chat" | "admin") => {
    setTab(t);
    try {
      localStorage.setItem("dap.tab", t);
    } catch {}
    if (t === "chat") refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <nav className="z-10 flex shrink-0 flex-wrap items-center gap-x-6 bg-dap-blue px-3 shadow-md sm:px-6">
        <div className="flex items-center gap-3 py-2.5">
          <HeaderLogo className="h-9" />
          <div className="border-l border-white/25 pl-3">
            <div className="text-sm leading-tight font-bold text-white">Policy Assistant</div>
            <div className="text-[11px] leading-tight text-dap-gold">Development Academy of the Philippines</div>
          </div>
        </div>
        <div className="flex">
          {(
            [
              ["chat", "Chat", MessagesSquare],
              ["admin", "Admin Panel", Settings2],
            ] as const
          ).map(([t, label, Icon]) => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-3.5 text-sm font-medium transition-colors sm:px-4 ${
                tab === t ? "border-dap-gold text-white" : "border-transparent text-white/60 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4 py-2 text-xs text-dap-gold">
          <span>
            {documents.length} polic{documents.length === 1 ? "y" : "ies"} indexed
          </span>
          {status?.passcodeGate && (
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
              className="flex items-center gap-1 text-white/70 hover:text-white"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </nav>

      {tab === "chat" ? (
        <ChatView status={status} documents={documents} onOpen={setViewer} />
      ) : (
        <AdminPanel status={status} onChanged={refresh} onOpen={setViewer} />
      )}

      {viewer && <PdfViewer target={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
