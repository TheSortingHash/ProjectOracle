// Pure post-processing of the model's structured answer: every citation, form
// and warning is checked against what the server actually sent. Nothing the
// model writes is shown as a source unless it resolves to a retrieved chunk.
import { findReferral } from "@/lib/referrals";
import type { AssistantPayload, CitationView, ChecklistItemView, FormView, Mode, WarningView } from "@/lib/types";
import type { RawAnswer } from "./prompts/answer.v1";
import type { LineageEdge, RetrievedChunk } from "./retrieval";

export type DocInfo = {
  id: string;
  title: string;
  issuanceNo: string | null;
  dateIssued: string | null;
  effectivityDate: string | null;
};

export type ValidationContext = {
  chunkAliases: Map<string, RetrievedChunk>; // "C1" → chunk
  docAliases: Map<string, string>; // "D1" → document id
  docs: Map<string, DocInfo>; // document id → info
  lineage: LineageEdge[];
  allowedForms: Map<string, FormView>;
  question: string;
  mode: Mode;
};

const EXCERPT_CHARS = 420;

export function docLabel(d: DocInfo | undefined): string {
  if (!d) return "Unknown document";
  return d.issuanceNo ? `${d.issuanceNo}: ${d.title}` : d.title;
}

function year(d: DocInfo | undefined) {
  const s = d?.dateIssued || d?.effectivityDate;
  return s ? s.slice(0, 4) : null;
}

export function lineageWarnings(ctx: Pick<ValidationContext, "lineage" | "docs">): WarningView[] {
  return ctx.lineage
    .filter((e) => ctx.docs.has(e.olderDocumentId))
    .map((e) => {
      const older = ctx.docs.get(e.olderDocumentId);
      const newer = ctx.docs.get(e.newerDocumentId);
      return {
        kind: "confirmed" as const,
        relation: e.relation,
        olderDocumentId: e.olderDocumentId,
        olderLabel: docLabel(older),
        olderYear: year(older),
        newerDocumentId: e.newerDocumentId,
        newerLabel: docLabel(newer),
        newerDate: newer?.effectivityDate || newer?.dateIssued || null,
        topic: e.scopeNote,
      };
    });
}

export function finalizeAnswer(raw: RawAnswer, ctx: ValidationContext): AssistantPayload {
  const order: string[] = []; // chunk aliases in citation order
  const supports = new Map<string, string>();
  let dropped = 0;

  const addAlias = (alias: string, note = "") => {
    const a = alias.trim().toUpperCase();
    if (!ctx.chunkAliases.has(a)) return null;
    if (!order.includes(a)) order.push(a);
    if (note && !supports.get(a)) supports.set(a, note);
    return order.indexOf(a) + 1;
  };

  for (const c of raw.citations) if (addAlias(c.chunk_id, c.supports) === null) dropped++;

  // Rewrite inline markers: [C3] or [C3, C7] → [1] / [1][2]; unknown ids are removed.
  const answer = raw.answer.replace(/\[((?:\s*C\d+\s*[,;]?)+)\]/gi, (_m, group: string) => {
    const nums = group
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map((alias) => {
        const n = addAlias(alias);
        if (n === null) dropped++;
        return n;
      })
      .filter((n): n is number => n !== null);
    return [...new Set(nums)].map((n) => `[${n}]`).join("");
  })
  // Removing an invalid marker can leave "word ." behind.
  .replace(/[ \t]+([.,;:!?])/g, "$1");

  const checklist: ChecklistItemView[] =
    ctx.mode === "scenario"
      ? raw.compliance_checklist.map((item) => {
          const n = addAlias(item.chunk_id);
          if (n === null) dropped++;
          return {
            policyArea: item.policy_area || "General",
            requirement: item.requirement,
            status: item.status,
            citationN: n,
          };
        })
      : [];

  const citations: CitationView[] = order.map((alias, i) => {
    const c = ctx.chunkAliases.get(alias)!;
    const doc = ctx.docs.get(c.documentId);
    return {
      n: i + 1,
      chunkId: c.id,
      documentId: c.documentId,
      documentTitle: doc?.title ?? c.documentTitle,
      issuanceNo: doc?.issuanceNo ?? c.issuanceNo,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      sectionLabel: c.sectionLabel,
      excerpt: c.content.length > EXCERPT_CHARS ? `${c.content.slice(0, EXCERPT_CHARS).trimEnd()}…` : c.content,
      supports: supports.get(alias) ?? "",
    };
  });

  // Warnings: confirmed lineage always shows; model-raised ones are confirmed
  // only if the lineage table agrees, otherwise flagged as possible conflicts.
  const warnings = lineageWarnings(ctx);
  for (const w of raw.warnings) {
    const older = ctx.docAliases.get(w.older_document_id.trim().toUpperCase());
    const newer = ctx.docAliases.get(w.newer_document_id.trim().toUpperCase());
    if (!older || !newer || older === newer) continue;
    const existing = warnings.find((x) => x.olderDocumentId === older && x.newerDocumentId === newer);
    if (existing) {
      existing.topic ??= w.topic || null;
      continue;
    }
    const o = ctx.docs.get(older);
    const n = ctx.docs.get(newer);
    warnings.push({
      kind: "possible_conflict",
      relation: null,
      olderDocumentId: older,
      olderLabel: docLabel(o),
      olderYear: year(o),
      newerDocumentId: newer,
      newerLabel: docLabel(n),
      newerDate: n?.effectivityDate || n?.dateIssued || null,
      topic: w.topic || null,
    });
  }

  const forms = [...new Set(raw.forms)].map((id) => ctx.allowedForms.get(id)).filter((f): f is FormView => !!f);

  const found = raw.found_in_documents && citations.length > 0;
  return {
    foundInDocuments: found,
    answer: answer.trim(),
    warnings,
    citations,
    forms,
    checklist,
    summary:
      ctx.mode === "scenario" && raw.compliance_summary
        ? {
            overall: raw.compliance_summary.overall,
            gaps: raw.compliance_summary.gaps,
            nextSteps: raw.compliance_summary.next_steps,
          }
        : null,
    referral: found ? null : findReferral(ctx.question),
    droppedCitations: dropped,
  };
}

export const NOT_FOUND_TEXT =
  "I cannot find this information in the uploaded DAP policy documents. Please verify with the relevant office, or ask an administrator to upload the governing issuance.";

export function notFoundPayload(question: string): AssistantPayload {
  return {
    foundInDocuments: false,
    answer: NOT_FOUND_TEXT,
    warnings: [],
    citations: [],
    forms: [],
    checklist: [],
    summary: null,
    referral: findReferral(question),
    droppedCitations: 0,
  };
}
