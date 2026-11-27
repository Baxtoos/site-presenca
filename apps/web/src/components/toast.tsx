"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Tone = "success" | "error" | "info";

export interface ToastInput {
  message: string;
  tone?: Tone;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: Tone;
  duration: number;
}

const ToastContext = createContext<{ push: (toast: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}

const TONE_STYLE: Record<Tone, string> = {
  success: "border-ok/40",
  error: "border-fail/50",
  info: "border-line",
};

function ToastView({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onClose]);

  return (
    <div
      className={`animate-rise pointer-events-auto relative overflow-hidden rounded-lg border bg-surface shadow-pop ${TONE_STYLE[toast.tone]}`}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <div className="flex items-center gap-3 px-4 py-3 text-sm">
        <p className="flex-1">{toast.message}</p>
        {toast.actionLabel ? (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              onClose();
            }}
            className="min-h-9 rounded-lg px-3 font-semibold text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
          >
            {toast.actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar aviso"
          className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2"
        >
          ×
        </button>
      </div>
      {}
      <div
        className="h-0.5 origin-left bg-accent"
        style={{ animation: `toast-countdown ${toast.duration}ms linear forwards` }}
        aria-hidden
      />
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback((input: ToastInput) => {
    const tone = input.tone ?? "info";
    const toast: ToastItem = {
      ...input,
      tone,
      duration: input.duration ?? (tone === "error" ? 8_000 : 5_000),
      id: nextId.current++,
    };
    setToasts((all) => [...all.slice(-2), toast]);
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-50 mx-auto grid max-w-md gap-2 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0 lg:w-96 lg:px-0">
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onClose={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
