"use client";

import { type ReactNode, useEffect, useState } from "react";
import { BookIcon, CheckCircleIcon, ShareIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { suapBookmarklet } from "@/lib/suap-collector";

const NAME = "Monitor SUAP";

type Browser = "android" | "iphone" | "samsung" | "firefox" | "computador";

const BROWSERS: { id: Browser; label: string }[] = [
  { id: "android", label: "Chrome (Android)" },
  { id: "iphone", label: "iPhone" },
  { id: "samsung", label: "Samsung Internet" },
  { id: "firefox", label: "Firefox" },
  { id: "computador", label: "Computador" },
];

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

type Step = { text: ReactNode; mock?: ReactNode };

const BoxMock = () => (
  <Mock>
    <div className="rounded-lg bg-[#1f2937] px-3 py-2 text-white">
      Monitor de Presenças: lendo o boletim…
    </div>
  </Mock>
);

function installSteps(browser: Browser, copyButton: ReactNode): Step[] {
  const copy: Step = {
    text: <>Toque no botão abaixo para copiar o código do favorito. {copyButton}</>,
  };
  const rename = (field: string): Step => ({
    text: (
      <>
        Na tela de editar: no <strong>Nome</strong>, escreva <strong>{NAME}</strong> (é com esse
        nome que você vai chamar o favorito depois). No <strong>{field}</strong>, apague tudo, toque
        e segure e escolha <strong>Colar</strong>. Salve.
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
            Ainda nesta página, toque nos <strong>três pontinhos ⋮</strong> (canto de cima) e na{" "}
            <strong>estrela ☆</strong>. Esta página vira um favorito.
          </>
        ),
        mock: <MenuMock items={["←  ☆  ⬇  ⓘ  ↻", "Nova guia", "Favoritos"]} pick={0} />,
      },
      {
        text: (
          <>
            No aviso &quot;Favorito adicionado&quot;, toque em <strong>Editar</strong>. Perdeu o
            aviso? <strong>⋮ → Favoritos</strong>, toque nos três pontinhos do favorito e em{" "}
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
    ];
  }
  return [];
}

function useSteps(browser: Browser): Step[] {
  const open: Step = {
    text: (
      <>
        Entre no <strong>SUAP</strong>{" "}
        {browser === "computador" ? "" : browser === "iphone" ? "pelo Safari " : "pelo navegador "}e
        abra a aba <strong>Boletins</strong>, como você já faz.
      </>
    ),
  };
  const wait: Step = {
    text: (
      <>
        Aparece uma caixinha escura no canto da tela. Espere uns segundos: o Monitor abre com as
        suas matérias, faltas e notas para você conferir e salvar.
      </>
    ),
    mock: <BoxMock />,
  };
  if (browser === "android") {
    return [
      open,
      {
        text: (
          <>
            Toque na <strong>barra de endereço</strong> (onde aparece suap.ifsp.edu.br) e apague o
            que estiver escrito.
          </>
        ),
      },
      {
        text: (
          <>
            Digite o nome do favorito: <strong>{NAME}</strong> (ou o nome que você deu a ele).
          </>
        ),
      },
      {
        text: (
          <>
            Na lista que aparece embaixo, toque na linha com a <strong>estrela ★</strong>: é o seu
            favorito. Não toque na pesquisa do Google (a da lupa 🔍).
          </>
        ),
        mock: <AddressBarMock />,
      },
      wait,
    ];
  }
  if (browser === "iphone") {
    return [
      open,
      {
        text: (
          <>
            Toque no <strong>livro</strong> <BookIcon size={14} className="inline" /> (Favoritos) e
            em <strong>{NAME}</strong>. Também dá para digitar o nome na barra de endereço e tocar
            no favorito.
          </>
        ),
        mock: <MenuMock items={["Favoritos", NAME]} pick={1} />,
      },
      wait,
    ];
  }
  if (browser === "samsung") {
    return [
      open,
      {
        text: (
          <>
            Toque no menu <strong>≡</strong> → <strong>Favoritos</strong> → <strong>{NAME}</strong>.
          </>
        ),
        mock: <MenuMock items={["Favoritos", NAME]} pick={1} />,
      },
      wait,
    ];
  }
  if (browser === "computador") {
    return [
      open,
      {
        text: (
          <>
            Clique em <strong>{NAME}</strong> na barra de favoritos.
          </>
        ),
      },
      wait,
    ];
  }
  return [];
}

function StepList({ items, testId }: { items: Step[]; testId: string }) {
  return (
    <ol className="grid gap-4" data-testid={testId}>
      {items.map((step, i) => (
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
  );
}

export function SuapBookmarklet() {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [browser, setBrowser] = useState<Browser | null>(null);
  const [copied, setCopied] = useState(false);
  const [host, setHost] = useState("");

  useEffect(() => {
    const href = suapBookmarklet(window.location.origin);
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
  const install = installSteps(current, copyButton);
  const use = useSteps(current);

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

      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="instalar">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Parte 1</p>
          <h2 id="instalar" className="text-lg font-semibold">
            Salvar o favorito (uma vez só)
          </h2>
        </div>

        {current === "computador" || current === "firefox" ? null : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            Faça no <strong>navegador</strong> (
            {current === "iphone"
              ? "Safari"
              : current === "samsung"
                ? "Samsung Internet"
                : "Chrome"}
            ), não dentro do app instalado: o app não tem barra de endereço nem favoritos. Abra{" "}
            <strong>{host}/semestres/suap</strong> no navegador e siga os passos.
          </p>
        )}

        {current === "firefox" ? (
          <p className="text-sm" data-testid="suap-guia">
            O Firefox para celular não roda favoritos desse tipo. Para sincronizar, abra o SUAP no{" "}
            <strong>Chrome</strong> ou no <strong>Samsung Internet</strong> (o resto do Monitor
            funciona em qualquer navegador), ou faça pelo computador.
          </p>
        ) : current === "computador" ? (
          <div className="grid gap-2 text-sm">
            <p>Mostre a barra de favoritos (Ctrl+Shift+B) e arraste este botão para ela:</p>
            <a
              ref={(el) => {
                if (el && code) el.setAttribute("href", code);
              }}
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
            <p className="text-xs text-muted">
              Arrastar não funciona? Copie o código, crie um favorito qualquer e cole o código no
              lugar do endereço. {copyButton}
            </p>
          </div>
        ) : (
          <StepList items={install} testId="suap-guia" />
        )}
      </section>

      {current === "firefox" ? null : (
        <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="usar">
          <div className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Parte 2</p>
            <h2 id="usar" className="text-lg font-semibold">
              Usar no SUAP (sempre que quiser atualizar)
            </h2>
          </div>
          {current === "android" ? (
            <p
              className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm"
              data-testid="suap-aviso"
            >
              <strong>Importante:</strong> no Chrome do Android o favorito{" "}
              <strong>não funciona</strong> se você abrir pela lista de Favoritos (⋮ → Favoritos).
              Ele só roda quando você <strong>digita o nome na barra de endereço</strong>, com o
              SUAP aberto.
            </p>
          ) : null}
          <StepList items={use} testId="suap-uso" />
        </section>
      )}
    </div>
  );
}
