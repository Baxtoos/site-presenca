/* global __ENV */
// Teste de carga e fumaça com k6 (Fase 9).
// Uso:
//   k6 run -e API_URL=http://localhost:4000 infra/load/k6-smoke.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

const API_URL = (__ENV.API_URL || "http://localhost:4000").replace(/\/$/, "");

export default function () {
  const health = http.get(`${API_URL}/healthz`);
  check(health, {
    "healthz 200": (r) => r.status === 200,
    "healthz status ok": (r) => r.json("status") === "ok",
  });

  const ready = http.get(`${API_URL}/readyz`);
  check(ready, {
    "readyz 200": (r) => r.status === 200,
    "readyz status ready": (r) => r.json("status") === "ready",
  });

  sleep(0.5);
}
