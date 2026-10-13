import React, { useEffect, useState } from "react";
import { Database, HardDrive, KeyRound, LogOut, Radio, Smartphone } from "lucide-react";
import { api, useAct, useGet } from "../lib";
import { Badge, Button, Card, CopyText, Field, Input, Notice, PageHeader, Skeleton, Textarea } from "../ui/kit";
import { useConfirm, useToast } from "../ui/overlay";

export default function Connections() {
  return (
    <div className="space-y-6">
      <PageHeader title="Connections" description="The accounts and storage BusiMovie runs on. Everything here should be green." />
      <div className="grid gap-4 lg:grid-cols-2">
        <BotDelivery />
        <Database_ />
      </div>
      <Userbot />
      <Vaults />
      <Rebuild />
    </div>
  );
}

function Database_() {
  const s = useGet<any>(["status"], "/api/status", { every: 30000 });
  const d = s.data?.database;
  return (
    <Card title="Database" actions={d ? <Badge tone={d.persistent ? "ok" : "warn"} dot>{d.persistent ? "Permanent" : "Temporary"}</Badge> : undefined}>
      {!d ? <Skeleton className="h-20" /> : (
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-3"><Database className="h-4 w-4 text-zinc-500" /><span className="text-zinc-300">{d.kind === "turso" ? "Turso (hosted SQLite)" : "Local SQLite file"}</span></div>
          {d.host && <CopyText text={d.host} className="text-zinc-400" />}
          {!d.persistent && (
            <Notice tone="warn" title="Data is lost when the server restarts">
              Create a free database at turso.tech, then add <code className="text-zinc-200">TURSO_DATABASE_URL</code> and <code className="text-zinc-200">TURSO_AUTH_TOKEN</code> to your Secrets.
            </Notice>
          )}
        </div>
      )}
    </Card>
  );
}

function BotDelivery() {
  const q = useGet<any>(["webhook"], "/api/telegram/webhook-status", { every: 20000 });
  const toast = useToast();
  const [url, setUrl] = useState("");
  useEffect(() => { if (q.data?.detectedAppUrl && !url) setUrl(q.data.detectedAppUrl); }, [q.data?.detectedAppUrl]);
  const set = useAct(() => api("/api/telegram/set-webhook", { body: { url } }), [["webhook"], ["status"]], () => toast.ok("Webhook is live."));
  const unset = useAct(() => api("/api/telegram/delete-webhook", { body: {} }), [["webhook"], ["status"]], () => toast.ok("Switched back to polling."));
  const d = q.data;
  const info = d?.webhookInfo;
  const mode = d?.mode === "webhook" ? "Webhook" : d?.mode === "polling" ? "Polling" : "Off";
  return (
    <Card title="Telegram bot" actions={d ? <Badge tone={d.active ? "ok" : "bad"} dot>{d.active ? `Online · ${mode}` : "Offline"}</Badge> : undefined}>
      {!d ? <Skeleton className="h-28" /> : d.mode === "disabled" ? (
        <Notice tone="bad" title="No bot token">Add <code className="text-zinc-200">TELEGRAM_BOT_TOKEN</code> to your Secrets.</Notice>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-zinc-500">
            While you're building, the bot polls Telegram. Once the app is published at a public address, switch to a webhook so Telegram pushes updates to it.
          </p>
          {info?.last_error_message && <Notice tone="warn" title="Telegram reported a problem">{info.last_error_message}</Notice>}
          <Field label="Public address">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.run.app" className="font-mono text-xs" />
          </Field>
          {info?.url && <div className="text-xs text-zinc-500">Registered: <span className="font-mono text-zinc-400">{info.url}</span>{info.pending_update_count ? ` · ${info.pending_update_count} waiting` : ""}</div>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Radio className="h-3.5 w-3.5" />} disabled={!url.startsWith("http")} loading={set.isPending} onClick={() => set.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>Use webhook</Button>
            <Button loading={unset.isPending} onClick={() => unset.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>Switch to polling</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Userbot() {
  const q = useGet<any>(["crawler-status"], "/api/crawler/status", { every: 8000 });
  const toast = useToast();
  const confirm = useConfirm();
  const aux = q.data?.auxiliarySession;
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [session, setSession] = useState("");
  const inv = [["crawler-status"], ["status"]];
  const err = (e: Error) => toast.err(e.message);

  const reqCode = useAct(() => api("/api/crawler/session/request-code", { body: { phone } }), inv, () => toast.ok("Code sent. Check Telegram on that phone."));
  const verify = useAct(() => api("/api/crawler/session/verify-code", { body: { code, password: pw || undefined } }), inv, () => { toast.ok("Signed in."); setCode(""); setPw(""); });
  const disc = useAct(() => api("/api/crawler/session/disconnect", { body: {} }), inv, () => toast.ok("Signed out."));
  const save = useAct(() => api("/api/crawler/session/save-session", { body: { session } }), inv, () => { toast.ok("Session saved."); setSession(""); });

  const signOut = async () => {
    if (await confirm({ title: "Sign the userbot out?", body: "The crawler will stop working until you sign in again.", confirmLabel: "Sign out", danger: true })) disc.mutate(undefined as never, { onError: err });
  };

  return (
    <Card title="Userbot account" description="A real Telegram account the crawler uses to talk to external bots and copy files into your vault." actions={aux ? <Badge tone={aux.connected ? "ok" : "warn"} dot>{aux.connected ? "Signed in" : "Not signed in"}</Badge> : undefined}>
      {!aux ? <Skeleton className="h-24" /> : aux.connected ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ember text-sm font-bold text-white">{(aux.firstName || aux.username || "?").slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white">{aux.firstName || "Connected"}{aux.username ? <span className="ml-2 font-normal text-zinc-500">@{aux.username}</span> : null}</div>
            {aux.phone && <div className="text-xs text-zinc-500">{aux.phone}</div>}
          </div>
          <Button variant="danger" icon={<LogOut className="h-3.5 w-3.5" />} onClick={signOut}>Sign out</Button>
        </div>
      ) : !aux.apiIdConfigured || !aux.apiHashConfigured ? (
        <Notice tone="warn" title="API credentials missing">Get an API ID and hash at my.telegram.org, then add <code className="text-zinc-200">TELEGRAM_API_ID</code> and <code className="text-zinc-200">TELEGRAM_API_HASH</code> to your Secrets.</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-200"><Smartphone className="h-4 w-4 text-zinc-500" /> Sign in with a code</div>
            {!aux.hasPendingCode ? (
              <>
                <Field label="Phone number" hint="With country code."><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 24 000 0000" inputMode="tel" /></Field>
                <Button variant="primary" disabled={phone.trim().length < 6} loading={reqCode.isPending} onClick={() => reqCode.mutate(undefined as never, { onError: err })}>Send code</Button>
              </>
            ) : (
              <>
                <Notice tone="info">A code was sent to {aux.pendingPhone}.</Notice>
                <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="tracking-[0.3em]" /></Field>
                <Field label="Two-step password" hint="Only if your account has one."><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
                <Button variant="primary" disabled={code.trim().length < 4} loading={verify.isPending} onClick={() => verify.mutate(undefined as never, { onError: err })}>Verify</Button>
              </>
            )}
          </div>
          <div className="space-y-4 lg:border-l lg:border-line lg:pl-6">
            <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-200"><KeyRound className="h-4 w-4 text-zinc-500" /> Or paste a session string</div>
            <Field label="Session string" hint="Stored in the database. Better still, set TELEGRAM_USER_SESSION as a secret.">
              <Textarea rows={4} value={session} onChange={(e) => setSession(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Button disabled={session.trim().length < 20} loading={save.isPending} onClick={() => save.mutate(undefined as never, { onError: err })}>Save session</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Vaults() {
  const q = useGet<any>(["crawler-status"], "/api/crawler/status", { every: 30000 });
  const toast = useToast();
  const aux = q.data?.auxiliarySession;
  const [movies, setMovies] = useState("");
  const [series, setSeries] = useState("");
  useEffect(() => {
    if (aux) { setMovies(aux.vaultChannelId || ""); setSeries(aux.seriesVaultChannelId || ""); }
  }, [aux?.vaultChannelId, aux?.seriesVaultChannelId]);
  const saveM = useAct(() => api("/api/crawler/vault-channel", { body: { channel_id: movies } }), [["crawler-status"]], () => toast.ok("Movies vault saved."));
  const saveS = useAct(() => api("/api/crawler/series-vault-channel", { body: { channel_id: series } }), [["crawler-status"]], () => toast.ok("Series vault saved."));
  const err = (e: Error) => toast.err(e.message);
  return (
    <Card title="Vault channels" description="Private channels where files are stored. The userbot must be a member, and the bot must be an admin there to deliver." actions={<HardDrive className="h-4 w-4 text-zinc-600" />}>
      {!aux ? <Skeleton className="h-20" /> : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Field label="Movies vault" hint="Numeric ID, usually starting with -100."><Input value={movies} onChange={(e) => setMovies(e.target.value)} className="font-mono text-xs" /></Field>
            <Button loading={saveM.isPending} disabled={!movies.trim() || movies === aux.vaultChannelId} onClick={() => saveM.mutate(undefined as never, { onError: err })}>Save</Button>
          </div>
          <div className="space-y-2">
            <Field label="Series vault" hint="Numeric ID, usually starting with -100."><Input value={series} onChange={(e) => setSeries(e.target.value)} className="font-mono text-xs" /></Field>
            <Button loading={saveS.isPending} disabled={!series.trim() || series === aux.seriesVaultChannelId} onClick={() => saveS.mutate(undefined as never, { onError: err })}>Save</Button>
          </div>
        </div>
      )}
    </Card>
  );
}



function Rebuild() {
  const toast = useToast();
  const q = useGet<any>(["rebuild"], "/api/library/rebuild", { every: 3000 });
  const start = useAct(() => api("/api/library/rebuild", { body: {} }), [["rebuild"]], () => toast.ok("Rebuild started."));
  const s = q.data;
  const reasons = s ? Object.entries(s.skippedReasons || {}) as Array<[string, number]> : [];
  return (
    <Card title="Rebuild library from vault" description="If you ever lose the database or move to a new one, your files are still in the vault channels. This reads them again and re-indexes every film and episode. Files already indexed are skipped, and followers aren't notified.">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={start.isPending || !!s?.running} onClick={() => start.mutate(undefined as never, { onError: (e: Error) => toast.err(e.message) })}>{s?.running ? "Rebuilding…" : "Rebuild now"}</Button>
        {s && s.startedAt && (
          <span className="text-xs text-zinc-400">
            {s.running ? "Reading the vault: " : s.error ? "Stopped: " : "Last run: "}
            {s.scanned} messages read · <span className="text-emerald-300">{s.added} added</span> · {s.already} already there · {s.skipped} skipped
          </span>
        )}
      </div>
      {s?.error && <p className="mt-2 text-xs text-rose-300">{s.error}</p>}
      {!s?.running && reasons.length > 0 && <p className="mt-2 text-xs text-zinc-500">Skipped because: {reasons.slice(0, 4).map(([r, n]) => `${r} (${n})`).join(" · ")}</p>}
    </Card>
  );
}
