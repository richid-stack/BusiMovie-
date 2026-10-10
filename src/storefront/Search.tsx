import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, X, Send } from "lucide-react";
import type { MediaFile } from "../types";
import Poster from "./Poster";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export default function SearchOverlay({ items, onClose, onOpen }: { items: MediaFile[]; onClose: () => void; onOpen: (m: MediaFile) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const results = useMemo(() => {
    const n = norm(q);
    if (n.length < 2) return [];
    return items.filter(m => norm(m.movie_title).includes(n)).slice(0, 48);
  }, [q, items]);

  const request = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/requests/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: q.trim(), auto_fetch: true }) });
      const j = await r.json().catch(() => ({}));
      setNote(r.ok ? "Request sent. We'll add it as soon as we find it." : j.error || "Couldn't send your request. Please try again.");
    } catch { setNote("Couldn't reach the server. Please try again."); }
    finally { setBusy(false); }
  };

  const typed = norm(q).length >= 2;
  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-ink/95 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Search">
      <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-5 md:px-12">
        <div className="flex items-center gap-3 border-b border-white/15 pb-3">
          <SearchIcon className="h-6 w-6 text-zinc-400" />
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setNote(null); }} placeholder="Search movies and series" aria-label="Search movies and series"
            className="min-w-0 flex-1 bg-transparent font-display text-2xl font-bold text-white placeholder:text-zinc-600 focus:outline-none md:text-4xl" />
          <button onClick={onClose} aria-label="Close search" className="grid h-10 w-10 place-items-center rounded-full text-zinc-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><X className="h-6 w-6" /></button>
        </div>

        {!typed && <p className="mt-10 text-zinc-500">Start typing a title.</p>}
        {typed && results.length > 0 && (
          <ul className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
            {results.map(m => (
              <li key={m.id}>
                <button onClick={() => { onClose(); onOpen(m); }} className="block aspect-[2/3] w-full overflow-hidden rounded-lg ring-1 ring-white/10 transition hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label={m.movie_title}>
                  <Poster title={m.movie_title} src={m.poster_url} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {typed && results.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="font-display text-2xl font-bold text-white">We don't have "{q.trim()}" yet</p>
            <p className="mt-2 text-zinc-400">Request it and we'll go find it. We'll message you in Telegram when it's ready.</p>
            <button onClick={request} disabled={busy || !!note} className="bg-ember mt-6 inline-flex h-12 items-center gap-2 rounded-lg px-7 font-bold text-ink transition hover:brightness-110 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <Send className="h-4 w-4" /> {busy ? "Sending…" : "Request this title"}
            </button>
            {note && <p role="status" className="mt-4 text-sm text-zinc-300">{note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
