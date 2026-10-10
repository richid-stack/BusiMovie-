import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaFile } from "../types";
import { buildDemoLibrary } from "./demo";

const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export const isDemo = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");

export function useLibrary() {
  const [items, setItems] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (isDemo()) { setItems(buildDemoLibrary()); setLoading(false); return; }
    try {
      const r = await fetch("/api/library");
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setItems(j.files || []);
      setFailed(false);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { items, loading, failed, reload: load };
}

/** Small persisted string-list (My List / Recently opened), keyed by a stable title key. */
function usePersistedKeys(storageKey: string, max: number) {
  const [keys, setKeys] = useState<string[]>(() => {
    try { return JSON.parse(safeGet(storageKey) || "[]"); } catch { return []; }
  });
  const write = (next: string[]) => { setKeys(next); safeSet(storageKey, JSON.stringify(next)); };
  return {
    keys,
    has: (k: string) => keys.includes(k),
    toggle: (k: string) => write(keys.includes(k) ? keys.filter(x => x !== k) : [k, ...keys].slice(0, max)),
    bump: (k: string) => write([k, ...keys.filter(x => x !== k)].slice(0, max))
  };
}

export const keyOf = (m: MediaFile) => `${m.is_series ? "s" : "m"}:${(m.movie_title || "").toLowerCase().trim()}:${m.year || ""}`;

export function useShelves(items: MediaFile[]) {
  const list = usePersistedKeys("bm:list", 100);
  const recent = usePersistedKeys("bm:recent", 20);
  const byKey = useMemo(() => new Map(items.map(m => [keyOf(m), m])), [items]);
  const pick = (keys: string[]) => keys.map(k => byKey.get(k)).filter((x): x is MediaFile => Boolean(x));

  const shelves = useMemo(() => {
    const byDate = [...items].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const hasViews = items.some(m => (m.views || 0) > 0);
    const top = hasViews ? [...items].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10) : [];
    return {
      featured: byDate.filter(m => m.poster_url || isDemo()).slice(0, 5).length ? byDate.filter(m => m.poster_url || isDemo()).slice(0, 5) : byDate.slice(0, 5),
      top, hasViews,
      latest: byDate.slice(0, 20),
      films: byDate.filter(m => !m.is_series),
      series: byDate.filter(m => m.is_series)
    };
  }, [items]);

  return { shelves, list, recent, myList: pick(list.keys), recentItems: pick(recent.keys) };
}

export function formatSize(bytes?: number): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function isNew(m: MediaFile, days = 14): boolean {
  if (!m.created_at) return false;
  const t = Date.parse(m.created_at.includes("T") ? m.created_at : m.created_at.replace(" ", "T") + "Z");
  return Number.isFinite(t) && Date.now() - t < days * 86400000;
}

/** Open the file in Telegram (the bot delivers it). Never exposes Telegram file URLs. */
export async function openInTelegram(fileId: number): Promise<{ ok: boolean; error?: string }> {
  if (isDemo()) return { ok: true };
  try {
    const r = await fetch(`/api/media/${fileId}/stream`);
    const j = await r.json();
    if (j.watchUrl) { window.open(j.watchUrl, "_blank", "noopener"); return { ok: true }; }
    return { ok: false, error: "Telegram link isn't available right now." };
  } catch { return { ok: false, error: "Couldn't reach the server. Try again." }; }
}
