// Runs before `dev` and `build`. Never fails the build.
// 1. Refreshes public/pdf.worker.min.mjs from pdfjs-dist when the package file
//    is available. The worker is also committed, so a missing source is fine.
// 2. Downloads the DAP logos into /public/brand if they are not committed yet.
//    Failures are non-fatal: the UI falls back to a text badge.
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();

try {
  const worker = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  await copyFile(worker, path.join(root, "public", "pdf.worker.min.mjs"));
} catch (err) {
  console.warn(`[assets] using the committed public/pdf.worker.min.mjs (${err.code ?? err.message})`);
}

const logos = [
  ["dap-logo.png", "https://i.imgur.com/jaEbfAR.png"],
  ["dap-vertical.png", "https://serp-p.pids.gov.ph/media/default/featured-image/dap_vertical_logo.png"],
];
const brandDir = path.join(root, "public", "brand");
await mkdir(brandDir, { recursive: true });

for (const [file, url] of logos) {
  const target = path.join(brandDir, file);
  try {
    await stat(target);
    continue; // already present (committed or downloaded earlier)
  } catch {}
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    console.log(`[assets] downloaded ${file}`);
  } catch (err) {
    console.warn(`[assets] could not download ${file} (${err.message}); UI will use a text fallback`);
  }
}
