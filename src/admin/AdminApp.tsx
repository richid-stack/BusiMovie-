import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Activity, Boxes, Film, Inbox, LayoutDashboard, Lock, LogOut, ShieldAlert, Megaphone, Menu, PlugZap, Radar, Search, Upload, X,
} from "lucide-react";
import { Mark } from "../components/Wordmark";
import { logout } from "../lib/adminAuth";
import { queryClient, useGet } from "./lib";
import { OverlayProvider } from "./ui/overlay";
import { Dot, Skeleton, cx } from "./ui/kit";

const Overview = lazy(() => import("./pages/Overview"));
const Library = lazy(() => import("./pages/Library"));
const Requests = lazy(() => import("./pages/Requests"));
const CrawlJobs = lazy(() => import("./pages/CrawlJobs"));
const SearchBots = lazy(() => import("./pages/SearchBots"));
const Sources = lazy(() => import("./pages/Sources"));
const Batch = lazy(() => import("./pages/Batch"));
const Connections = lazy(() => import("./pages/Connections"));
const Messaging = lazy(() => import("./pages/Messaging"));
const Gate = lazy(() => import("./pages/Gate"));
const Safety = lazy(() => import("./pages/Safety"));

interface NavItem { to: string; label: string; icon: React.ElementType; badge?: "requests" | "jobs"; keywords?: string }
const GROUPS: Array<{ title?: string; items: NavItem[] }> = [
  { items: [{ to: "", label: "Overview", icon: LayoutDashboard }] },
  {
    title: "Catalog",
    items: [
      { to: "library", label: "Library", icon: Film, keywords: "movies series files vault" },
      { to: "requests", label: "Requests", icon: Inbox, badge: "requests", keywords: "viewers pending fulfil" },
    ],
  },
  {
    title: "Automation",
    items: [
      { to: "jobs", label: "Crawl jobs", icon: Activity, badge: "jobs", keywords: "queue traces retry" },
      { to: "bots", label: "Search bots", icon: Radar, keywords: "delta quinson playground" },
      { to: "sources", label: "Source channels", icon: Boxes, keywords: "targets backfill crawl" },
      { to: "batch", label: "Batch import", icon: Upload, keywords: "csv pdf cron list" },
    ],
  },
  {
    title: "Audience",
    items: [
      { to: "gate", label: "Required channels", icon: Lock, keywords: "join gate subscribe discussion ads sponsor force" },
      { to: "safety", label: "Safety", icon: ShieldAlert, keywords: "takedown dmca ban block limit abuse cap remove" },
    ],
  },
  {
    title: "System",
    items: [
      { to: "connections", label: "Connections", icon: PlugZap, keywords: "webhook userbot session vault database telegram" },
      { to: "messaging", label: "Messaging", icon: Megaphone, keywords: "broadcast spotlight announce" },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.items);

function useCounts() {
  const status = useGet<any>(["status"], "/api/status", { every: 15000 });
  const crawler = useGet<any>(["crawler-status"], "/api/crawler/status", { every: 15000 });
  return {
    status: status.data,
    crawler: crawler.data,
    badges: {
      requests: Number(status.data?.stats?.pendingRequests) || 0,
      jobs: Number(crawler.data?.pendingJobsCount) || 0,
    },
  };
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { status, crawler, badges } = useCounts();
  const aux = crawler?.auxiliarySession;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Mark size={26} />
        <span className="font-display text-[15px] font-bold tracking-tight text-white">busimovie</span>
        <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Admin</span>
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-3" aria-label="Admin sections">
        {GROUPS.map((g, gi) => (
          <div key={gi}>
            {g.title && <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600">{g.title}</div>}
            <ul className="space-y-0.5">
              {g.items.map((n) => {
                const count = n.badge ? badges[n.badge] : 0;
                return (
                  <li key={n.to}>
                    <NavLink
                      to={n.to ? `/admin/${n.to}` : "/admin"}
                      end={!n.to}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cx(
                          "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition",
                          isActive ? "bg-surface-3 text-white" : "text-zinc-400 hover:bg-surface-2 hover:text-zinc-100"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="bg-ember absolute -left-2.5 top-2 h-5 w-[3px] rounded-r-full" />}
                          <n.icon className={cx("h-4 w-4 shrink-0", isActive ? "text-white" : "text-zinc-500 group-hover:text-zinc-300")} />
                          <span className="flex-1 truncate">{n.label}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-ember-pink/15 px-1.5 text-[10.5px] font-semibold tabular-nums text-pink-300">{count}</span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-3 border-t border-line p-3">
        <div className="space-y-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-xs">
          <StatusRow label="Telegram bot" ok={status ? !!status.botRunning : undefined} />
          <StatusRow label="Userbot" ok={aux ? !!aux.connected : undefined} />
          <StatusRow label={status?.database?.kind === "turso" ? "Database · Turso" : "Database · local"} ok={status ? !!status.database?.persistent : undefined} warnIfNot />
        </div>
        <div className="flex gap-2">
          <a href="/" target="_blank" rel="noreferrer" className="flex h-8 flex-1 items-center justify-center rounded-lg border border-line text-xs font-medium text-zinc-300 hover:bg-surface-2 hover:text-white">
            View storefront
          </a>
          <button
            onClick={() => logout()}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-zinc-400 hover:bg-surface-2 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, ok, warnIfNot }: { label: string; ok?: boolean; warnIfNot?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-zinc-400">{label}</span>
      {ok === undefined ? <Skeleton className="h-2 w-8" /> : (
        <span className="flex items-center gap-1.5 text-zinc-500">
          <Dot tone={ok ? "ok" : warnIfNot ? "warn" : "bad"} pulse={ok} />
          {ok ? "Online" : warnIfNot ? "Temporary" : "Offline"}
        </span>
      )}
    </div>
  );
}

/* ---------------------------- Command palette (Ctrl/⌘ K) --------------------------- */

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ALL.filter((n) => !t || `${n.label} ${n.keywords || ""}`.toLowerCase().includes(t));
  }, [q]);
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);
  useEffect(() => setIdx(0), [q]);
  if (!open) return null;
  const go = (n: NavItem) => {
    nav(n.to ? `/admin/${n.to}` : "/admin");
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[14vh]">
      <div className="adm-fade absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div className="adm-pop relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && results[idx]) go(results[idx]);
            }}
            placeholder="Jump to…"
            className="h-12 flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-zinc-500">esc</kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500">No matching page</li>}
          {results.map((n, i) => (
            <li key={n.to}>
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(n)}
                className={cx("flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm", i === idx ? "bg-surface-3 text-white" : "text-zinc-400")}
              >
                <n.icon className="h-4 w-4 text-zinc-500" />
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------- Shell ------------------------------------- */

function Shell() {
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const main = useRef<HTMLElement>(null);
  const current = ALL.find((n) => (n.to ? loc.pathname.startsWith(`/admin/${n.to}`) : loc.pathname === "/admin" || loc.pathname === "/admin/"));
  const { badges } = useCounts();

  useEffect(() => {
    setSheet(false);
    main.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const closePalette = useCallback(() => setPalette(false), []);

  return (
    <div className="flex h-dvh bg-ink text-zinc-200">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface-1 lg:block">
        <Sidebar />
      </aside>

      {sheet && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="adm-fade absolute inset-0 bg-black/70" onClick={() => setSheet(false)} />
          <div className="adm-slide absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface-1">
            <button onClick={() => setSheet(false)} aria-label="Close menu" className="absolute right-2 top-3 rounded-md p-2 text-zinc-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <Sidebar onNavigate={() => setSheet(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-ink/90 px-4 backdrop-blur lg:px-8">
          <button onClick={() => setSheet(true)} aria-label="Open menu" className="-ml-1.5 rounded-md p-2 text-zinc-300 hover:bg-surface-2 lg:hidden">
            <Menu className="h-5 w-5" />
            {(badges.requests > 0 || badges.jobs > 0) && <span className="sr-only">Pending items</span>}
          </button>
          <div className="flex min-w-0 items-center gap-2 text-[13px] lg:hidden">
            <Mark size={20} />
            <span className="truncate font-medium text-zinc-200">{current?.label || "Admin"}</span>
          </div>
          <div className="hidden text-[13px] text-zinc-500 lg:block">
            Admin <span className="mx-1.5 text-zinc-700">/</span> <span className="text-zinc-200">{current?.label || ""}</span>
          </div>
          <button
            onClick={() => setPalette(true)}
            className="ml-auto flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 text-xs text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Jump to…</span>
            <kbd className="hidden rounded border border-line px-1 text-[10px] sm:inline">Ctrl K</kbd>
          </button>
        </header>
        <main ref={main} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route index element={<Overview />} />
                <Route path="library" element={<Library />} />
                <Route path="requests" element={<Requests />} />
                <Route path="gate" element={<Gate />} />
                <Route path="safety" element={<Safety />} />
                <Route path="jobs" element={<CrawlJobs />} />
                <Route path="bots" element={<SearchBots />} />
                <Route path="sources" element={<Sources />} />
                <Route path="batch" element={<Batch />} />
                <Route path="connections" element={<Connections />} />
                <Route path="messaging" element={<Messaging />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
      <Palette open={palette} onClose={closePalette} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export default function AdminApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <OverlayProvider>
        <Shell />
      </OverlayProvider>
    </QueryClientProvider>
  );
}
