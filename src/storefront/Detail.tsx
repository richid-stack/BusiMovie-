import React, { useEffect, useMemo, useState } from "react";
import { X, Play, Plus, Check } from "lucide-react";
import type { MediaFile } from "../types";
import GrainGradient from "../components/GrainGradient";
import Poster from "./Poster";
import { formatSize, isDemo } from "./store";

export default function Detail({ item, saved, onClose, onPlay, onToggleList }: {
  item: MediaFile; saved: boolean; onClose: () => void;
  onPlay: (fileId: number, forTitle: MediaFile) => void; onToggleList: () => void;
}) {
  const [episodes, setEpisodes] = useState<MediaFile[]>(item.episodes || []);
  const seasons = useMemo(() => (item.seasons && item.seasons.length ? item.seasons : [...new Set(episodes.map(e => e.season || 1))].sort((a, b) => a - b)), [item, episodes]);
  const [season, setSeason] = useState<number>(seasons[0] || 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => {
    if (isDemo()) return;
    fetch("/api/library/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: item.movie_title }) }).catch(() => {});
  }, [item.movie_title]);

  useEffect(() => {
    if (!item.is_series || episodes.length || isDemo()) return;
    fetch(`/api/series/${encodeURIComponent(item.movie_title)}/episodes`).then(r => r.ok ? r.json() : []).then(setEpisodes).catch(() => {});
  }, [item, episodes.length]);

  const seasonEps = episodes.filter(e => (e.season || 1) === season).sort((a, b) => (a.episode || 0) - (b.episode || 0));
  const firstFile = item.is_series ? seasonEps[0] || episodes[0] : item;
  const meta = [item.is_series ? "Series" : "Film", item.year, item.is_series ? `${seasons.length} season${seasons.length > 1 ? "s" : ""}` : item.quality].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-black/75 backdrop-blur-sm md:items-start md:py-10" onMouseDown={e => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={item.movie_title}>
      <div className="bm-rise relative w-full max-w-3xl overflow-hidden rounded-t-2xl bg-surface-1 shadow-2xl ring-1 ring-white/10 md:rounded-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="h-5 w-5" />
        </button>

        <div className="relative h-72 md:h-96">
          <GrainGradient className="absolute inset-0" grainSize={3.5} seed={23}><span /></GrainGradient>
          <div className="absolute inset-0 bg-gradient-to-t from-surface-1 via-surface-1/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 flex items-end gap-5 p-5 md:p-8">
            <div className="hidden aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/20 sm:block"><Poster title={item.movie_title} src={item.poster_url} /></div>
            <div className="min-w-0">
              <h2 className="font-display text-3xl font-extrabold uppercase leading-[0.98] tracking-tight text-white md:text-5xl">{item.movie_title}</h2>
              <p className="mt-2 text-sm font-medium text-white/85">{meta.join("  •  ")}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5 md:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={!firstFile} onClick={() => firstFile && onPlay(firstFile.id, item)} className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-7 font-bold text-ink transition hover:bg-white/85 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1">
              <Play className="h-5 w-5 fill-current" /> {item.is_series ? "Play first episode" : "Play"}
            </button>
            <button onClick={onToggleList} aria-pressed={saved} className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/25 px-5 font-semibold text-white transition hover:border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {saved ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />} {saved ? "In My List" : "My List"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">Plays in Telegram — tapping Play opens our bot and sends the file to your chat.</p>
          {item.overview && <p className="max-w-2xl leading-relaxed text-zinc-300">{item.overview}</p>}

          {item.is_series ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-white">Episodes</h3>
                {seasons.length > 1 && (
                  <label className="text-sm text-zinc-400">
                    <span className="sr-only">Season</span>
                    <select value={season} onChange={e => setSeason(Number(e.target.value))} className="rounded-md border border-white/15 bg-surface-2 px-3 py-1.5 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      {seasons.map(s => <option key={s} value={s}>Season {s}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-surface-2/60">
                {seasonEps.length === 0 && <li className="p-4 text-sm text-zinc-500">Episodes for this season are being added.</li>}
                {seasonEps.map(ep => (
                  <li key={ep.id}>
                    <button onClick={() => onPlay(ep.id, item)} className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-white/5 focus:outline-none focus-visible:bg-white/10">
                      <span className="w-8 text-center font-display text-xl font-bold text-zinc-500">{ep.episode}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">Episode {ep.episode}</span>
                        <span className="block text-xs text-zinc-500">{[ep.quality, formatSize(ep.file_size)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Play className="h-4 w-4 shrink-0 text-zinc-400" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : item.all_qualities && item.all_qualities.length > 0 && (
            <div>
              <h3 className="mb-3 font-display text-lg font-bold text-white">Versions</h3>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-surface-2/60">
                {item.all_qualities.map(q => (
                  <li key={q.id}>
                    <button onClick={() => onPlay(q.id, item)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-white/5 focus:outline-none focus-visible:bg-white/10">
                      <span className="text-sm font-semibold text-white">{q.quality}</span>
                      <span className="flex items-center gap-3 text-xs text-zinc-500">{formatSize(q.file_size)}<Play className="h-4 w-4 text-zinc-400" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
