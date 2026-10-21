"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ClipboardCheck,
  FileText,
  History,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
} from "lucide-react";
import { BotAvatar } from "@/components/brand";
import type { ViewerTarget } from "@/components/PdfViewer";
import { api, type StatusResponse } from "@/lib/api";
import { PERSONA_LIST, PERSONAS, isPersonaKey, type PersonaKey } from "@/lib/personas";
import type { ChatMessageView, DocumentView, Mode } from "@/lib/types";
import { AssistantMessage } from "./AssistantMessage";
import { PersonaBadge } from "./PersonaBadge";

const EXAMPLES: Record<PersonaKey, string[]> = {
  general_staff: [
    "How do I file for vacation leave, and how early must I apply?",
    "What do I need to submit to get reimbursed after an official trip?",
  ],
  policy_maker: [
    "Which issuance currently governs travel allowances, and what did it supersede?",
    "We plan to revise the overtime policy. Which existing issuances should the new circular reference or repeal?",
  ],
  program_manager: [
    "What are the honoraria rates for resource persons, and who approves them?",
    "Up to what amount can we use Small Value Procurement, and what documents are required?",
  ],
};

const SCENARIO_EXAMPLE =
  "We are planning a 3-day PMDP workshop in Tagaytay next month for 40 participants. We will hire two external resource persons, rent a hotel venue with meals, and four staff will travel by DAP vehicle. Can we proceed?";

type Conversation = { id: string; title: string; updatedAt: string };

export default function ChatView({
  status,
  documents,
  onOpen,
}: {
  status: StatusResponse | null;
  documents: DocumentView[];
  onOpen: (t: ViewerTarget) => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [persona, setPersona] = useState<PersonaKey>("general_staff");
  const [mode, setMode] = useState<Mode>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dap.persona");
      // Restoring a per-browser preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isPersonaKey(saved)) setPersona(saved);
      if (window.innerWidth < 768) setSidebarOpen(false);
    } catch {}
  }, []);

  const choosePersona = (p: PersonaKey) => {
    setPersona(p);
    try {
      localStorage.setItem("dap.persona", p);
    } catch {}
  };

  const loadConversations = useCallback(async () => {
    try {
      const r = await api<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(r.conversations);
    } catch {}
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const openConversation = async (id: string) => {
    setError("");
    const r = await api<{ messages: ChatMessageView[] }>(`/api/conversations/${id}`);
    setConversationId(id);
    setMessages(r.messages);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setError("");
  };

  const ready = Boolean(status?.anthropic) && documents.length > 0;

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || loading || !ready) return;
    setInput("");
    setError("");
    const tempId = `pending-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: tempId, sender: "user", content: message, persona, mode, createdAt: new Date().toISOString() },
    ]);
    setLoading(true);
    try {
      const r = await api<{ conversationId: string; user: ChatMessageView; assistant: ChatMessageView }>("/api/chat", {
        method: "POST",
        json: { conversationId, message, persona, mode },
      });
      setConversationId(r.conversationId);
      setMessages((m) => [...m.filter((x) => x.id !== tempId), r.user, r.assistant]);
      loadConversations();
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      setInput(message);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const simplify = async (id: string) => {
    try {
      const r = await api<{ plainEnglish: string; filipino: string }>(`/api/messages/${id}/simplify`, { method: "POST" });
      setMessages((m) => m.map((x) => (x.id === id && x.sender === "assistant" ? { ...x, simplified: r } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not simplify this answer.");
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`absolute inset-y-0 left-0 z-20 w-72 shrink-0 overflow-y-auto border-r border-gray-200 bg-white transition-transform duration-200 md:static md:z-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:hidden"
        }`}
      >
        <div className="space-y-5 p-4">
          <button
            type="button"
            onClick={newConversation}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dap-blue-200 bg-dap-blue-50 py-2 text-sm font-semibold text-dap-blue hover:bg-dap-blue-100"
          >
            <MessageSquarePlus className="h-4 w-4" /> New conversation
          </button>

          <section>
            <label htmlFor="persona" className="mb-1 block text-xs font-semibold text-gray-600">
              Your role
            </label>
            <select
              id="persona"
              value={persona}
              onChange={(e) => choosePersona(e.target.value as PersonaKey)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-dap-blue focus:outline-none"
            >
              {PERSONA_LIST.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-snug text-gray-400">{PERSONAS[persona].description}</p>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Scenario audit mode</span>
              <button
                type="button"
                role="switch"
                aria-checked={mode === "scenario"}
                onClick={() => setMode((m) => (m === "chat" ? "scenario" : "chat"))}
                className={`relative h-5 w-10 rounded-full transition-colors ${mode === "scenario" ? "bg-dap-blue" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    mode === "scenario" ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">Describe a planned activity and get a compliance checklist.</p>
          </section>

          {conversations.length > 0 && (
            <section>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <History className="h-3.5 w-3.5" /> Recent conversations
              </p>
              <ul className="space-y-0.5">
                {conversations.slice(0, 12).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(c.id)}
                      className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-gray-100 ${
                        c.id === conversationId ? "bg-dap-blue-50 font-semibold text-dap-blue" : "text-gray-600"
                      }`}
                      title={c.title}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className="mb-1.5 text-xs font-semibold text-gray-600">Indexed policies ({documents.length})</p>
            {documents.length === 0 ? (
              <p className="rounded-lg border border-yellow-200 bg-yellow-50 p-2.5 text-[11px] text-yellow-800">
                No documents are indexed yet. An administrator can upload PDFs in the Admin Panel.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {documents.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => onOpen({ title: d.title, fileUrl: d.fileUrl, page: 1 })}
                      className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs text-dap-blue hover:bg-dap-blue-50"
                      title={d.title}
                    >
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{d.issuanceNo || d.title}</span>
                        {d.issuanceNo && <span className="block truncate text-[10px] text-gray-400">{d.title}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
      {sidebarOpen && (
        <div className="absolute inset-0 z-10 bg-black/20 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />
      )}

      {/* Chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((s) => !s)}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <span className="text-xs text-gray-500">Answering as</span>
          <PersonaBadge persona={persona} />
          {mode === "scenario" && (
            <span className="rounded bg-dap-blue px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
              SCENARIO MODE
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.length === 0 && (
              <Welcome
                persona={persona}
                mode={mode}
                onPersona={choosePersona}
                onExample={(q) => (ready ? send(q) : setInput(q))}
                status={status}
                docCount={documents.length}
              />
            )}
            {messages.map((m) =>
              m.sender === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-xl rounded-2xl rounded-tr-sm bg-dap-blue px-4 py-2.5 text-sm whitespace-pre-wrap text-white shadow">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <AssistantMessage msg={m} onOpen={onOpen} onSimplify={simplify} />
                </div>
              ),
            )}
            {loading && (
              <div className="flex items-start gap-2">
                <BotAvatar size={22} />
                <div className="rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="dap-dot h-1.5 w-1.5 rounded-full bg-dap-blue" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                    {mode === "scenario" ? "Checking the scenario against each policy area…" : "Searching the policy documents…"}
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-gray-200 bg-white p-3 sm:p-4">
          <div className="mx-auto max-w-3xl">
            {error && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
            <div className="flex items-end gap-2">
              {mode === "scenario" ? (
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                  }}
                  rows={4}
                  disabled={!ready}
                  placeholder={ready ? "Describe the planned event, project or activity in detail…" : "Waiting for setup…"}
                  className="flex-1 resize-none rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:border-dap-blue focus:ring-2 focus:ring-dap-blue/15 focus:outline-none disabled:bg-gray-50"
                />
              ) : (
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) send();
                  }}
                  disabled={!ready}
                  placeholder={
                    !status?.anthropic
                      ? "The Anthropic API key has not been configured yet"
                      : documents.length === 0
                        ? "Upload policy documents in the Admin Panel first…"
                        : "Ask about DAP policies…"
                  }
                  className="flex-1 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:border-dap-blue focus:ring-2 focus:ring-dap-blue/15 focus:outline-none disabled:bg-gray-50"
                />
              )}
              <button
                type="button"
                onClick={() => send()}
                disabled={loading || !input.trim() || !ready}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-dap-blue px-4 text-sm font-semibold text-white hover:bg-dap-blue-dark disabled:opacity-40"
              >
                {mode === "scenario" ? <ClipboardCheck className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {mode === "scenario" ? "Audit" : "Send"}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-gray-400">
              {mode === "scenario" ? "Ctrl + Enter to submit · " : ""}Answers come only from uploaded DAP documents. Verify
              important decisions with the issuing office.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Welcome(props: {
  persona: PersonaKey;
  mode: Mode;
  onPersona: (p: PersonaKey) => void;
  onExample: (q: string) => void;
  status: StatusResponse | null;
  docCount: number;
}) {
  const examples = props.mode === "scenario" ? [SCENARIO_EXAMPLE] : EXAMPLES[props.persona];
  return (
    <div className="flex gap-2">
      <BotAvatar size={22} />
      <div className="flex-1 rounded-2xl rounded-tl-sm border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-800">Hello! I&apos;m the DAP Policy Assistant.</p>
        <p className="mt-1 text-sm text-gray-600">
          I answer questions using only the policy documents your administrators have uploaded, and I cite the exact page
          for every rule. Which role best describes you?
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {PERSONA_LIST.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => props.onPersona(p.key)}
              className={`rounded-xl border p-2.5 text-left transition ${
                props.persona === p.key ? "border-dap-blue ring-2 ring-dap-blue/15" : "border-gray-200 hover:border-dap-blue-200"
              }`}
            >
              <PersonaBadge persona={p.key} />
              <span className="mt-1 block text-[11px] leading-snug text-gray-500">{p.description}</span>
            </button>
          ))}
        </div>
        {props.status && !props.status.anthropic && (
          <p className="mt-3 rounded-lg bg-yellow-50 p-2.5 text-xs text-yellow-800">
            Setup needed: the Anthropic API key is not configured. See the Admin Panel → Setup checklist.
          </p>
        )}
        {props.status?.anthropic && props.docCount === 0 && (
          <p className="mt-3 rounded-lg bg-yellow-50 p-2.5 text-xs text-yellow-800">
            No policy documents are indexed yet. Upload PDFs in the Admin Panel to get started.
          </p>
        )}
        <p className="mt-4 mb-1.5 text-[11px] font-bold tracking-wide text-gray-400 uppercase">
          {props.mode === "scenario" ? "Try a scenario" : "Try asking"}
        </p>
        <div className="space-y-1.5">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => props.onExample(q)}
              className="block w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-dap-blue-50 hover:text-dap-blue"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
