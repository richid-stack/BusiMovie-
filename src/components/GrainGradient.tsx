import React, { useEffect, useRef } from "react";

/**
 * BusiMovie signature background: a three-colour gradient (pink -> red-orange -> amber) rendered as a
 * stochastic, dithered stipple (dots get sparser towards the colour boundaries) instead of a smooth blur.
 *
 * Rendered ONCE into a small canvas, then upscaled (pixelated) — cheap, no images, no network.
 * The slow "drift" is a CSS transform on the finished canvas, so there is no per-frame pixel work.
 */

export const EMBER = {
  pink: [254, 29, 104],
  red: [254, 73, 40],
  amber: [254, 175, 2]
} as const;

type Blob = { x: number; y: number; r: number; c: readonly number[] };

// Blob layout measured from the reference splash: pink top-right, red diagonal band, amber bottom/left.
const BLOBS: Blob[] = [
  { x: 0.88, y: 0.0, r: 0.5, c: EMBER.pink },
  { x: 0.55, y: 0.45, r: 0.55, c: EMBER.red },
  { x: 0.0, y: 0.18, r: 0.34, c: EMBER.red },
  { x: 0.1, y: 1.0, r: 0.75, c: EMBER.amber },
  { x: 0.9, y: 0.78, r: 0.3, c: EMBER.red }
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paintGrainGradient(canvas: HTMLCanvasElement, w: number, h: number, seed = 7, grain = 1) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  const rnd = mulberry32(seed);
  const aspect = h / w;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      // weight of each blob (gaussian-ish falloff, aspect-corrected)
      let wp = 0, wr = 0, wa = 0;
      for (const b of BLOBS) {
        const dx = nx - b.x;
        const dy = (ny - b.y) / Math.max(0.6, aspect * 0.62);
        const d2 = (dx * dx + dy * dy) / (b.r * b.r);
        const wgt = Math.exp(-d2 * 1.6);
        if (b.c === EMBER.pink) wp += wgt;
        else if (b.c === EMBER.amber) wa += wgt;
        else wr += wgt;
      }
      // Sharpen: cores stay pure, only the borders between colours are speckled (like the reference).
      wp = Math.pow(wp, 2.2); wr = Math.pow(wr, 2.2); wa = Math.pow(wa, 2.2);
      const total = wp + wr + wa + 1e-6;
      // Stochastic choice: probability == weight. This is what creates the speckled boundaries.
      // `grain` widens the noisy transition zone.
      const jitter = (rnd() - 0.5) * 0.35 * grain;
      let pick = rnd() * total + jitter * total;
      let col: readonly number[];
      if (pick < wp) col = EMBER.pink;
      else if (pick < wp + wr) col = EMBER.red;
      else col = EMBER.amber;
      // tiny per-pixel luminance noise for a printed / spray feel
      const lum = 1 + (rnd() - 0.5) * 0.06 * grain;
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, col[0] * lum);
      img.data[i + 1] = Math.min(255, col[1] * lum);
      img.data[i + 2] = Math.min(255, col[2] * lum);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

interface Props {
  className?: string;
  seed?: number;
  /** pixel size of one "grain" in CSS px (bigger = coarser). */
  grainSize?: number;
  drift?: boolean;
  children?: React.ReactNode;
}

export default function GrainGradient({ className = "", seed = 7, grainSize = 2.5, drift = true, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const render = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      // Slightly larger than the box so the drift never reveals an edge.
      const w = Math.min(900, Math.ceil((rect.width * 1.25) / grainSize));
      const h = Math.min(1600, Math.ceil((rect.height * 1.25) / grainSize));
      paintGrainGradient(canvas, w, h, seed);
    };
    render();
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(render, 150);
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [seed, grainSize]);

  return (
    <div ref={wrapRef} className={`${/\b(absolute|fixed)\b/.test(className) ? "" : "relative"} overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute -left-[12.5%] -top-[12.5%] h-[125%] w-[125%] ${drift ? "bm-drift" : ""}`}
        style={{ imageRendering: "pixelated" }}
      />
      <div className="relative z-10 h-full w-full">{children}</div>
    </div>
  );
}
