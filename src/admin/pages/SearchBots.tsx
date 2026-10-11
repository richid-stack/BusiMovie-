import React, { useState } from "react";
import { FlaskConical, Pencil, Plus, Radar, Send, Trash2 } from "lucide-react";
import { api, timeAgo, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, Field, IconButton, Input, Notice, PageHeader, Segmented, Select, Skeleton, Toggle } from "../ui/kit";
import { Drawer, useConfirm, useToast } from "../ui/overlay";

interface Bot {
  id: number; bot_username: string; bot_type: "inline" | "command"; command_template: string;
  status: "active" | "degraded" | "inactive"; priority: number; success_count: number; last_queried_at: string | null;
  scope?: "movie" | "series" | "both";
}
const SCOPE = { movie: "Movies", series: "Series", both: "Movies & series" } as const;

export default function SearchBots() {
  const q = useGet<Bot[]>(["bots"], "/api/crawler/bots", { every: 20000 });
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<Bot | "new" | null>(null);
  const [test, setTest] = useState<Bot | null>(null);

  const toggle = useAct((b: Bot) => api(`/api/crawler/bots/${b.id}`, { method: "PUT", body: { status: b.status === "active" ? "inactive" : "active" } }), [["bots"]]);
  const del = useAct((id: number) => api(`/api/crawler/bots/${id}`, { method: "DELETE" }), [["bots"]], () => toast.ok("Bot removed."));

  const remove = async (b: Bot) => {
    if (await confirm({ title: `Remove ${b.bot_username}?`, body: "The crawler will stop using it. You can add it back any time.", confirmLabel: "Remove", danger: true }))
      del.mutate(b.id, { onError: (e) => toast.err(e.message) });
  };
  const bots = q.data || [];

  return (
    <div>
      <PageHeader
        title="Search bots"
        description="External Telegram bots the crawler asks for files. It reads each bot's screens and clicks through on its own; tries them in priority order, then falls back to the next."
        actions={<Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEdit("new")}>Add bot</Button>}
      />
      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : bots.length === 0 ? (
        <Card><Empty icon={<Radar className="h-5 w-5" />} title="No search bots yet" body="Add the bots you use to find movies and series. Series fall back to @quinsonnbot until you add one." action={<Button variant="primary" onClick={() => setEdit("new")}>Add your first bot</Button>} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {bots.map((b) => (
            <Card key={b.id} className={b.status === "inactive" ? "opacity-60" : ""}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-sm font-semibold text-white">{b.bot_username}</span>
                    <Badge tone={b.status === "active" ? "ok" : b.status === "degraded" ? "warn" : "neutral"} dot>{b.status === "active" ? "Active" : b.status === "degraded" ? "Struggling" : "Off"}</Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>{SCOPE[b.scope || "movie"]}</span>
                    <span>Priority {b.priority}</span>
                    <span>{b.success_count} delivered</span>
                    <span>Last used {timeAgo(b.last_queried_at)}</span>
                  </div>
                  <code className="mt-2 block truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-[11px] text-zinc-400">{b.command_template}</code>
                </div>
                <Toggle checked={b.status === "active"} onChange={() => toggle.mutate(b, { onError: (e) => toast.err(e.message) })} label={`Enable ${b.bot_username}`} />
              </div>
              <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3">
                <Button size="sm" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setTest(b)}>Test</Button>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(b)}>Edit</Button>
                <IconButton label="Remove" className="ml-auto" onClick={() => remove(b)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}
      <BotForm bot={edit} onClose={() => setEdit(null)} />
      <Playground bot={test} onClose={() => setTest(null)} />
    </div>
  );
}

function BotForm({ bot, onClose }: { bot: Bot | "new" | null; onClose: () => void }) {
  const toast = useToast();
  const isNew = bot === "new";
  const base = { bot_username: "", bot_type: "command" as "command" | "inline", command_template: "{query}", priority: 1, scope: "movie" as "movie" | "series" | "both" };
  const [f, setF] = useState(base);
  React.useEffect(() => {
    if (bot === "new") setF(base);
    else if (bot) setF({ bot_username: bot.bot_username, bot_type: bot.bot_type, command_template: bot.command_template, priority: bot.priority, scope: bot.scope || "movie" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot]);
  const save = useAct(
    () => (isNew ? api("/api/crawler/bots", { body: f }) : api(`/api/crawler/bots/${(bot as Bot).id}`, { method: "PUT", body: f })),
    [["bots"]],
    () => { toast.ok(isNew ? "Bot added." : "Bot updated."); onClose(); }
  );
  const valid = f.bot_username.trim().length > 2;
  return (
    <Drawer
      open={!!bot}
      onClose={onClose}
      title={isNew ? "Add a search bot" : "Edit search bot"}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>{isNew ? "Add bot" : "Save"}</Button>
      </>}
    >
      <div className="space-y-5">
        <Field label="Bot username" hint="With or without the @."><Input value={f.bot_username} onChange={(e) => setF({ ...f, bot_username: e.target.value })} placeholder="@SomeMovieBot" autoFocus /></Field>
        <Field label="What it serves">
          <Segmented value={f.scope} onChange={(scope) => setF({ ...f, scope })} options={[{ value: "movie", label: "Movies" }, { value: "series", label: "Series" }, { value: "both", label: "Both" }]} />
        </Field>
        <Field label="How you ask it" hint="Use {query} where the title goes. Most bots just want the title.">
          <Input value={f.command_template} onChange={(e) => setF({ ...f, command_template: e.target.value })} className="font-mono" placeholder="{query}" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={f.bot_type} onChange={(e) => setF({ ...f, bot_type: e.target.value as any })}>
              <option value="command">Chat bot</option>
              <option value="inline">Inline bot</option>
            </Select>
          </Field>
          <Field label="Priority" hint="Lower goes first."><Input type="number" min={1} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) || 1 })} /></Field>
        </div>
      </div>
    </Drawer>
  );
}

function Playground({ bot, onClose }: { bot: Bot | null; onClose: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [res, setRes] = useState<any>(null);
  const [sent, setSent] = useState<number | null>(null);
  React.useEffect(() => { setRes(null); setQuery(""); setSent(null); }, [bot]);

  const run = useAct(() => api("/api/crawler/bots/test-query", { body: { bot_username: bot!.bot_username, query } }), [], setRes);
  const fwd = useAct((i: number) => api<any>("/api/crawler/bots/forward", { body: { bot_username: res.bot, message_id: res.messageId, button_row: res.buttons[i].row, button_col: res.buttons[i].col } }), [["library-raw"]]);

  const press = async (i: number) => {
    setSent(i);
    try {
      const r = await fwd.mutateAsync(i);
      r.success ? toast.ok(r.message || "Saved to the vault.") : toast.info(r.message || "The bot didn't send a file.");
    } catch (e: any) { toast.err(e.message); } finally { setSent(null); }
  };

  return (
    <Drawer open={!!bot} onClose={onClose} title="Test a bot" subtitle={bot?.bot_username}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) run.mutate(undefined as never, { onError: (er) => toast.err(er.message) }); }}>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A title to search for" autoFocus />
        <Button variant="primary" type="submit" loading={run.isPending} disabled={!query.trim()}>Ask</Button>
      </form>
      <p className="mt-2 text-xs text-zinc-500">Sends your text to the bot exactly as a viewer's request would, then shows what it replied.</p>

      {res && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone={res.found ? "ok" : "warn"} dot>{res.found ? "Bot replied" : "No reply"}</Badge>
            {res.duration_ms !== undefined && <span className="text-xs tabular-nums text-zinc-500">{res.duration_ms} ms</span>}
          </div>
          {res.error && <Notice tone="bad">{res.error}</Notice>}
          {res.replyText && <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 p-3.5 font-sans text-[13px] leading-relaxed text-zinc-300">{res.replyText}</pre>}
          {res.buttons?.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-zinc-400">Buttons on the reply · press one to save its file</div>
              <div className="flex flex-wrap gap-1.5">
                {res.buttons.map((b: any, i: number) => (
                  <Button key={i} size="sm" disabled={!!b.url} loading={sent === i} icon={<Send className="h-3 w-3" />} onClick={() => press(i)} title={b.url ? "This button opens a link" : undefined}>{b.text}</Button>
                ))}
              </div>
            </div>
          )}
          {!res.buttons?.length && res.hasDirectMedia && <Notice tone="ok">The bot sent a file directly.</Notice>}
        </div>
      )}
    </Drawer>
  );
}
