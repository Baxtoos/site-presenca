"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { suapBookmarklet } from "@/lib/suap-collector";

/**
 * O favorito é um link javascript:. O React não aceita esse tipo de href no JSX, então ele é
 * colocado no elemento depois de montar. Clicar nele aqui não faz nada (a CSP do site bloqueia):
 * ele é para arrastar até a barra de favoritos e usar no SUAP.
 */
export function SuapBookmarklet() {
  const toast = useToast();
  const link = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    const href = suapBookmarklet(window.location.origin);
    link.current?.setAttribute("href", href);
    // Texto do favorito só existe no navegador (usa o endereço desta página).
    setCode(href);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.push({ tone: "success", message: "Código do favorito copiado." });
    } catch {
      toast.push({
        tone: "error",
        message: "Não consegui copiar. Use o computador e arraste o botão.",
      });
    }
  }

  return (
    <div className="grid gap-5">
      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="text-lg font-semibold">
          Como funciona
        </h2>
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>Você entra no SUAP normalmente, como sempre.</li>
          <li>
            Clica no favorito <strong>Enviar para o Monitor</strong>. Ele lê o seu boletim e, de
            cada turma, as aulas lançadas (com as faltas de cada dia) e o horário.
          </li>
          <li>
            O Monitor abre com tudo para você conferir: criar o semestre ou atualizar o que você já
            tem.
          </li>
        </ol>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          A sua senha do SUAP nunca passa pelo Monitor: o favorito usa a sessão que você já abriu, e
          os dados vão direto do seu navegador para a sua conta aqui. Para manter em dia, clique de
          novo quando quiser (por exemplo, toda semana).
        </p>
      </section>

      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="instalar">
        <h2 id="instalar" className="text-lg font-semibold">
          Instalar o favorito (uma vez só)
        </h2>
        <div className="grid gap-2 text-sm">
          <p className="font-medium">No computador</p>
          <p className="text-muted">
            Mostre a barra de favoritos (Ctrl+Shift+B) e arraste este botão para ela:
          </p>
          <a
            ref={link}
            href="#instalar"
            data-testid="suap-favorito"
            onClick={(e) => {
              e.preventDefault();
              toast.push({
                tone: "info",
                message: "Arraste o botão para a barra de favoritos e use-o com o SUAP aberto.",
              });
            }}
            className="inline-flex min-h-11 w-fit cursor-grab items-center rounded-md border-2 border-dashed border-accent bg-accent-soft px-4 text-sm font-semibold text-accent"
          >
            Enviar para o Monitor
          </a>
        </div>
        <div className="grid gap-2 text-sm">
          <p className="font-medium">No celular (ou se arrastar não funcionar)</p>
          <ol className="grid list-decimal gap-1 pl-5 text-muted">
            <li>Copie o código do favorito.</li>
            <li>
              Crie um favorito qualquer no navegador, edite-o, dê o nome{" "}
              <strong>Enviar para o Monitor</strong> e cole o código no lugar do endereço.
            </li>
            <li>
              No SUAP, digite <strong>Enviar para o Monitor</strong> na barra de endereço e toque no
              favorito que aparecer.
            </li>
          </ol>
          <Button type="button" variant="secondary" disabled={!code} onClick={() => void copy()}>
            Copiar código do favorito
          </Button>
        </div>
      </section>
    </div>
  );
}
