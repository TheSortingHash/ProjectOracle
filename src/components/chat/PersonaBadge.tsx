import { PERSONAS, type PersonaKey } from "@/lib/personas";

export function PersonaBadge({ persona }: { persona: PersonaKey }) {
  const p = PERSONAS[persona];
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-[11px] font-bold"
      style={{ background: p.badgeColors.bg, color: p.badgeColors.fg }}
    >
      {p.label}
    </span>
  );
}
