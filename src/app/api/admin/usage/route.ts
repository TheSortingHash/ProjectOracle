import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, rows } from "@/server/db";
import { handle, requireAdmin } from "@/server/http";

export const GET = handle(async () => {
  await requireAdmin();
  const d = await db();
  const daily = await rows<{ day: string; queries: number; unanswered: number; tokens: number }>(
    d,
    sql`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*)::int AS queries,
               count(*) FILTER (WHERE found_in_documents = false)::int AS unanswered,
               coalesce(sum(input_tokens + output_tokens), 0)::int AS tokens
        FROM messages WHERE sender = 'assistant' AND created_at > now() - interval '14 days'
        GROUP BY 1 ORDER BY 1`,
  );
  const unanswered = await rows<{ question: string; askedAt: string; persona: string }>(
    d,
    sql`SELECT u.content AS question, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS "askedAt", a.persona
        FROM messages a
        JOIN LATERAL (
          SELECT content FROM messages u
          WHERE u.conversation_id = a.conversation_id AND u.sender = 'user' AND u.created_at <= a.created_at
          ORDER BY u.created_at DESC LIMIT 1
        ) u ON true
        WHERE a.sender = 'assistant' AND a.found_in_documents = false
        ORDER BY a.created_at DESC LIMIT 25`,
  );
  const [totals] = await rows<{ queries: number; input: number; output: number; conversations: number }>(
    d,
    sql`SELECT count(*)::int AS queries, coalesce(sum(input_tokens),0)::int AS input,
               coalesce(sum(output_tokens),0)::int AS output,
               count(DISTINCT conversation_id)::int AS conversations
        FROM messages WHERE sender = 'assistant'`,
  );
  const audit = await rows<{ actor: string; action: string; at: string }>(
    d,
    sql`SELECT actor, action, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at
        FROM audit_log WHERE action NOT LIKE 'chat.%' ORDER BY created_at DESC LIMIT 20`,
  );
  return NextResponse.json({ daily, unanswered, totals, audit });
});
