"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { BookIcon, CheckCircleIcon, ShareIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { suapBookmarklet } from "@/lib/suap-collector";

/** Nome sugerido para o favorito: curto e único, para achar digitando na barra de endereço. */
const NAME = "Monitor SUAP";

type Browser = "android" | "iphone" | "samsung" | "firefox" | "computador";

const BROWSERS: { id: Browser; label: string }[] = [
  { id: "android", label: "Chrome (Android)" },
  { id: "iphone", label: "iPhone" },
  { id: "samsung", label: "Samsung Internet" },
  { id: "firefox", label: "Firefox" },
  { id: "computador", label: "Computador" },
];

/** Qual navegador é este (só para escolher a explicação; dá para trocar na tela). */
function detect(): Browser {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return "iphone";
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return "samsung";
    if (/Firefox/.test(ua)) return "firefox";
    return "android";
  }
  return "computador";
}

// ---------------------------------------------------------------- ilustrações dos passos

function Mock({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden
      className="mt-2 max-w-xs rounded-xl border border-line bg-surface-2 p-2.5 text-[13px] leading-tight shadow-sm"
    >
      {children}
    </div>
  );
}

const Highlight = ({ children }: { children: ReactNode }) => (
  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent ring-1 ring-accent/40">
    {children}
  </span>
);

/** Barra de endereço com o nome digitado e a sugestão do favorito embaixo. */
const AddressBarMock = () => (
  <Mock>
    <div className="rounded-full border border-line-strong bg-surface px-3 py-1.5">
      {NAME}
      <span className="animate-pulse">|</span>
    </div>
    <div className="mt-1.5 grid gap-1">
      <div className="flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1.5 text-accent ring-1 ring-accent/40">
        <span>★</span>
        <span className="font-semibold">{NAME}</span>
        <span className="ml-auto text-[11px]">← toque aqui</span>
      </div>
      <div className="flex items-center gap-2 px-2 py-1 text-muted">
        <span>🔍</span>
        <span>{NAME.toLowerCase()} — pesquisar</span>
      </div>
    </div>
  </Mock>
);

/** Tela de editar favorito com nome e endereço trocados. */
const EditMock = ({ urlLabel = "URL" }: { urlLabel?: string }) => (
  <Mock>
    <p className="mb-1 font-semibold">Editar favorito</p>
    <p className="text-[11px] text-muted">Nome</p>
    <p className="mb-1.5 rounded-md border border-line-strong bg-surface px-2 py-1">{NAME}</p>
    <p className="text-[11px] text-muted">{urlLabel}</p>
    <p className="truncate rounded-md border border-accent bg-surface px-2 py-1 font-mono text-[11px] text-accent">
      javascript:(async%20function…
    </p>
  </Mock>
);

const MenuMock = ({ items, pick }: { items: ReactNode[]; pick: number }) => (
  <Mock>
    <div className="grid gap-1">
      {items.map((item, i) => (
        <div key={i} className="px-2 py-1">
          {i === pick ? <Highlight>{item}</Highlight> : <span className="text-muted">{item}</span>}
        </div>
      ))}
    </div>
  </Mock>
);

// ---------------------------------------------------------------- passos por navegador

type Step = { text: ReactNode; mock?: ReactNode };

function steps(browser: Browser, copyButton: ReactNode): Step[] {
  const copy: Step = { text: <>Copie o código do favorito: {copyButton}</> };
  const rename: (field: string) => Step = (field) => ({
    text: (
      <>
        No <strong>Nome</strong>, escreva <strong>{NAME}</strong>. No <strong>{field}</strong>,
        apague tudo, toque e segure, e escolha <strong>Colar</strong>. Salve.
      </>
    ),
    mock: <EditMock urlLabel={field} />,
  });
  if (browser === "android") {
    return [
      copy,
      {
        text: (
          <>
            Toque nos <strong>três pontinhos ⋮</strong> (canto de cima) e na{" "}
            <strong>estrela ☆</strong>. Esta página vira um favorito.
          </>
        ),
        mock: <MenuMock items={["←  ☆  ⬇  ⓘ  ↻", "Nova guia", "Favoritos"]} pick={0} />,
      },
      {
        text: (
          <>
            No aviso &quot;Favorito adicionado&quot;, toque em <strong>Editar</strong>. Perdeu o
            aviso? <strong>⋮ → Favoritos</strong>, toque e segure o favorito e escolha{" "}
            <strong>Editar</strong>.
          </>
        ),
        mock: (
          <Mock>
            <div className="flex items-center justify-between rounded-md bg-ink px-3 py-2 text-paper">
              <span>Favorito adicionado</span>
              <span className="font-semibold underline">Editar</span>
            </div>
          </Mock>
        ),
      },
      rename("URL"),
      {
        text: (
          <>
            Pronto. <strong>No SUAP</strong>, com o boletim aberto, toque na barra de endereço,
            digite <strong>{NAME}</strong> e toque na sugestão com a <strong>estrela ★</strong> (não
            na pesquisa do Google). Abrir pela lista de Favoritos <strong>não funciona</strong> no
            Chrome do Android: tem de ser pela barra de endereço.
          </>
        ),
        mock: <AddressBarMock />,
      },
    ];
  }
  if (browser === "iphone") {
    return [
      copy,
      {
        text: (
          <>
            Toque em <strong>Compartilhar</strong> <ShareIcon size={14} className="inline" /> e em{" "}
            <strong>Adicionar Favorito</strong> → <strong>Salvar</strong>.
          </>
        ),
        mock: (
          <MenuMock
            items={["Copiar", "Adicionar à Lista de Leitura", "Adicionar Favorito"]}
            pick={2}
          />
        ),
      },
      {
        text: (
          <>
            Toque no <strong>livro</strong> <BookIcon size={14} className="inline" /> (Favoritos),
            em <strong>Editar</strong> e no favorito que você acabou de criar.
          </>
        ),
        mock: <MenuMock items={["Favoritos", "Monitor de Presenças", "Editar"]} pick={2} />,
      },
      rename("endereço"),
      {
        text: (
          <>
            Pronto. <strong>No SUAP</strong>, com o boletim aberto, toque no livro{" "}
            <BookIcon size={14} className="inline" /> e em <strong>{NAME}</strong>. (Também dá para
            digitar o nome na barra de endereço e tocar no favorito.)
          </>
        ),
        mock: <MenuMock items={["Favoritos", NAME]} pick={1} />,
      },
    ];
  }
  if (browser === "samsung") {
    return [
      copy,
      {
        text: (
          <>
            Toque na <strong>estrela ☆</strong> da barra de endereço para adicionar esta página aos
            favoritos.
          </>
        ),
      },
      {
        text: (
          <>
            Toque no menu <strong>≡</strong> → <strong>Favoritos</strong>, toque e segure o favorito
            e escolha <strong>Editar</strong>.
          </>
        ),
        mock: <MenuMock items={["Favoritos", "Monitor de Presenças", "Editar"]} pick={2} />,
      },
      rename("URL"),
      {
        text: (
          <>
            Pronto. <strong>No SUAP</strong>, com o boletim aberto:{" "}
            <strong>≡ → Favoritos → {NAME}</strong>.
          </>
        ),
        mock: <MenuMock items={["Favoritos", NAME]} pick={1} />,
      },
    ];
  }
  return [];
}

/**
 * Instalar o favorito "Enviar para o Monitor". No computador, arrasta para a barra de favoritos;
 * no celular (sem barra), um passo a passo do navegador que a pessoa usa. O favorito é um link
 * javascript:: o React não aceita esse href no JSX, então ele é posto no elemento depois de montar.
 */
export function SuapBookmarklet() {
  const toast = useToast();
  const link = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");
  const [browser, setBrowser] = useState<Browser | null>(null);
  const [copied, setCopied] = useState(false);
  const [host, setHost] = useState("");

  useEffect(() => {
    const href = suapBookmarklet(window.location.origin);
    link.current?.setAttribute("href", href);
    // Só existe no navegador: usa o endereço desta página e o navegador da pessoa.
    setCode(href);
    setBrowser(detect());
    setHost(window.location.host);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.push({ tone: "success", message: "Código copiado. Agora crie o favorito." });
    } catch {
      toast.push({ tone: "error", message: "Não consegui copiar. Tente de novo." });
    }
  }

  const copyButton = (
    <Button
      type="button"
      variant={copied ? "secondary" : "primary"}
      disabled={!code}
      onClick={() => void copy()}
      className="mt-2 w-full sm:w-auto"
    >
      {copied ? (
        <>
          <CheckCircleIcon size={16} /> Copiado. Copiar de novo
        </>
      ) : (
        "Copiar código do favorito"
      )}
    </Button>
  );
  const current = browser ?? "computador";
  const guide = steps(current, copyButton);

  return (
    <div className="grid gap-5">
      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="text-lg font-semibold">
          Como funciona
        </h2>
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>Você entra no SUAP normalmente, como sempre.</li>
          <li>
            Usa o favorito <strong>{NAME}</strong>. Ele lê o seu boletim e, de cada turma, as aulas
            lançadas (com as faltas de cada dia) e o horário.
          </li>
          <li>
            O Monitor abre com tudo para você conferir: criar o semestre ou atualizar o que você já
            tem.
          </li>
        </ol>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          A sua senha do SUAP nunca passa pelo Monitor: o favorito usa a sessão que você já abriu, e
          os dados vão direto do seu navegador para a sua conta aqui. Instala uma vez só; depois é
          só usar quando quiser atualizar (por exemplo, toda semana). Sincronizou no computador? O
          celular já vê tudo, é a mesma conta.
        </p>
      </section>

      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="instalar">
        <h2 id="instalar" className="text-lg font-semibold">
          Instalar o favorito (uma vez só)
        </h2>
        <div role="tablist" aria-label="Seu navegador" className="flex flex-wrap gap-1.5">
          {BROWSERS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={current === b.id}
              onClick={() => setBrowser(b.id)}
              className={`min-h-9 rounded-md border px-3 text-sm transition-colors ${current === b.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong bg-surface text-muted hover:bg-surface-2"}`}
            >
              {b.label}
            </button>
          ))}
        </div>

        {current === "computador" || current === "firefox" ? null : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            Faça no <strong>navegador</strong> ({current === "iphone" ? "Safari" : "Chrome"}), não
            dentro do app instalado: o app não tem barra de endereço nem favoritos. Abra{" "}
            <strong>{host}/semestres/suap</strong> no navegador e siga os passos.
          </p>
        )}

        {current === "computador" ? null : current === "firefox" ? (
          <p className="text-sm" data-testid="suap-guia">
            O Firefox para celular não roda favoritos desse tipo. Para sincronizar, abra o SUAP no{" "}
            <strong>Chrome</strong> ou no <strong>Samsung Internet</strong> (o resto do Monitor
            funciona em qualquer navegador), ou faça pelo computador.
          </p>
        ) : (
          <ol className="grid gap-4" data-testid="suap-guia">
            {guide.map((step, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr] gap-3 text-sm">
                <span className="grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-ink">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  {step.text}
                  {step.mock}
                </div>
              </li>
            ))}
          </ol>
        )}

        <div
          className={`grid gap-2 text-sm ${current === "computador" ? "" : "border-t border-line pt-4"}`}
        >
          <p className="font-medium">No computador</p>
          <p className="text-muted">
            Mostre a barra de favoritos (Ctrl+Shift+B) e arraste este botão para ela. No SUAP, é só
            clicar nele.
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
            {NAME}
          </a>
          {current === "computador" ? (
            <p className="text-xs text-muted">
              Arrastar não funciona? Copie o código, crie um favorito qualquer e cole o código no
              lugar do endereço. {copyButton}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
