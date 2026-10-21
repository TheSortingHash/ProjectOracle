import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { config } from "@/server/config";
import { databaseKind, db } from "@/server/db";
import { documents } from "@/server/db/schema";
import { getSession, handle } from "@/server/http";
import { gate } from "@/server/session";
import { blobAccess } from "@/server/storage";

export const GET = handle(async () => {
  const session = await getSession();
  let dbOk = true;
  let dbError: string | null = null;
  let indexed = 0;
  try {
    const d = await db();
    const [r] = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.status, "indexed"), eq(documents.isActive, true)));
    indexed = r.n;
  } catch (err) {
    dbOk = false;
    dbError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json({
    anthropic: config.hasAnthropic,
    voyage: config.hasVoyage,
    database: databaseKind(),
    databaseOk: dbOk,
    databaseError: dbError,
    storage: config.storage,
    blobAccess,
    passcodeGate: gate.enabled,
    adminConfigured: Boolean(gate.adminPasscode) || gate.adminOpen,
    isAdmin: session.admin || gate.adminOpen,
    models: { answer: config.answerModel, fast: config.fastModel, embeddings: config.hasVoyage ? config.voyageModel : null },
    indexedDocuments: indexed,
  });
});
