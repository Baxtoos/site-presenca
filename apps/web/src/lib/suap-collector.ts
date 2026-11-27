/**
 * Favorito "Enviar para o Monitor": roda DENTRO do SUAP, na sessão que o aluno já abriu (com o
 * captcha que ele mesmo passou). Lê o boletim do período e, de cada turma, as aulas lançadas (com
 * as faltas de cada dia) e o horário; depois abre o Monitor com o retrato no fragmento da URL
 * (#suap=...), que não vai para nenhum servidor. A senha nunca passa pelo Monitor.
 *
 * Esta função vira o texto do favorito (Function.prototype.toString): não pode usar nada de fora
 * dela (imports, constantes do módulo), só o que o navegador já tem.
 */
export async function suapCollector(monitorOrigin: string): Promise<void> {
  // Aba do Monitor aberta já no clique (depois dos awaits o navegador bloquearia o pop-up).
  const target = window.open("", "_blank");
  const box = document.createElement("div");
  box.setAttribute(
    "style",
    "position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:10px;background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)",
  );
  document.body.appendChild(box);
  const say = (text: string) => {
    box.textContent = `Monitor de Presenças: ${text}`;
    if (target && !target.closed) {
      target.document.title = "Monitor de Presenças";
      target.document.body.textContent = text;
    }
  };
  const norm = (s: string | null | undefined) =>
    (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const text = (el: Element | null | undefined) =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const int = (s: string) => {
    const m = /\d+/.exec(s);
    return m ? Number(m[0]) : null;
  };
  const isoDate = (s: string) => {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  const get = async (url: string, htmx = false) => {
    const res = await fetch(url, {
      credentials: "include",
      headers: htmx ? { "HX-Request": "true" } : {},
    });
    if (res.url.includes("/accounts/login")) {
      throw new Error("a sessão do SUAP expirou. Entre de novo e clique no favorito.");
    }
    if (!res.ok) throw new Error(`o SUAP respondeu ${res.status} ao abrir ${url}.`);
    return parse(await res.text());
  };
  /** Abre a página num quadro escondido e espera o SUAP preencher a aba (conteúdo carregado depois). */
  const viaFrame = (url: string, ready: (doc: Document) => boolean) =>
    new Promise<Document>((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("style", "position:fixed;width:1px;height:1px;opacity:0;left:-9999px");
      frame.src = url;
      let tries = 0;
      const timer = window.setInterval(() => {
        const doc = frame.contentDocument;
        if (doc && ready(doc)) {
          window.clearInterval(timer);
          const copy = parse(doc.documentElement.outerHTML);
          frame.remove();
          resolve(copy);
        } else if (++tries > 60) {
          window.clearInterval(timer);
          frame.remove();
          reject(new Error(`não consegui abrir ${url}.`));
        }
      }, 250);
      document.body.appendChild(frame);
    });
  /** Caixa (.box) cujo título começa com o texto dado. */
  const boxNamed = (doc: Document, title: string) =>
    Array.from(doc.querySelectorAll(".box")).find((b) =>
      norm(text(b.querySelector("h3"))).startsWith(norm(title)),
    ) ?? null;
  /** Índice de cada coluna pelo cabeçalho (primeira linha, contando colspan). */
  const columns = (table: Element) => {
    const map: Record<string, number> = {};
    const row = table.querySelector("thead tr") ?? table.querySelector("tr");
    let i = 0;
    for (const th of Array.from(row?.children ?? [])) {
      map[norm(text(th))] = i;
      i += Number(th.getAttribute("colspan") ?? "1");
    }
    return map;
  };
  const col = (map: Record<string, number>, ...names: string[]) => {
    for (const [key, i] of Object.entries(map)) {
      if (names.some((n) => key.startsWith(norm(n)))) return i;
    }
    return -1;
  };

  try {
    if (!/suap/i.test(location.hostname)) {
      throw new Error("abra o SUAP, entre na sua conta e clique no favorito de novo.");
    }
    const me = document.querySelector('#user-tools a[href^="/edu/aluno/"], a[href^="/edu/aluno/"]');
    const matricula = me?.getAttribute("href")?.split("/")[3];
    if (!matricula) {
      throw new Error("não achei o seu cadastro de aluno. Confira se você está logado no SUAP.");
    }

    // ---- boletim do período escolhido na tela (ou o mais recente)
    say("lendo o boletim…");
    const chosen = document.querySelector<HTMLSelectElement>("select#ano_periodo")?.value;
    const boletim = await get(
      `/edu/aluno/${matricula}/boletins/?etapa=&ano_periodo=${encodeURIComponent(chosen ?? "")}`,
      true,
    );
    const table = boletim.querySelector("#tabela_boletim");
    if (!table) throw new Error("não encontrei o boletim deste período.");
    const heading = /(\d{4})\s*\/\s*([12])/.exec(
      text(boletim.querySelector(".box h3")) || chosen?.replace("_", "/") || "",
    );
    const period = heading
      ? `${heading[1]}_${heading[2]}`
      : (boletim.querySelector<HTMLOptionElement>("select#ano_periodo option")?.value ?? "");
    const head = columns(table);
    const cPlanned = col(head, "total de aulas previstas");
    const cDelivered = col(head, "total de aulas cumpridas");
    const cAbsences = col(head, "total de faltas");
    const cFreq = col(head, "% freq");
    // Notas: cada "ETAPA n" ocupa 2 colunas (NOTA e FALTAS); a nota é a primeira.
    const cStages = Object.entries(head)
      .filter(([key]) => /^etapa \d/.test(key))
      .map(([key, i]) => ({ label: `Etapa ${key.replace(/\D/g, "")}`, i }));
    const cAverage = col(head, "media");
    const cExam = col(head, "naf");
    const cFinal = col(head, "mfd");
    const cStatus = col(head, "situacao");
    /** "7,5" → 7.5; "-" ou vazio → null. */
    const score = (cell: Element | undefined) => {
      const v = text(cell).replace(",", ".");
      return /^\d{1,3}(\.\d+)?$/.test(v) ? Math.min(1000, Number(v)) : null;
    };
    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((tr) =>
      tr.querySelector('a[href*="/edu/sala_virtual/"]'),
    );
    if (rows.length === 0) throw new Error("o boletim deste período não tem disciplinas.");

    const subjects = [];
    for (const [index, tr] of rows.entries()) {
      const cells = Array.from(tr.children);
      const diario = /sala_virtual\/(\d+)/.exec(
        tr.querySelector('a[href*="/edu/sala_virtual/"]')!.getAttribute("href") ?? "",
      )![1]!;
      const title = text(cells[1]);
      const m = /^(.*?)\s*\(([^)]+)\)/.exec(title);
      const name = (m ? m[1]! : title.split(" - ")[0]!).trim();
      const code = (m ? m[2]! : diario).trim();
      say(`lendo ${name} (${index + 1} de ${rows.length})…`);

      // ---- aulas lançadas
      const lessonsUrl = `/edu/sala_virtual/${diario}/?tab=aulas`;
      const hasLessons = (doc: Document) =>
        !!doc.querySelector('.tab-container[data-tab="aulas"] table tbody tr') ||
        !!boxNamed(doc, "aulas ministradas")?.querySelector("table tbody tr");
      let aulas = await get(lessonsUrl);
      const expected = Number(
        aulas.querySelector('.tab-container[data-tab="aulas"]')?.getAttribute("data-counter") ??
          "0",
      );
      if (!hasLessons(aulas) && expected > 0) aulas = await viaFrame(lessonsUrl, hasLessons);
      const lessonsTable =
        aulas.querySelector('.tab-container[data-tab="aulas"] table') ??
        boxNamed(aulas, "aulas ministradas")?.querySelector("table") ??
        null;
      const lessons = [];
      if (lessonsTable) {
        const lh = columns(lessonsTable);
        const cDate = col(lh, "data");
        const cUnits = col(lh, "n aulas", "nº aulas", "no aulas");
        const cMiss = col(lh, "n faltas", "nº faltas", "no faltas");
        const cExc = col(lh, "faltas abonadas");
        const cContent = col(lh, "conteudo");
        for (const row of Array.from(lessonsTable.querySelectorAll("tbody tr"))) {
          const td = Array.from(row.children);
          const date = isoDate(text(td[cDate]));
          const units = int(text(td[cUnits]));
          if (!date || !units) continue;
          const absences = int(text(td[cMiss])) ?? 0;
          lessons.push({
            date,
            units: Math.min(units, 12),
            absences: Math.min(absences, 12),
            excused: cExc >= 0 && norm(text(td[cExc])) === "sim",
            content: absences > 0 && cContent >= 0 ? text(td[cContent]).slice(0, 300) : "",
          });
        }
      }

      // ---- dados gerais: professor, local e horário
      const generalUrl = `/edu/sala_virtual/${diario}/?tab=dados_gerais`;
      const hasGeneral = (doc: Document) => !!boxNamed(doc, "horario de aula");
      let general = await get(generalUrl);
      if (!hasGeneral(general))
        general = await viaFrame(generalUrl, hasGeneral).catch(() => general);
      const professor = text(boxNamed(general, "professores")?.querySelector(".card h4")) || null;
      const localCells = boxNamed(general, "local de aula")?.querySelectorAll("td");
      const location = localCells && localCells.length > 1 ? text(localCells[1]) : null;
      const slots: { weekday: number; startsAt: string; endsAt: string }[] = [];
      const days: Record<string, number> = {
        segunda: 1,
        terca: 2,
        quarta: 3,
        quinta: 4,
        sexta: 5,
        sabado: 6,
        domingo: 7,
      };
      let weekdayOf: Record<number, number> = {};
      for (const row of Array.from(
        boxNamed(general, "horario de aula")?.querySelectorAll("tr") ?? [],
      )) {
        const cells = Array.from(row.children);
        if (row.querySelector("th")) {
          weekdayOf = {};
          cells.forEach((c, i) => {
            const day = days[norm(text(c)).split("-")[0]!];
            if (day) weekdayOf[i] = day;
          });
          continue;
        }
        const time = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/.exec(text(cells[0]));
        if (!time) continue;
        cells.forEach((c, i) => {
          const content = text(c);
          if (i === 0 || !weekdayOf[i] || !content) return;
          if (content.includes(`(${code})`) || !/\([A-Z0-9]+\)/.test(content)) {
            slots.push({ weekday: weekdayOf[i], startsAt: time[1]!, endsAt: time[2]! });
          }
        });
      }

      const finalText = cFinal >= 0 ? text(cells[cFinal]) : "";
      const grades = {
        stages: cStages.slice(0, 6).map((s) => ({ label: s.label, score: score(cells[s.i]) })),
        average: cAverage >= 0 ? score(cells[cAverage]) : null,
        finalExam: cExam >= 0 ? score(cells[cExam]) : null,
        finalGrade: cFinal >= 0 ? score(cells[cFinal]) : null,
        // Curso com conceito: a coluna MFD/CONCEITO traz letra, não número.
        concept:
          finalText && finalText !== "-" && score(cells[cFinal]) === null
            ? finalText.slice(0, 20)
            : null,
        status: cStatus >= 0 ? text(cells[cStatus]).slice(0, 80) || null : null,
        assessments: [] as unknown[],
      };

      // ---- "Detalhar": cada avaliação (sigla, tipo, peso, nota) de cada etapa
      const assessments: {
        stage: string;
        method: string | null;
        code: string;
        kind: string | null;
        description: string | null;
        date: string | null;
        weight: number | null;
        score: number | null;
      }[] = [];
      const detailHref = tr
        .querySelector('a[href*="detalhar_matricula_diario_boletim"]')
        ?.getAttribute("href");
      if (detailHref) {
        const detail = await get(detailHref).catch(() => null);
        // Título de cada etapa ("Etapa 1 - Média Aritmética") vem antes da tabela dela.
        const titles = detail
          ? Array.from(detail.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,b,legend,caption")).filter(
              (el) => /^etapa\b/i.test(text(el)),
            )
          : [];
        for (const tbl of Array.from(detail?.querySelectorAll("table") ?? [])) {
          const dh = columns(tbl);
          const cCode = col(dh, "sigla");
          const cScore = col(dh, "nota obtida", "nota");
          if (cCode < 0 || cScore < 0) continue;
          const title = titles
            .filter((h) => h.compareDocumentPosition(tbl) & Node.DOCUMENT_POSITION_FOLLOWING)
            .pop();
          const [stage, method] = title ? text(title).split(/\s+-\s+/) : ["Etapa", undefined];
          const cKind = col(dh, "tipo");
          const cDesc = col(dh, "descricao");
          const cDate = col(dh, "data");
          const cWeight = col(dh, "peso");
          const opt = (c: number, td: Element[], max: number) => {
            const v = c >= 0 ? text(td[c]) : "";
            return v && v !== "-" ? v.slice(0, max) : null;
          };
          for (const row of Array.from(tbl.querySelectorAll("tr")).slice(1)) {
            const td = Array.from(row.children);
            const codeText = text(td[cCode]);
            if (!codeText || row.querySelector("th")) continue;
            assessments.push({
              stage: (stage ?? "Etapa").slice(0, 30),
              method: method ? method.slice(0, 60) : null,
              code: codeText.slice(0, 20),
              kind: opt(cKind, td, 40),
              description: opt(cDesc, td, 120),
              date: opt(cDate, td, 20),
              weight: cWeight >= 0 ? score(td[cWeight]) : null,
              score: score(td[cScore]),
            });
          }
        }
      }
      grades.assessments = assessments.slice(0, 40);

      const freq = text(cells[cFreq]).replace("%", "").replace(",", ".");
      subjects.push({
        diario,
        code: code.slice(0, 20),
        name: name.slice(0, 120),
        plannedUnits: int(text(cells[cPlanned])),
        deliveredUnits: int(text(cells[cDelivered])),
        absences: int(text(cells[cAbsences])),
        frequencyPct: freq && !Number.isNaN(Number(freq)) ? Math.min(100, Number(freq)) : null,
        professor: professor ? professor.slice(0, 120) : null,
        location: location ? location.slice(0, 300) : null,
        slots: slots.slice(0, 60),
        lessons: lessons.slice(0, 400),
        grades,
      });
    }

    const snapshot = { format: "suap", version: 1, host: location.hostname, period, subjects };
    const url = `${monitorOrigin}/semestres/importar#suap=${encodeURIComponent(JSON.stringify(snapshot))}`;
    say("pronto! Abrindo o Monitor…");
    if (target && !target.closed) target.location.href = url;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- roda no SUAP
    else window.location.assign(url);
    window.setTimeout(() => box.remove(), 4000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`não deu certo: ${message}`);
    box.style.background = "#7f1d1d";
    box.addEventListener("click", () => box.remove());
    if (target && !target.closed) target.close();
  }
}

/**
 * Texto do favorito (javascript:...) para o Monitor neste endereço. É curto de propósito: só
 * carrega /suap.js (o suapCollector acima) do Monitor. Um favorito de 14 mil caracteres não roda
 * no Chrome do Android, e assim o favorito salvo recebe as versões novas sem salvar de novo.
 */
export function suapBookmarklet(monitorOrigin: string): string {
  const src = JSON.stringify(`${monitorOrigin}/suap.js?v=`);
  const fail = JSON.stringify("Monitor de Presenças: não consegui carregar. Confira a internet.");
  const code = `(function(){var s=document.createElement("script");s.src=${src}+Date.now();s.onerror=function(){alert(${fail})};document.body.appendChild(s)})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
