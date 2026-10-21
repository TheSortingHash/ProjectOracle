import "server-only";
import { db } from "./db";
import { auditLog } from "./db/schema";

export async function audit(
  actor: string,
  action: string,
  target?: { type: string; id: string },
  detail?: Record<string, unknown>,
) {
  try {
    const d = await db();
    await d.insert(auditLog).values({
      id: crypto.randomUUID(),
      actor,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      detail: detail ?? null,
    });
  } catch (err) {
    // Auditing must never break the user-facing action.
    console.error("[audit] failed to write", action, err);
  }
}
