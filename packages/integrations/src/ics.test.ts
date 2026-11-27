import { describe, expect, it } from "vitest";
import { IcsError, parseIcs } from "./ics";
import { cleanMoodleTitle, deadlinesFromIcs } from "./moodle";

const MOODLE_ICS = [
  "BEGIN:VCALENDAR",
  "METHOD:PUBLISH",
  "PRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2024100700//EN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:1234@moodle.exemplo.edu.br",
  "SUMMARY:Lista 3 está para ser entregue",
  "DESCRIPTION:Exercícios 1 a 10\\, capítulo 4\\nEntregar em PDF",
  "CLASS:PUBLIC",
  "LAST-MODIFIED:20261101T120000Z",
  "DTSTAMP:20261124T150000Z",
  "DTSTART:20261130T025900Z",
  "DTEND:20261130T025900Z",
  "CATEGORIES:SI.TESD5 - 2026-2",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1235@moodle.exemplo.edu.br",
  "SUMMARY:Questionário 2 abre",
  "DTSTART:20261125T120000Z",
  "DTEND:20261125T120000Z",
  "CATEGORIES:SI.BD2 - 2026-2",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1236@moodle.exemplo.edu.br",
  "SUMMARY:Questionário 2 fecha",
  "DTSTART;TZID=America/Sao_Paulo:20261202T235900",
  "CATEGORIES:SI.BD2 - 2026-2",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "DESCRIPTION:não é o evento",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1237@moodle.exemplo.edu.br",
  "SUMMARY:Seminário final com um título bem comprido que o Moodle dobra em v",
  " árias linhas",
  "DTSTART;VALUE=DATE:20261210",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Sem UID é ignorado",
  "DTSTART:20261210T120000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("leitor de .ics", () => {
  const events = parseIcs(MOODLE_ICS);

  it("lê os eventos com UID, desdobra linhas e desfaz escapes", () => {
    expect(events.map((e) => e.uid)).toEqual([
      "1234@moodle.exemplo.edu.br",
      "1235@moodle.exemplo.edu.br",
      "1236@moodle.exemplo.edu.br",
      "1237@moodle.exemplo.edu.br",
    ]);
    expect(events[0]!.description).toBe("Exercícios 1 a 10, capítulo 4\nEntregar em PDF");
    expect(events[0]!.categories).toEqual(["SI.TESD5 - 2026-2"]);
    expect(events[3]!.summary).toBe(
      "Seminário final com um título bem comprido que o Moodle dobra em várias linhas",
    );
  });

  it("datas em UTC, com TZID e dia inteiro (fim do dia no fuso do aluno)", () => {
    expect(events[0]!.start.toISOString()).toBe("2026-11-30T02:59:00.000Z");
    expect(events[2]!.start.toISOString()).toBe("2026-12-03T02:59:00.000Z");
    expect(events[3]).toMatchObject({ allDay: true });
    expect(events[3]!.start.toISOString()).toBe("2026-12-11T02:59:00.000Z");
  });

  it("o VALARM não vaza para o evento", () => {
    expect(events[2]!.description).toBe("");
  });

  it("recusa o que não é calendário", () => {
    expect(() => parseIcs("<html>login</html>")).toThrow(IcsError);
  });
});

describe("prazos do Moodle", () => {
  it("tira aberturas e limpa o sufixo do título", () => {
    const deadlines = deadlinesFromIcs(parseIcs(MOODLE_ICS));
    expect(deadlines.map((d) => [d.title, d.courseKey])).toEqual([
      ["Lista 3", "SI.TESD5 - 2026-2"],
      ["Questionário 2", "SI.BD2 - 2026-2"],
      ["Seminário final com um título bem comprido que o Moodle dobra em várias linhas", null],
    ]);
    expect(deadlines.every((d) => d.source === "moodle_ics" && !d.submitted)).toBe(true);
  });

  it.each([
    ["Lista 3 está para ser entregue", "Lista 3"],
    ["Trabalho 1 deve ser entregue", "Trabalho 1"],
    ["Quiz 4 closes", "Quiz 4"],
    ["Assignment is due", "Assignment"],
    ["Prova final", "Prova final"],
    ["fecha", "fecha"],
  ])("%s → %s", (summary, title) => {
    expect(cleanMoodleTitle(summary)).toBe(title);
  });
});
