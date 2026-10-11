import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { Button, cx } from "./kit";

/* ------------------------------ Drawer / Modal ------------------------------ */

function useLock(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Drawer({
  open, onClose, title, subtitle, children, footer, width = "max-w-xl",
}: {
  open: boolean; onClose: () => void; title?: React.ReactNode; subtitle?: React.ReactNode;
  children: React.ReactNode; footer?: React.ReactNode; width?: string;
}) {
  useLock(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] adm-fade" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        className={cx("adm-slide absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-surface-1 shadow-2xl", width)}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[15px] font-semibold text-white">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-zinc-400 hover:bg-surface-3 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body
  );
}

export function Modal({
  open, onClose, title, children, footer, width = "max-w-md",
}: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  useLock(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] adm-fade" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={cx("adm-pop relative w-full rounded-t-2xl border border-line bg-surface-1 shadow-2xl sm:rounded-2xl", width)}>
        {title && <h2 className="px-5 pt-5 font-display text-[15px] font-semibold text-white">{title}</h2>}
        <div className="px-5 py-4 text-sm text-zinc-400">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ----------------------------------- Confirm ---------------------------------- */

interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

/* ----------------------------------- Toasts ----------------------------------- */

type ToastKind = "ok" | "err" | "info";
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ToastApi { ok: (t: string) => void; err: (t: string) => void; info: (t: string) => void }
const ToastCtx = createContext<ToastApi>({ ok() {}, err() {}, info() {} });
export const useToast = () => useContext(ToastCtx);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = idRef.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3800);
  }, []);
  const api: ToastApi = React.useMemo(
    () => ({ ok: (t) => push("ok", t), err: (t) => push("err", t), info: (t) => push("info", t) }),
    [push]
  );

  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setPending({ ...o, resolve })), []);
  const settle = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <ToastCtx.Provider value={api}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <Modal
          open={!!pending}
          onClose={() => settle(false)}
          title={
            <span className="flex items-center gap-2">
              {pending?.danger && <AlertTriangle className="h-4 w-4 text-rose-400" />}
              {pending?.title}
            </span>
          }
          footer={
            <>
              <Button variant="ghost" onClick={() => settle(false)}>Cancel</Button>
              <Button variant={pending?.danger ? "danger" : "primary"} onClick={() => settle(true)} autoFocus>
                {pending?.confirmLabel || "Confirm"}
              </Button>
            </>
          }
        >
          {pending?.body}
        </Modal>
        {createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end">
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                className="adm-pop pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-line bg-surface-2/95 px-3.5 py-3 text-[13px] text-zinc-100 shadow-2xl backdrop-blur"
              >
                {t.kind === "ok" ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-400" />
                  : t.kind === "err" ? <XCircle className="mt-px h-4 w-4 shrink-0 text-rose-400" />
                  : <Info className="mt-px h-4 w-4 shrink-0 text-sky-400" />}
                <span className="min-w-0 break-words">{t.text}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}
