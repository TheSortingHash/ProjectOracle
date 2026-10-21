import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import type { AssistantPayload, ChatMessageView } from "@/lib/types";
import type { PersonaKey } from "@/lib/personas";
import { db } from "@/server/db";
import { conversations, messages, simplifications } from "@/server/db/schema";
import { getSession, handle, HttpError } from "@/server/http";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/conversations/[id]">) => {
  const session = await getSession();
  const { id } = await ctx.params;
  const d = await db();
  const [conv] = await d
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.clientId, session.clientId)));
  if (!conv) throw new HttpError(404, "Conversation not found.");
  const list = await d
    .select({ m: messages, s: simplifications })
    .from(messages)
    .leftJoin(simplifications, eq(simplifications.messageId, messages.id))
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  const views: ChatMessageView[] = list.map(({ m, s }) =>
    m.sender === "user"
      ? {
          id: m.id,
          sender: "user",
          content: m.content,
          persona: m.persona as PersonaKey,
          mode: m.mode as "chat" | "scenario",
          createdAt: m.createdAt.toISOString(),
        }
      : {
          id: m.id,
          sender: "assistant",
          persona: m.persona as PersonaKey,
          mode: m.mode as "chat" | "scenario",
          payload: m.payload as AssistantPayload,
          createdAt: m.createdAt.toISOString(),
          simplified: s ? { plainEnglish: s.plainEnglish, filipino: s.filipino } : null,
        },
  );
  return NextResponse.json({ conversation: { id: conv.id, title: conv.title }, messages: views });
});
