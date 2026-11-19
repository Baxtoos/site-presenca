/* global __ENV, __VU, __ITER */
// Teste de carga realista: uma turma usando o app ao mesmo tempo.
//
// Cada usuário virtual cria a própria conta, um semestre e uma matéria com aula todo dia, e
// depois repete o uso normal com pausas de quem está lendo a tela: abre o início, "Hoje", o
// calendário do mês, o "Posso faltar?" e marca presença ou falta numa aula passada.
//
// Uso (contra um ambiente de TESTE, nunca contra a produção gratuita):
//   API com limites folgados:  RATE_LIMIT_FACTOR=1000 NODE_ENV=test node apps/api/dist/main.js
//   k6 run -e API_URL=http://localhost:4000 -e WEB_ORIGIN=http://localhost:3000 infra/load/k6-turma.js
// Perfis: -e PERFIL=rapido (1 min, até 20 alunos) | padrao (4 min, até 60) | pico (5 min, até 150)
import { check, group, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const API_URL = (__ENV.API_URL || "http://localhost:4000").replace(/\/$/, "");
const WEB_ORIGIN = (__ENV.WEB_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

const PERFIS = {
  rapido: [
    { duration: "20s", target: 20 },
    { duration: "30s", target: 20 },
    { duration: "10s", target: 0 },
  ],
  padrao: [
    { duration: "1m", target: 60 },
    { duration: "2m", target: 60 },
    { duration: "1m", target: 0 },
  ],
  pico: [
    { duration: "1m", target: 50 },
    { duration: "1m", target: 150 },
    { duration: "2m", target: 150 },
    { duration: "1m", target: 0 },
  ],
};

export const options = {
  scenarios: {
    turma: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: PERFIS[__ENV.PERFIL || "padrao"],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // Menos de 1% de erros (409 de aula já marcada não conta como erro).
    http_req_failed: ["rate<0.01"],
    // Leituras do dia a dia rápidas; escrita (marcar aula) um pouco mais folgada.
    "http_req_duration{tipo:leitura}": ["p(95)<500", "p(99)<1000"],
    "http_req_duration{tipo:escrita}": ["p(95)<800"],
    checks: ["rate>0.99"],
  },
};

const marcar = new Trend("marcar_aula_ms", true);
http.setResponseCallback(http.expectedStatuses(200, 201, 202, 204, 409));

const DAY = 86_400_000;
/** Data de hoje em São Paulo (UTC−3), como AAAA-MM-DD. */
function today() {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}
function shift(iso, days) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
function isoWeekday(iso) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const json = { "content-type": "application/json", origin: WEB_ORIGIN };

/**
 * O cookie de sessão é `__Host-sid` (Secure): o k6 não o devolve sozinho em http://localhost,
 * então cada usuário virtual guarda o próprio e manda no cabeçalho.
 */
let session = "";
const auth = () => (session ? { cookie: `__Host-sid=${session}` } : {});
const read = (name) => ({ headers: auth(), tags: { tipo: "leitura", name } });
const write = (name, extra = {}) => ({
  headers: { ...json, ...auth(), ...extra },
  tags: { tipo: "escrita", name },
});

/** Estado de cada usuário virtual. */
let aluno = null;

function criarAluno() {
  const hoje = today();
  const email = `carga.${__VU}.${Date.now()}@presenca.local`;
  const reg = http.post(
    `${API_URL}/v1/auth/register`,
    JSON.stringify({ email, password: `senha-de-carga-${__VU}-segura`, fullName: `Aluno ${__VU}` }),
    write("cadastro"),
  );
  if (!check(reg, { "cadastro 201": (r) => r.status === 201 })) return null;
  session = reg.cookies["__Host-sid"]?.[0]?.value ?? "";

  const sem = http.post(
    `${API_URL}/v1/semesters`,
    JSON.stringify({
      label: `Carga ${__VU}`,
      startsOn: shift(hoje, -60),
      endsOn: shift(hoje, 60),
      isCurrent: true,
    }),
    write("criar semestre"),
  );
  if (!check(sem, { "semestre 201": (r) => r.status === 201 })) return null;

  const schedules = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    startsAt: "19:00",
    endsAt: "20:40",
    units: 2,
  }));
  const sub = http.post(
    `${API_URL}/v1/semesters/${sem.json("id")}/subjects`,
    JSON.stringify({
      name: "Cálculo I",
      unitsPerClass: 2,
      countingMode: "manual",
      manualMaxUnits: 200,
      schedules,
    }),
    write("criar matéria"),
  );
  if (!check(sub, { "matéria 201": (r) => r.status === 201 })) return null;
  const subject = sub.json();
  return {
    subjectId: subject.id,
    scheduleByWeekday: Object.fromEntries(subject.schedules.map((s) => [s.weekday, s.id])),
  };
}

export default function () {
  if (!aluno) {
    aluno = criarAluno();
    if (!aluno) {
      sleep(5);
      return;
    }
  }
  const { subjectId, scheduleByWeekday } = aluno;

  group("abrir o app", () => {
    const me = http.get(`${API_URL}/v1/me`, read("me"));
    check(me, { "me 200": (r) => r.status === 200 });
    const hoje = http.get(`${API_URL}/v1/today`, read("hoje"));
    check(hoje, { "hoje 200": (r) => r.status === 200 });
  });
  sleep(1 + Math.random() * 2);

  group("página da matéria", () => {
    const cal = http.get(`${API_URL}/v1/subjects/${subjectId}/calendar`, read("calendário"));
    check(cal, { "calendário 200": (r) => r.status === 200 });
    const sim = http.get(`${API_URL}/v1/subjects/${subjectId}/simulate`, read("posso faltar"));
    check(sim, { "posso faltar 200": (r) => r.status === 200 });
  });
  sleep(1 + Math.random() * 3);

  group("marcar uma aula", () => {
    // Uma aula passada diferente a cada volta (de 1 a 50 dias atrás).
    const date = shift(today(), -1 - (__ITER % 50));
    const status = Math.random() < 0.8 ? "present" : "absent";
    const res = http.post(
      `${API_URL}/v1/attendance`,
      JSON.stringify({
        subjectId,
        classDate: date,
        scheduleId: scheduleByWeekday[isoWeekday(date)],
        status,
      }),
      write("marcar aula", { "idempotency-key": `${__VU}-${__ITER}-${Date.now()}` }),
    );
    marcar.add(res.timings.duration);
    check(res, {
      "marcar 201 (ou 409 se já marcada)": (r) => r.status === 201 || r.status === 409,
    });
  });
  sleep(2 + Math.random() * 4);
}
