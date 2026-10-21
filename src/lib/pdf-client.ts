"use client";
// Browser-side PDF.js helpers: text extraction for ingestion and the viewer.
import type * as Pdfjs from "pdfjs-dist";

let lib: Promise<typeof Pdfjs> | null = null;

export function pdfjs(): Promise<typeof Pdfjs> {
  // The legacy build supports older browsers; the modern build needs very recent JS features.
  lib ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

/** Extracts text page by page, keeping line breaks so the server can detect headings. */
export async function extractPages(
  data: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<{ pageNo: number; text: string }[]> {
  const m = await pdfjs();
  const task = m.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  const pages: { pageNo: number; text: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      text += item.hasEOL ? "\n" : item.str.endsWith(" ") ? "" : " ";
    }
    // Treat a run of short lines followed by a blank as paragraph breaks.
    pages.push({ pageNo: i, text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() });
    onProgress?.(i, pdf.numPages);
  }
  await task.destroy();
  return pages;
}

export function normaliseForMatch(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
