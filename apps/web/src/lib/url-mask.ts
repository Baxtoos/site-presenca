export const URL_MASK_SCRIPT = `(function () {
  // Retrato do SUAP vindo do favorito (#suap=...): guardado antes de a URL ser mascarada, e
  // sobrevive ao login se a pessoa ainda não estava logada (lib/suap-collector.ts).
  try {
    if (location.hash.indexOf("#suap=") === 0) {
      sessionStorage.setItem("presenca:suap", location.hash.slice(6));
    }
  } catch (e) {}
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
