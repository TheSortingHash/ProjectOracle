// Structure-aware chunker. Splits page text into paragraphs, starts a new chunk
// at section headings where possible, otherwise packs paragraphs up to ~800
// tokens with a one-paragraph overlap. Every chunk keeps its page range and the
// nearest section heading.

export type PageText = { pageNo: number; text: string };

export type Chunk = {
  ordinal: number;
  pageStart: number;
  pageEnd: number;
  sectionLabel: string | null;
  content: string;
  tokenCount: number;
};

export type ChunkOptions = { maxChars?: number; minChars?: number; overlapMaxChars?: number };

const HEADING_PATTERNS = [
  /^(section|sec\.|article|rule|chapter|part|title)\s+[0-9ivxlc]+\b/i, // Section 3. / ARTICLE IV
  /^[IVXLC]+\.\s+\S/, // IV. COVERAGE
  /^\d+(\.\d+){0,3}\.?\s+[A-Z][^.!?]{2,90}$/, // 5.1 Travel Allowance
  /^[A-Z][A-Z0-9 ,&/()\-]{4,90}$/, // ALL-CAPS HEADING
];

type Unit = { pageNo: number; text: string; heading: string | null };

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 4 || t.length > 100) return false;
  return HEADING_PATTERNS.some((re) => re.test(t));
}

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?;]+[.!?;]+["')\]]*\s*|[^.!?;]+$/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > maxChars && buf) {
      out.push(buf.trim());
      buf = "";
    }
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function toUnits(pages: PageText[], maxChars: number): Unit[] {
  const units: Unit[] = [];
  for (const page of pages) {
    const paragraphs = page.text
      .replace(/\r/g, "")
      .split(/\n\s*\n/)
      .flatMap((p) => {
        // A heading on its own line inside a paragraph block becomes its own unit.
        const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
        const parts: string[] = [];
        let cur: string[] = [];
        for (const line of lines) {
          if (isHeading(line)) {
            if (cur.length) parts.push(cur.join(" "));
            parts.push(line);
            cur = [];
          } else {
            cur.push(line);
          }
        }
        if (cur.length) parts.push(cur.join(" "));
        return parts;
      });
    for (const para of paragraphs) {
      const text = para.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const heading = isHeading(text) ? text.slice(0, 120) : null;
      for (const piece of splitLong(text, maxChars)) units.push({ pageNo: page.pageNo, text: piece, heading });
    }
  }
  return units;
}

export function chunkPages(pages: PageText[], opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 3200;
  const minChars = opts.minChars ?? 400;
  const overlapMaxChars = opts.overlapMaxChars ?? 600;
  const units = toUnits(pages, maxChars);

  const chunks: Chunk[] = [];
  let current: Unit[] = [];
  let section: string | null = null;
  let currentSection: string | null = null;

  const size = (us: Unit[]) => us.reduce((n, u) => n + u.text.length + 1, 0);
  const flush = (carryOverlap: boolean) => {
    if (!current.length) return;
    const content = current.map((u) => u.text).join("\n");
    chunks.push({
      ordinal: chunks.length,
      pageStart: current[0].pageNo,
      pageEnd: current[current.length - 1].pageNo,
      sectionLabel: currentSection,
      content,
      tokenCount: estimateTokens(content),
    });
    const last = current[current.length - 1];
    current = carryOverlap && last.text.length <= overlapMaxChars && !last.heading ? [last] : [];
  };

  for (const unit of units) {
    if (unit.heading) {
      // New section: close the running chunk if it is big enough to stand alone.
      if (size(current) >= minChars) flush(false);
      section = unit.heading;
      if (!current.length || current.every((u) => u.heading)) currentSection = section;
    }
    if (current.length && size(current) + unit.text.length > maxChars) flush(true);
    if (!current.length) currentSection = section;
    current.push(unit);
  }
  flush(false);
  return chunks;
}
