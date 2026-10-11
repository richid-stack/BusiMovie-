import crypto from "crypto";
import type { Express, Request, Response, NextFunction } from "express";

/**
 * Admin authentication for BusiMovie.
 *
 * Two ways in (either works):
 *  1. Password login            -> env ADMIN_PASSWORD
 *  2. Telegram login / Mini App -> env ADMIN_TELEGRAM_IDS (comma separated numeric Telegram user ids)
 *
 * A signed session token is issued as an HttpOnly cookie AND returned in the JSON body, so it also works
 * inside iframes (e.g. the AI Studio preview) where third-party cookies are blocked: the client keeps the
 * token and sends it as `Authorization: Bearer <token>`.
 *
 * Secure by default: every /api route needs an admin session unless it is explicitly listed in PUBLIC_ROUTES.
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const COOKIE_NAME = "bm_admin";

let generatedPassword: string | null = null;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  // Derive a stable secret from other secrets so sessions survive restarts without extra config.
  const base = process.env.ADMIN_PASSWORD || process.env.TELEGRAM_BOT_TOKEN || "";
  if (base) return crypto.createHash("sha256").update("bm-session:" + base).digest("hex");
  // Last resort: random per boot (sessions end on restart).
  if (!generatedPassword) generatedPassword = crypto.randomBytes(9).toString("base64url");
  return crypto.createHash("sha256").update("bm-boot:" + generatedPassword).digest("hex");
}

export function getAdminPassword(): string {
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0) return process.env.ADMIN_PASSWORD;
  if (!generatedPassword) {
    generatedPassword = crypto.randomBytes(9).toString("base64url");
    console.warn("================================================================");
    console.warn("[Auth] ADMIN_PASSWORD is not set. A temporary admin password was generated for this run:");
    console.warn(`[Auth]   ${generatedPassword}`);
    console.warn("[Auth] Set ADMIN_PASSWORD (and/or ADMIN_TELEGRAM_IDS) in your Secrets to make it permanent.");
    console.warn("================================================================");
  }
  return generatedPassword;
}

export function getAdminTelegramIds(): Set<string> {
  return new Set(
    [process.env.ADMIN_TELEGRAM_IDS || "", process.env.TELEGRAM_ADMIN_CHAT_ID || ""]
      .join(",")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isAdminTelegramId(id: string | number | undefined | null): boolean {
  if (id === undefined || id === null) return false;
  return getAdminTelegramIds().has(String(id));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison to keep timing roughly constant.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface SessionPayload {
  sub: string; // "password" or "tg:<id>"
  name?: string;
  exp: number;
}

export function signSession(payload: Omit<SessionPayload, "exp">): string {
  const full: SessionPayload = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const body = b64url(JSON.stringify(full));
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const s = verifySession(authHeader.slice(7).trim());
    if (s) return s;
  }
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(cookies[COOKIE_NAME]);
}

function setSessionCookie(req: Request, res: Response, token: string) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  // SameSite=None is needed when the app is embedded in an iframe (AI Studio preview); it requires Secure.
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? "SameSite=None" : "SameSite=Lax",
    secure ? "Secure" : ""
  ].filter(Boolean);
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

/* ------------------------------ rate limiting ------------------------------ */

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(opts: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, Bucket>();
  // Opportunistic cleanup
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, Math.max(30_000, opts.windowMs));
  (timer as any).unref?.();

  return {
    hit(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
      const now = Date.now();
      const k = `${opts.keyPrefix}:${key}`;
      let b = buckets.get(k);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(k, b);
      }
      b.count++;
      return {
        allowed: b.count <= opts.max,
        remaining: Math.max(0, opts.max - b.count),
        retryAfterSec: Math.ceil((b.resetAt - now) / 1000)
      };
    },
    middleware() {
      return (req: Request, res: Response, next: NextFunction) => {
        const r = this.hit(clientIp(req));
        if (!r.allowed) {
          res.setHeader("Retry-After", String(r.retryAfterSec));
          return res.status(429).json({ error: "Too many requests. Please try again later." });
        }
        next();
      };
    }
  };
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

/* ----------------------------- Telegram checks ----------------------------- */

/** Verify the payload from the Telegram Login Widget. https://core.telegram.org/widgets/login#checking-authorization */
export function verifyTelegramLoginWidget(data: Record<string, any>, botToken: string): boolean {
  if (!data || !data.hash || !botToken) return false;
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== null)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (!safeEqual(calc, String(hash))) return false;
  const authDate = Number(rest.auth_date || 0);
  return authDate > 0 && Date.now() / 1000 - authDate < 24 * 60 * 60;
}

/** Verify Telegram Mini App `initData`. https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export function verifyTelegramInitData(initData: string, botToken: string): { id: string; name: string } | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const checkString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (!safeEqual(calc, hash)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 24 * 60 * 60) return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    if (!user.id) return null;
    return { id: String(user.id), name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id) };
  } catch {
    return null;
  }
}

/** Secret token Telegram echoes back in `X-Telegram-Bot-Api-Secret-Token`. Derived so it is identical on every instance. */
export function getWebhookSecret(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  return crypto.createHmac("sha256", "bm-webhook").update(token).digest("hex").slice(0, 48);
}

export function verifyWebhookRequest(req: Request): boolean {
  const header = req.headers["x-telegram-bot-api-secret-token"];
  const got = Array.isArray(header) ? header[0] : header;
  if (!got) return false;
  return safeEqual(String(got), getWebhookSecret());
}

/* ------------------------------ route policy ------------------------------ */

/**
 * Everything under /api is ADMIN-ONLY unless it matches one of these.
 * Keep this list short and review it whenever a route is added.
 */
const PUBLIC_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/health$/ },
  { method: "GET", pattern: /^\/api\/auth\/config$/ },
  { method: "GET", pattern: /^\/api\/auth\/session$/ },
  { method: "POST", pattern: /^\/api\/auth\/(login|telegram|webapp|logout)$/ },
  { method: "POST", pattern: /^\/api\/telegram-webhook$/ }, // protected by the webhook secret header instead
  // Storefront (read-only catalog + search + request)
  { method: "GET", pattern: /^\/api\/library$/ },
  { method: "GET", pattern: /^\/api\/series$/ },
  { method: "GET", pattern: /^\/api\/series\/[^/]+\/episodes$/ },
  { method: "GET", pattern: /^\/api\/trailer$/ },
  { method: "GET", pattern: /^\/api\/search-test$/ },
  { method: "GET", pattern: /^\/api\/media\/\d+\/stream$/ }, // returns a Telegram deep link only (no token)
  { method: "POST", pattern: /^\/api\/requests\/create$/ },
  { method: "POST", pattern: /^\/api\/library\/view$/ } // anonymous view counter for "Top 10"
];

export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((r) => r.method === method.toUpperCase() && r.pattern.test(path));
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: "Admin login required", code: "AUTH_REQUIRED" });
  (req as any).admin = session;
  next();
}

/** Gate for the whole /api tree. */
export function apiGate(req: Request, res: Response, next: NextFunction) {
  // `req.path` is relative to the mount point; rebuild the full path.
  const full = req.baseUrl + req.path;
  if (isPublicRoute(req.method, full)) return next();
  return requireAdmin(req, res, next);
}

/* -------------------------------- routes -------------------------------- */

export function registerAuthRoutes(app: Express, getBotUsername: () => string | undefined) {
  const loginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, keyPrefix: "login" });

  app.get("/api/auth/config", (_req, res) => {
    res.json({
      passwordEnabled: true,
      passwordGenerated: !process.env.ADMIN_PASSWORD,
      telegramEnabled: getAdminTelegramIds().size > 0 && !!process.env.TELEGRAM_BOT_TOKEN,
      telegramBotUsername: getBotUsername() || null
    });
  });

  app.get("/api/auth/session", (req, res) => {
    const s = getSessionFromRequest(req);
    res.json({ authenticated: !!s, user: s ? { sub: s.sub, name: s.name } : null });
  });

  app.post("/api/auth/login", loginLimiter.middleware(), (req, res) => {
    const password = String(req.body?.password || "");
    if (!password || !safeEqual(password, getAdminPassword())) {
      return res.status(401).json({ error: "Incorrect password" });
    }
    const token = signSession({ sub: "password", name: "Admin" });
    setSessionCookie(req, res, token);
    res.json({ success: true, token });
  });

  app.post("/api/auth/telegram", loginLimiter.middleware(), (req, res) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    const data = req.body || {};
    if (!verifyTelegramLoginWidget(data, botToken)) {
      return res.status(401).json({ error: "Telegram login could not be verified" });
    }
    if (!isAdminTelegramId(data.id)) {
      return res.status(403).json({ error: "This Telegram account is not an admin" });
    }
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || String(data.id);
    const token = signSession({ sub: `tg:${data.id}`, name });
    setSessionCookie(req, res, token);
    res.json({ success: true, token });
  });

  app.post("/api/auth/webapp", loginLimiter.middleware(), (req, res) => {
    const user = verifyTelegramInitData(String(req.body?.initData || ""), process.env.TELEGRAM_BOT_TOKEN || "");
    if (!user) return res.status(401).json({ error: "Telegram Mini App data could not be verified" });
    if (!isAdminTelegramId(user.id)) return res.status(403).json({ error: "This Telegram account is not an admin" });
    const token = signSession({ sub: `tg:${user.id}`, name: user.name });
    setSessionCookie(req, res, token);
    res.json({ success: true, token });
  });

  app.post("/api/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
}
