import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { gate, SESSION_COOKIE, verifySession, type Session } from "./session";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getSession(): Promise<Session> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) throw new HttpError(401, "Please sign in with the demo passcode.");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (session.admin || gate.adminOpen) return session;
  if (!gate.adminPasscode) {
    throw new HttpError(403, "The Admin Panel is disabled until ADMIN_PASSCODE is set in the environment.");
  }
  throw new HttpError(403, "Admin passcode required.");
}

export function actorName(s: Session) {
  return `${s.admin ? "admin" : "user"}:${s.clientId.slice(0, 8)}`;
}

/** Wraps a route handler so thrown errors become JSON responses with sensible status codes. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Invalid request.", issues: err.issues }, { status: 400 });
      }
      const status =
        typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
      if (status >= 500) console.error("[api]", err);
      const message =
        status >= 500 && !(err as Error)?.message ? "Something went wrong." : (err as Error)?.message ?? "Error";
      return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 500 });
    }
  };
}
