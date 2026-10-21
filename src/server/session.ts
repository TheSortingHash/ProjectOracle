// Signed session cookie for the demo passcode gate. Shared by proxy.ts and
// route handlers, so it only uses Web Crypto (no Node-only APIs).

export const SESSION_COOKIE = "dap_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export type Session = { clientId: string; admin: boolean; issuedAt: number };

export const gate = {
  get demoPasscode() {
    return process.env.DEMO_PASSCODE || "";
  },
  get adminPasscode() {
    return process.env.ADMIN_PASSCODE || "";
  },
  /** When no demo passcode is configured the app is open (local development). */
  get enabled() {
    return Boolean(process.env.DEMO_PASSCODE);
  },
  /** Admin is open locally without a passcode, but never on a Vercel deployment. */
  get adminOpen() {
    return !process.env.ADMIN_PASSCODE && !process.env.VERCEL;
  },
};

function secret(): string {
  return (
    process.env.AUTH_SECRET ||
    // Fallback so a misconfigured demo still works; README tells admins to set AUTH_SECRET.
    `dap-fallback:${process.env.DEMO_PASSCODE ?? ""}:${process.env.ADMIN_PASSCODE ?? ""}`
  );
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export async function signSession(s: Session): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  return `${body}.${await hmac(body)}`;
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (Date.now() / 1000 - s.issuedAt > MAX_AGE_SECONDS) return null;
    return s;
  } catch {
    return null;
  }
}

export function newSession(admin = false): Session {
  return { clientId: crypto.randomUUID(), admin, issuedAt: Math.floor(Date.now() / 1000) };
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
