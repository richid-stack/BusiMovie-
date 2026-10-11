import React, { useState } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import { api, useAct, useGet } from "../lib";
import { Button, Card, Notice, PageHeader, Textarea } from "../ui/kit";
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
    </div>
  );
}
