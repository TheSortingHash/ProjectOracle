import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db";
import { conversations, messages, simplifications } from "./db/schema";
import { structuredCall } from "./llm/client";
import { SIMPLIFY_SYSTEM, SimplifySchema } from "./prompts/simplify.v1";
import { RateLimitError } from "./answer";

export class NotFoundError extends Error {
  status = 404;
}

export async function simplifyMessage(messageId: string, clientId: string) {
  const d = await db();
  const [msg] = await d
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.sender, "assistant"), eq(conversations.clientId, clientId)));
  if (!msg) throw new NotFoundError("Message not found.");

  const [cached] = await d.select().from(simplifications).where(eq(simplifications.messageId, messageId));
  if (cached) return { plainEnglish: cached.plainEnglish, filipino: cached.filipino };

  const [{ count }] = await d
    .select({ count: sql<number>`count(*)::int` })
    .from(simplifications)
    .where(gt(simplifications.createdAt, new Date(Date.now() - 60_000)));
  if (count >= config.rateLimit.simplifyPerMinute) throw new RateLimitError("Please wait a moment and try again.");

  const { data } = await structuredCall({
    model: config.fastModel,
    schema: SimplifySchema,
    effort: "low",
    maxTokens: 6000,
    system: [{ type: "text", text: SIMPLIFY_SYSTEM }],
    messages: [{ role: "user", content: `<answer>\n${msg.content}\n</answer>` }],
  });
  await d
    .insert(simplifications)
    .values({ messageId, plainEnglish: data.plain_english, filipino: data.filipino })
    .onConflictDoNothing();
  return { plainEnglish: data.plain_english, filipino: data.filipino };
}
