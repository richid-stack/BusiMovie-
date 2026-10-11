import React, { useState } from "react";
import { Boxes, History, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, timeAgo, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, Field, IconButton, Input, PageHeader, Select, Skeleton, TD, TH, THead, TR, Table, Toggle, type Tone } from "../ui/kit";
import { Drawer, Modal, useConfirm, useToast } from "../ui/overlay";

interface Target {
  id: number; channel_identifier: string; title: string; status: "active" | "paused" | "syncing";
  min_file_size_mb: number; quality_filter: string; last_crawled_at: string | null; total_files_found: number;
}
interface LogRow { id: string; timestamp: string; type: string; source: string; title: string; details: string; status: "success" | "filtered" | "cooldown" | "error" }
interface Dialog { id: string; title: string; username: string | null; isChannel: boolean; isGroup: boolean }

const LOG_TONE: Record<string, Tone> = { success: "ok", filtered: "neutral", cooldown: "warn", error: "bad" };

export default function Sources() {
  const q = useGet<Target[]>(["targets"], "/api/crawler/targets", { every: 15000 });
  const logs = useGet<LogRow[]>(["crawler-logs"], "/api/crawler/logs", { every: 10000 });
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [backfill, setBackfill] = useState<Target | null>(null);

  const toggle = useAct((t: Target) => api(`/api/crawler/targets/${t.id}`, { method: "PUT", body: { status: t.status === "active" ? "paused" : "active" } }), [["targets"]]);
  const del = useAct((id: number) => api(`/api/crawler/targets/${id}`, { method: "DELETE" }), [["targets"]], () => toast.ok("Source removed."));
  const remove = async (t: Target) => {
    if (await confirm({ title: `Stop watching ${t.title}?`, body: "Files already saved to your library stay. New uploads in this channel will no longer be picked up.", confirmLabel: "Remove", danger: true }))
      del.mutate(t.id, { onError: (e) => toast.err(e.message) });
  };
  const rows = q.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Source channels"
        description="Telegram channels the userbot watches. New movie and series uploads are copied into your vault automatically."
        actions={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Add channel</Button>}
      />
      <Card flush>
        {q.isLoading ? <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div> : rows.length === 0 ? (
          <Empty icon={<Boxes className="h-5 w-5" />} title="No channels yet" body="Add a channel your userbot has joined and BusiMovie will start collecting from it." action={<Button variant="primary" onClick={() => setAdding(true)}>Add a channel</Button>} />
        ) : (
          <Table>
            <THead>
              <TH>Channel</TH><TH className="hidden md:table-cell">Rules</TH><TH className="hidden md:table-cell">Found</TH><TH className="hidden md:table-cell">Last checked</TH><TH>Watching</TH><TH className="text-right">Actions</TH>
            </THead>
            <tbody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD className="max-w-[7rem] sm:max-w-[14rem]"><div className="truncate font-medium text-white">{t.title}</div><div className="truncate font-mono text-xs text-zinc-500">{t.channel_identifier}</div></TD>
                  <TD className="hidden md:table-cell whitespace-nowrap text-xs text-zinc-400">{t.quality_filter === "all" ? "Any quality" : t.quality_filter} · ≥ {t.min_file_size_mb} MB</TD>
                  <TD className="hidden md:table-cell tabular-nums">{t.total_files_found}</TD>
                  <TD className="hidden md:table-cell whitespace-nowrap text-zinc-500">{timeAgo(t.last_crawled_at)}</TD>
                  <TD><Toggle checked={t.status !== "paused"} onChange={() => toggle.mutate(t, { onError: (e) => toast.err(e.message) })} label={`Watch ${t.title}`} /></TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" icon={<History className="h-3.5 w-3.5" />} onClick={() => setBackfill(t)}>Backfill</Button>
                      <IconButton label="Remove" onClick={() => remove(t)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Activity" description="What the crawler has done lately" flush actions={<IconButton label="Refresh" onClick={() => logs.refetch()}><RefreshCw className="h-3.5 w-3.5" /></IconButton>}>
        {(logs.data || []).length === 0 ? <Empty title="Nothing yet" body="Crawler activity appears here as it happens." /> : (
          <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto">
            {(logs.data || []).slice(0, 60).map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-4 py-2.5">
                <Badge tone={LOG_TONE[l.status] || "neutral"} className="mt-0.5">{l.status}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-zinc-200">{l.title}</div>
                  <div className="truncate text-xs text-zinc-500">{l.source} · {l.details}</div>
                </div>
                <span className="shrink-0 text-xs text-zinc-600">{timeAgo(l.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AddTarget open={adding} onClose={() => setAdding(false)} />
      <BackfillModal target={backfill} onClose={() => setBackfill(null)} />
    </div>
  );
}

function AddTarget({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const base = { channel_identifier: "", title: "", min_file_size_mb: 500, quality_filter: "all" };
  const [f, setF] = useState(base);
  const dialogs = useGet<Dialog[]>(["dialogs"], "/api/crawler/joined-dialogs", { enabled: open });
  const add = useAct(() => api("/api/crawler/targets", { body: f }), [["targets"]], () => { toast.ok("Channel added."); setF(base); onClose(); });
  const channels = (dialogs.data || []).filter((d) => d.isChannel || d.isGroup);
  return (
    <Drawer open={open} onClose={onClose} title="Add a source channel" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!f.channel_identifier.trim()} loading={add.isPending} onClick={() => add.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>Add channel</Button>
    </>}>
      <div className="space-y-5">
        {channels.length > 0 && (
          <Field label="Pick from channels your userbot has joined">
            <Select value="" onChange={(e) => { const d = channels.find((c) => c.id === e.target.value); if (d) setF({ ...f, channel_identifier: d.username ? `@${d.username}` : d.id, title: d.title }); }}>
              <option value="">Choose…</option>
              {channels.map((d) => <option key={d.id} value={d.id}>{d.title}{d.username ? ` (@${d.username})` : ""}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Channel" hint="An @username, a t.me link or a numeric ID."><Input value={f.channel_identifier} onChange={(e) => setF({ ...f, channel_identifier: e.target.value })} placeholder="@MoviesChannel" /></Field>
        <Field label="Display name" hint="Optional."><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quality">
            <Select value={f.quality_filter} onChange={(e) => setF({ ...f, quality_filter: e.target.value })}>
              <option value="all">Any</option><option value="1080p">1080p only</option><option value="4k">4K only</option>
            </Select>
          </Field>
          <Field label="Smallest file (MB)" hint="Skips trailers and samples."><Input type="number" min={0} value={f.min_file_size_mb} onChange={(e) => setF({ ...f, min_file_size_mb: Number(e.target.value) })} /></Field>
        </div>
      </div>
    </Drawer>
  );
}

function BackfillModal({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const toast = useToast();
  const [limit, setLimit] = useState(50);
  const run = useAct(() => api<any>(`/api/crawler/targets/${target!.id}/backfill`, { body: { limit } }), [["targets"], ["library-raw"], ["crawler-logs"]], (r) => {
    toast.ok(`Looked at ${r.scanned ?? 0} posts and saved ${r.ingested ?? 0} new files.`);
    onClose();
  });
  return (
    <Modal open={!!target} onClose={onClose} title={`Backfill ${target?.title || ""}`} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>Start</Button>
    </>}>
      <p className="mb-3">Go back through older posts in this channel and save any files that match your rules.</p>
      <Field label="How many recent posts">
        <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[20, 50, 100].map((n) => <option key={n} value={n}>{n} posts</option>)}
        </Select>
      </Field>
    </Modal>
  );
}
