import React, { useState } from "react";
import { CalendarClock, Megaphone, Sparkles } from "lucide-react";
import { api, useAct, useGet } from "../lib";
import { Badge, Button, Card, Notice, PageHeader, Textarea, Toggle } from "../ui/kit";
import { useConfirm, useToast } from "../ui/overlay";

export default function Messaging() {
  const status = useGet<any>(["status"], "/api/status");
  const toast = useToast();
  const confirm = useConfirm();
  const [msg, setMsg] = useState("");
  const users = status.data?.stats?.users;
  const live = status.data?.botRunning;

  const broadcast = useAct(() => api<any>("/api/admin/broadcast", { body: { message: msg } }), [], (r) => {
    toast.ok(`Delivered to ${r.sent} of ${r.total} viewers${r.failed ? ` (${r.failed} couldn't be reached)` : ""}.`);
    setMsg("");
  });
  const spotlight = useAct(() => api<any>("/api/bot/trigger-followup", { body: {} }), [], (r) =>
    r.total ? toast.ok(`Sent “${r.title}” to ${r.sent} of ${r.total} viewers.`) : toast.info("No viewers yet.")
  );
  const err = (e: Error) => toast.err(e.message);

  const send = async () => {
    if (await confirm({ title: `Send to ${users ?? "all"} viewers?`, body: "This goes out immediately and can't be recalled.", confirmLabel: "Send now" })) broadcast.mutate(undefined as never, { onError: err });
  };
  const spot = async () => {
    if (await confirm({ title: "Send the spotlight?", body: "Picks a title from your library and sends it to every viewer.", confirmLabel: "Send spotlight" })) spotlight.mutate(undefined as never, { onError: err });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Messaging" description="Reach everyone who has started the bot." />
      {status.data && !live && <Notice tone="bad" title="The bot is offline">Messages can't be sent until it's running.</Notice>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Announcement" description="Plain text. Short messages get read." actions={<Megaphone className="h-4 w-4 text-zinc-600" />}>
          <Textarea rows={6} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="New this week: the full season of…" maxLength={3500} />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs tabular-nums text-zinc-600">{msg.length}/3500</span>
            <Button variant="primary" disabled={!msg.trim() || !live} loading={broadcast.isPending} onClick={send}>Send to {users ?? "all"} viewers</Button>
          </div>
        </Card>
        <Card className="lg:col-span-2" title="Spotlight" description="Pick something from the library and recommend it to everyone." actions={<Sparkles className="h-4 w-4 text-zinc-600" />}>
          <p className="mb-4 text-[13px] text-zinc-500">One tap. BusiMovie chooses a title, writes the blurb and sends it with a watch button.</p>
          <Button disabled={!live} loading={spotlight.isPending} onClick={spot}>Send a spotlight</Button>
        </Card>
      </div>
      <Digest live={!!live} />
    </div>
  );
}

function Digest({ live }: { live: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const q = useGet<any>(["digest"], "/api/digest");
  const set = useAct((enabled: boolean) => api("/api/digest", { method: "PUT", body: { enabled } }), [["digest"]]);
  const send = useAct(() => api<any>("/api/digest/send", { body: {} }), [["digest"]], (r) => toast.ok(r.skipped || `Sent to ${r.sent} of ${r.total} viewers.`));
  const d = q.data;
  const preview = d?.preview ? String(d.preview.text).replace(/<\/?b>/g, "").replace(/<[^>]*>/g, "") : "";
  return (
    <Card title="Weekly “new this week”" description="A short list of what was added in the last 7 days, sent once a week (Friday evening, UTC). Every message has a button to stop them." actions={d ? <Toggle checked={d.enabled} label="Weekly digest" onChange={(v) => set.mutate(v, { onSuccess: () => toast.ok(v ? "Weekly digest is on." : "Weekly digest is off."), onError: (e: Error) => toast.err(e.message) })} /> : <CalendarClock className="h-4 w-4 text-zinc-600" />}>
      {d && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Badge tone={d.enabled ? "ok" : "neutral"} dot>{d.enabled ? "On" : "Off"}</Badge>
            <span>{d.optouts} opted out</span>
            <span>· {d.lastSentAt ? `last sent ${new Date(d.lastSentAt).toLocaleDateString()}` : "never sent"}</span>
          </div>
          {preview ? <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2/50 p-3 font-sans text-[13px] text-zinc-300">{preview}</pre> : <p className="text-[13px] text-zinc-500">Nothing new in the last 7 days, so nothing would be sent.</p>}
          <Button disabled={!live || !preview} loading={send.isPending} onClick={async () => { if (await confirm({ title: "Send the digest now?", body: "It goes to every viewer who hasn't opted out.", confirmLabel: "Send now" })) send.mutate(undefined as never, { onError: (e: Error) => toast.err(e.message) }); }}>Send now</Button>
        </div>
      )}
    </Card>
  );
}
