/* Logo Daylyx : présentation à l'arrivée, chargement après login. */
(function () {
  var INTRO_MS = 2300;
  var REVEAL_MS = 850;
  var introTimer = 0;
  var hideTimer = 0;
  var introStarted = false;
  var loaderActive = false;

  function lockupHtml(extraClass) {
    var cls = "daylyx-lockup";
    if (extraClass) cls += " " + extraClass;
    return (
      '<div class="' + cls + '" data-daylyx-mark role="img" aria-label="Daylyx">' +
        '<svg class="daylyx-mark" viewBox="4 14 154 132" aria-hidden="true">' +
          '<g class="daylyx-stem">' +
            '<rect x="8" y="18" width="32" height="124" rx="16" fill="#0046fe"></rect>' +
            '<circle class="daylyx-hole" cx="24" cy="46" r="6"></circle>' +
          "</g>" +
          '<path class="daylyx-arc" pathLength="1" d="M 66 38.43 A 48 48 0 1 1 66 121.57"></path>' +
          '<circle class="daylyx-dot" cx="84" cy="80" r="6.4" fill="#0046fe"></circle>' +
        "</svg>" +
        '<div class="daylyx-letters" aria-hidden="true">' +
          "<span>a</span><span>y</span><span>l</span><span>y</span><span>x</span>" +
        "</div>" +
      "</div>"
    );
  }

  function prepare(lockup) {
    if (!lockup) return;
    var arc = lockup.querySelector(".daylyx-arc");
    if (arc && !arc.getAttribute("pathLength")) arc.setAttribute("pathLength", "1");
  }

  function clear(lockup) {
    if (!lockup) return;
    lockup.classList.remove("play", "loop", "resolved");
  }

  function restart(lockup, modeClass) {
    if (!lockup) return;
    clear(lockup);
    void lockup.offsetWidth;
    lockup.classList.add(modeClass);
  }

  function playIntro(lockup) {
    if (!lockup) return;
    prepare(lockup);
    restart(lockup, "play");
  }

  function playLoader(lockup) {
    if (!lockup) return;
    prepare(lockup);
    restart(lockup, "loop");
  }

  function reveal(lockup) {
    if (!lockup) return;
    prepare(lockup);
    clear(lockup);
    void lockup.offsetWidth;
    lockup.classList.add("resolved");
  }

  function ensureIntroScreen() {
    var existing = document.getElementById("daylyx-intro-screen");
    if (existing) return existing;
    var screen = document.createElement("div");
    screen.id = "daylyx-intro-screen";
    screen.className = "daylyx-intro-screen";
    screen.setAttribute("aria-live", "polite");
    screen.innerHTML = lockupHtml();
    document.body.appendChild(screen);
    return screen;
  }

  function ensureBootLockup() {
    var boot = document.getElementById("auth-boot-screen");
    if (!boot) return null;
    var lockup = boot.querySelector("[data-daylyx-mark]");
    if (lockup) return lockup;
    var card = boot.querySelector(".auth-boot-card") || boot;
    var oldBrand = card.querySelector(".brand");
    var wrap = document.createElement("div");
    wrap.innerHTML = lockupHtml();
    var node = wrap.firstChild;
    if (oldBrand) card.replaceChild(node, oldBrand);
    else card.insertBefore(node, card.firstChild);
    return node;
  }

  function finishIntro() {
    var html = document.documentElement;
    var screen = document.getElementById("daylyx-intro-screen");
    if (!html.classList.contains("daylyx-presenting")) return;
    if (screen) {
      screen.classList.add("is-leaving");
      screen.setAttribute("aria-hidden", "true");
    }
    window.setTimeout(function () {
      html.classList.remove("daylyx-presenting");
      if (screen) screen.hidden = true;
    }, 420);
  }

  function startIntroIfNeeded() {
    var html = document.documentElement;
    if (introStarted) return;
    if (!html.classList.contains("daylyx-presenting")) return;
    if (html.classList.contains("auth-booting")) {
      html.classList.remove("daylyx-presenting");
      return;
    }
    introStarted = true;
    var screen = ensureIntroScreen();
    screen.hidden = false;
    screen.classList.remove("is-leaving");
    if (!screen.dataset.daylyxBound) {
      screen.dataset.daylyxBound = "1";
      screen.addEventListener("click", finishIntro);
    }
    playIntro(screen.querySelector("[data-daylyx-mark]"));
    window.clearTimeout(introTimer);
    introTimer = window.setTimeout(finishIntro, INTRO_MS);
  }

  function startLoaderIfNeeded() {
    if (!document.documentElement.classList.contains("auth-booting")) {
      loaderActive = false;
      return;
    }
    if (loaderActive) return;
    loaderActive = true;
    document.documentElement.classList.remove("daylyx-presenting");
    var lockup = ensureBootLockup();
    var hint = document.querySelector("#auth-boot-screen .daylyx-splash-hint, #auth-boot-screen p");
    if (hint) hint.textContent = "Chargement";
    playLoader(lockup);
  }

  function hideBootWithReveal(done) {
    var boot = document.getElementById("auth-boot-screen");
    var lockup = boot && boot.querySelector("[data-daylyx-mark]");
    window.clearTimeout(hideTimer);
    if (!lockup) {
      if (typeof done === "function") done();
      return;
    }
    reveal(lockup);
    hideTimer = window.setTimeout(function () {
      if (typeof done === "function") done();
    }, REVEAL_MS);
  }

  function sync() {
    if (document.documentElement.classList.contains("auth-booting")) startLoaderIfNeeded();
    else startIntroIfNeeded();
  }

  window.DaylyxMark = {
    html: lockupHtml,
    intro: playIntro,
    loader: playLoader,
    reveal: reveal,
    hideBootWithReveal: hideBootWithReveal,
    sync: sync
  };

  function boot() {
    sync();
    if (window.MutationObserver) {
      new MutationObserver(function () {
        sync();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
