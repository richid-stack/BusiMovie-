import React, { useState } from "react";
import { Activity, ChevronRight, RotateCw } from "lucide-react";
import { api, fullDate, timeAgo, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, PageHeader, Segmented, Skeleton, TD, TH, THead, TR, Table, type Tone } from "../ui/kit";
import { Drawer, useToast } from "../ui/overlay";
import { JOB_LABEL, JobBadge, SOURCE_LABEL, jobLabel, jobStatus, type Job } from "./shared";

interface TraceStep { n: number; at: number; kind: string; why: string; action: string; text?: string; buttons?: string[] }
interface Trace { id: number; bot: string; outcome: string; detail: string | null; trace: TraceStep[]; created_at: string }

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  done: { label: "Delivered a file", tone: "ok" },
  not_found: { label: "Bot has no match", tone: "neutral" },
  wrong_file: { label: "Wrong file sent", tone: "warn" },
  blocked: { label: "Blocked by a join gate or throttle", tone: "warn" },
  failed: { label: "Couldn't navigate the bot", tone: "bad" },
  acquire_failed: { label: "Received but not stored", tone: "bad" },
  error: { label: "Unexpected error", tone: "bad" },
  no_episodes: { label: "No episodes arrived", tone: "neutral" },
};

export default function CrawlJobs() {
  const q = useGet<Job[]>(["jobs"], "/api/crawler/jobs?limit=100", { every: 5000 });
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const jobs = q.data || [];
  const counts = jobs.reduce<Record<string, number>>((a, j) => ((a[jobStatus(j)] = (a[jobStatus(j)] || 0) + 1), a), {});
  const shown = filter === "all" ? jobs : jobs.filter((j) => jobStatus(j) === filter);
  const opts = [{ value: "all", label: "All", count: jobs.length }, ...(["running", "queued", "needs_admin", "done", "not_found", "failed"] as const).map((s) => ({ value: s as string, label: JOB_LABEL[s], count: counts[s] || 0 }))];

  return (
    <div>
      <PageHeader title="Crawl jobs" description="Every fetch the crawler has run for viewers, you and batch imports, with the exact steps it took inside each external bot." />
      <div className="mb-4"><Segmented value={filter} onChange={setFilter} options={opts} /></div>
      <Card flush>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : shown.length === 0 ? (
          <Empty icon={<Activity className="h-5 w-5" />} title="No jobs here" body="Requests from viewers, admin fetches and batch imports show up as they run." />
        ) : (
          <Table>
            <THead>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">From</TH>
              <TH className="hidden md:table-cell">Bot</TH>
              <TH className="hidden md:table-cell">When</TH>
              <TH className="w-8" />
            </THead>
            <tbody>
              {shown.map((j) => (
                <TR key={j.id} onClick={() => setOpenId(j.id)}>
                  <TD className="max-w-[9.5rem] md:max-w-[18rem]">
                    <div className="truncate font-medium text-white">{jobLabel(j)}</div>
                    {j.error && jobStatus(j) !== "done" && <div className="truncate text-xs text-zinc-500">{j.error}</div>}
                  </TD>
                  <TD><JobBadge status={jobStatus(j)} /></TD>
                  <TD className="hidden md:table-cell text-zinc-400">{SOURCE_LABEL[j.source] || j.source}</TD>
                  <TD className="hidden md:table-cell text-zinc-400">{j.bot_used || "—"}</TD>
                  <TD className="hidden md:table-cell whitespace-nowrap text-zinc-500">{timeAgo(j.created_at)}</TD>
                  <TD><ChevronRight className="h-4 w-4 text-zinc-600" /></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <JobDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function JobDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const q = useGet<{ job: Job; traces: Trace[] }>(["job", id], `/api/crawler/jobs/${id}`, { enabled: id !== null, every: 4000 });
  const retry = useAct((jid: number) => api(`/api/crawler/jobs/${jid}/retry`, { method: "POST", body: {} }), [["jobs"], ["job"]], () => {
    toast.ok("Queued again.");
    onClose();
  });
  const job = q.data?.job;
  const st = job ? jobStatus(job) : "";
  return (
    <Drawer
      open={id !== null}
      onClose={onClose}
      width="max-w-2xl"
      title={job ? jobLabel(job) : "Job"}
      subtitle={job ? `#${job.id} · ${SOURCE_LABEL[job.source] || job.source} · ${fullDate(job.created_at)}` : undefined}
      footer={job && !["queued", "running", "done"].includes(st) ? (
        <Button variant="primary" icon={<RotateCw className="h-3.5 w-3.5" />} loading={retry.isPending} onClick={() => retry.mutate(job.id, { onError: (e) => toast.err(e.message) })}>Try again</Button>
      ) : undefined}
    >
      {!job ? <Skeleton className="h-40" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <JobBadge status={st} />
            <span className="text-xs text-zinc-500">Attempt {job.attempts}{job.finished_at ? ` · finished ${timeAgo(job.finished_at)}` : ""}</span>
          </div>
          {job.error && st !== "done" && <p className="break-words rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-zinc-300">{job.error}</p>}
          {q.data!.traces.length === 0 && <p className="text-[13px] text-zinc-500">No bot attempts recorded yet, or they are older than 7 days.</p>}
          {q.data!.traces.map((t) => {
            const o = OUTCOME[t.outcome] || { label: t.outcome, tone: "neutral" as Tone };
            return (
              <section key={t.id} className="rounded-xl border border-line">
                <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                  <span className="font-display text-[13px] font-semibold text-white">{t.bot}</span>
                  <Badge tone={o.tone} dot>{o.label}</Badge>
                  {t.detail && <span className="basis-full text-xs text-zinc-500">{t.detail}</span>}
                </header>
                <ol className="space-y-0 px-4 py-3">
                  {t.trace.map((s, i) => (
                    <li key={s.n} className="relative pb-3.5 pl-5 last:pb-0">
                      {i < t.trace.length - 1 && <span className="absolute left-[3px] top-3 h-full w-px bg-line" />}
                      <span className="absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full bg-zinc-600" />
                      <div className="text-[13px] text-zinc-200">
                        <span className="mr-1.5 tabular-nums text-xs text-zinc-600">{(s.at / 1000).toFixed(1)}s</span>
                        <span className="font-medium">{s.kind}</span> <span className="text-zinc-500">→</span> {s.action}
                      </div>
                      <div className="text-xs text-zinc-500">{s.why}</div>
                      {s.text && <div className="mt-1 line-clamp-2 rounded-md bg-surface-2 px-2 py-1 text-xs italic text-zinc-500">“{s.text}”</div>}
                      {s.buttons && s.buttons.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {s.buttons.slice(0, 8).map((b, bi) => <span key={bi} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-zinc-400">{b}</span>)}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
