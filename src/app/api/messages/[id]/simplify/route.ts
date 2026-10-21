import { NextResponse } from "next/server";
import { requireAnthropic } from "@/server/config";
import { getSession, handle } from "@/server/http";
import { simplifyMessage } from "@/server/simplify";

export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/messages/[id]/simplify">) => {
  const session = await getSession();
  requireAnthropic();
  const { id } = await ctx.params;
  return NextResponse.json(await simplifyMessage(id, session.clientId));
});
