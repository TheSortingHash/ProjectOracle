"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { normaliseForMatch, pdfjs } from "@/lib/pdf-client";

export type ViewerTarget = {
  title: string;
  fileUrl: string;
  page: number;
  highlight?: string | null; // cited chunk text to highlight on the page
};

type Rect = { left: number; top: number; width: number; height: number };

export default function PdfViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(target.page || 1);
  const [scale, setScale] = useState(1.3);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [rects, setRects] = useState<Rect[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setPage((p) => p + 1);
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let dead = false;
    let loading: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const m = await pdfjs();
        const task = m.getDocument({ url: target.fileUrl });
        loading = task;
        const doc = await task.promise;
        if (dead) return;
        setPdf(doc);
        setPage((p) => Math.min(Math.max(1, p), doc.numPages));
      } catch (err) {
        if (!dead) setError(err instanceof Error ? err.message : "Could not open the PDF.");
      }
    })();
    return () => {
      dead = true;
      loading?.destroy();
    };
  }, [target.fileUrl]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    const pageNo = Math.min(Math.max(1, page), pdf.numPages);
    let dead = false;
    let task: { cancel: () => void } | null = null;
    setRendering(true);
    (async () => {
      const m = await pdfjs();
      const pg = await pdf.getPage(pageNo);
      const viewport = pg.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || dead) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });
      const render = pg.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      task = render;
      try {
        await render.promise;
      } catch {
        return; // cancelled by a newer render
      }
      if (dead) return;

      // Highlight: find the cited text in this page's text layer.
      const found: Rect[] = [];
      if (target.highlight && pageNo === (target.page || 1)) {
        const content = await pg.getTextContent();
        const items = content.items.filter((it): it is Extract<typeof it, { str: string }> => "str" in it);
        let joined = "";
        const starts: number[] = [];
        for (const it of items) {
          starts.push(joined.length);
          joined += normaliseForMatch(it.str) + " ";
        }
        const needleFull = normaliseForMatch(target.highlight);
        let at = -1;
        let len = 0;
        for (const n of [140, 80, 40]) {
          const needle = needleFull.slice(0, n).replace(/\s\S*$/, "");
          if (needle.length < 15) continue;
          at = joined.indexOf(needle);
          if (at >= 0) {
            len = Math.min(needleFull.length, 900);
            break;
          }
        }
        if (at >= 0) {
          const end = at + len;
          items.forEach((it, i) => {
            const s = starts[i];
            const e = s + normaliseForMatch(it.str).length;
            if (e <= at || s >= end || !it.str.trim()) return;
            const tx = m.Util.transform(viewport.transform, it.transform);
            const h = Math.hypot(tx[2], tx[3]);
            found.push({ left: tx[4], top: tx[5] - h, width: it.width * viewport.scale, height: h * 1.15 });
          });
        }
      }
      setRects(found);
      setRendering(false);
    })();
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [pdf, page, scale, target.highlight, target.page]);

  const total = pdf?.numPages ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={target.title}
        className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 bg-dap-blue px-4 py-2.5 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-dap-gold" />
            <span className="truncate text-sm font-semibold">{target.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <IconBtn label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </IconBtn>
            <span className="px-1 text-xs tabular-nums">
              {total ? `${Math.min(page, total)} / ${total}` : "…"}
            </span>
            <IconBtn label="Next page" disabled={!total || page >= total} onClick={() => setPage((p) => Math.min(total, p + 1))}>
              <ChevronRight className="h-4 w-4" />
            </IconBtn>
            <span className="mx-1 h-4 w-px bg-white/30" />
            <IconBtn label="Zoom out" disabled={scale <= 0.7} onClick={() => setScale((s) => Math.max(0.7, s - 0.2))}>
              <ZoomOut className="h-4 w-4" />
            </IconBtn>
            <IconBtn label="Zoom in" disabled={scale >= 2.6} onClick={() => setScale((s) => Math.min(2.6, s + 0.2))}>
              <ZoomIn className="h-4 w-4" />
            </IconBtn>
            <a
              href={target.fileUrl}
              download
              className="flex h-8 w-8 items-center justify-center rounded hover:bg-white/15"
              aria-label="Download original"
              title="Download original"
            >
              <Download className="h-4 w-4" />
            </a>
            <IconBtn label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconBtn>
          </div>
        </div>
        {target.highlight && rects.length > 0 && page === target.page && (
          <div className="border-b border-dap-gold/40 bg-dap-gold-50 px-4 py-1.5 text-xs text-[#7A5F00]">
            Cited passage highlighted on page {target.page}.
          </div>
        )}
        <div className="relative flex flex-1 justify-center overflow-auto bg-gray-100 p-3 sm:p-5">
          {error ? (
            <p className="self-center text-sm text-red-600">{error}</p>
          ) : (
            <div className="relative h-fit shadow-lg" style={{ width: size.width || undefined }}>
              <canvas ref={canvasRef} className="block bg-white" />
              <div className="pointer-events-none absolute inset-0">
                {rects.map((r, i) => (
                  <div
                    key={i}
                    className="absolute rounded-sm bg-yellow-300/45 mix-blend-multiply"
                    style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                  />
                ))}
              </div>
              {rendering && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100/70">
                  <Loader2 className="h-6 w-6 animate-spin text-dap-blue" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn(props: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-8 w-8 items-center justify-center rounded hover:bg-white/15 disabled:opacity-30"
    >
      {props.children}
    </button>
  );
}
