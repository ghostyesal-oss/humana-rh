/* Bandeau d'information cookies (cookies techniques uniquement, pas de mur de consentement). */
(function () {
  var noticeFlag = "daylyx-cookie-notice";

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
