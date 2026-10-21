import { NextResponse } from "next/server";
import { z } from "zod";
import { isPersonaKey } from "@/lib/personas";
import { answerQuestion } from "@/server/answer";
import { audit } from "@/server/audit";
import { requireAnthropic } from "@/server/config";
import { actorName, getSession, handle } from "@/server/http";

export const maxDuration = 120;

const Body = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(8000),
  persona: z.string().refine(isPersonaKey),
  mode: z.enum(["chat", "scenario"]),
});

export const POST = handle(async (request: Request) => {
  const session = await getSession();
  requireAnthropic();
  const body = Body.parse(await request.json());
  const result = await answerQuestion({
    clientId: session.clientId,
    conversationId: body.conversationId ?? null,
    message: body.message,
    persona: body.persona as Parameters<typeof answerQuestion>[0]["persona"],
    mode: body.mode,
  });
  await audit(actorName(session), "chat.query", { type: "message", id: result.assistant.id }, {
    persona: body.persona,
    mode: body.mode,
    found: result.assistant.sender === "assistant" ? result.assistant.payload.foundInDocuments : null,
  });
  return NextResponse.json(result);
});
