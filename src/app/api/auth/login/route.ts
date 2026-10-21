import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { handle } from "@/server/http";
import {
  cookieOptions,
  gate,
  newSession,
  SESSION_COOKIE,
  signSession,
  timingSafeEqualString,
  verifySession,
} from "@/server/session";

const Body = z.object({ passcode: z.string().max(200), scope: z.enum(["user", "admin"]).default("user") });

export const POST = handle(async (request: Request) => {
  const { passcode, scope } = Body.parse(await request.json());
  const store = await cookies();
  const existing = await verifySession(store.get(SESSION_COOKIE)?.value);

  const isAdmin = timingSafeEqualString(passcode, gate.adminPasscode);
  const isUser = !gate.enabled || timingSafeEqualString(passcode, gate.demoPasscode);

  if (scope === "admin" ? !isAdmin : !(isUser || isAdmin)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }

  // Keep the browser's client id when upgrading to admin so chat history stays.
  const session = { ...(existing ?? newSession()), admin: isAdmin || Boolean(existing?.admin) };
  session.issuedAt = Math.floor(Date.now() / 1000);
  const res = NextResponse.json({ ok: true, admin: session.admin });
  res.cookies.set(SESSION_COOKIE, await signSession(session), cookieOptions);
  await audit(`${session.admin ? "admin" : "user"}:${session.clientId.slice(0, 8)}`, `auth.login.${scope}`);
  return res;
});
