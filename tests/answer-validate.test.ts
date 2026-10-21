import { describe, expect, it } from "vitest";
import { finalizeAnswer, type DocInfo, type ValidationContext } from "@/server/answer-validate";
import type { RawAnswer } from "@/server/prompts/answer.v1";
import type { RetrievedChunk } from "@/server/retrieval";

const chunk = (id: string, documentId: string, page: number, content = `content of ${id}`): RetrievedChunk => ({
  id,
  documentId,
  pageStart: page,
  pageEnd: page,
  sectionLabel: "Section 1",
  content,
  documentTitle: `Title ${documentId}`,
  issuanceType: null,
  issuanceNo: null,
  dateIssued: null,
  effectivityDate: null,
  policyArea: "Travel",
  score: 1,
});

const docs = new Map<string, DocInfo>([
  ["old", { id: "old", title: "Travel Rules 2019", issuanceNo: "AO 2019-01", dateIssued: "2019-02-01", effectivityDate: null }],
  ["new", { id: "new", title: "Travel Rules 2024", issuanceNo: "AO 2024-03", dateIssued: "2024-05-01", effectivityDate: "2024-06-01" }],
  ["other", { id: "other", title: "Leave Manual", issuanceNo: null, dateIssued: null, effectivityDate: null }],
]);

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    chunkAliases: new Map([
      ["C1", chunk("chunk-a", "old", 3)],
      ["C2", chunk("chunk-b", "new", 5)],
      ["C3", chunk("chunk-c", "other", 9)],
    ]),
    docAliases: new Map([
      ["D1", "old"],
      ["D2", "new"],
      ["D3", "other"],
    ]),
    docs,
    lineage: [],
    allowedForms: new Map([["leave-form-ab12", { id: "leave-form-ab12", name: "Application for Leave", description: null }]]),
    question: "How much is the travel allowance?",
    mode: "chat",
    ...over,
  };
}

const raw = (over: Partial<RawAnswer> = {}): RawAnswer => ({
  found_in_documents: true,
  answer: "The rate is PHP 1,500 per day [C2]. Earlier rules said otherwise [C1, C9].",
  warnings: [],
  citations: [
    { chunk_id: "C2", supports: "current rate" },
    { chunk_id: "C7", supports: "hallucinated" },
  ],
  forms: ["leave-form-ab12", "made-up-form"],
  compliance_checklist: [],
  compliance_summary: null,
  ...over,
});

describe("finalizeAnswer", () => {
  it("keeps only citations that resolve to retrieved chunks and renumbers markers", () => {
    const out = finalizeAnswer(raw(), ctx());
    expect(out.citations.map((c) => c.chunkId)).toEqual(["chunk-b", "chunk-a"]);
    expect(out.citations[0]).toMatchObject({ n: 1, pageStart: 5, issuanceNo: "AO 2024-03", supports: "current rate" });
    expect(out.answer).toBe("The rate is PHP 1,500 per day [1]. Earlier rules said otherwise [2].");
    expect(out.droppedCitations).toBe(2); // C7 in citations, C9 inline
  });

  it("drops forms outside the library", () => {
    expect(finalizeAnswer(raw(), ctx()).forms.map((f) => f.id)).toEqual(["leave-form-ab12"]);
  });

  it("always shows confirmed lineage warnings, even if the model raised none", () => {
    const out = finalizeAnswer(
      raw(),
      ctx({ lineage: [{ olderDocumentId: "old", newerDocumentId: "new", relation: "supersedes", scopeNote: "rates" }] }),
    );
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatchObject({
      kind: "confirmed",
      relation: "supersedes",
      olderYear: "2019",
      newerLabel: "AO 2024-03: Travel Rules 2024",
      newerDate: "2024-06-01",
    });
  });

  it("flags model-raised conflicts the lineage table does not support", () => {
    const out = finalizeAnswer(
      raw({ warnings: [{ older_document_id: "D3", newer_document_id: "D2", topic: "allowances" }] }),
      ctx(),
    );
    expect(out.warnings).toEqual([expect.objectContaining({ kind: "possible_conflict", olderDocumentId: "other", topic: "allowances" })]);
  });

  it("treats an answer with no valid citations as not found and adds a referral", () => {
    const out = finalizeAnswer(raw({ answer: "No idea [C8].", citations: [] }), ctx());
    expect(out.foundInDocuments).toBe(false);
    expect(out.referral?.office).toBe("Administrative office");
  });

  it("maps checklist items to citation numbers in scenario mode and flags unverifiable ones", () => {
    const out = finalizeAnswer(
      raw({
        answer: "Summary [C2].",
        citations: [{ chunk_id: "C2", supports: "" }],
        compliance_checklist: [
          { policy_area: "Travel", requirement: "Travel order approved in advance", status: "unclear", chunk_id: "C2" },
          { policy_area: "Leave", requirement: "Leave filed", status: "met", chunk_id: "C3" },
          { policy_area: "Leave", requirement: "Invented rule", status: "unmet", chunk_id: "C99" },
        ],
        compliance_summary: { overall: "partially_compliant", gaps: "x", next_steps: "y" },
      }),
      ctx({ mode: "scenario" }),
    );
    expect(out.checklist.map((c) => c.citationN)).toEqual([1, 2, null]);
    expect(out.summary?.overall).toBe("partially_compliant");
  });
});
