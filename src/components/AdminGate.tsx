import React, { useCallback, useEffect, useRef, useState } from "react";
import GrainGradient from "./GrainGradient";
import Wordmark from "./Wordmark";
import { checkSession, loginWithPassword, loginWithTelegram, loginWithWebApp, logout } from "../lib/adminAuth";

interface AuthConfig {
  telegramEnabled: boolean;
  telegramBotUsername: string | null;
  passwordGenerated: boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void } };
    onBusiTelegramAuth?: (user: Record<string, any>) => void;
  }
}

/** Shows a login screen until the visitor has a valid admin session. */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "ok">("checking");
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tgRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (await checkSession()) {
      setState("ok");
      return;
    }
    // Opened as a Telegram Mini App by an admin? Log in automatically.
    const initData = window.Telegram?.WebApp?.initData;
    if (initData && (await loginWithWebApp(initData))) {
      setState("ok");
      return;
    }
    setState("login");
  }, []);

  useEffect(() => {
    refresh();
    const onExpired = () => setState("login");
    window.addEventListener("bm-auth-expired", onExpired);
    return () => window.removeEventListener("bm-auth-expired", onExpired);
  }, [refresh]);

  useEffect(() => {
    if (state !== "login") return;
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [state]);

  // Telegram Login Widget
  useEffect(() => {
    if (state !== "login" || !config?.telegramEnabled || !config.telegramBotUsername || !tgRef.current) return;
    window.onBusiTelegramAuth = async (user) => {
      setBusy(true);
      setError(null);
      const r = await loginWithTelegram(user);
      setBusy(false);
      if (r.ok) setState("ok");
      else setError(r.error || "Telegram login failed");
    };
    const host = tgRef.current;
    host.innerHTML = "";
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", config.telegramBotUsername);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "12");
    s.setAttribute("data-onauth", "onBusiTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    host.appendChild(s);
  }, [state, config]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    const r = await loginWithPassword(password);
    setBusy(false);
    if (r.ok) {
      setPassword("");
      setState("ok");
    } else {
      setError(r.error || "Login failed");
    }
  };

  if (state === "checking") {
    return <div className="min-h-screen bg-ink" aria-busy="true" />;
  }

  if (state === "ok") {
    return (
      <>
        <button
          onClick={() => logout()}
          className="fixed left-4 bottom-4 z-[9999] rounded-full border border-line bg-surface-1/80 px-3 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur transition hover:text-white"
        >
          Sign out
        </button>
        {children}
      </>
    );
  }

  return (
    <GrainGradient className="min-h-screen" seed={11}>
      <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
        <div className="bm-rise mb-8">
          <Wordmark size={40} mono className="text-white" />
        </div>
        <form
          onSubmit={submit}
          className="bm-rise w-full max-w-sm rounded-3xl border border-white/15 bg-ink/80 p-6 shadow-2xl backdrop-blur-xl"
          style={{ animationDelay: "0.08s" }}
        >
          <h1 className="font-display text-xl font-bold text-white">Admin console</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in to manage the catalog, requests and crawler.</p>

          <label htmlFor="admin-password" className="mt-6 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-white outline-none transition focus:border-ember-red focus:ring-2 focus:ring-ember-red/40"
            placeholder="••••••••"
          />

          {error && (
            <p role="alert" className="mt-3 text-sm text-ember-pink">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="bg-ember mt-5 w-full rounded-xl px-4 py-3 font-display text-sm font-bold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {config?.telegramEnabled && config.telegramBotUsername && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-zinc-500">
                <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
              </div>
              <div ref={tgRef} className="flex justify-center" />
            </>
          )}

          {config?.passwordGenerated && (
            <p className="mt-5 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-zinc-400">
              No <code className="text-zinc-200">ADMIN_PASSWORD</code> secret is set, so a temporary password was printed in
              the server log. Add <code className="text-zinc-200">ADMIN_PASSWORD</code> to your Secrets to make it permanent.
            </p>
          )}
        </form>
      </div>
    </GrainGradient>
  );
}
