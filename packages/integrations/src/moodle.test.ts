import { describe, expect, it } from "vitest";
import { enrichWithApi, type MoodleClient, type MoodleDeadline } from "./moodle";

const NOW = new Date("2026-11-24T15:00:00Z");

function fakeClient(submittedIds: number[]): MoodleClient & { statusCalls: number } {
  const client = {
    statusCalls: 0,
    siteInfo: async () => ({ userId: 7, siteName: "Moodle Exemplo" }),
    courses: async () => [{ id: 10, shortname: "SI.TESD5 - 2026-2", fullname: "TESD5" }],
    assignments: async () => [
      {
        id: 100,
        cmid: 555,
        name: "Lista 3",
        dueAt: new Date("2026-11-30T02:59:00Z"),
        courseShortname: "SI.TESD5 - 2026-2",
      },
      {
        id: 101,
        cmid: 556,
        name: "Projeto",
        dueAt: new Date("2026-12-15T02:59:00Z"),
        courseShortname: "SI.TESD5 - 2026-2",
      },
      {
        id: 102,
        cmid: 557,
        name: "Antiga",
        dueAt: new Date("2026-09-01T02:59:00Z"),
        courseShortname: "SI.TESD5 - 2026-2",
      },
      { id: 103, cmid: 558, name: "Sem prazo", dueAt: null, courseShortname: "SI.TESD5 - 2026-2" },
    ],
    submitted: async (id: number) => {
      client.statusCalls++;
      return submittedIds.includes(id);
    },
  };
  return client;
}

describe("upgrade com wstoken", () => {
  const ics: MoodleDeadline[] = [
    {
      source: "moodle_ics",
      externalUid: "1234@moodle",
      title: "Lista 3",
      dueAt: new Date("2026-11-30T02:59:00Z"),
      courseKey: "SI.TESD5 - 2026-2",
      url: null,
      submitted: false,
    },
  ];

  it("casa pelo título e prazo: traz o link direto e se já foi enviada", async () => {
    const client = fakeClient([100]);
    const result = await enrichWithApi(ics, client, "https://moodle.exemplo.edu.br/", NOW);
    expect(result[0]).toMatchObject({
      externalUid: "1234@moodle",
      url: "https://moodle.exemplo.edu.br/mod/assign/view.php?id=555",
      submitted: true,
    });
    // O que o .ics não trouxe e ainda vai vencer entra como prazo da API.
    expect(result[1]).toMatchObject({
      source: "moodle_api",
      externalUid: "assign:101",
      title: "Projeto",
      submitted: false,
    });
    expect(result).toHaveLength(2);
    // Atividade antiga (mais de 14 dias) e sem prazo nem consultam o status.
    expect(client.statusCalls).toBe(2);
  });

  it("não altera a lista original", async () => {
    await enrichWithApi(ics, fakeClient([100]), "https://moodle.exemplo.edu.br", NOW);
    expect(ics[0]!.url).toBeNull();
  });
});
