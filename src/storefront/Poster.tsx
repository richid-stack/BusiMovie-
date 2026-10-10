import React, { useEffect, useRef, useState } from "react";
import { paintGrainGradient } from "../components/GrainGradient";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Poster with a graceful fallback: real artwork when we have it, otherwise a generated grain-gradient
 * "cover" (unique per title) carrying the title set in the display face. Original artwork, never a copy.
 */
export default function Poster({ title, src, className = "", showTitle = true }: { title: string; src?: string | null; className?: string; showTitle?: boolean }) {
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const h = hash(title);

  useEffect(() => {
    if ((src && !broken) || !ref.current) return;
    paintGrainGradient(ref.current, 64, 96, h, 1.2);
  }, [src, broken, h]);

  if (src && !broken) {
    return <img src={src} alt={title} loading="lazy" onError={() => setBroken(true)} className={`h-full w-full object-cover ${className}`} draggable={false} />;
  }
  // Vary the crop per title. Scaling around the centre (>= 1.3) always covers the frame, flip + shift add variety.
  const flip = h & 1 ? -1 : 1;
  const scale = 1.35 + ((h >>> 3) % 5) * 0.15;
  const maxShift = ((scale - 1) / scale) * 50 - 2; // % of the box we can move without exposing an edge
  const dx = (((h >>> 9) % 21) - 10) / 10 * maxShift;
  const dy = (((h >>> 14) % 21) - 10) / 10 * maxShift;
  return (
    <div className={`relative h-full w-full overflow-hidden bg-surface-2 ${className}`} role="img" aria-label={title}>
      <canvas
        ref={ref}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated", transform: `translate(${dx}%, ${dy}%) scale(${scale * flip}, ${scale})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      {showTitle && (
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="font-display text-[0.95rem] font-extrabold uppercase leading-[1.05] tracking-wide text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] line-clamp-3">
            {title}
          </p>
        </div>
      )}
    </div>
  );
}
