import React, { forwardRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

/* --------------------------------- Button --------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  // The ember gradient is reserved for the one main action on a screen.
  primary: "bg-ember text-white shadow-[0_1px_0_rgba(255,255,255,.25)_inset] hover:brightness-110",
  secondary: "border border-line bg-surface-2 text-zinc-100 hover:bg-surface-3 hover:border-zinc-600",
  ghost: "text-zinc-300 hover:bg-surface-3 hover:text-white",
  danger: "border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: React.ReactNode }
>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-red/60",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
        VARIANT[variant],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx("inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-surface-3 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-red/60", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Badge --------------------------------- */

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "accent";
const TONE: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
  warn: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
  bad: "bg-rose-500/10 text-rose-300 ring-rose-500/25",
  info: "bg-sky-500/10 text-sky-300 ring-sky-500/25",
  neutral: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/25",
  accent: "bg-ember-pink/10 text-pink-300 ring-ember-pink/30",
};
const DOT: Record<Tone, string> = {
  ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400", info: "bg-sky-400", neutral: "bg-zinc-400", accent: "bg-ember-pink",
};

export function Badge({ tone = "neutral", dot, pulse, children, className }: { tone?: Tone; dot?: boolean; pulse?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONE[tone], className)}>
      {(dot || pulse) && <span className={cx("h-1.5 w-1.5 rounded-full", DOT[tone], pulse && "animate-pulse")} />}
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse }: { tone?: Tone; pulse?: boolean }) {
  return <span className={cx("inline-block h-2 w-2 rounded-full", DOT[tone], pulse && "animate-pulse")} />;
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({
  title, description, actions, children, className, flush,
}: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface-1", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <h3 className="font-display text-[13px] font-semibold text-white">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Stat({
  label, value, hint, icon, tone, loading,
}: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: Tone; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{label}</span>
        {icon && <span className={cx("text-zinc-600", tone === "warn" && "text-amber-400", tone === "bad" && "text-rose-400", tone === "ok" && "text-emerald-400")}>{icon}</span>}
      </div>
      {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <div className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-white">{value}</div>}
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

/* ---------------------------------- Forms ---------------------------------- */

const CONTROL =
  "w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-white placeholder:text-zinc-600 transition focus:border-ember-red/70 focus:outline-none focus:ring-2 focus:ring-ember-red/25 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(CONTROL, "h-9", className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cx(CONTROL, "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2371717a%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)} {...p}>
      {children}
    </select>
  );
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(CONTROL, "py-2 leading-relaxed", className)} {...p} />;
});

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-zinc-300">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-rose-400">{error}</span> : hint ? <span className="mt-1.5 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-red/60", checked ? "bg-ember" : "bg-surface-3 ring-1 ring-inset ring-line")}
    >
      <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, className,
}: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode; count?: number }>; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-1 p-0.5 no-scrollbar", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition", value === o.value ? "bg-surface-3 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-200")}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="tabular-nums text-zinc-500">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Layout bits -------------------------------- */

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <h1 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-3/70", className)} />;
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-zinc-500">{icon}</div>}
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      {body && <p className="mt-1 max-w-sm text-[13px] text-zinc-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  const border: Record<Tone, string> = {
    ok: "border-emerald-500/25 bg-emerald-500/[.06]", warn: "border-amber-500/25 bg-amber-500/[.06]", bad: "border-rose-500/25 bg-rose-500/[.06]",
    info: "border-sky-500/25 bg-sky-500/[.06]", neutral: "border-line bg-surface-2", accent: "border-ember-pink/30 bg-ember-pink/[.06]",
  };
  return (
    <div className={cx("flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-[13px]", border[tone])}>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium text-zinc-100">{title}</div>}
        {children && <div className={cx("text-zinc-400", title && "mt-0.5")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function CopyText({ text, children, className }: { text: string; children?: React.ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch { /* clipboard blocked */ }
      }}
      className={cx("inline-flex max-w-full items-center gap-1.5 rounded-md font-mono text-xs text-zinc-300 hover:text-white", className)}
      title="Copy"
    >
      <span className="truncate">{children ?? text}</span>
      {done ? <Check className="h-3 w-3 shrink-0 text-emerald-400" /> : <Copy className="h-3 w-3 shrink-0 text-zinc-600" />}
    </button>
  );
}

/* ----------------------------------- Table ---------------------------------- */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}
export const THead = ({ children }: { children: React.ReactNode }) => (
  <thead>
    <tr className="border-b border-line text-[11px] font-medium uppercase tracking-wider text-zinc-500">{children}</tr>
  </thead>
);
export const TH = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cx("whitespace-nowrap px-3 py-2.5 font-medium sm:px-4", className)}>{children}</th>
);
export const TR = ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
  <tr onClick={onClick} className={cx("border-b border-line/70 last:border-0 transition", onClick && "cursor-pointer hover:bg-surface-2/70", className)}>
    {children}
  </tr>
);
export const TD = ({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx("px-3 py-3 align-middle text-zinc-300 sm:px-4", className)}>{children}</td>
);

/* ---------------------------------- Charts ---------------------------------- */

/** Tiny dependency-free bar chart: values are drawn as rounded bars with the ember gradient. */
export function BarChart({ data, height = 120, label }: { data: Array<{ label: string; value: number }>; height?: number; label?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end" title={`${d.label}: ${d.value}`}>
            <div
              className={cx("w-full rounded-t-[4px] transition-all", d.value ? "bg-ember opacity-90 group-hover:opacity-100" : "bg-surface-3")}
              style={{ height: d.value ? `${Math.max(6, (d.value / max) * 100)}%` : 3 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 text-[10px] text-zinc-600">
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center">{d.label}</span>
        ))}
      </div>
    </div>
  );
}
