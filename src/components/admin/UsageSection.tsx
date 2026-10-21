"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type Usage = {
  daily: { day: string; queries: number; unanswered: number; tokens: number }[];
  unanswered: { question: string; askedAt: string; persona: string }[];
  totals: { queries: number; input: number; output: number; conversations: number };
  audit: { actor: string; action: string; at: string }[];
};

const fmt = (n: number) => n.toLocaleString("en-PH");

export default function UsageSection() {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Usage>("/api/admin/usage").then(setData, (e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-dap-blue" />;

  const max = Math.max(1, ...data.daily.map((d) => d.queries));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Questions answered" value={fmt(data.totals.queries)} />
        <Stat label="Conversations" value={fmt(data.totals.conversations)} />
        <Stat label="Input tokens" value={fmt(data.totals.input)} />
        <Stat label="Output tokens" value={fmt(data.totals.output)} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-gray-700">Questions per day (last 14 days)</h3>
        {data.daily.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No questions yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.daily.map((d) => (
              <li key={d.day} className="grid grid-cols-[80px_1fr_70px] items-center gap-2 text-xs">
                <span className="text-gray-500 tabular-nums">{d.day.slice(5)}</span>
                <span className="flex h-3.5 overflow-hidden rounded bg-gray-100">
                  <span className="bg-dap-blue" style={{ width: `${((d.queries - d.unanswered) / max) * 100}%` }} />
                  <span className="bg-dap-gold" style={{ width: `${(d.unanswered / max) * 100}%` }} />
                </span>
                <span className="text-right text-gray-600 tabular-nums">
                  {d.queries}
                  {d.unanswered ? <span className="text-[#8a7414]"> ({d.unanswered})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-dap-blue" /> answered from documents
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-dap-gold" /> not found
          </span>
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700">Unanswered questions</h3>
        <p className="mb-3 text-xs text-gray-500">
          Questions the documents could not answer. These point to issuances that may be missing from the corpus.
        </p>
        {data.unanswered.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">None so far.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.unanswered.map((u, i) => (
              <li key={i} className="flex gap-3 py-2 text-xs">
                <span className="flex-1 text-gray-800">{u.question}</span>
                <span className="shrink-0 text-gray-400">{u.askedAt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-gray-700">Recent admin activity</h3>
        {data.audit.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {data.audit.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-32 shrink-0 text-gray-400 tabular-nums">{a.at}</span>
                <code className="text-gray-700">{a.action}</code>
                <span className="ml-auto text-gray-400">{a.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">{label}</p>
      <p className="mt-1 text-xl font-bold text-dap-blue tabular-nums">{value}</p>
    </div>
  );
}
