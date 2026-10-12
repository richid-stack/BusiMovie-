import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Database, Film, HardDrive, Inbox, Search, Users } from "lucide-react";
import { useGet, formatBytes, parseDate, timeAgo } from "../lib";
import { BarChart, Button, Card, Dot, Empty, PageHeader, Skeleton, Stat, TD, TR, Table } from "../ui/kit";
import { JobBadge, jobLabel, jobStatus, type Job, JOB_LABEL } from "./shared";

export default function Overview() {
  const status = useGet<any>(["status"], "/api/status", { every: 15000 });
  const crawler = useGet<any>(["crawler-status"], "/api/crawler/status", { every: 15000 });
  const jobs = useGet<Job[]>(["jobs"], "/api/crawler/jobs?limit=100", { every: 10000 });
  const library = useGet<{ files: any[] }>(["library-raw"], "/api/library?raw=true");
  const reqs = useGet<any>(["requests"], "/api/requests", { every: 20000 });

  const s = status.data?.stats;
  const aux = crawler.data?.auxiliarySession;

  const added = useMemo(() => {
    const days: Array<{ label: string; value: number; key: string }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push({ key: d.toDateString(), label: i % 2 === 0 ? String(d.getDate()) : "", value: 0 });
    }
    for (const f of library.data?.files || []) {
      const d = parseDate(f.created_at);
      if (!d) continue;
      d.setHours(0, 0, 0, 0);
      const hit = days.find((x) => x.key === d.toDateString());
      if (hit) hit.value++;
    }
    return days;
  }, [library.data]);
  const addedTotal = added.reduce((a, d) => a + d.value, 0);

  const outcome = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of jobs.data || []) c[jobStatus(j)] = (c[jobStatus(j)] || 0) + 1;
    return c;
  }, [jobs.data]);
  const jobTotal = Object.values(outcome).reduce((a, b) => a + b, 0);

  interface Item { tone: "bad" | "warn" | "accent"; title: string; body: string; to?: string; cta?: string }
  const attention: Item[] = [];
  if (status.data && !status.data.botRunning)
    attention.push({ tone: "bad", title: "The Telegram bot is offline", body: "Viewers can't search or request until it is running.", to: "/admin/connections", cta: "Fix" });
  if (aux && !aux.connected)
    attention.push({ tone: "warn", title: "The userbot isn't signed in", body: "The crawler can't reach external bots or your vault.", to: "/admin/connections", cta: "Sign in" });
  if (status.data?.database && !status.data.database.persistent)
    attention.push({ tone: "warn", title: "The database is temporary", body: "Data is lost on restart. Add your Turso credentials to keep it.", to: "/admin/connections", cta: "See how" });
  if (s?.pendingRequests > 0)
    attention.push({ tone: "accent", title: `${s.pendingRequests} viewer request${s.pendingRequests === 1 ? "" : "s"} waiting`, body: "Fetch them automatically or mark them ready.", to: "/admin/requests", cta: "Review" });
  if (outcome.needs_admin)
    attention.push({ tone: "accent", title: `${outcome.needs_admin} crawl job${outcome.needs_admin === 1 ? "" : "s"} need you`, body: "A bot asked for something the crawler can't do alone.", to: "/admin/jobs", cta: "Open" });
  const w = status.data?.worker;
  if (w?.stalled)
    attention.push({ tone: "bad", title: "The crawler looks stuck", body: `"${w.current?.title}" has been running for ${Math.round((w.current?.seconds || 0) / 60)} min. It will be stopped automatically; restart the app if it doesn't clear.`, to: "/admin/jobs", cta: "Open" });
  else if (w && w.failStreak >= 3)
    attention.push({ tone: "warn", title: `${w.failStreak} crawl jobs failed in a row`, body: "A search bot may be down or the userbot signed out.", to: "/admin/bots", cta: "Check bots" });
  if (crawler.data?.floodWaitActive)
    attention.push({ tone: "warn", title: "Telegram is rate-limiting the userbot", body: `Crawling resumes in about ${crawler.data.floodWaitCooldownSeconds}s.` });

  const recentJobs = (jobs.data || []).slice(0, 6);
  const recentReqs: any[] = (reqs.data?.all || []).slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="What's happening across your catalog, viewers and crawler right now." />

      {attention.length > 0 && (
        <Card title="Needs your attention" flush actions={<span className="rounded-full bg-ember-pink/15 px-2 text-[11px] font-semibold tabular-nums text-pink-300">{attention.length}</span>}>
          <ul className="divide-y divide-line/70">
            {attention.map((n, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <Dot tone={n.tone === "accent" ? "accent" : n.tone === "bad" ? "bad" : "warn"} pulse />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-zinc-100">{n.title}</div>
                  <div className="text-xs text-zinc-500">{n.body}</div>
                </div>
                {n.to && <Link to={n.to}><Button size="sm">{n.cta}</Button></Link>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Library files" icon={<Film className="h-4 w-4" />} value={s ? s.libraryFiles.toLocaleString() : ""} loading={!s} hint={s ? `${formatBytes(s.totalVaultBytes)} in the vault` : undefined} />
        <Stat label="Viewers" icon={<Users className="h-4 w-4" />} value={s ? s.users.toLocaleString() : ""} loading={!s} hint="Have started the bot" />
        <Stat label="Searches" icon={<Search className="h-4 w-4" />} value={s ? s.searches.toLocaleString() : ""} loading={!s} hint="All time" />
        <Stat label="Waiting requests" icon={<Inbox className="h-4 w-4" />} tone={s?.pendingRequests ? "warn" : undefined} value={s ? s.pendingRequests.toLocaleString() : ""} loading={!s} hint={s ? `${s.requests.toLocaleString()} total` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Files added" description="Last 14 days" actions={<span className="text-xs tabular-nums text-zinc-500">{addedTotal} new</span>}>
          {library.isLoading ? <Skeleton className="h-36" /> : <BarChart data={added} height={130} label="Files added per day over the last 14 days" />}
        </Card>
        <Card className="lg:col-span-2" title="Crawler results" description={jobTotal ? `Last ${jobTotal} jobs` : "No jobs yet"}>
          {jobTotal === 0 ? (
            <p className="py-6 text-center text-[13px] text-zinc-500">Jobs will appear here as viewers request titles.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
                {(["done", "running", "queued", "not_found", "needs_admin", "failed"] as const).map((k) =>
                  outcome[k] ? <div key={k} style={{ width: `${(outcome[k] / jobTotal) * 100}%` }} className={BAR[k]} title={`${JOB_LABEL[k]}: ${outcome[k]}`} /> : null
                )}
              </div>
              <ul className="space-y-1.5 text-[13px]">
                {(["done", "running", "queued", "not_found", "needs_admin", "failed"] as const).filter((k) => outcome[k]).map((k) => (
                  <li key={k} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-zinc-400"><span className={`h-2 w-2 rounded-full ${BAR[k]}`} />{JOB_LABEL[k]}</span>
                    <span className="tabular-nums text-zinc-200">{outcome[k]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent crawl jobs" flush actions={<Link to="/admin/jobs" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">All jobs <ArrowRight className="h-3 w-3" /></Link>}>
          {jobs.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : recentJobs.length === 0 ? (
            <Empty title="No jobs yet" body="Requests, admin fetches and batch imports show up here." />
          ) : (
            <Table className="[&_table]:min-w-0">
              <tbody>
                {recentJobs.map((j) => (
                  <TR key={j.id}>
                    <TD className="max-w-[14rem]"><div className="truncate text-zinc-100">{jobLabel(j)}</div><div className="text-xs text-zinc-500">{timeAgo(j.created_at)}</div></TD>
                    <TD className="text-right"><JobBadge status={jobStatus(j)} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Latest requests" flush actions={<Link to="/admin/requests" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">All requests <ArrowRight className="h-3 w-3" /></Link>}>
          {reqs.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : recentReqs.length === 0 ? (
            <Empty title="No requests yet" body="When a viewer asks for a title you don't have, it lands here." />
          ) : (
            <Table className="[&_table]:min-w-0">
              <tbody>
                {recentReqs.map((r) => (
                  <TR key={r.id}>
                    <TD className="max-w-[14rem]"><div className="truncate text-zinc-100">{r.title}</div><div className="text-xs text-zinc-500">{timeAgo(r.created_at)}</div></TD>
                    <TD className="text-right text-xs text-zinc-400">{r.status === "fulfilled" ? "Ready" : r.status === "waiting" ? "Fetching" : "Waiting"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniFact icon={<HardDrive className="h-4 w-4" />} label="Active sources" value={crawler.data ? `${crawler.data.activeTargets ?? 0}` : "…"} to="/admin/sources" />
        <MiniFact icon={<Database className="h-4 w-4" />} label="Active search bots" value={crawler.data ? `${crawler.data.activeBots ?? 0}` : "…"} to="/admin/bots" />
        <MiniFact icon={<AlertTriangle className="h-4 w-4" />} label="Jobs in queue" value={crawler.data ? `${crawler.data.pendingJobsCount ?? 0}` : "…"} to="/admin/jobs" />
      </div>
    </div>
  );
}

const BAR: Record<string, string> = {
  done: "bg-emerald-400", running: "bg-amber-400", queued: "bg-zinc-500", not_found: "bg-zinc-600", needs_admin: "bg-ember-pink", failed: "bg-rose-400",
};

function MiniFact({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: string; to: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3 transition hover:border-zinc-600">
      <span className="text-zinc-500 group-hover:text-zinc-300">{icon}</span>
      <span className="flex-1 text-[13px] text-zinc-400">{label}</span>
      <span className="font-display text-lg font-semibold tabular-nums text-white">{value}</span>
    </Link>
  );
}
