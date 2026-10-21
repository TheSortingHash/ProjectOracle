// Referral offices for out-of-scope answers (handoff §8). Owner to confirm the
// current office names before launch.
import type { Referral } from "./types";

// Ordered from most to least specific; the first match wins.
const REFERRALS: { keywords: RegExp; topic: string; office: string }[] = [
  { keywords: /\b(leave|vacation|sick leave|maternity|paternity|hr|personnel|attendance|tardiness|dtr|appointment|promotion)\b/i, topic: "Leave and HR matters", office: "Human Resource office" },
  { keywords: /\b(procure|procurement|bidding|bac|canvass|quotation|purchase|supplier)\w*/i, topic: "Procurement", office: "Procurement / BAC Secretariat" },
  { keywords: /\b(travel|itinerary|liquidat|per diem|transport)\w*/i, topic: "Travel authority and liquidation", office: "Administrative office" },
  { keywords: /\b(budget|disburse|accounting|voucher|payment|honorari|allowance|realign)\w*/i, topic: "Budget, disbursement and accounting", office: "Finance Department" },
  { keywords: /\b(pmdp|bagani|program operation|scholar)\w*/i, topic: "Program operations", office: "Respective program office" },
  { keywords: /\b(issuance|memorandum circular|administrative order|policy draft|drafting|repeal)\w*/i, topic: "Policy issuance", office: "Office of the President / Legal" },
  { keywords: /\b(system|access|password|email account|ict|it support|network)\b/i, topic: "Systems and access", office: "ICT office" },
];

export function findReferral(text: string): Referral | null {
  const hit = REFERRALS.find((r) => r.keywords.test(text));
  return hit ? { topic: hit.topic, office: hit.office } : null;
}
