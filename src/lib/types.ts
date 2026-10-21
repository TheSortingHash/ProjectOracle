// Shapes exchanged between the API and the browser.
import type { PersonaKey } from "./personas";

export type Mode = "chat" | "scenario";

export type ChecklistStatus = "met" | "unmet" | "unclear" | "cannot_verify";
export type Overall = "compliant" | "partially_compliant" | "non_compliant" | "cannot_determine";

export type CitationView = {
  n: number; // display number used in the answer text, e.g. [1]
  chunkId: string;
  documentId: string;
  documentTitle: string;
  issuanceNo: string | null;
  pageStart: number;
  pageEnd: number;
  sectionLabel: string | null;
  excerpt: string;
  supports: string;
};

export type WarningView = {
  kind: "confirmed" | "possible_conflict";
  relation: "amends" | "supersedes" | "repeals" | null;
  olderDocumentId: string;
  olderLabel: string;
  olderYear: string | null;
  newerDocumentId: string;
  newerLabel: string;
  newerDate: string | null;
  topic: string | null;
};

export type ChecklistItemView = {
  policyArea: string;
  requirement: string;
  status: ChecklistStatus;
  citationN: number | null; // null → cited source could not be validated
};

export type FormView = { id: string; name: string; description: string | null };

export type Referral = { topic: string; office: string };

export type AssistantPayload = {
  foundInDocuments: boolean;
  answer: string;
  warnings: WarningView[];
  citations: CitationView[];
  forms: FormView[];
  checklist: ChecklistItemView[];
  summary: { overall: Overall; gaps: string; nextSteps: string } | null;
  referral: Referral | null;
  droppedCitations: number;
};

export type ChatMessageView =
  | { id: string; sender: "user"; content: string; persona: PersonaKey; mode: Mode; createdAt: string }
  | {
      id: string;
      sender: "assistant";
      persona: PersonaKey;
      mode: Mode;
      payload: AssistantPayload;
      createdAt: string;
      simplified?: { plainEnglish: string; filipino: string } | null;
    };

export type DocumentStatus =
  | "uploaded"
  | "extracting"
  | "awaiting_metadata_review"
  | "chunking"
  | "embedding"
  | "indexed"
  | "failed";

export type IssuanceType =
  | "Administrative Order"
  | "Memorandum Circular"
  | "Office Order"
  | "Guideline"
  | "Manual"
  | "Other";

export const ISSUANCE_TYPES: IssuanceType[] = [
  "Administrative Order",
  "Memorandum Circular",
  "Office Order",
  "Guideline",
  "Manual",
  "Other",
];

export type DocumentView = {
  id: string;
  title: string;
  fileName: string;
  issuanceType: string | null;
  issuanceNo: string | null;
  dateIssued: string | null;
  effectivityDate: string | null;
  issuingOffice: string | null;
  fileUrl: string;
  fileSize: number;
  pageCount: number;
  lowTextPages: number[];
  status: DocumentStatus;
  statusDetail: string | null;
  isActive: boolean;
  uploadedBy: string | null;
  createdAt: string;
  chunkCount?: number;
  suggestedMetadata?: SuggestedMetadata | null;
};

export type SuggestedMetadata = {
  title: string;
  issuance_type: IssuanceType;
  issuance_no: string;
  date_issued: string;
  effectivity_date: string;
  issuing_office: string;
  references: {
    relation: "amends" | "supersedes" | "repeals";
    cited_issuance: string;
    matched_document_id: string | null;
  }[];
};
