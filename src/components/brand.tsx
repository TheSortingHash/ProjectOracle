"use client";
import { useState } from "react";

// Logos are served from /public/brand (downloaded at build time). If a file is
// missing, fall back to a text badge in DAP colours.

// The image can fail before React hydrates (so onError never fires); the ref
// callback catches that case.
const detectBroken = (setErr: (v: boolean) => void) => (el: HTMLImageElement | null) => {
  if (el && el.complete && el.naturalWidth === 0) setErr(true);
};

export function HeaderLogo({ className = "h-9" }: { className?: string }) {
  const [err, setErr] = useState(false);
  if (err)
    return (
      <div className={`${className} flex items-center justify-center rounded bg-dap-gold px-2 text-sm font-bold text-dap-blue`}>
        DAP
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/dap-logo.png" alt="Development Academy of the Philippines" className={`${className} w-auto object-contain`} ref={detectBroken(setErr)} onError={() => setErr(true)} />;
}

export function BotAvatar({ size = 24 }: { size?: number }) {
  const [err, setErr] = useState(false);
  if (err)
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full bg-dap-gold font-bold text-dap-blue"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        aria-hidden
      >
        D
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/dap-vertical.png"
      alt=""
      aria-hidden
      className="shrink-0 rounded object-contain"
      style={{ width: size, height: size }}
      ref={detectBroken(setErr)}
      onError={() => setErr(true)}
    />
  );
}
