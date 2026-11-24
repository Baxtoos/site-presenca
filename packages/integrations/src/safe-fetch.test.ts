import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isBlockedAddress, safeFetch } from "./safe-fetch";

describe("endereços bloqueados", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "não é ip",
  ])("%s é bloqueado", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "200.133.0.1", "172.32.0.1", "2804:14c::1", "2001:4860:4860::8888"])(
    "%s é público",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("safeFetch", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok") return res.end("BEGIN:VCALENDAR");
      if (req.url === "/redirect-interno")
        return res.writeHead(302, { location: "http://169.254.169.254/latest" }).end();
      if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (req.url === "/grande") return res.end("x".repeat(5000));
      if (req.url === "/lento") return setTimeout(() => res.end("tarde"), 2_000);
      if (req.url === "/post") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => res.end(body));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const local = { allowHttp: true, allowPrivate: true };

  it("recusa http, usuário na URL, porta estranha e lixo", async () => {
    await expect(safeFetch("http://exemplo.com/a")).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeFetch("https://u:p@exemplo.com/a")).rejects.toMatchObject({
      code: "invalid_url",
    });
    await expect(safeFetch("https://exemplo.com:22/a")).rejects.toMatchObject({
      code: "invalid_url",
    });
    await expect(safeFetch("javascript:alert(1)")).rejects.toMatchObject({ code: "invalid_url" });
    await expect(safeFetch("nada")).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("recusa nome que aponta para IP interno (inclusive quando só um dos IPs é interno)", async () => {
    const resolve = async () => [
      { address: "200.133.0.1", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(safeFetch("https://moodle.exemplo.edu.br/x", { resolve })).rejects.toMatchObject({
      code: "blocked_address",
    });
    await expect(safeFetch("https://169.254.169.254/latest/meta-data")).rejects.toMatchObject({
      code: "blocked_address",
    });
    await expect(safeFetch("https://[::1]/")).rejects.toMatchObject({ code: "blocked_address" });
    // Sem allowPrivate, nem o servidor local dos testes passa.
    await expect(safeFetch(`${base}/ok`, { allowHttp: true })).rejects.toMatchObject({
      code: "blocked_address",
    });
  });

  it("busca, segue redirecionamento revalidando e para nos limites", async () => {
    expect((await safeFetch(`${base}/ok`, local)).body).toBe("BEGIN:VCALENDAR");
    // Redirecionar para metadados de nuvem é barrado mesmo com o primeiro salto local liberado
    // (o destino é revalidado; aqui allowPrivate=false no segundo salto não existe, então testa
    // com um resolvedor que só libera 127.0.0.1).
    await expect(
      safeFetch(`${base}/redirect-interno`, {
        allowHttp: true,
        allowPrivate: false,
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    await expect(safeFetch(`${base}/loop`, local)).rejects.toMatchObject({
      code: "too_many_redirects",
    });
    await expect(safeFetch(`${base}/grande`, { ...local, maxBytes: 1000 })).rejects.toMatchObject({
      code: "too_large",
    });
    await expect(safeFetch(`${base}/lento`, { ...local, timeoutMs: 300 })).rejects.toMatchObject({
      code: "timeout",
    });
    await expect(safeFetch(`${base}/nao-existe`, local)).rejects.toMatchObject({
      code: "http_error",
      status: 404,
    });
  });

  it("POST manda o formulário no corpo", async () => {
    const res = await safeFetch(`${base}/post`, {
      ...local,
      method: "POST",
      form: { wstoken: "segredo", wsfunction: "x" },
    });
    expect(res.body).toBe("wstoken=segredo&wsfunction=x");
  });
});
