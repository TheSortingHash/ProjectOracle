"use client";
import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { HeaderLogo } from "@/components/brand";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed.");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-dap-blue px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <HeaderLogo className="h-10" />
          <div className="border-l border-gray-200 pl-3">
            <div className="text-sm font-bold text-dap-blue">Policy Assistant</div>
            <div className="text-xs text-gray-500">Development Academy of the Philippines</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Demo passcode</span>
            <div className="relative">
              <Lock className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                autoFocus
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2.5 pr-3 pl-9 text-sm focus:border-dap-blue focus:ring-2 focus:ring-dap-blue/20 focus:outline-none"
                placeholder="Enter the passcode you were given"
              />
            </div>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !passcode}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-dap-blue py-2.5 text-sm font-semibold text-white hover:bg-dap-blue-dark disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
        <p className="mt-6 text-[11px] leading-relaxed text-gray-400">
          Internal prototype for DAP staff. Answers are generated only from policy documents uploaded by administrators
          and should be verified with the issuing office.
        </p>
      </div>
    </main>
  );
}
