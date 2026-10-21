import "server-only";

// Central place for environment-driven settings. Secrets are read only here
// and only on the server.
export const config = {
  answerModel: process.env.ANSWER_MODEL || "claude-sonnet-5-5",
  fastModel: process.env.FAST_MODEL || "claude-haiku-5-5",
  voyageModel: process.env.VOYAGE_MODEL || "voyage-4",
  hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  hasVoyage: Boolean(process.env.VOYAGE_API_KEY),
  storage: process.env.BLOB_READ_WRITE_TOKEN ? ("blob" as const) : ("local" as const),
  retrieval: {
    candidatesPerQuery: 20,
    maxChunks: 12,
    maxChunksScenario: 18,
  },
  rateLimit: { chatPerMinute: 10, simplifyPerMinute: 15 },
  historyTurns: 6,
};

export class SetupError extends Error {
  status = 503;
}

export function requireAnthropic() {
  if (!config.hasAnthropic) {
    throw new SetupError(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.",
    );
  }
}
