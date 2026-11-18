import { Injectable } from "@nestjs/common";

/**
 * Relógio injetável: os testes trocam por um fixo para controlar "hoje" sem depender da data real.
 */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }

  /** Data de hoje ("AAAA-MM-DD") no fuso do aluno, que é o que importa para "aulas de hoje". */
  todayIn(timezone: string): string {
    return localDate(this.now(), timezone);
  }
}

/** Dia civil de um instante em determinado fuso IANA (en-CA formata como AAAA-MM-DD). */
export function localDate(instant: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    // Fuso inválido gravado por engano: cai para UTC em vez de derrubar a requisição.
    return instant.toISOString().slice(0, 10);
  }
}
