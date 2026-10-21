import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, gate, newSession, SESSION_COOKIE, signSession, verifySession } from "./server/session";

// Passcode gate for the demo. Every request except the login page, the auth
// endpoints and static assets needs a valid signed session cookie.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (!gate.enabled) {
    // Open mode (no DEMO_PASSCODE): issue an anonymous session so chats can be
    // grouped per browser, and forward it to this same request.
    const token = await signSession(newSession(gate.adminOpen));
    const headers = new Headers(request.headers);
    const existing = headers.get("cookie");
    headers.set("cookie", `${existing ? `${existing}; ` : ""}${SESSION_COOKIE}=${token}`);
    const res = NextResponse.next({ request: { headers } });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions);
    return res;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in with the demo passcode." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|brand/|pdf\\.worker\\.min\\.mjs|favicon\\.ico).*)"],
};
