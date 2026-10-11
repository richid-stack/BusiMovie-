import { QueryClient, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 4000, retry: 1, refetchOnWindowFocus: true },
  },
});

/** Error with the server's own message so toasts can show it. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data?.error || data?.message || `Request failed (${res.status})`, res.status);
  return data as T;
}

/** GET with polling that pauses while the tab is hidden. */
export function useGet<T = any>(key: unknown[], path: string, opts: { every?: number; enabled?: boolean } = {}) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => api<T>(path),
    refetchInterval: opts.every ? () => (document.hidden ? false : opts.every!) : false,
    enabled: opts.enabled,
  });
}

/** POST/PUT/DELETE and refresh the listed query keys afterwards. */
export function useAct<TBody = any, TRes = any>(
  fn: (body: TBody) => Promise<TRes>,
  invalidate: unknown[][] = [],
  onDone?: (res: TRes) => void
) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TBody>({
    mutationFn: fn,
    onSuccess: (res) => {
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      onDone?.(res);
    },
  });
}

export function formatBytes(n?: number | null): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  // SQLite "YYYY-MM-DD HH:MM:SS" is UTC
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? s.replace(" ", "T") + "Z" : s;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function timeAgo(s?: string | null): string {
  const d = parseDate(s);
  if (!d) return "—";
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return "just now";
  if (sec < 90) return "1 min ago";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fullDate(s?: string | null): string {
  const d = parseDate(s);
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
