"use client";

import { type ButtonHTMLAttributes, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function Button({
  variant = "primary",
  loading = false,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
}) {
  const hydrated = useHydrated();
  const styles = {
    primary: "bg-accent text-accent-ink shadow-sm hover:bg-accent/90 active:bg-accent/80",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-hover",
    danger: "border border-line-strong bg-surface text-fail hover:bg-fail-soft active:bg-fail-soft",
    ghost: "text-muted hover:bg-hover hover:text-ink",
  }[variant];
  return (
    <button
      {...props}
      disabled={props.disabled || loading || !hydrated}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors sm:min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}
