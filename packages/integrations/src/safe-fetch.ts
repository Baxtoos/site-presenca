import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Busca HTTP para URLs informadas por alunos (link .ics, endereço do Moodle), protegida contra
 * SSRF: só https (http apenas com `allowHttp`, nos testes), sem usuário e senha na URL, DNS
 * resolvido antes e a conexão presa ao IP validado (sem troca de DNS no meio), nenhum endereço
 * interno (loopback, RFC 1918, link-local/metadados de nuvem, CGNAT, IPv6 privado), redirecionamento
 * só revalidado e no máximo 3, tempo curto e resposta limitada.
 */

export class SafeFetchError extends Error {
  override name = "SafeFetchError";
  constructor(
    message: string,
    readonly code:
      | "invalid_url"
      | "blocked_address"
      | "dns_failed"
      | "timeout"
      | "too_large"
      | "too_many_redirects"
      | "http_error"
      | "network_error",
    readonly status?: number,
  ) {
    super(message);
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return blocked.check(address, "ipv4");
  const v4 = embeddedIpv4(address);
  if (v4) return blocked.check(v4, "ipv4");
  return blocked.check(address, "ipv6");
}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  form?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<LookupAddress[]>;
}

export interface SafeResponse {
  status: number;
  contentType: string;
  body: string;
  url: string;
}

const defaultResolve = (host: string) =>
  new Promise<LookupAddress[]>((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    );
  });

async function validate(
  raw: string,
  options: SafeFetchOptions,
): Promise<{ url: URL; address: LookupAddress }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("Link inválido.", "invalid_url");
  }
  const httpOk = options.allowHttp && url.protocol === "http:";
  if (url.protocol !== "https:" && !httpOk) {
    throw new SafeFetchError("Use um link que comece com https://.", "invalid_url");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("O link não pode ter usuário e senha.", "invalid_url");
  }
  if (url.port && !httpOk && !["443", "8443"].includes(url.port)) {
    throw new SafeFetchError("Porta não permitida.", "invalid_url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: LookupAddress[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await (options.resolve ?? defaultResolve)(host);
    } catch {
      throw new SafeFetchError("Não foi possível encontrar esse endereço.", "dns_failed");
    }
  }
  if (addresses.length === 0) {
    throw new SafeFetchError("Não foi possível encontrar esse endereço.", "dns_failed");
  }
  if (!options.allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
    throw new SafeFetchError("Esse endereço não é permitido.", "blocked_address");
  }
  return { url, address: addresses[0]! };
}

function once(
  url: URL,
  address: LookupAddress,
  options: SafeFetchOptions,
  deadline: number,
): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const body = options.form ? new URLSearchParams(options.form).toString() : undefined;
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError("Demorou demais.", "timeout"));
    const req = client.request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          "user-agent": "MonitorDePresencas/1.0 (+integracao)",
          accept: "text/calendar, application/json, */*;q=0.5",
          ...(body
            ? {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
        },
        lookup: (_host, opts, callback) => {
          if ((opts as { all?: boolean }).all) {
            (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [address]);
          } else {
            callback(null, address.address, address.family);
          }
        },
        timeout: remaining,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, contentType: "", body: "" });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new SafeFetchError("Resposta grande demais.", "too_large"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new SafeFetchError("Resposta grande demais.", "too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status,
            contentType: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", () => reject(new SafeFetchError("A conexão caiu.", "network_error")));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new SafeFetchError("Demorou demais.", "timeout"));
    });
    req.on("error", (error) => {
      if (error instanceof SafeFetchError) return reject(error);
      reject(new SafeFetchError("Não foi possível conectar.", "network_error"));
    });
    req.end(body);
  });
}

export async function safeFetch(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const deadline = Date.now() + (options.timeoutMs ?? 8_000);
  const maxRedirects = options.maxRedirects ?? 3;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url, address } = await validate(current, options);
    const res = await once(url, address, options, deadline);
    if (res.location !== undefined) {
      if (!res.location) throw new SafeFetchError("Redirecionamento inválido.", "http_error");
      current = new URL(res.location, url).toString();
      options = { ...options, method: "GET", form: undefined };
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new SafeFetchError(`O site respondeu ${res.status}.`, "http_error", res.status);
    }
    return {
      status: res.status,
      contentType: res.contentType,
      body: res.body,
      url: url.toString(),
    };
  }
  throw new SafeFetchError("Redirecionamentos demais.", "too_many_redirects");
}
