import React from "react";

/**
 * Temporary BusiMovie wordmark (text-based). Three original directions will be drafted for Richie to choose from.
 * Intentionally NOT based on any other brand's lettering.
 */
export default function Wordmark({ className = "", size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      className={`inline-flex items-baseline select-none font-display font-extrabold uppercase leading-none tracking-[0.06em] text-white ${className}`}
      style={{ fontSize: size }}
      aria-label="BusiMovie"
    >
      <span>Busi</span>
      <span className="relative">
        Movie
        <span className="absolute -top-[0.12em] right-[-0.28em] h-[0.34em] w-[0.34em] rounded-full bg-white/95" aria-hidden="true" />
      </span>
    </span>
  );
}
