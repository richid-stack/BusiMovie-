import React, { useState } from "react";
import { Ban, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { api, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, Field, Input, Notice, PageHeader, Skeleton, Stat } from "../ui/kit";
import { useConfirm, useToast } from "../ui/overlay";

interface SafetyData {
  cap: number;
  stats: { deliveriesToday: number; top: Array<{ telegram_id: string; n: number; username: string | null; first_name: string | null }> };
  bans: Array<{ telegram_id: string; reason: string | null; banned_at: string; username: string | null; first_name: string | null }>;
  blocks: Array<{ id: number; kind: "file" | "title"; file_name: string | null; title: string | null; year: string | null; reason: string | null; created_at: string }>;
}
const who = (u: { username: string | null; first_name: string | null; telegram_id: string }) => (u.username ? `@${u.username}` : u.first_name || u.telegram_id);

export default function Safety() {
  const toast = useToast();
  const confirm = useConfirm();
  const data = useGet<SafetyData>(["safety"], "/api/safety", { every: 20000 });
  const inv = [["safety"]];
  const err = (e: Error) => toast.err(e.message);
  const d = data.data;

  const [cap, setCap] = useState<string>("");
  React.useEffect(() => { if (d) setCap(String(d.cap)); }, [d?.cap]);
  const saveCap = useAct((n: number) => api("/api/safety/cap", { method: "PUT", body: { cap: n } }), inv);

  const [banWho, setBanWho] = useState(""), [banWhy, setBanWhy] = useState("");
  const ban = useAct((b: any) => api("/api/safety/bans", { body: b }), inv, () => { setBanWho(""); setBanWhy(""); toast.ok("Banned."); });
  const unban = useAct((id: string) => api(`/api/safety/bans/${id}`, { method: "DELETE" }), inv, () => toast.ok("They can use the bot again."));

  const [title, setTitle] = useState(""), [year, setYear] = useState(""), [why, setWhy] = useState("");
  const takedown = useAct((b: any) => api<any>("/api/safety/takedown", { body: b }), inv, (r) => {
    setTitle(""); setYear(""); setWhy("");
    toast.ok(`Taken down: ${r.removedFiles} file${r.removedFiles === 1 ? "" : "s"} removed${r.vaultErrors ? `, ${r.vaultErrors} vault cop${r.vaultErrors === 1 ? "y" : "ies"} could not be deleted` : ""}.`);
  });
  const unblock = useAct((id: number) => api(`/api/safety/blocks/${id}`, { method: "DELETE" }), inv, () => toast.ok("Removed from the blocklist."));

  return (
    <div className="space-y-6">
      <PageHeader title="Safety" description="Take a title down for good, keep bad actors out, and limit how much one viewer can pull in a day." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Files sent today" value={d?.stats.deliveriesToday ?? 0} loading={!d} hint={d?.cap ? "counted while a limit is set" : "counted once you set a limit"} />
        <Stat label="Banned viewers" value={d?.bans.length ?? 0} loading={!d} />
        <Stat label="Blocked titles" value={d?.blocks.filter((b) => b.kind === "title").length ?? 0} loading={!d} />
        <Stat label="Blocked files" value={d?.blocks.filter((b) => b.kind === "file").length ?? 0} loading={!d} hint="reported or removed copies" />
      </div>

      <Card title="Take a title down" description="Deletes every file of it (including the copies in your vault channel), cancels its queued jobs and blocks it from ever being fetched or crawled again.">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (title.trim().length < 2) return;
          if (await confirm({ title: `Take down “${title.trim()}${year.trim() ? ` (${year.trim()})` : ""}”?`, body: "Every file of it is deleted and it won't be fetched again. You can lift the block below, but deleted files are gone.", confirmLabel: "Take it down", danger: true }))
            takedown.mutate({ title, year, reason: why }, { onError: err });
        }}>
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Exactly as it appears in the library" /></Field>
            <Field label="Year" hint="Optional"><Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2019" inputMode="numeric" /></Field>
          </div>
          <Field label="Reason" hint="Only you see this."><Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. copyright request from …" /></Field>
          <Button type="submit" variant="danger" icon={<ShieldAlert className="h-4 w-4" />} loading={takedown.isPending} disabled={title.trim().length < 2}>Take down</Button>
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Daily limit" description={d?.cap ? `Each viewer can get ${d.cap} file${d.cap === 1 ? "" : "s"} a day. Admins are never limited.` : "No limit. Set a number to cap how many files one viewer can get per day (resets at midnight UTC)."}>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(cap); if (Number.isFinite(n) && n >= 0) saveCap.mutate(n, { onSuccess: () => toast.ok(n ? `Limit set to ${n} a day.` : "Limit removed."), onError: err }); }}>
            <Field label="Files per viewer per day" hint="0 = no limit" className="flex-1"><Input value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="0" /></Field>
            <Button type="submit" variant="primary" loading={saveCap.isPending} disabled={!d || cap === String(d.cap)}>Save</Button>
          </form>
          {d && d.stats.top.length > 0 && d.cap > 0 && (
            <div className="mt-4 space-y-1 text-xs text-zinc-400">
              <div className="text-zinc-500">Most files today</div>
              {d.stats.top.map((t) => <div key={t.telegram_id} className="flex justify-between"><span>{who(t)}</span><span className="tabular-nums">{t.n}</span></div>)}
            </div>
          )}
        </Card>

        <Card title="Ban a viewer" description="A banned viewer gets nothing from the bot.">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (banWho.trim()) ban.mutate({ who: banWho, reason: banWhy }, { onError: err }); }}>
            <Field label="Telegram id or @username" hint="@usernames work for people who have used the bot."><Input value={banWho} onChange={(e) => setBanWho(e.target.value)} placeholder="123456789 or @name" /></Field>
            <Field label="Reason" hint="Optional, only you see it."><Input value={banWhy} onChange={(e) => setBanWhy(e.target.value)} /></Field>
            <Button type="submit" variant="danger" icon={<Ban className="h-4 w-4" />} loading={ban.isPending} disabled={!banWho.trim()}>Ban</Button>
          </form>
        </Card>
      </div>

      <Card title="Banned viewers" flush>
        {!d ? <div className="p-4"><Skeleton className="h-16" /></div> : d.bans.length === 0 ? <Empty title="Nobody is banned" /> : (
          <ul className="divide-y divide-line/70">
            {d.bans.map((b) => (
              <li key={b.telegram_id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><div className="truncate font-medium text-white">{who(b)}</div><div className="truncate text-xs text-zinc-500">{b.telegram_id}{b.reason ? ` · ${b.reason}` : ""}</div></div>
                <Button size="sm" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => unban.mutate(b.telegram_id, { onError: err })}>Unban</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Blocklist" description="Titles and exact files the library will never take in again. Reported wrong files land here automatically." flush>
        {!d ? <div className="p-4"><Skeleton className="h-16" /></div> : d.blocks.length === 0 ? <Empty title="Nothing is blocked" body="Taken-down titles and reported bad files show up here." /> : (
          <ul className="divide-y divide-line/70">
            {d.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <Badge tone={b.kind === "title" ? "bad" : "warn"}>{b.kind === "title" ? "Title" : "File"}</Badge>
                <div className="min-w-0 flex-1"><div className="truncate text-sm text-white">{b.kind === "title" ? `${b.title}${b.year ? ` (${b.year})` : ""}` : b.file_name}</div><div className="truncate text-xs text-zinc-500">{b.reason || "no reason noted"} · {String(b.created_at).slice(0, 10)}</div></div>
                <Button size="sm" variant="ghost" aria-label="Lift block" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => unblock.mutate(b.id, { onError: err })}>Lift</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Notice tone="info" title="What a takedown can and can't do">
        It removes the title from this library and your vault channel and stops it coming back through bots or source channels. It can't recall files viewers already received in their own chats, and the source bots and channels keep whatever they host.
      </Notice>
    </div>
  );
}
