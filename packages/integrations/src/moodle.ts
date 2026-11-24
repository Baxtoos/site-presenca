import type { IcsEvent } from "./ics";
import { SafeFetchError, safeFetch, type SafeFetchOptions } from "./safe-fetch";

/** Um prazo vindo do Moodle, pronto para virar (ou atualizar) uma tarefa. */
export interface MoodleDeadline {
  source: "moodle_ics" | "moodle_api";
  /** Identificador estável na origem (UID do .ics ou "assign:{id}"). */
  externalUid: string;
  title: string;
  dueAt: Date;
  /** Código da turma (CATEGORIES do .ics ou shortname da API); null se o Moodle não informar. */
  courseKey: string | null;
  url: string | null;
  /** Só com wstoken: o aluno já enviou a atividade no Moodle. */
  submitted: boolean;
}

// Eventos de abertura não são prazo ("Questionário 2 abre", "Quiz opens").
const OPENING = /\b(abre|abrir[áa]|opens|começa|inicia|disponível a partir)\s*$/i;
// Sufixos que o Moodle põe no título do prazo, em português e inglês.
const DUE_SUFFIX =
  /\s*(?:[-–:]\s*)?(?:está para ser entregue|deve ser entregue|vence|venceu|fecha|encerra|is due|closes|due)\s*$/i;

/** Remove o "está para ser entregue" e afins: "Lista 3 está para ser entregue" → "Lista 3". */
export function cleanMoodleTitle(summary: string): string {
  const cleaned = summary.replace(DUE_SUFFIX, "").trim();
  return (cleaned || summary.trim()).slice(0, 200);
}

/** Normaliza para comparar títulos (sem acento, caixa e espaços extras). */
export const normalizeTitle = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Eventos do .ics do Moodle → prazos (sem aberturas, com título limpo e a turma). */
export function deadlinesFromIcs(events: readonly IcsEvent[]): MoodleDeadline[] {
  return events
    .filter((e) => e.summary && !OPENING.test(e.summary))
    .map((e) => ({
      source: "moodle_ics" as const,
      externalUid: e.uid,
      title: cleanMoodleTitle(e.summary),
      dueAt: e.start,
      courseKey: e.categories[0]?.slice(0, 200) ?? null,
      url: e.url,
      submitted: false,
    }));
}

// ---------------------------------------------------------------- Web Services (wstoken)

export class MoodleApiError extends Error {
  override name = "MoodleApiError";
  constructor(
    message: string,
    /** errorcode do Moodle (invalidtoken, accessexception, servicenotavailable…). */
    readonly code: string,
  ) {
    super(message);
  }
}

export interface MoodleAssignment {
  id: number;
  cmid: number;
  name: string;
  dueAt: Date | null;
  courseShortname: string;
}

export interface MoodleClient {
  siteInfo(): Promise<{ userId: number; siteName: string }>;
  courses(userId: number): Promise<{ id: number; shortname: string; fullname: string }[]>;
  assignments(courseIds: number[]): Promise<MoodleAssignment[]>;
  submitted(assignId: number): Promise<boolean>;
}

/** Endereço base do Moodle normalizado ("https://moodle.x.edu.br" sem barra no fim). */
export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * Cliente REST do Moodle (Moodle mobile web service). O token vai no corpo do POST, nunca na URL
 * (que pode acabar em logs de proxies).
 */
export function moodleClient(
  baseUrl: string,
  token: string,
  fetchOptions: SafeFetchOptions = {},
): MoodleClient {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/webservice/rest/server.php`;
  async function call<T>(wsfunction: string, params: Record<string, string> = {}): Promise<T> {
    const res = await safeFetch(endpoint, {
      ...fetchOptions,
      method: "POST",
      form: { wstoken: token, wsfunction, moodlewsrestformat: "json", ...params },
    });
    let data: unknown;
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new MoodleApiError("O Moodle não respondeu como esperado.", "invalidresponse");
    }
    if (data && typeof data === "object" && "exception" in data) {
      const d = data as { errorcode?: string; message?: string };
      throw new MoodleApiError(d.message ?? "Erro do Moodle.", d.errorcode ?? "unknown");
    }
    return data as T;
  }

  return {
    async siteInfo() {
      const d = await call<{ userid: number; sitename: string }>("core_webservice_get_site_info");
      return { userId: d.userid, siteName: d.sitename };
    },
    async courses(userId) {
      const d = await call<{ id: number; shortname: string; fullname: string }[]>(
        "core_enrol_get_users_courses",
        { userid: String(userId) },
      );
      return d.map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname }));
    },
    async assignments(courseIds) {
      if (courseIds.length === 0) return [];
      const params: Record<string, string> = {};
      courseIds.forEach((id, i) => (params[`courseids[${i}]`] = String(id)));
      const d = await call<{
        courses: {
          shortname: string;
          assignments: { id: number; cmid: number; name: string; duedate: number }[];
        }[];
      }>("mod_assign_get_assignments", params);
      return d.courses.flatMap((c) =>
        c.assignments.map((a) => ({
          id: a.id,
          cmid: a.cmid,
          name: a.name,
          dueAt: a.duedate > 0 ? new Date(a.duedate * 1000) : null,
          courseShortname: c.shortname,
        })),
      );
    },
    async submitted(assignId) {
      const d = await call<{ lastattempt?: { submission?: { status?: string } } }>(
        "mod_assign_get_submission_status",
        { assignid: String(assignId) },
      );
      return d.lastattempt?.submission?.status === "submitted";
    },
  };
}

/**
 * Upgrade com wstoken: casa as atividades da API com os prazos do .ics (mesma turma, mesmo título
 * normalizado e mesmo minuto do prazo) para trazer o link direto e saber se já foi enviada. Atividades
 * futuras que o .ics não trouxe entram como prazo próprio (source moodle_api).
 */
export async function enrichWithApi(
  deadlines: MoodleDeadline[],
  client: MoodleClient,
  baseUrl: string,
  now: Date,
): Promise<MoodleDeadline[]> {
  const site = await client.siteInfo();
  const courses = await client.courses(site.userId);
  const assignments = await client.assignments(courses.map((c) => c.id));
  const minute = (d: Date) => Math.floor(d.getTime() / 60_000);
  const base = normalizeBaseUrl(baseUrl);
  const recent = now.getTime() - 14 * 86_400_000;
  const result = deadlines.map((d) => ({ ...d }));
  let statusCalls = 0;

  for (const a of assignments) {
    if (!a.dueAt || a.dueAt.getTime() < recent) continue;
    const url = `${base}/mod/assign/view.php?id=${a.cmid}`;
    // Limite de chamadas por sincronização (cada status é uma requisição ao Moodle).
    const submitted = statusCalls < 60 ? (statusCalls++, await client.submitted(a.id)) : false;
    const match = result.find(
      (d) =>
        d.source === "moodle_ics" &&
        minute(d.dueAt) === minute(a.dueAt!) &&
        normalizeTitle(d.title) === normalizeTitle(a.name) &&
        (d.courseKey === null || normalizeTitle(d.courseKey) === normalizeTitle(a.courseShortname)),
    );
    if (match) {
      match.url = url;
      match.submitted = submitted;
      match.courseKey ??= a.courseShortname;
    } else if (a.dueAt.getTime() > now.getTime()) {
      result.push({
        source: "moodle_api",
        externalUid: `assign:${a.id}`,
        title: a.name.slice(0, 200),
        dueAt: a.dueAt,
        courseKey: a.courseShortname,
        url,
        submitted,
      });
    }
  }
  return result;
}

/** Mensagem curta e sem dados sensíveis para "última sincronização falhou". */
export function describeSyncError(error: unknown): string {
  if (error instanceof SafeFetchError) {
    switch (error.code) {
      case "http_error":
        return error.status === 404 || error.status === 403
          ? "O Moodle recusou o link. Gere um novo link do calendário e cole de novo."
          : `O Moodle respondeu com erro (${error.status ?? "?"}).`;
      case "timeout":
        return "O Moodle demorou demais para responder.";
      case "too_large":
        return "O calendário do Moodle é grande demais.";
      case "dns_failed":
        return "Não foi possível encontrar o endereço do Moodle.";
      case "blocked_address":
      case "invalid_url":
        return error.message;
      default:
        return "Não foi possível falar com o Moodle.";
    }
  }
  if (error instanceof MoodleApiError) {
    return error.code === "invalidtoken"
      ? "A chave de segurança do Moodle não vale mais. Gere outra e cole de novo."
      : error.code === "servicenotavailable" || error.code === "accessexception"
        ? "O Moodle da instituição não libera o serviço móvel para essa chave."
        : "O Moodle recusou a consulta.";
  }
  if (error instanceof Error && error.name === "IcsError") return error.message;
  if (error instanceof Error && error.name === "SecretError") {
    return "Não foi possível abrir os dados da conexão. Conecte o Moodle de novo.";
  }
  return "Falha inesperada ao sincronizar.";
}
