"use client";

import { type ComponentType, useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { applyTheme, readTheme, subscribeTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { value: "system", label: "Automático", icon: MonitorIcon },
  { value: "light", label: "Claro", icon: SunIcon },
  { value: "dark", label: "Escuro", icon: MoonIcon },
];

/** Escolha do tema (fica guardada neste aparelho). */
export function ThemePicker() {
  // No servidor não há aparelho: "system" até hidratar, depois o valor guardado.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "system");

  return (
    <section className="grid gap-4 card p-5 text-sm sm:p-6" aria-labelledby="tema-titulo">
      <div className="grid gap-1">
        <h2 id="tema-titulo" className="text-base font-semibold text-ink">
          Aparência
        </h2>
        <p className="text-muted">
          Automático segue o tema do aparelho. A escolha vale só para este aparelho.
        </p>
      </div>
      <fieldset>
        <legend className="sr-only">Tema</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const checked = theme === o.value;
            return (
              <label
                key={o.value}
                className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md px-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-accent/30 ${
                  checked ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="tema"
                  value={o.value}
                  checked={checked}
                  onChange={() => applyTheme(o.value)}
                  className="sr-only"
                />
                <Icon size={17} />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * Troca rápida de tema: três ícones, o atual destacado. Fica no rodapé da barra lateral
 * (computador) e no topo da tela (celular). Mesma escolha da página Conta (guardada no aparelho).
 */
export function ThemeSwitcher({
  name = "tema-rapido",
  showLabel = true,
  className = "",
}: {
  /** Nome do grupo de opções (um diferente para cada lugar onde aparece na página). */
  name?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "system");
  return (
    <fieldset className={`flex items-center justify-between gap-2 ${className}`}>
      <legend className="sr-only">Tema</legend>
      {showLabel ? (
        <span className="text-xs font-medium text-muted" aria-hidden>
          Tema
        </span>
      ) : null}
      <div className="flex gap-0.5 rounded-md bg-surface-2 p-0.5">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const checked = theme === o.value;
          return (
            <label
              key={o.value}
              title={o.label}
              className={`grid size-7 cursor-pointer place-items-center rounded transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${
                checked ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => applyTheme(o.value)}
                className="sr-only"
                aria-label={`Tema ${o.label.toLowerCase()}`}
              />
              <Icon size={15} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
