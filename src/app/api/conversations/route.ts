import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { conversations } from "@/server/db/schema";
import { getSession, handle } from "@/server/http";

export const GET = handle(async () => {
  const session = await getSession();
  const d = await db();
  const list = await d
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.clientId, session.clientId))
    .orderBy(desc(conversations.updatedAt))
    .limit(30);
  return NextResponse.json({ conversations: list });
});
