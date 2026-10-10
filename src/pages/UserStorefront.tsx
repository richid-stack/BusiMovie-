import React, { useCallback, useMemo, useState } from "react";
import type { MediaFile } from "../types";
import Splash from "../storefront/Splash";
import { TopNav, BottomNav, Tab } from "../storefront/Nav";
import Billboard from "../storefront/Billboard";
import Row from "../storefront/Row";
import Detail from "../storefront/Detail";
import SearchOverlay from "../storefront/Search";
import Poster from "../storefront/Poster";
import { keyOf, openInTelegram, useLibrary, useShelves } from "../storefront/store";

const splashSeen = () => { try { return sessionStorage.getItem("bm:splash") === "1" || new URLSearchParams(location.search).has("nosplash"); } catch { return false; } };

export default function UserStorefront() {
  const { items, loading, failed, reload } = useLibrary();
  const { shelves, list, recent, myList, recentItems } = useShelves(items);
  const [tab, setTab] = useState<Tab>("home");
  const [splash, setSplash] = useState(!splashSeen());
  const [detail, setDetail] = useState<MediaFile | null>(null);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isSaved = useCallback((m: MediaFile) => list.has(keyOf(m)), [list]);
  const toggleList = (m: MediaFile) => list.toggle(keyOf(m));
  const open = (m: MediaFile) => { recent.bump(keyOf(m)); setDetail(m); };

  const play = async (fileId: number, forTitle: MediaFile) => {
    recent.bump(keyOf(forTitle));
    const r = await openInTelegram(fileId);
    if (!r.ok) { setToast(r.error || "Couldn't open Telegram."); window.setTimeout(() => setToast(null), 4000); }
  };
  const playTitle = (m: MediaFile) => {
    const first = m.is_series ? m.episodes?.[0] : m;
    if (first) play(first.id, m); else open(m);
  };

  const endSplash = useCallback(() => { setSplash(false); try { sessionStorage.setItem("bm:splash", "1"); } catch { /* ignore */ } }, []);

  const rowProps = { isSaved, onOpen: open, onPlay: playTitle, onToggleList: toggleList };
  const gridItems = useMemo(() => tab === "series" ? shelves.series : tab === "films" ? shelves.films : tab === "list" ? myList : [], [tab, shelves, myList]);

  return (
    <div className="min-h-svh bg-ink pb-24 text-zinc-100 md:pb-16">
      {splash && <Splash onDone={endSplash} />}
      <TopNav tab={tab} setTab={setTab} onSearch={() => setSearching(true)} />

      <main>
        {tab === "home" ? (
          <>
            {items.length > 0 && (
              <Billboard items={shelves.featured} inList={isSaved} onPlay={playTitle} onInfo={open} onToggleList={toggleList} />
            )}
            <div className={items.length > 0 ? "-mt-10 md:-mt-16 relative z-10" : "pt-24"}>
              {recentItems.length > 0 && <Row title="Pick up where you left off" items={recentItems} {...rowProps} />}
              {shelves.hasViews
                ? <Row title="Top 10 this week" items={shelves.top} ranked {...rowProps} />
                : null}
              <Row title="New on BusiMovie" items={shelves.latest} {...rowProps} />
              <Row title="Series" items={shelves.series} {...rowProps} />
              <Row title="Films" items={shelves.films} {...rowProps} />
              {myList.length > 0 && <Row title="My List" items={myList} {...rowProps} />}
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-[1800px] px-4 pt-24 md:px-12">
            <h1 className="mb-6 font-display text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              {tab === "series" ? "Series" : tab === "films" ? "Films" : "My List"}
            </h1>
            {gridItems.length === 0 ? (
              <p className="py-20 text-center text-zinc-500">{tab === "list" ? "Tap + on any title to save it here." : "Nothing here yet."}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                {gridItems.map(m => (
                  <li key={m.id}>
                    <button onClick={() => open(m)} aria-label={m.movie_title} className="block aspect-[2/3] w-full overflow-hidden rounded-lg ring-1 ring-white/10 transition hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      <Poster title={m.movie_title} src={m.poster_url} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!loading && items.length === 0 && tab === "home" && (
          <div className="mx-auto max-w-md px-6 py-32 text-center">
            <p className="font-display text-2xl font-bold text-white">{failed ? "We couldn't load the library" : "The library is empty for now"}</p>
            <p className="mt-2 text-zinc-400">{failed ? "Check your connection and try again." : "Titles will appear here as soon as they're added."}</p>
            {failed && <button onClick={reload} className="mt-6 h-11 rounded-lg bg-white px-6 font-bold text-ink hover:bg-white/85">Try again</button>}
          </div>
        )}
      </main>

      {detail && <Detail item={detail} saved={isSaved(detail)} onClose={() => setDetail(null)} onPlay={play} onToggleList={() => toggleList(detail)} />}
      {searching && <SearchOverlay items={items} onClose={() => setSearching(false)} onOpen={open} />}
      {toast && <div role="status" className="fixed inset-x-4 bottom-24 z-[120] mx-auto max-w-sm rounded-lg bg-white px-4 py-3 text-center text-sm font-semibold text-ink shadow-2xl md:bottom-8">{toast}</div>}

      <BottomNav tab={tab} setTab={setTab} onSearch={() => setSearching(true)} />
    </div>
  );
}
