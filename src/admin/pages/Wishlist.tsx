import React, { useState } from "react";
import { Clapperboard, Pause, Play, Plus, RotateCw, Trash2 } from "lucide-react";
import { api, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, Field, Input, Segmented, Skeleton, cx, type Tone } from "../ui/kit";
import { useConfirm, useToast } from "../ui/overlay";

interface Wish {
  id: number; title: string; year: string | null; mode: "all" | "seasons" | "follow"; status: "active" | "paused" | "done";
  note: string | null; next_check_at: number; seasonsWanted: number[] | null; running: boolean;
  progress: Array<{ season: number; held: number; offered: number | null }>;
}
const inTime = (at: number) => {
  const m = Math.max(1, Math.round((at - Date.now()) / 60000));
  return m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
};
const MODE_LABEL = { all: "Everything", follow: "Everything + new episodes", seasons: "Chosen seasons" } as const;
const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Working on it", tone: "warn" }, paused: { label: "Paused", tone: "neutral" }, done: { label: "Complete", tone: "ok" },
};

/** Series the cron should keep hunting until every episode is in the series channel. */
export default function Wishlist() {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useGet<{ wishes: Wish[] }>(["wishlist"], "/api/crawler/wishlist", { every: 10000 });
  const inv = [["wishlist"], ["jobs"]];
  const err = (e: Error) => toast.err(e.message);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"all" | "follow" | "seasons">("all");
  const [seasons, setSeasons] = useState("1");

  const parseSeasons = (v: string) => {
    const out = new Set<number>();
    for (const part of v.split(",")) {
      const m = part.trim().match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/);
      if (!m) continue;
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      for (let n = a; n <= Math.min(b, a + 40); n++) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  };

  const add = useAct((body: any) => api("/api/crawler/wishlist", { body }), inv, () => { setTitle(""); toast.ok("Added. The crawler will start on it shortly."); });
  const patch = useAct((v: { id: number; body: any }) => api(`/api/crawler/wishlist/${v.id}`, { method: "PUT", body: v.body }), inv);
  const runNow = useAct((id: number) => api(`/api/crawler/wishlist/${id}/run`, { body: {} }), inv, () => toast.ok("Checking now."));
  const remove = useAct((id: number) => api(`/api/crawler/wishlist/${id}`, { method: "DELETE" }), inv);

  const wanted = parseSeasons(seasons);
  const submit = () => add.mutate({ title, mode, seasons: mode === "seasons" ? wanted : null }, { onError: err });
  const wishes = list.data?.wishes || [];

  return (
    <Card
      title="Series wishlist"
      description="Tell the crawler which shows you want. It asks your series bot for the seasons, collects every episode, and keeps going until the series channel has them all."
    >
      <form onSubmit={(e) => { e.preventDefault(); if (title.trim().length > 1) submit(); }} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Series"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Severance" /></Field>
          <div className="flex items-end"><Button type="submit" variant="primary" className="w-full sm:w-auto" icon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={title.trim().length < 2 || (mode === "seasons" && !wanted.length)}>Add</Button></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<"all" | "follow" | "seasons"> value={mode} onChange={setMode} options={[{ value: "all", label: "Everything now" }, { value: "follow", label: "Everything + new episodes" }, { value: "seasons", label: "Some seasons" }]} />
          {mode === "seasons" && <Input value={seasons} onChange={(e) => setSeasons(e.target.value)} placeholder="1, 3-4" className="w-32" aria-label="Seasons" />}
        </div>
        <p className="text-xs text-zinc-500">You can also put series in a batch list: “Severance S2”, “Dark S1-S3”, “Breaking Bad complete series”, or “series: Succession”.</p>
      </form>

      <div className="mt-5 space-y-2.5">
        {list.isLoading ? <Skeleton className="h-24" /> : wishes.length === 0 ? (
          <Empty icon={<Clapperboard className="h-5 w-5" />} title="No series on the wishlist" body="Add a show above and leave the rest to the crawler." />
        ) : wishes.map((w) => {
          const st = w.running ? { label: "Fetching…", tone: "warn" as Tone } : STATUS[w.status];
          const held = w.progress.reduce((n, p) => n + p.held, 0);
          const offered = w.progress.reduce((n, p) => n + (p.offered ?? 0), 0);
          const pct = offered ? Math.min(100, Math.round((held / offered) * 100)) : 0;
          return (
            <div key={w.id} className="rounded-lg border border-line bg-surface-2/60 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                  <div className="truncate font-medium text-white">{w.title}{w.year ? <span className="ml-1.5 font-normal text-zinc-500">{w.year}</span> : null}</div>
                  <div className="text-xs text-zinc-500">{MODE_LABEL[w.mode]}{w.mode === "seasons" && w.seasonsWanted ? ` · S${w.seasonsWanted.join(", S")}` : ""}</div>
                </div>
                <Badge tone={st.tone} dot pulse={w.running}>{st.label}</Badge>
                <div className="ml-auto flex gap-0.5">
                  <Button size="sm" variant="ghost" aria-label="Check now" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={() => runNow.mutate(w.id, { onError: err })} />
                  <Button size="sm" variant="ghost" aria-label={w.status === "paused" ? "Resume" : "Pause"} icon={w.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} onClick={() => patch.mutate({ id: w.id, body: { status: w.status === "paused" ? "active" : "paused" } }, { onError: err })} />
                  <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={async () => { if (await confirm({ title: `Remove “${w.title}”?`, body: "Episodes already saved stay in your library.", confirmLabel: "Remove", danger: true })) remove.mutate(w.id, { onError: err }); }} />
                </div>
              </div>
              {offered > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="bg-ember h-full rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                    <span className="tabular-nums text-zinc-300">{held} of {offered} episodes</span>
                    {w.progress.map((p) => (
                      <span key={p.season} className={cx("tabular-nums", p.offered && p.held >= p.offered && "text-emerald-400")}>S{p.season} {p.held}/{p.offered ?? "?"}</span>
                    ))}
                  </div>
                </div>
              )}
              {w.note && <p className="mt-2 text-xs text-zinc-400">{w.note}{w.status === "active" && w.next_check_at > Date.now() ? ` · next check ${inTime(w.next_check_at)}` : ""}</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
