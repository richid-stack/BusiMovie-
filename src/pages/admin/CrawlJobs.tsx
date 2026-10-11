import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCw, ChevronRight, X } from "lucide-react";

interface Job {
  id: number; kind: string; title: string; year: string | null; season: number | null; episode: number | null;
  status: string; crawl_status?: string; source: string; attempts: number; error: string | null;
  created_at: string; finished_at: string | null; bot_used?: string;
}
interface TraceStep { n: number; at: number; kind: string; why: string; action: string; text?: string; buttons?: string[] }
interface Trace { id: number; bot: string; outcome: string; detail: string | null; trace: TraceStep[]; created_at: string }

const BADGE: Record<string, string> = {
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  running: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  queued: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  not_found: "bg-zinc-500/15 text-zinc-300 border-zinc-600/40",
  needs_admin: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
};
const LABEL: Record<string, string> = {
  done: "Done", running: "Running", queued: "Queued", not_found: "Not found", needs_admin: "Needs you", failed: "Failed",
};
const OUTCOME_HELP: Record<string, string> = {
  done: "Delivered a file", not_found: "Bot has no match", wrong_file: "Bot sent the wrong file",
  blocked: "Blocked (join gate or throttled)", failed: "Navigation failed", acquire_failed: "File received but could not be stored",
  error: "Unexpected error", no_episodes: "No episodes arrived",
};

const label = (j: Job) =>
  j.kind === "movie" ? `${j.title}${j.year ? ` (${j.year})` : ""}`
  : j.kind === "season" ? `${j.title} · Season ${j.season}`
  : `${j.title} · S${String(j.season ?? 0).padStart(2, "0")}E${String(j.episode ?? 0).padStart(2, "0")}`;

export default function CrawlJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState<{ job: Job; traces: Trace[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/crawler/jobs?limit=100");
      if (r.ok) setJobs(await r.json());
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const show = async (id: number) => {
    const r = await fetch(`/api/crawler/jobs/${id}`);
    if (r.ok) setOpen(await r.json());
  };
  const retry = async (id: number) => {
    setBusy(true);
    try { await fetch(`/api/crawler/jobs/${id}/retry`, { method: "POST" }); await load(); setOpen(null); } finally { setBusy(false); }
  };

  const statusOf = (j: Job) => j.crawl_status || j.status;
  const counts = jobs.reduce<Record<string, number>>((a, j) => ((a[statusOf(j)] = (a[statusOf(j)] || 0) + 1), a), {});
  const shown = filter === "all" ? jobs : jobs.filter((j) => statusOf(j) === filter);

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-2">
        {["all", "queued", "running", "done", "not_found", "needs_admin", "failed"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${filter === s ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-800 text-zinc-400 hover:text-white"}`}>
            {s === "all" ? "All" : LABEL[s]} {s !== "all" && counts[s] ? <span className="opacity-70">· {counts[s]}</span> : null}
          </button>
        ))}
        <button onClick={load} className="ml-auto p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="rounded-2xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/80">
        {shown.length === 0 && <div className="p-8 text-center text-sm text-zinc-500">No jobs here yet. Requests from viewers, admin fetches and CSV batches show up as they run.</div>}
        {shown.map((j) => (
          <button key={j.id} onClick={() => show(j.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/60 transition">
            <span className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${BADGE[statusOf(j)] || BADGE.queued}`}>{LABEL[statusOf(j)] || statusOf(j)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{label(j)}</div>
              <div className="text-xs text-zinc-500 truncate">
                {j.source} · attempt {j.attempts} · {j.created_at}{j.bot_used ? ` · via ${j.bot_used}` : ""}
                {j.error && statusOf(j) !== "done" ? ` · ${j.error}` : ""}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end" onClick={() => setOpen(null)}>
          <div className="w-full max-w-xl h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-white">{label(open.job)}</div>
                <div className="text-xs text-zinc-500">Job #{open.job.id} · {open.job.source} · {open.job.created_at}</div>
              </div>
              <button onClick={() => setOpen(null)} className="p-2 text-zinc-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            {open.job.error && <div className="text-xs text-zinc-400 bg-zinc-900 rounded-xl p-3 break-words">{open.job.error}</div>}
            {!["queued", "running"].includes(open.job.status) && open.job.status !== "done" && (
              <button disabled={busy} onClick={() => retry(open.job.id)} className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-50">
                <RotateCw className="w-4 h-4" /> Try again
              </button>
            )}
            {open.traces.length === 0 && <div className="text-sm text-zinc-500">No bot attempts recorded yet (or they are older than 7 days).</div>}
            {open.traces.map((t) => (
              <div key={t.id} className="rounded-2xl border border-zinc-800 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{t.bot}</span>
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${t.outcome === "done" ? BADGE.done : t.outcome === "not_found" ? BADGE.not_found : BADGE.failed}`}>{OUTCOME_HELP[t.outcome] || t.outcome}</span>
                </div>
                {t.detail && <div className="text-xs text-zinc-400">{t.detail}</div>}
                <ol className="space-y-2">
                  {t.trace.map((s) => (
                    <li key={s.n} className="text-xs border-l-2 border-zinc-800 pl-3">
                      <div className="text-zinc-300"><span className="text-zinc-500">{(s.at / 1000).toFixed(1)}s</span> · <span className="font-semibold">{s.kind}</span> → {s.action}</div>
                      <div className="text-zinc-500">{s.why}</div>
                      {s.text && <div className="text-zinc-600 mt-1 line-clamp-2">“{s.text}”</div>}
                      {s.buttons && s.buttons.length > 0 && <div className="text-zinc-600 mt-0.5 truncate">buttons: {s.buttons.slice(0, 8).join(" | ")}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
