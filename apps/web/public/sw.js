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

const VERSION = "v4";
const STATIC_CACHE = `presenca-static-${VERSION}`;
const PAGES_CACHE = "presenca-pages";
const OFFLINE_URL = "/offline";
const NAV_TIMEOUT_MS = 4000;

const CACHEABLE_PAGES = [
  /^\/$/,
  /^\/hoje$/,
  /^\/avisos$/,
  /^\/materias\/[^/]+$/,
  /^\/semestres(\/[^/]+)?$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const response = await fetch(OFFLINE_URL, { cache: "reload" });
      if (response.ok) {
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
    const publicPage = response.headers.get("x-presenca-publica") === "1";
    if (
      cacheable &&
      !publicPage &&
      response.ok &&
      response.type === "basic" &&
      !response.redirected
    ) {
      const cache = await caches.open(PAGES_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (cacheable) {
      const cache = await caches.open(PAGES_CACHE);
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
});

self.addEventListener("push", (event) => {
  let data = { title: "Monitor de Presenças", body: "Você tem um aviso novo.", url: "/avisos" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  const classes = Array.isArray(data.classes) ? data.classes : [];
  const actions =
    classes.length === 1
      ? [
          { action: "present", title: "Fui" },
          { action: "absent", title: "Faltei" },
        ]
      : classes.length > 1
        ? [{ action: "present", title: "Fui a todas" }]
        : [];
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      renotify: typeof data.tag === "string" && data.tag.startsWith("task:"),
      lang: "pt-BR",
      actions,
      data: { url: data.url, classes },
    }),
  );
});

async function markFromNotification(classes, status) {
  let done = 0;
  let already = 0;
  for (const c of classes) {
    const response = await fetch("/api/v1/attendance", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `push:${c.classDate}:${c.scheduleId}`,
      },
      body: JSON.stringify({
        subjectId: c.subjectId,
        scheduleId: c.scheduleId,
        classDate: c.classDate,
        status,
      }),
    });
    if (response.status === 401) return { ok: false, login: true };
    if (response.status === 409) already++;
    else if (!response.ok) return { ok: false };
    else done++;
  }
  return { ok: true, done, already };
}

async function openApp(path) {
  const target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) return;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
  if (open) {
    await open.focus();
    return open.navigate(target.href);
  }
  return self.clients.openWindow(target.href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const classes = Array.isArray(data.classes) ? data.classes : [];
  if ((event.action === "present" || event.action === "absent") && classes.length > 0) {
    event.waitUntil(
      (async () => {
        const result = await markFromNotification(classes, event.action).catch(() => ({
          ok: false,
        }));
        if (!result.ok) return openApp(result.login ? "/entrar?next=%2Fhoje" : "/hoje");
        const what = event.action === "present" ? "Presença registrada" : "Falta registrada";
        let title;
        if (result.done === 0) {
          title =
            classes.length === 1
              ? `${classes[0].name}: a aula já tinha registro`
              : "Essas aulas já tinham registro";
        } else if (classes.length === 1) {
          title = `${what} em ${classes[0].name}`;
        } else {
          title = `${what} em ${result.done} ${result.done === 1 ? "aula" : "aulas"}`;
        }
        const body =
          result.already > 0
            ? "O que já estava marcado não foi trocado. Para mudar, abra o app em Hoje."
            : "Para mudar, abra o app em Hoje.";
        return self.registration.showNotification(title, {
          body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: "checkin_reminder",
          lang: "pt-BR",
          data: { url: "/hoje" },
        });
      })(),
    );
    return;
  }
  event.waitUntil(openApp(data.url ?? "/avisos"));
});
