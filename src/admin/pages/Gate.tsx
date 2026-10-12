import React, { useState } from "react";
import { Lock, Megaphone, MessagesSquare, Plus, RadioTower, ShieldCheck, Trash2 } from "lucide-react";
import { api, useAct, useGet } from "../lib";
import { Badge, Button, Card, CopyText, Empty, Field, Input, Notice, PageHeader, Select, Skeleton, Stat, Toggle, cx, type Tone } from "../ui/kit";
import { useConfirm, useToast } from "../ui/overlay";

interface Channel { id: number; chat_id: string; title: string; username: string | null; link: string | null; kind: "discussion" | "ads" | "general"; mode: "check" | "request"; active: number; members: number }
interface GateData {
  settings: { enabled: boolean; ttlHours: number };
  stats: { prompted: number; joined: number; resumed: number; waiting: number };
  botRunning: boolean; channels: Channel[];
}
interface Test { ok: boolean; problem?: string; isAdmin?: boolean; canInvite?: boolean; needsLink?: boolean; title?: string }

const KIND = { discussion: { label: "Discussion", icon: MessagesSquare }, ads: { label: "Sponsor / ads", icon: Megaphone }, general: { label: "Channel", icon: RadioTower } } as const;

export default function Gate() {
  const toast = useToast();
  const confirm = useConfirm();
  const data = useGet<GateData>(["gate"], "/api/gate", { every: 15000 });
  const inv = [["gate"]];
  const err = (e: Error) => toast.err(e.message);
  const d = data.data;

  const saveSettings = useAct((b: any) => api("/api/gate/settings", { method: "PUT", body: b }), inv);
  const patch = useAct((v: { id: number; body: any }) => api(`/api/gate/channels/${v.id}`, { method: "PUT", body: v.body }), inv);
  const remove = useAct((id: number) => api(`/api/gate/channels/${id}`, { method: "DELETE" }), inv);
  const [tests, setTests] = useState<Record<number, Test | "loading">>({});
  const test = async (id: number) => {
    setTests((t) => ({ ...t, [id]: "loading" }));
    try { const r = await api<Test>(`/api/gate/channels/${id}/test`, { body: {} }); setTests((t) => ({ ...t, [id]: r })); data.refetch(); }
    catch (e: any) { setTests((t) => ({ ...t, [id]: { ok: false, problem: e.message } })); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Required channels" description="Send viewers to your community, discussion group or a sponsor's channel before they get a file. When they join, the file arrives in their chat automatically." />

      {d && !d.botRunning && <Notice tone="bad" title="The Telegram bot is offline">The gate only works while the bot is running.</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Asked to join" value={d?.stats.prompted ?? 0} loading={!d} />
        <Stat label="Joined" value={d?.stats.joined ?? 0} loading={!d} tone="ok" />
        <Stat label="Sent automatically" value={d?.stats.resumed ?? 0} loading={!d} hint="requests completed after joining" />
        <Stat label="Waiting now" value={d?.stats.waiting ?? 0} loading={!d} />
      </div>

      <Card
        title="Ask viewers to join first"
        description={d?.settings.enabled ? "On. Viewers see the join buttons before their file is sent." : "Off. Nothing changes for viewers until you switch this on."}
        actions={d ? <Toggle checked={d.settings.enabled} label="Require channels" onChange={(v) => {
          if (v && !d.channels.some((c) => c.active)) return toast.info("Add at least one channel first.");
          saveSettings.mutate({ enabled: v }, { onSuccess: () => toast.ok(v ? "Viewers will be asked to join." : "Gate switched off."), onError: err });
        }} /> : <Skeleton className="h-5 w-9" />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Check again after" hint="Someone who joined is trusted for this long, so most requests need no extra check.">
            <Select value={d?.settings.ttlHours ?? 24} onChange={(e) => saveSettings.mutate({ ttlHours: Number(e.target.value) }, { onError: err })}>
              {[[1, "1 hour"], [6, "6 hours"], [24, "1 day"], [168, "1 week"]].map(([v, l]) => <option key={v as number} value={v as number}>{l}</option>)}
            </Select>
          </Field>
          <div className="text-xs leading-relaxed text-zinc-500">
            Admins are never asked. A channel the bot can't read never blocks viewers; it's skipped and you get a Telegram message instead.
          </div>
        </div>
      </Card>

      <Card title="Channels" flush>
        {!d ? <div className="p-4"><Skeleton className="h-24" /></div> : d.channels.length === 0 ? (
          <Empty icon={<Lock className="h-5 w-5" />} title="No required channels yet" body="Add your discussion channel or an ad channel below." />
        ) : (
          <ul className="divide-y divide-line/70">
            {d.channels.map((c) => {
              const t = tests[c.id];
              const K = KIND[c.kind];
              const tone: Tone = t && t !== "loading" ? (t.ok ? "ok" : "bad") : "neutral";
              return (
                <li key={c.id} className={cx("space-y-3 px-4 py-3.5", !c.active && "opacity-60")}>
                  <div className="flex flex-wrap items-center gap-3">
                    <K.icon className="h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-white">{c.title}</div>
                      <div className="truncate text-xs text-zinc-500"><CopyText text={c.chat_id}>{c.chat_id}</CopyText>{c.link ? <> · <span className="text-zinc-400">{c.link.replace("https://", "")}</span></> : <span className="text-amber-400"> · no join link yet</span>}</div>
                    </div>
                    <Badge tone="neutral">{c.members} verified</Badge>
                    {t && t !== "loading" && <Badge tone={tone} dot>{t.ok ? "Bot is admin" : "Needs setup"}</Badge>}
                    <Toggle checked={!!c.active} label="Active" onChange={(v) => patch.mutate({ id: c.id, body: { active: v } }, { onError: err })} />
                  </div>
                  {t && t !== "loading" && t.problem && <p className="text-xs text-rose-300">{t.problem}</p>}
                  {t && t !== "loading" && t.ok && t.needsLink && <p className="text-xs text-amber-300">Give the bot the "invite users" permission, or paste a join link below.</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-40"><Select value={c.kind} onChange={(e) => patch.mutate({ id: c.id, body: { kind: e.target.value } }, { onError: err })} aria-label="Type">
                      {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select></div>
                    <div className="w-56"><Select value={c.mode} onChange={(e) => patch.mutate({ id: c.id, body: { mode: e.target.value, invite_link: null } }, { onError: err })} aria-label="Join style">
                      <option value="check">Open join</option>
                      <option value="request">Join request (bot approves)</option>
                    </Select></div>
                    <LinkEditor channel={c} onSave={(link) => patch.mutate({ id: c.id, body: { invite_link: link } }, { onSuccess: () => toast.ok("Link saved."), onError: err })} />
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />} loading={t === "loading"} onClick={() => test(c.id)}>Test</Button>
                      <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={async () => { if (await confirm({ title: `Stop requiring “${c.title}”?`, body: "Viewers will no longer be asked to join it.", confirmLabel: "Remove", danger: true })) remove.mutate(c.id, { onError: err }); }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <AddChannel onAdded={() => data.refetch()} botRunning={!!d?.botRunning} />

      <Notice tone="info" title="How to set a channel up">
        <ol className="list-decimal space-y-1 pl-4">
          <li>Add the bot to your channel or group as an <b>administrator</b> (it only needs “invite users”). That's how it sees who has joined.</li>
          <li>Add the channel here and press <b>Test</b>.</li>
          <li>Switch the gate on. A viewer who taps Watch sees the join buttons; the moment they join, their file is sent to their chat. Telegram doesn't let a bot move someone's screen, so they get the file as a message and the "Thanks for joining" note.</li>
        </ol>
      </Notice>
    </div>
  );
}

function LinkEditor({ channel, onSave }: { channel: Channel; onSave: (link: string | null) => void }) {
  const [v, setV] = useState(channel.link && !channel.username ? channel.link : "");
  React.useEffect(() => setV(channel.link && !channel.username ? channel.link : ""), [channel.link, channel.username]);
  return (
    <div className="flex min-w-[12rem] flex-1 items-center gap-1.5">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={channel.username ? `https://t.me/${channel.username} (default)` : "Join link, https://t.me/+…"} aria-label="Join link" className="h-8 text-xs" />
      <Button size="sm" variant="ghost" disabled={(v || "") === (channel.link && !channel.username ? channel.link : "")} onClick={() => onSave(v.trim() || null)}>Save</Button>
    </div>
  );
}

function AddChannel({ onAdded, botRunning }: { onAdded: () => void; botRunning: boolean }) {
  const toast = useToast();
  const [ref, setRef] = useState("");
  const [kind, setKind] = useState("discussion");
  const [mode, setMode] = useState("check");
  const [link, setLink] = useState("");
  const [mine, setMine] = useState<any[] | null>(null);
  const [loadingMine, setLoadingMine] = useState(false);

  const add = useAct((b: any) => api<any>("/api/gate/channels", { body: b }), [["gate"]], (r) => {
    setRef(""); setLink("");
    if (r.inspection && !r.inspection.ok) toast.info(r.inspection.problem || "Added. Make the bot an admin there, then press Test.");
    else toast.ok("Channel added.");
    onAdded();
  });
  const loadMine = async () => {
    setLoadingMine(true);
    try { setMine(await api<any[]>("/api/crawler/joined-dialogs")); } catch (e: any) { toast.err(e.message); } finally { setLoadingMine(false); }
  };

  return (
    <Card title="Add a channel or group" description="Your discussion channel, community group, or a sponsor's channel.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) add.mutate({ ref, kind, mode, invite_link: link.trim() || null }, { onError: (er: Error) => toast.err(er.message) }); }}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Field label="Channel id or @username"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="@busimovie_chat or -1001234567890" /></Field>
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="Join style"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="check">Open join</option><option value="request">Join request</option></Select></Field>
        </div>
        <Field label="Join link (private channels)" hint="Optional for public @channels. For private ones the bot creates a link itself if it's an admin."><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://t.me/+…" /></Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={!ref.trim()}>Add</Button>
          <Button type="button" variant="ghost" loading={loadingMine} onClick={loadMine}>Pick from channels my userbot is in</Button>
        </div>
      </form>
      {mine && (
        <div className="mt-4 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface-2/50 p-1.5">
          {mine.length === 0 ? <p className="p-3 text-xs text-zinc-500">No channels found. Sign the userbot in under Connections.</p> : mine.map((m) => (
            <button key={m.id} type="button" onClick={() => setRef(m.username ? `@${m.username}` : m.id.startsWith("-") ? m.id : `-100${m.id}`)} className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-white/[.04]">
              <span className="truncate text-zinc-200">{m.title}</span>
              <span className="shrink-0 text-xs text-zinc-500">{m.username ? `@${m.username}` : m.id}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
