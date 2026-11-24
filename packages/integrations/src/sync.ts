import { parseIcs } from "./ics";
import {
  deadlinesFromIcs,
  describeSyncError,
  enrichWithApi,
  moodleClient,
  type MoodleDeadline,
} from "./moodle";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch";
import { openSecret, secretAad } from "./secrets";

export interface ConnectionCredentials {
  userId: string;
  icsUrlEnc: string;
  baseUrl: string | null;
  wstokenEnc: string | null;
  /** Fuso da conta: vale para datas sem fuso no .ics. */
  timezone: string;
}

export interface FetchedDeadlines {
  deadlines: MoodleDeadline[];
  /** Aviso de sincronização parcial (o .ics veio, a API com wstoken falhou). */
  warning: string | null;
}

/**
 * Busca os prazos de uma conexão: abre as credenciais, baixa o .ics (sempre) e, se houver wstoken,
 * enriquece pela API. Roda fora de transação (rede). Falha no .ics é erro; falha só na API vira
 * aviso e a sincronização segue com o .ics.
 */
/** Baixa e lê o .ics (link em texto, já aberto). */
export async function fetchIcsDeadlines(
  icsUrl: string,
  timezone: string,
  fetchOptions: SafeFetchOptions = {},
): Promise<MoodleDeadline[]> {
  const res = await safeFetch(icsUrl, fetchOptions);
  return deadlinesFromIcs(parseIcs(res.body, timezone));
}

export async function fetchMoodleDeadlines(
  conn: ConnectionCredentials,
  key: Buffer,
  now: Date,
  fetchOptions: SafeFetchOptions = {},
): Promise<FetchedDeadlines> {
  const icsUrl = openSecret(conn.icsUrlEnc, key, secretAad(conn.userId, "ics_url"));
  const deadlines = await fetchIcsDeadlines(icsUrl, conn.timezone, fetchOptions);
  if (!conn.wstokenEnc || !conn.baseUrl) return { deadlines, warning: null };
  try {
    const token = openSecret(conn.wstokenEnc, key, secretAad(conn.userId, "wstoken"));
    const enriched = await enrichWithApi(
      deadlines,
      moodleClient(conn.baseUrl, token, fetchOptions),
      conn.baseUrl,
      now,
    );
    return { deadlines: enriched, warning: null };
  } catch (error) {
    return { deadlines, warning: `Parcial: ${describeSyncError(error)}` };
  }
}
