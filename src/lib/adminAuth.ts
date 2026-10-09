/**
 * Client-side admin session helper.
 * - Stores the signed token (returned by /api/auth/*) in localStorage so it also works inside iframes
 *   (e.g. the AI Studio preview) where third-party cookies are blocked.
 * - Patches window.fetch ONCE so every same-origin /api/* request carries `Authorization: Bearer <token>`,
 *   and announces a 401 so the UI can show the login screen again.
 */
const KEY = "bm_admin_token";

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

let installed = false;
export function installAuthFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : (input as Request).url;
    const isApi = url.startsWith("/api/") || url.includes(`${window.location.origin}/api/`);
    let nextInit = init;
    const token = getAdminToken();
    if (isApi && token) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      nextInit = { ...init, headers };
    }
    const res = await original(input as any, nextInit);
    if (isApi && res.status === 401 && token && !url.includes("/api/auth/")) {
      setAdminToken(null);
      window.dispatchEvent(new Event("bm-auth-expired"));
    }
    return res;
  };
}

export async function loginWithPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "Login failed" };
    setAdminToken(data.token);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: "Could not reach the server" };
  }
}

export async function loginWithTelegram(user: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "Telegram login failed" };
    setAdminToken(data.token);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

export async function loginWithWebApp(initData: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/webapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    setAdminToken(data.token);
    return true;
  } catch {
    return false;
  }
}

export async function checkSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  setAdminToken(null);
  window.dispatchEvent(new Event("bm-auth-expired"));
}
