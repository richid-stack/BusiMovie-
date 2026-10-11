import React, { useEffect, useState } from "react";
import { Search, Home, Tv, Film, Bookmark, User } from "lucide-react";
import Wordmark from "../components/Wordmark";

export type Tab = "home" | "series" | "films" | "list";
const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "series", label: "Series", icon: Tv },
  { id: "films", label: "Films", icon: Film },
  { id: "list", label: "My List", icon: Bookmark }
];

export function TopNav({ tab, setTab, onSearch }: { tab: Tab; setTab: (t: Tab) => void; onSearch: () => void }) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={`fixed inset-x-0 top-0 z-40 transition-colors duration-500 ${solid ? "bg-ink/90 backdrop-blur-xl" : "bg-gradient-to-b from-black/80 to-transparent"}`}>
      <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-4 md:px-12">
        <div className="flex items-center gap-10">
          <button onClick={() => setTab("home")} aria-label="BusiMovie home" className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded">
            <Wordmark size={24} mono className="text-white" />
          </button>
          <nav className="hidden items-center gap-7 md:flex" aria-label="Browse">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`relative py-1 text-[0.95rem] font-medium transition-colors focus:outline-none focus-visible:text-white ${tab === t.id ? "text-white" : "text-zinc-400 hover:text-zinc-100"}`}
              >
                {t.label}
                {tab === t.id && <span className="bg-ember absolute -bottom-0.5 left-0 h-[2px] w-full rounded-full" />}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onSearch} aria-label="Search" className="grid h-10 w-10 place-items-center rounded-full text-zinc-100 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Search className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <span className="hidden h-8 w-8 place-items-center rounded-full bg-ember text-ink md:grid" aria-hidden="true"><User className="h-4 w-4" /></span>
        </div>
      </div>
    </header>
  );
}

export function BottomNav({ tab, setTab, onSearch }: { tab: Tab; setTab: (t: Tab) => void; onSearch: () => void }) {
  const item = (active: boolean) => `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.68rem] font-medium transition-colors ${active ? "text-white" : "text-zinc-500"}`;
  return (
    <nav aria-label="Browse" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="flex">
        {TABS.slice(0, 3).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined} className={item(tab === t.id)}>
            <t.icon className="h-5 w-5" />{t.label}
          </button>
        ))}
        <button onClick={onSearch} className={item(false)}><Search className="h-5 w-5" />Search</button>
        <button onClick={() => setTab("list")} aria-current={tab === "list" ? "page" : undefined} className={item(tab === "list")}>
          <Bookmark className="h-5 w-5" />My List
        </button>
      </div>
    </nav>
  );
}
