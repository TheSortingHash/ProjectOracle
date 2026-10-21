import { describe, expect, it } from "vitest";
import { chunkPages, isHeading } from "@/server/ingest/chunker";

describe("isHeading", () => {
  it("recognises common issuance headings", () => {
    expect(isHeading("Section 3. Coverage")).toBe(true);
    expect(isHeading("ARTICLE IV")).toBe(true);
    expect(isHeading("IV. TRAVEL ALLOWANCE")).toBe(true);
    expect(isHeading("5.1 Local Travel")).toBe(true);
    expect(isHeading("GENERAL PROVISIONS")).toBe(true);
  });
  it("does not treat sentences as headings", () => {
    expect(isHeading("The employee shall file the application five days before the leave.")).toBe(false);
    expect(isHeading("Approved by")).toBe(false);
  });
});

describe("chunkPages", () => {
  const para = (n: number) => `Paragraph ${n}. ` + "The quick rule applies to all staff. ".repeat(12);

  it("keeps page ranges and section labels", () => {
    const chunks = chunkPages(
      [
        { pageNo: 1, text: `SECTION 1. PURPOSE\n\n${para(1)}\n\n${para(2)}` },
        { pageNo: 2, text: `SECTION 2. COVERAGE\n\n${para(3)}` },
      ],
      { maxChars: 3200, minChars: 200 },
    );
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 1, sectionLabel: "SECTION 1. PURPOSE" });
    expect(chunks[1]).toMatchObject({ pageStart: 2, pageEnd: 2, sectionLabel: "SECTION 2. COVERAGE" });
    expect(chunks[1].content.startsWith("SECTION 2. COVERAGE")).toBe(true);
  });

  it("splits long sections with overlap and spans pages", () => {
    const pages = [1, 2, 3].map((p) => ({ pageNo: p, text: [1, 2, 3].map((i) => para(p * 10 + i)).join("\n\n") }));
    const chunks = chunkPages(pages, { maxChars: 1500, minChars: 200, overlapMaxChars: 600 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(1500 + 600);
    // overlap: the last paragraph of one chunk opens the next
    const lastPara = chunks[0].content.split("\n").pop()!;
    expect(chunks[1].content.startsWith(lastPara)).toBe(true);
    expect(chunks.at(-1)!.pageEnd).toBe(3);
  });

  it("returns nothing for empty pages", () => {
    expect(chunkPages([{ pageNo: 1, text: "   " }])).toEqual([]);
  });
});
