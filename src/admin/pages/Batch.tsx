import React, { useRef, useState } from "react";
import { FileUp, ListChecks, OctagonX, Play, RotateCw, Trash2 } from "lucide-react";
import { api, timeAgo, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, Field, Input, Notice, PageHeader, Segmented, Select, Skeleton, Stat, TD, TH, THead, TR, Table, Textarea, Toggle, cx, type Tone } from "../ui/kit";
import { useConfirm, useToast } from "../ui/overlay";

interface QItem { id: number; clean_title: string; year?: string; requested_quality: string; status: string; attempts: number; last_error?: string; bot_used?: string; source_csv?: string; updated_at: string }
interface Cron {
  config: { isEnabled: boolean; batchSize: number; intervalMinutes: number; delayBetweenItemsMs: number; maxRetries: number; nextRunAt: string | null; isRunningBatch: boolean };
  counts: { total: number; pending: number; processing: number; completed: number; duplicate_skipped: number; failed: number };
  floodWaitActive: boolean; floodWaitSeconds: number;
}
const ST: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "neutral" }, processing: { label: "Working", tone: "warn" }, completed: { label: "Saved", tone: "ok" },
  duplicate_skipped: { label: "Already had it", tone: "info" }, not_found: { label: "Not found", tone: "neutral" }, failed: { label: "Failed", tone: "bad" },
};

export default function Batch() {
  const cron = useGet<Cron>(["cron"], "/api/crawler/cron/status", { every: 8000 });
  const [filter, setFilter] = useState("all");
  const queue = useGet<QItem[]>(["cron-queue", filter], `/api/crawler/cron/queue?status=${filter}&limit=200`, { every: 8000 });
  const toast = useToast();
  const confirm = useConfirm();
  const inv = [["cron"], ["cron-queue"], ["jobs"]];

  const run = useAct((limit: number) => api<any>("/api/crawler/cron/run-batch-now", { body: { limit } }), inv, (r) =>
    toast.ok(r.processed !== undefined ? `Batch sent to the crawler (${r.processed} titles).` : "Batch sent to the crawler.")
  );
  const stop = useAct(() => api("/api/crawler/cron/stop-all", { body: {} }), inv, () => toast.ok("Stopped the scheduler and any running batch."));
  const requeue = useAct((type: string) => api<any>("/api/crawler/cron/requeue", { body: { type } }), inv, (r) => toast.ok(`${r.requeuedCount ?? 0} titles put back in line.`));
  const clear = useAct((type: string) => api("/api/crawler/cron/clear-queue", { body: { type } }), inv, () => toast.ok("Queue cleaned up."));
  const c = cron.data;
  const err = (e: Error) => toast.err(e.message);

  const doClear = async (type: "completed" | "failed" | "all") => {
    if (await confirm({ title: type === "all" ? "Empty the whole queue?" : `Clear ${type} titles?`, body: "This only removes them from this list. Files already in your library are untouched.", confirmLabel: "Clear", danger: type === "all" }))
      clear.mutate(type, { onError: err });
  };

  const counts = c?.counts;
  return (
    <div className="space-y-6">
      <PageHeader title="Batch import" description="Drop in a list of titles and the crawler works through them slowly in the background, so you can build a library without babysitting it." />

      {c?.floodWaitActive && <Notice tone="warn" title="Telegram asked the userbot to slow down">Batches resume in about {c.floodWaitSeconds}s.</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In line" value={counts?.pending ?? 0} loading={!c} hint={counts?.processing ? `${counts.processing} working now` : undefined} />
        <Stat label="Saved" value={counts?.completed ?? 0} loading={!c} tone="ok" />
        <Stat label="Already had" value={counts?.duplicate_skipped ?? 0} loading={!c} />
        <Stat label="Failed" value={counts?.failed ?? 0} loading={!c} tone={counts?.failed ? "bad" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><Upload /></div>
        <div className="lg:col-span-2"><Scheduler cron={c} loading={cron.isLoading} /></div>
      </div>

      <Card
        title="Queue"
        flush
        actions={<>
          <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} loading={run.isPending} onClick={() => run.mutate(c?.config.batchSize || 5, { onError: err })}>Run a batch now</Button>
          <Button size="sm" variant="danger" icon={<OctagonX className="h-3.5 w-3.5" />} onClick={() => stop.mutate(undefined as never, { onError: err })}>Emergency stop</Button>
        </>}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Segmented value={filter} onChange={setFilter} options={[
            { value: "all", label: "All" }, { value: "pending", label: "Waiting" }, { value: "completed", label: "Saved" }, { value: "failed", label: "Failed" }, { value: "duplicate_skipped", label: "Skipped" },
          ]} />
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => requeue.mutate("failed", { onError: err })}>Retry failed</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => doClear("completed")}>Clear saved</Button>
          </div>
        </div>
        {queue.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : (queue.data || []).length === 0 ? (
          <Empty icon={<ListChecks className="h-5 w-5" />} title="The queue is empty" body="Upload a list above to fill it." />
        ) : (
          <Table className="max-h-[28rem] overflow-y-auto">
            <THead><TH>Title</TH><TH>Status</TH><TH className="hidden md:table-cell">Bot</TH><TH className="hidden md:table-cell">Tries</TH><TH className="hidden md:table-cell">From</TH><TH className="hidden md:table-cell">Updated</TH></THead>
            <tbody>
              {(queue.data || []).map((i) => {
                const s = ST[i.status] || { label: i.status, tone: "neutral" as Tone };
                return (
                  <TR key={i.id}>
                    <TD className="max-w-[16rem]"><div className="truncate font-medium text-white">{i.clean_title}{i.year ? <span className="ml-1.5 font-normal text-zinc-500">{i.year}</span> : null}</div>{i.last_error && i.status === "failed" && <div className="truncate text-xs text-zinc-500">{i.last_error}</div>}</TD>
                    <TD><Badge tone={s.tone} dot>{s.label}</Badge></TD>
                    <TD className="hidden md:table-cell text-zinc-400">{i.bot_used || "—"}</TD>
                    <TD className="hidden md:table-cell tabular-nums text-zinc-400">{i.attempts}</TD>
                    <TD className="hidden md:table-cell max-w-[10rem] truncate text-zinc-500">{i.source_csv || "—"}</TD>
                    <TD className="hidden md:table-cell whitespace-nowrap text-zinc-500">{timeAgo(i.updated_at)}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Upload() {
  const toast = useToast();
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const [report, setReport] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = useAct((payload: any) => api<any>("/api/crawler/cron/upload-csv", { body: payload }), [["cron"], ["cron-queue"]], (r) => { setReport(r); setText(""); });

  const sendFile = async (file: File) => {
    const pdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const payload: any = { sourceName: file.name };
    if (pdf) {
      payload.fileBase64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
    } else payload.csvContent = await file.text();
    send.mutate(payload, { onError: (e) => toast.err(e.message) });
  };

  return (
    <Card title="Add titles" description="One title per line, or a CSV, spreadsheet export, Markdown or PDF list." className="h-full">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) sendFile(f); }}
        className={cx("flex flex-col items-center rounded-xl border border-dashed px-4 py-7 text-center transition", drag ? "border-ember-red bg-ember-red/5" : "border-line bg-surface-2/40")}
      >
        <FileUp className="h-5 w-5 text-zinc-500" />
        <p className="mt-2 text-[13px] text-zinc-300">Drop a file here</p>
        <p className="text-xs text-zinc-600">.csv · .txt · .md · .tsv · .pdf</p>
        <Button size="sm" className="mt-3" loading={send.isPending} onClick={() => fileRef.current?.click()}>Choose file</Button>
        <input ref={fileRef} type="file" hidden accept=".csv,.txt,.md,.markdown,.pdf,.tsv,text/plain,text/csv,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ""; }} />
      </div>
      <div className="mt-4">
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Or paste titles here\nInception 2010\nThe Dark Knight"} className="font-mono text-xs" />
        <div className="mt-2 flex justify-end">
          <Button variant="primary" disabled={!text.trim()} loading={send.isPending} onClick={() => send.mutate({ csvContent: text, sourceName: "pasted_list.txt" }, { onError: (e) => toast.err(e.message) })}>Queue these titles</Button>
        </div>
      </div>
      {report && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[["Read", report.totalParsed, ""], ["Queued", report.queued, "text-emerald-300"], ["Duplicates", report.duplicatesSkipped, "text-zinc-400"]].map(([l, v, cls]) => (
            <div key={l as string} className="rounded-lg border border-line bg-surface-2 py-2.5">
              <div className={cx("font-display text-lg font-semibold tabular-nums", (cls as string) || "text-white")}>{v as number}</div>
              <div className="text-[11px] text-zinc-500">{l as string}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Scheduler({ cron, loading }: { cron?: Cron; loading: boolean }) {
  const toast = useToast();
  const [f, setF] = useState({ batchSize: 5, intervalMinutes: 15, delayBetweenItemsMs: 7000, maxRetries: 3 });
  React.useEffect(() => {
    if (cron) setF({ batchSize: cron.config.batchSize, intervalMinutes: cron.config.intervalMinutes, delayBetweenItemsMs: cron.config.delayBetweenItemsMs, maxRetries: cron.config.maxRetries });
  }, [cron?.config.batchSize, cron?.config.intervalMinutes, cron?.config.delayBetweenItemsMs, cron?.config.maxRetries]);
  const save = useAct((body: any) => api("/api/crawler/cron/config", { body }), [["cron"]]);
  const on = !!cron?.config.isEnabled;
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <Card
      title="Automatic runs"
      className="h-full"
      actions={loading ? <Skeleton className="h-5 w-9" /> : <Toggle checked={on} label="Run batches automatically" onChange={(v) => save.mutate({ isEnabled: v, ...f }, { onSuccess: () => toast.ok(v ? `On: ${f.batchSize} titles every ${f.intervalMinutes} min.` : "Paused."), onError: (e) => toast.err(e.message) })} />}
      description={on ? (cron?.config.nextRunAt ? `Next run ${new Date(cron.config.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Running") : "Off. Use “Run a batch now”, or switch this on."}
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Titles per run"><Select value={f.batchSize} onChange={num("batchSize")}>{[1, 3, 5, 10, 15, 25].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          <Field label="Every"><Select value={f.intervalMinutes} onChange={num("intervalMinutes")}>{[5, 10, 15, 30, 60, 120].map((n) => <option key={n} value={n}>{n} min</option>)}</Select></Field>
          <Field label="Pause between titles"><Select value={f.delayBetweenItemsMs} onChange={num("delayBetweenItemsMs")}>{[3000, 5000, 7000, 10000, 15000].map((n) => <option key={n} value={n}>{n / 1000}s</option>)}</Select></Field>
          <Field label="Tries per title"><Input type="number" min={1} max={10} value={f.maxRetries} onChange={num("maxRetries")} /></Field>
        </div>
        <p className="text-xs text-zinc-500">Longer pauses keep Telegram from rate-limiting the userbot.</p>
        <Button className="w-full" loading={save.isPending} onClick={() => save.mutate(f, { onSuccess: () => toast.ok("Saved."), onError: (e) => toast.err(e.message) })}>Save settings</Button>
      </div>
    </Card>
  );
}
