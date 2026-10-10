import React, { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Play, Plus, Check } from "lucide-react";
import type { MediaFile } from "../types";
import Poster from "./Poster";
import { isNew } from "./store";

const cardW = "w-[38vw] sm:w-[26vw] md:w-[17vw] lg:w-[13.2vw] xl:w-[11.6vw]";

export function Card({ m, rank, saved, onOpen, onPlay, onToggleList }: {
  m: MediaFile; rank?: number; saved: boolean;
  onOpen: (m: MediaFile) => void; onPlay: (m: MediaFile) => void; onToggleList: (m: MediaFile) => void;
}) {
  return (
    <div className={`group/card relative shrink-0 snap-start ${rank ? "flex items-end" : ""} ${rank ? "w-[58vw] sm:w-[40vw] md:w-[26vw] lg:w-[20vw]" : cardW}`}>
      {rank && (
        <span aria-hidden="true" className="select-none font-display text-[7.5rem] font-extrabold leading-[0.8] text-transparent md:text-[9.5rem]"
          style={{ WebkitTextStroke: "3px rgba(255,255,255,0.55)", marginRight: "-0.1em" }}>{rank}</span>
      )}
      <div className={`relative ${rank ? "w-[55%] shrink-0" : "w-full"}`}>
        <button onClick={() => onOpen(m)} aria-label={`${m.movie_title}. Open details`}
          className="relative block aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface-2 text-left ring-1 ring-white/5 transition duration-300 ease-[var(--ease-spring)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white md:group-hover/card:z-20 md:group-hover/card:scale-[1.07] md:group-hover/card:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)]">
          <Poster title={m.movie_title} src={m.poster_url} />
          {isNew(m) && <span className="bg-ember absolute left-2 top-2 rounded px-1.5 py-0.5 text-[0.62rem] font-extrabold uppercase tracking-wider text-ink">New</span>}
          {!m.is_series && m.quality && <span className="absolute right-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[0.62rem] font-bold text-white backdrop-blur">{m.quality}</span>}
          {/* hover details (desktop) */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 hidden translate-y-2 bg-gradient-to-t from-black via-black/80 to-transparent p-3 pt-10 opacity-0 transition duration-300 md:block md:group-hover/card:translate-y-0 md:group-hover/card:opacity-100">
            <span className="line-clamp-1 block text-sm font-bold text-white">{m.movie_title}</span>
            <span className="mt-0.5 block text-xs text-zinc-300">{[m.is_series ? "Series" : "Film", m.year].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
        <div className="absolute bottom-2 right-2 hidden gap-1.5 opacity-0 transition duration-300 md:flex md:group-hover/card:z-30 md:group-hover/card:opacity-100">
          <button onClick={() => onPlay(m)} aria-label={`Play ${m.movie_title}`} className="grid h-8 w-8 place-items-center rounded-full bg-white text-ink transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><Play className="h-3.5 w-3.5 fill-current" /></button>
          <button onClick={() => onToggleList(m)} aria-pressed={saved} aria-label={saved ? "Remove from My List" : "Add to My List"} className="grid h-8 w-8 place-items-center rounded-full border border-white/60 bg-black/60 text-white transition hover:scale-110 hover:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {saved ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Row({ title, items, ranked = false, isSaved, onOpen, onPlay, onToggleList }: {
  title: string; items: MediaFile[]; ranked?: boolean; isSaved: (m: MediaFile) => boolean;
  onOpen: (m: MediaFile) => void; onPlay: (m: MediaFile) => void; onToggleList: (m: MediaFile) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: true });
  const measure = () => {
    const el = ref.current; if (!el) return;
    setEdge({ left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 });
  };
  useEffect(() => { measure(); }, [items.length]);
  const scrollBy = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  if (items.length === 0) return null;

  return (
    <section className="group/row relative py-3 md:py-4" aria-label={title}>
      <h2 className="mb-3 px-4 font-display text-lg font-bold tracking-tight text-white md:px-12 md:text-[1.35rem]">{title}</h2>
      <div className="relative">
        {edge.left && <button onClick={() => scrollBy(-1)} aria-label={`Scroll ${title} left`} className="absolute inset-y-0 left-0 z-30 hidden w-12 items-center justify-center bg-gradient-to-r from-ink to-transparent text-white opacity-0 transition group-hover/row:opacity-100 md:flex"><ChevronLeft className="h-8 w-8" /></button>}
        {edge.right && <button onClick={() => scrollBy(1)} aria-label={`Scroll ${title} right`} className="absolute inset-y-0 right-0 z-30 hidden w-12 items-center justify-center bg-gradient-to-l from-ink to-transparent text-white opacity-0 transition group-hover/row:opacity-100 md:flex"><ChevronRight className="h-8 w-8" /></button>}
        <div ref={ref} onScroll={measure} className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto scroll-smooth px-4 py-4 scroll-pl-4 md:gap-3 md:px-12 md:scroll-pl-12">
          {items.map((m, i) => (
            <Card key={`${m.id}-${i}`} m={m} rank={ranked ? i + 1 : undefined} saved={isSaved(m)} onOpen={onOpen} onPlay={onPlay} onToggleList={onToggleList} />
          ))}
        </div>
      </div>
    </section>
  );
}
