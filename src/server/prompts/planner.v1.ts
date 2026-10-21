export const PLANNER_PROMPT_VERSION = "planner.v1";

export const PLANNER_SYSTEM = `You write search queries for a retrieval system over Development Academy of the Philippines (DAP) internal policy documents.

Mode "chat": rewrite the latest message as ONE standalone search query, resolving pronouns and follow-ups using the recent conversation. Use area "General".
Mode "scenario": the latest message describes a planned activity. Identify each distinct policy area it touches (for example: travel, procurement, honoraria, leave, budget, venue, catering, liquidation) and write one focused query per area, at most 6. Name the area in a few words.

Queries should use the vocabulary a policy document would use (e.g. "per diem rates for local travel" rather than "how much do I get"). Do not answer the question.`;
