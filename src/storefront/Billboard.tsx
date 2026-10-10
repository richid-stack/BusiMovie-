import React, { useEffect, useState } from "react";
import { Play, Info, Plus, Check } from "lucide-react";
import type { MediaFile } from "../types";
import GrainGradient from "../components/GrainGradient";
import Poster from "./Poster";
import { keyOf } from "./store";

/** Featured banner. Rotates through the newest titles; the grain gradient is its stage. */
export default function Billboard({ items, inList, onPlay, onInfo, onToggleList }: {
  items: MediaFile[];
  inList: (m: MediaFile) => boolean;
  onPlay: (m: MediaFile) => void;
  onInfo: (m: MediaFile) => void;
  onToggleList: (m: MediaFile) => void;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = window.setInterval(() => setI(x => (x + 1) % items.length), 9000);
    return () => window.clearInterval(t);
  }, [items.length]);

  const m = items[i % Math.max(items.length, 1)];
  if (!m) return null;
  const saved = inList(m);
  const meta = [m.is_series ? "Series" : "Film", m.year, m.is_series ? `${m.seasons?.length || 1} season${(m.seasons?.length || 1) > 1 ? "s" : ""}` : m.quality].filter(Boolean);

  return (
    <section aria-label="Featured" className="relative h-[78svh] min-h-[520px] w-full overflow-hidden md:h-[88svh]">
      <GrainGradient className="absolute inset-0" grainSize={3.5} seed={11}>
        <span />
      </GrainGradient>
      {/* legibility scrims */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/55 to-transparent md:via-ink/30" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink via-ink/60 to-transparent" />

      {/* poster */}
      <div key={keyOf(m) + "p"} className="bm-rise absolute right-[6vw] top-24 hidden aspect-[2/3] w-[min(22vw,340px)] overflow-hidden rounded-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/15 md:block">
        <Poster title={m.movie_title} src={m.poster_url} />
      </div>

      <div key={keyOf(m)} className="bm-rise relative z-10 flex h-full max-w-[1800px] flex-col justify-end px-4 pb-24 md:px-12 md:pb-32">
        <div className="max-w-2xl">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/90">
            <span className="bg-ember h-2 w-2 rounded-full" aria-hidden="true" />
            {m.is_series ? "Series" : "Film"} · New on BusiMovie
          </p>
          <h1 className="font-display text-[2.6rem] font-extrabold uppercase leading-[0.95] tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)] md:text-7xl">
            {m.movie_title}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-white/85">
            {meta.map((x, k) => <span key={k} className={k ? "before:mr-3 before:text-white/40 before:content-['•']" : ""}>{x}</span>)}
          </p>
          {m.overview && <p className="mt-4 line-clamp-3 max-w-xl text-[0.98rem] leading-relaxed text-white/85 md:text-lg">{m.overview}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={() => onPlay(m)} className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-7 text-base font-bold text-ink transition hover:bg-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-ink">
              <Play className="h-5 w-5 fill-current" /> Play
            </button>
            <button onClick={() => onInfo(m)} className="inline-flex h-12 items-center gap-2 rounded-lg bg-white/20 px-6 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
              <Info className="h-5 w-5" /> More info
            </button>
            <button onClick={() => onToggleList(m)} aria-pressed={saved} aria-label={saved ? "Remove from My List" : "Add to My List"} className="grid h-12 w-12 place-items-center rounded-full border border-white/40 bg-black/20 text-white backdrop-blur-md transition hover:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
              {saved ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {items.length > 1 && (
          <div className="absolute bottom-14 left-4 flex gap-1.5 md:bottom-16 md:left-12" role="tablist" aria-label="Featured titles">
            {items.map((_, k) => (
              <button key={k} role="tab" aria-selected={k === i} aria-label={`Featured ${k + 1}`} onClick={() => setI(k)}
                className={`h-1 rounded-full transition-all ${k === i ? "w-8 bg-white" : "w-4 bg-white/35 hover:bg-white/60"}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
