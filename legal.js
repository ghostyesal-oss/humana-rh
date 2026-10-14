/* Bandeau cookies + identité légale (SIRET / DPO depuis HUMANA_CONFIG). */
(function () {
  var noticeFlag = "daylyx-cookie-notice";
  var EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  var MAX_LEGAL = 220;

  function alreadySeen() {
    try {
      return localStorage.getItem(noticeFlag) === "1";
    } catch (_) {
      return true;
    }
  }

  function acknowledge(bar) {
    try {
      localStorage.setItem(noticeFlag, "1");
    } catch (_) { /* ignore */ }
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function mount() {
    if (alreadySeen() || document.getElementById("daylyx-cookie-notice")) return;

    var bar = el("div", "cookie-notice");
    bar.id = "daylyx-cookie-notice";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-labelledby", "cookie-notice-title");

    var copy = el("div", "cookie-notice-copy");
    var title = el("p");
    title.id = "cookie-notice-title";
    var strong = el("strong", "", "Cookies techniques");
    title.appendChild(strong);
    var body = el("p");
    body.appendChild(document.createTextNode("Daylyx utilise uniquement des cookies nécessaires à la connexion et à la sécurité. Aucun cookie publicitaire. "));
    var more = el("a", "", "En savoir plus");
    more.href = "/cookies";
    body.appendChild(more);
    body.appendChild(document.createTextNode("."));
    copy.appendChild(title);
    copy.appendChild(body);

    var button = el("button", "primary", "J'ai compris");
    button.type = "button";
    button.addEventListener("click", function () {
      acknowledge(bar);
    });

    bar.appendChild(copy);
    bar.appendChild(button);
    document.body.appendChild(bar);
  }

  function cleanLegal(value, max) {
    return String(value || "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, max || MAX_LEGAL);
  }

  function fillLegal() {
    var cfg = window.HUMANA_CONFIG || {};
    var fields = {
      publisherName: cleanLegal(cfg.LEGAL_PUBLISHER_NAME),
      publisherAddress: cleanLegal(cfg.LEGAL_PUBLISHER_ADDRESS),
      siret: cleanLegal(cfg.LEGAL_SIRET, 20).replace(/[^\d\s]/g, ""),
      director: cleanLegal(cfg.LEGAL_PUBLICATION_DIRECTOR),
      dpoName: cleanLegal(cfg.LEGAL_DPO_NAME),
      dpoEmail: cleanLegal(cfg.LEGAL_DPO_EMAIL, 120)
    };
    Object.keys(fields).forEach(function (key) {
      var val = fields[key];
      if (!val) return;
      if (key === "dpoEmail" && !EMAIL_RE.test(val)) return;
      var nodes = document.querySelectorAll('[data-legal="' + key + '"]');
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        node.textContent = "";
        if (key === "dpoEmail") {
          var link = document.createElement("a");
          link.href = "mailto:" + val;
          link.textContent = val;
          node.appendChild(link);
        } else {
          node.textContent = val;
        }
      }
    });
  }

  function boot() {
    fillLegal();
    mount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
