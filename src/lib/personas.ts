// Persona configuration shared by the client (labels, badge colours) and the
// server (prompt blocks, retrieval boosts).

export type PersonaKey = "general_staff" | "policy_maker" | "program_manager";

export type Persona = {
  key: PersonaKey;
  label: string;
  description: string;
  badgeColors: { bg: string; fg: string };
  promptBlock: string;
  retrievalBoost?: string[]; // issuance types to favour slightly
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  general_staff: {
    key: "general_staff",
    label: "General Staff",
    description: "Everyday administrative questions: leave, travel, attendance, reimbursements.",
    badgeColors: { bg: "#EEF0FC", fg: "#1C2790" },
    promptBlock: `Audience: General Staff.
- Write in plain, conversational Filipino-workplace English. No jargon; if a technical term is unavoidable, explain it in the same sentence.
- Order: (1) a direct answer in one or two sentences, (2) a short explanation, (3) numbered steps if the question is procedural, (4) forms they need, if any.
- Focus on what the employee needs to DO. Keep paragraphs short.
- Mention which office to coordinate with only when the documents name it.`,
  },
  policy_maker: {
    key: "policy_maker",
    label: "Policy Maker",
    description: "Policy analysis, drafting support, and compliance review.",
    badgeColors: { bg: "#FDF6DC", fg: "#7A5F00" },
    promptBlock: `Audience: Policy Maker.
- Be precise and formal, like a senior policy officer writing a brief. Use proper terms (Memorandum Circular, Administrative Order, effectivity date, superseding clause).
- Structure: policy overview; legal basis (issuance number, date, issuing office as stated in the excerpts); conflict analysis if excerpts disagree (present both and state which is later and therefore controlling, noting this should be verified with the issuing office); implications.
- When asked to help draft or review a proposed policy: identify conflicts with the excerpted issuances and list which existing issuances the new one should reference or expressly repeal. Do not draft the full issuance.`,
    retrievalBoost: ["Administrative Order", "Memorandum Circular"],
  },
  program_manager: {
    key: "program_manager",
    label: "Program Manager",
    description: "Budgets, procurement, honoraria, and program operations.",
    badgeColors: { bg: "#E6F9F1", fg: "#15643A" },
    promptBlock: `Audience: Program Manager.
- Be operational and specific: exact amounts, rates, thresholds, percentages, deadlines and approving authority, exactly as written in the excerpts.
- Use numbered procedures and, where it helps, a markdown table (e.g. threshold → procurement mode → approver).
- If a program is named (e.g. PMDP, BAGANI), prefer that program's own guidelines over general rules and say so. If no program-specific excerpt exists, say "No program-specific guidelines for <program> were found in the uploaded documents; the general rule applies."`,
    retrievalBoost: ["Guideline", "Manual"],
  },
};

export const PERSONA_LIST = Object.values(PERSONAS);

export function isPersonaKey(v: unknown): v is PersonaKey {
  return typeof v === "string" && v in PERSONAS;
}
