import { describe, expect, it } from "vitest";
import { newSession, signSession, verifySession } from "@/server/session";

describe("session cookie", () => {
  it("round-trips and rejects tampering", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const s = newSession(true);
    const token = await signSession(s);
    expect(await verifySession(token)).toEqual(s);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...s, admin: true, clientId: "x" })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`)).toBeNull();
    expect(await verifySession(`${body}.${sig.slice(0, -2)}aa`)).toBeNull();
    process.env.AUTH_SECRET = "other";
    expect(await verifySession(token)).toBeNull();
  });
});
