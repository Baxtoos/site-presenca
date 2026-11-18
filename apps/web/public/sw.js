/*
 * Service worker do Monitor de Presenças.
 *
 * - Arquivos estáticos com hash (/_next/static, ícones): cache primeiro (nunca mudam de conteúdo).
 * - Páginas da área logada: rede primeiro; a última versão boa fica guardada para abrir sem internet.
 * - /api: nunca passa pelo cache (dados pessoais e respostas sempre frescas). Registrar falta sem
 *   internet é trabalho da fila no IndexedDB, não do service worker.
 * - Sem rede e sem cópia: página /offline.
 *
 * Ao sair da conta, o app apaga o cache de páginas (ver lib/offline-cache.ts).
 */

const VERSION = "v1";
const STATIC_CACHE = `presenca-static-${VERSION}`;
const PAGES_CACHE = "presenca-pages";
const OFFLINE_URL = "/offline";
const NAV_TIMEOUT_MS = 4000;

/** Páginas que valem a pena abrir offline (todas da área logada). Login e cadastro, não. */
const CACHEABLE_PAGES = [/^\/$/, /^\/hoje$/, /^\/materias\/[^/]+$/, /^\/semestres(\/[^/]+)?$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const response = await fetch(OFFLINE_URL, { cache: "reload" });
      if (response.ok) {
        // Guarda também o CSS/JS que a página offline usa.
        const html = await response.clone().text();
        const assets = [...html.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g)].map(
          (m) => m[1],
        );
        await cache.put(OFFLINE_URL, response);
        await Promise.all([...new Set(assets)].map((url) => cache.add(url).catch(() => undefined)));
      }
      await cache.addAll(["/icons/icon-192.png", "/manifest.webmanifest"]).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("presenca-static-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Rede com prazo: numa conexão que "pendura" (Wi-Fi sem internet), cai para o cache. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function handleNavigation(request) {
  const url = new URL(request.url);
  const cacheable = CACHEABLE_PAGES.some((re) => re.test(url.pathname));
  try {
    const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
    // Só guarda página completa da própria URL: redirecionamento (sessão expirada → /entrar) não.
    if (cacheable && response.ok && response.type === "basic" && !response.redirected) {
      const cache = await caches.open(PAGES_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (cacheable) {
      const cache = await caches.open(PAGES_CACHE);
      // URL exata: /hoje?data=X nunca mostra a cópia de outro dia.
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

async function handleStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(handleStatic(request));
  }
  // O resto (dados RSC das navegações do Next, etc.) vai direto para a rede. Sem internet, o Next
  // faz uma navegação completa, que cai no handleNavigation acima.
});
