import { addDays, type IsoDate } from "./calendar";

/**
 * Feriados nacionais do Brasil (Lei 662/1949, Lei 6.802/1980 e Lei 14.759/2023) e os pontos
 * facultativos que costumam parar as aulas. Sem feriados estaduais e municipais: esses o aluno
 * cadastra à mão, como os recessos da faculdade.
 */
export interface Holiday {
  startsOn: IsoDate;
  endsOn: IsoDate;
  label: string;
  /** Ponto facultativo (Carnaval, Corpus Christi): cada faculdade decide se tem aula. */
  optional: boolean;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const single = (date: IsoDate, label: string, optional = false): Holiday => ({
  startsOn: date,
  endsOn: date,
  label,
  optional,
});

/** Feriados nacionais e pontos facultativos de um ano, em ordem de data. */
export function brazilHolidays(year: number): Holiday[] {
  const y = String(year);
  const easter = easterSunday(year);
  const list: Holiday[] = [
    single(`${y}-01-01`, "Confraternização Universal"),
    {
      startsOn: addDays(easter, -48),
      endsOn: addDays(easter, -47),
      label: "Carnaval",
      optional: true,
    },
    single(addDays(easter, -2), "Sexta-feira Santa"),
    single(`${y}-04-21`, "Tiradentes"),
    single(`${y}-05-01`, "Dia do Trabalho"),
    single(addDays(easter, 60), "Corpus Christi", true),
    single(`${y}-09-07`, "Independência do Brasil"),
    single(`${y}-10-12`, "Nossa Senhora Aparecida"),
    single(`${y}-11-02`, "Finados"),
    single(`${y}-11-15`, "Proclamação da República"),
    ...(year >= 2024 ? [single(`${y}-11-20`, "Dia de Zumbi e da Consciência Negra")] : []),
    single(`${y}-12-25`, "Natal"),
  ];
  return list.sort((p, q) => p.startsOn.localeCompare(q.startsOn));
}

/** Feriados que caem (ao menos em parte) entre `from` e `to`, inclusive. */
export function brazilHolidaysBetween(from: IsoDate, to: IsoDate): Holiday[] {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  const out: Holiday[] = [];
  for (let year = first; year <= last; year++) {
    for (const h of brazilHolidays(year)) {
      if (h.endsOn >= from && h.startsOn <= to) out.push(h);
    }
  }
  return out;
}
