"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  ClipboardList,
  Download,
  FileSearch,
  HelpCircle,
  Languages,
  Loader2,
  Paperclip,
  XCircle,
} from "lucide-react";
import { BotAvatar } from "@/components/brand";
import type { ViewerTarget } from "@/components/PdfViewer";
import { PERSONAS } from "@/lib/personas";
import type { AssistantPayload, ChatMessageView, ChecklistStatus, CitationView, Overall } from "@/lib/types";
import { PersonaBadge } from "./PersonaBadge";

type Props = {
  msg: Extract<ChatMessageView, { sender: "assistant" }>;
  onOpen: (t: ViewerTarget) => void;
  onSimplify: (id: string) => Promise<void>;
};

const STATUS_META: Record<ChecklistStatus, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  met: { label: "Met", icon: CheckCircle2, cls: "text-green-700" },
  unmet: { label: "Not met", icon: XCircle, cls: "text-red-600" },
  unclear: { label: "Unclear", icon: CircleHelp, cls: "text-amber-600" },
  cannot_verify: { label: "Cannot verify", icon: CircleDashed, cls: "text-gray-500" },
};

const OVERALL_META: Record<Overall, { label: string; cls: string }> = {
  compliant: { label: "Compliant", cls: "bg-green-100 text-green-800" },
  partially_compliant: { label: "Partially compliant", cls: "bg-amber-100 text-amber-800" },
  non_compliant: { label: "Non-compliant", cls: "bg-red-100 text-red-700" },
  cannot_determine: { label: "Cannot determine", cls: "bg-gray-100 text-gray-700" },
};

function citationTarget(c: CitationView): ViewerTarget {
  return {
    title: c.issuanceNo ? `${c.issuanceNo}: ${c.documentTitle}` : c.documentTitle,
    fileUrl: `/api/documents/${c.documentId}/file`,
    page: c.pageStart,
    highlight: c.excerpt.replace(/…$/, ""),
  };
}

const pagesLabel = (c: CitationView) => (c.pageStart === c.pageEnd ? `p. ${c.pageStart}` : `pp. ${c.pageStart}–${c.pageEnd}`);

function CitationChip({ c, onOpen }: { c: CitationView; onOpen: Props["onOpen"] }) {
  const [hover, setHover] = useState(false);
  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => onOpen(citationTarget(c))}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-dap-blue-100 px-1 text-[10px] font-bold text-dap-blue hover:bg-dap-blue hover:text-white"
        aria-label={`Source ${c.n}: ${c.documentTitle}, ${pagesLabel(c)}`}
      >
        {c.n}
      </button>
      {hover && <SourceCard c={c} />}
    </span>
  );
}

function SourceCard({ c }: { c: CitationView }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 block w-72 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-xl">
      <span className="block truncate text-xs font-bold text-dap-blue">{c.issuanceNo || c.documentTitle}</span>
      <span className="block text-[11px] text-gray-500">
        {pagesLabel(c)}
        {c.sectionLabel ? ` · ${c.sectionLabel}` : ""}
      </span>
      <span className="mt-1.5 block max-h-28 overflow-hidden border-t pt-1.5 text-[11px] leading-relaxed text-gray-700">
        {c.excerpt}
      </span>
      <span className="mt-1.5 block text-[11px] font-semibold text-[#8a7414]">Click to open at the cited page →</span>
    </span>
  );
}

function Answer({ payload, onOpen }: { payload: AssistantPayload; onOpen: Props["onOpen"] }) {
  const byN = new Map(payload.citations.map((c) => [c.n, c]));
  // Turn [n] markers into links the custom renderer swaps for citation chips.
  const md = payload.answer.replace(/\[(\d+)\]/g, (m, n) => (byN.has(Number(n)) ? `[${n}](#cite-${n})` : m));
  return (
    <div className="answer-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            const c = m ? byN.get(Number(m[1])) : undefined;
            if (c) return <CitationChip c={c} onOpen={onOpen} />;
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-dap-blue underline">
                {children}
              </a>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

export function AssistantMessage({ msg, onOpen, onSimplify }: Props) {
  const p = msg.payload;
  const [busy, setBusy] = useState(false);
  const [showSimple, setShowSimple] = useState(Boolean(msg.simplified));
  const persona = PERSONAS[msg.persona];

  const groups = new Map<string, typeof p.checklist>();
  for (const item of p.checklist) groups.set(item.policyArea, [...(groups.get(item.policyArea) ?? []), item]);
  const tally = p.checklist.reduce<Record<string, number>>((acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc), {});

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <BotAvatar size={22} />
        <span className="text-xs font-medium text-gray-500">DAP Policy Assistant</span>
        {persona && <PersonaBadge persona={msg.persona} />}
        {msg.mode === "scenario" && (
          <span className="rounded bg-dap-blue px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">AUDIT</span>
        )}
      </div>

      <div className="rounded-2xl rounded-tl-sm border border-gray-200 bg-white p-4 shadow-sm">
        {p.warnings.map((w, i) => (
          <div
            key={i}
            className={`mb-3 flex gap-2.5 rounded-xl border p-3 ${
              w.kind === "confirmed" ? "border-yellow-300 bg-yellow-50" : "border-orange-200 bg-orange-50"
            }`}
          >
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${w.kind === "confirmed" ? "text-yellow-700" : "text-orange-600"}`} />
            <div className="text-xs leading-relaxed">
              <p className={`font-bold ${w.kind === "confirmed" ? "text-yellow-900" : "text-orange-800"}`}>
                {w.kind === "confirmed" ? "Policy amendment warning" : "Possible conflict — verify with the issuing office"}
              </p>
              <p className={w.kind === "confirmed" ? "text-yellow-800" : "text-orange-700"}>
                {w.kind === "confirmed" ? (
                  <>
                    The {w.olderYear ? <strong>{w.olderYear}</strong> : null} rule in <strong>{w.olderLabel}</strong> was{" "}
                    {w.relation === "repeals" ? "repealed" : w.relation === "supersedes" ? "superseded" : "amended"} by{" "}
                    <strong>{w.newerLabel}</strong>
                    {w.newerDate ? ` (${w.newerDate})` : ""}. The answer below follows the newer issuance.
                  </>
                ) : (
                  <>
                    <strong>{w.olderLabel}</strong> and <strong>{w.newerLabel}</strong> appear to state different rules
                    {w.topic ? ` on ${w.topic}` : ""}. No amendment is recorded by an administrator, so treat the later
                    issuance as controlling only after verification.
                  </>
                )}
                {w.kind === "confirmed" && w.topic ? <span className="block opacity-80">Scope: {w.topic}</span> : null}
              </p>
            </div>
          </div>
        ))}

        {!p.foundInDocuments && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
            <FileSearch className="h-4 w-4" />
            Not found in the uploaded policy documents
          </div>
        )}

        <Answer payload={p} onOpen={onOpen} />

        {p.referral && (
          <div className="mt-3 flex gap-2 rounded-xl border border-dap-blue-200 bg-dap-blue-50 p-3 text-xs text-gray-700">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-dap-blue" />
            <p>
              For <strong>{p.referral.topic.toLowerCase()}</strong>, coordinate directly with the{" "}
              <strong>{p.referral.office}</strong>; this may need a case-specific assessment.
            </p>
          </div>
        )}

        {p.checklist.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <ClipboardList className="h-4 w-4 text-dap-blue" />
              <span className="text-xs font-bold text-gray-700">Compliance checklist</span>
              {(Object.keys(STATUS_META) as ChecklistStatus[]).map((s) =>
                tally[s] ? (
                  <span key={s} className={`text-[11px] font-semibold ${STATUS_META[s].cls}`}>
                    {tally[s]} {STATUS_META[s].label.toLowerCase()}
                  </span>
                ) : null,
              )}
            </div>
            <div className="space-y-3">
              {[...groups.entries()].map(([area, items]) => (
                <div key={area}>
                  <p className="mb-1 text-[11px] font-bold tracking-wide text-gray-400 uppercase">{area}</p>
                  <ul className="space-y-1.5">
                    {items.map((item, i) => {
                      const meta = STATUS_META[item.status];
                      const Icon = meta.icon;
                      const c = item.citationN ? byNumber(p, item.citationN) : null;
                      return (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.cls}`} aria-label={meta.label} />
                          <span className="flex-1 text-gray-800">
                            {item.requirement}
                            {c ? (
                              <CitationChip c={c} onOpen={onOpen} />
                            ) : (
                              <span className="ml-1 text-[10px] text-orange-600">(source not verified)</span>
                            )}
                          </span>
                          <span className={`shrink-0 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {p.summary && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-bold text-gray-700">Overall:</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${OVERALL_META[p.summary.overall].cls}`}>
                {OVERALL_META[p.summary.overall].label}
              </span>
            </div>
            {p.summary.gaps && (
              <p className="text-gray-700">
                <strong>Gaps and risks:</strong> {p.summary.gaps}
              </p>
            )}
            {p.summary.nextSteps && (
              <p className="mt-1 text-gray-700">
                <strong>Next steps:</strong> {p.summary.nextSteps}
              </p>
            )}
          </div>
        )}

        {p.forms.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {p.forms.map((f) => (
              <a
                key={f.id}
                href={`/api/forms/${f.id}`}
                title={f.description ?? undefined}
                className="flex items-center gap-1.5 rounded-lg border border-dap-blue-200 bg-dap-blue-50 px-3 py-1.5 text-xs font-medium text-dap-blue hover:bg-dap-blue-100"
              >
                <Download className="h-3.5 w-3.5" />
                {f.name}
              </a>
            ))}
          </div>
        )}

        {p.citations.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-400 uppercase">Sources</p>
            <ol className="space-y-1">
              {p.citations.map((c) => (
                <li key={c.n} className="text-xs">
                  <button
                    type="button"
                    onClick={() => onOpen(citationTarget(c))}
                    className="flex items-start gap-1.5 text-left text-dap-blue hover:underline"
                  >
                    <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <span className="font-semibold">[{c.n}]</span> {c.issuanceNo ? `${c.issuanceNo} — ` : ""}
                      {c.documentTitle}, {pagesLabel(c)}
                      {c.sectionLabel ? <span className="text-gray-500"> · {c.sectionLabel}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {p.droppedCitations > 0 && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-400">
            <HelpCircle className="h-3 w-3" />
            {p.droppedCitations} citation{p.droppedCitations > 1 ? "s" : ""} could not be matched to a retrieved passage
            and {p.droppedCitations > 1 ? "were" : "was"} removed.
          </p>
        )}

        <div className="mt-3 border-t pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (msg.simplified) return setShowSimple((s) => !s);
              setBusy(true);
              try {
                await onSimplify(msg.id);
                setShowSimple(true);
              } finally {
                setBusy(false);
              }
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#8a7414] hover:underline disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
            {busy ? "Simplifying…" : msg.simplified && showSimple ? "Hide simple version" : "Explain simply / Filipino"}
          </button>
          {msg.simplified && showSimple && (
            <div className="mt-2 grid gap-2 rounded-xl border border-green-200 bg-green-50 p-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-bold text-green-800">Plain English</p>
                <div className="answer-md mt-0.5 text-xs! text-green-950">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.simplified.plainEnglish}</ReactMarkdown>
                </div>
              </div>
              <div className="border-t border-green-200 pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
                <p className="text-[11px] font-bold text-green-800">Filipino / Tagalog</p>
                <div className="answer-md mt-0.5 text-xs! text-green-950">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.simplified.filipino}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function byNumber(p: AssistantPayload, n: number) {
  return p.citations.find((c) => c.n === n) ?? null;
}
