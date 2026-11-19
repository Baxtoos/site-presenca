/**
 * Máscara da barra de endereço: o navegador mostra sempre só o domínio (`/`), em qualquer tela.
 *
 * Roda como script inline no <head>, ANTES do Next hidratar, para que o roteador capture estas
 * versões de pushState/replaceState como as "originais":
 * - toda escrita no histórico guarda a URL real em `state.__presencaUrl` (e em sessionStorage) e
 *   grava `/` na barra; o estado interno do Next (`__NA`, árvore) segue intacto;
 * - Voltar/Avançar: antes do Next tratar o popstate, a URL real volta por um instante (o Next
 *   restaura a tela a partir de `location.href`) e a próxima escrita dele mascara de novo;
 * - recarregar a página (F5, puxar para atualizar) carrega `/`; o script leva de volta à última
 *   tela visitada nesta aba.
 *
 * A URL inicial não é mascarada aqui: o Next lê `window.location` para montar o estado do
 * roteador e, logo na hidratação, ele mesmo chama replaceState, que já passa por aqui.
 * Consequência: código do app não deve ler `window.location.pathname/search` (vira `/`); use
 * usePathname/useSearchParams.
 *
 * É só cosmético: links (<a href>) e as chamadas à API continuam com os caminhos reais.
 */
export const URL_MASK_SCRIPT = `(function () {
  var KEY = "presenca:url";
  var h = window.history;
  var push = h.pushState.bind(h);
  var replace = h.replaceState.bind(h);
  function remember(path) {
    try { sessionStorage.setItem(KEY, path); } catch (e) {}
  }
  function realPath(url) {
    if (url === undefined || url === null || url === "") return null;
    try {
      var u = new URL(String(url), location.href);
      return u.origin === location.origin ? u.pathname + u.search + u.hash : null;
    } catch (e) {
      return null;
    }
  }
  function masked(original) {
    return function (state, unused, url) {
      var path = realPath(url);
      if (path === null) return original(state, unused, url);
      remember(path);
      return original(Object.assign({}, state || {}, { __presencaUrl: path }), unused, "/");
    };
  }
  h.pushState = masked(push);
  h.replaceState = masked(replace);
  window.addEventListener("popstate", function (event) {
    var path = event.state && event.state.__presencaUrl;
    if (path) {
      remember(path);
      replace(event.state, "", path);
    }
  });
  try {
    var nav = performance.getEntriesByType("navigation")[0];
    var last = sessionStorage.getItem(KEY);
    if (nav && nav.type === "reload" && last && last !== location.pathname + location.search) {
      location.replace(last);
    }
  } catch (e) {}
})();`;
