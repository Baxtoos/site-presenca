import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, ChevronLeftIcon, InfoIcon } from "./icons";

export { Button } from "./button";

/** Campo com rótulo, dica e erro ligados ao input por aria (leitores de tela anunciam o erro). */
/** Visual comum de input, select e textarea. */
export const INPUT_CLASS =
  "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base outline-none transition-[border-color,box-shadow] placeholder:text-muted/80 hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:min-h-10 sm:text-sm";

export function Field({
  id,
  label,
  error,
  hint,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** O Field já cria o <input>: passar um input dentro dele quebraria a tela (ver Conta → Excluir). */
  children?: never;
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
        className={`${INPUT_CLASS} ${error ? "border-fail" : ""}`}
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

/** Aviso no estilo "callout": ícone à esquerda, fundo suave, sem borda pesada. */
export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const styles = {
    info: "bg-accent-soft text-ink [&>svg]:text-accent",
    error: "bg-fail-soft text-fail",
    success: "bg-ok-soft text-ok",
  }[tone];
  const Icon = { info: InfoIcon, error: AlertIcon, success: CheckCircleIcon }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2.5 rounded-lg px-3.5 py-3 text-sm ${styles}`}
    >
      <Icon size={18} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Cabeçalho de página no estilo Notion: ícone grande, título forte, descrição curta e ações.
 * `back` mostra o caminho de volta acima (texto do link inalterado, para leitores de tela).
 */
export function PageHeader({
  icon,
  iconTile = true,
  eyebrow,
  title,
  description,
  actions,
  back,
  children,
}: {
  /** Ícone da página (um dos de components/icons). Vai numa peça quadrada, como no Notion. */
  icon?: ReactNode;
  /** false: o ícone já vem com a própria moldura (ex.: a cor da matéria). */
  iconTile?: boolean;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="grid gap-3 pb-2">
      {back ? (
        <Link
          href={back.href}
          aria-label={back.label}
          className="-ml-1.5 inline-flex w-fit items-center gap-0.5 rounded-md px-1.5 py-1 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ChevronLeftIcon size={16} />
          <span>{back.label.replace(/^←\s*/, "")}</span>
        </Link>
      ) : null}
      {icon ? (
        iconTile ? (
          <div
            className="grid size-12 place-items-center rounded-xl border border-line bg-surface-2 text-ink shadow-sm"
            aria-hidden
          >
            {icon}
          </div>
        ) : (
          <div aria-hidden>{icon}</div>
        )
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          {eyebrow ? <p className="text-sm font-medium text-muted">{eyebrow}</p> : null}
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-[2.5rem] sm:leading-[1.15]">
            {title}
          </h1>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <div className="max-w-prose text-[15px] text-muted">{description}</div> : null}
      {children}
    </header>
  );
}

/** Título de seção dentro da página (como um "heading 2" do Notion), com ação opcional à direita. */
export function SectionTitle({
  id,
  children,
  action,
}: {
  id?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Link com cara de botão (para navegação: Criar, Adicionar...). */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-accent-ink shadow-sm hover:bg-accent/90",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
    ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  }[variant];
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 w-fit items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-10 ${styles} ${className}`}
    >
      {children}
    </Link>
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
