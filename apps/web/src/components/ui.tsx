import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** Botão principal (cheio) ou secundário (contorno). Mostra estado de carregamento sem mudar de tamanho. */
export function Button({
  variant = "primary",
  loading = false,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
}) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:bg-accent/90",
    secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
    danger: "border border-line bg-surface text-fail hover:bg-fail-soft",
  }[variant];
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
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

/** Campo com rótulo, dica e erro ligados ao input por aria (leitores de tela anunciam o erro). */
export function Field({
  id,
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}) {
  const describedBy = [error ? `${id}-erro` : null, hint ? `${id}-dica` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`min-h-11 w-full min-w-0 rounded-lg border bg-surface px-3 text-base outline-none transition-colors placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 ${error ? "border-fail" : "border-line"}`}
      />
      {hint && !error ? (
        <p id={`${id}-dica`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-erro`} className="text-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const styles = {
    info: "border-accent/30 bg-accent-soft text-ink",
    error: "border-fail/30 bg-fail-soft text-fail",
    success: "border-ok/30 bg-ok-soft text-ok",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

/** Divisor "ou" entre formas de entrar. */
export function OrDivider() {
  return (
    <div
      className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted"
      aria-hidden
    >
      <span className="h-px flex-1 bg-line" />
      ou
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
