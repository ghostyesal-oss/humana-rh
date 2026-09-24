/* Humana - couche d'animations restreinte à l'accueil et aux événements.
 *
 * Coût mesuré : 9,8 Ko (3,0 Ko gzip). Quatre boucles (tilt rAF, reveal IO,
 * ripple, compteurs rAF) + MutationObserver sur tout le DOM.
 * Sur poste modeste / mobile, le tilt + l'observer à chaque renderApp
 * (innerHTML complet) coûtent plus que le parse. Décision : charger le
 * script seulement sur home/events, couper le tilt au toucher, et scanner
 * après rendu au lieu d'observer le DOM.
 */
(function () {
  "use strict";

  const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches
    || window.matchMedia("(max-width: 900px)").matches;
  const TILT_PAGES = { home: true, events: true };
  const TILT_SELECTOR = [
    ".card:not(.punch-history-card):not(.error-card)",
    ".home-widget",
    ".stat-card",
    ".balance-card",
    ".hours-card",
    ".document-card"
  ].join(",");
  const TILT_MAX_DEG = 5.5;
  const REVEAL_SELECTOR = "section, article.card, .home-widget, .stat-card";

  function currentPageId() {
    return document.querySelector(".app-shell")?.dataset?.currentPage
      || document.body?.dataset?.page
      || "";
  }

  function bindTilt(el) {
    if (el.dataset.huTilt === "1") return;
    if (el.matches(".card:has(.day-timeline)")) return;
    el.dataset.huTilt = "1";

    let raf = null;
    let tx = 0, ty = 0;
    let sx = 50, sy = 50;

    const apply = () => {
      raf = null;
      el.style.setProperty("--hu-tiltX", ty.toFixed(2) + "deg");
      el.style.setProperty("--hu-tiltY", tx.toFixed(2) + "deg");
      el.style.setProperty("--hu-spotX", sx.toFixed(2) + "%");
      el.style.setProperty("--hu-spotY", sy.toFixed(2) + "%");
    };

    const onMove = (ev) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const nx = (ev.clientX - cx) / (rect.width / 2);
      const ny = (ev.clientY - cy) / (rect.height / 2);
      tx = Math.max(-1, Math.min(1, nx)) * TILT_MAX_DEG;
      ty = -Math.max(-1, Math.min(1, ny)) * TILT_MAX_DEG;
      sx = ((ev.clientX - rect.left) / rect.width) * 100;
      sy = ((ev.clientY - rect.top) / rect.height) * 100;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onEnter = () => el.classList.add("hu-tilt-active");
    const onLeave = () => {
      el.classList.remove("hu-tilt-active");
      tx = 0; ty = 0; sx = 50; sy = 50;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    el.addEventListener("pointerenter", onEnter, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
  }

  function scanTilts(root) {
    if (REDUCE_MOTION || COARSE_POINTER || !TILT_PAGES[currentPageId()]) return;
    (root || document).querySelectorAll(TILT_SELECTOR).forEach(bindTilt);
  }

  const revealObs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("hu-revealed");
          revealObs.unobserve(e.target);
        }
      }
    },
    { threshold: 0.08, rootMargin: "0px 0px -32px 0px" }
  );
  let revealIndex = 0;
  function armReveal(root) {
    (root || document).querySelectorAll(REVEAL_SELECTOR).forEach((el) => {
      if (el.dataset.huReveal === "1") return;
      el.dataset.huReveal = "1";
      const delay = (revealIndex++ % 12) * 45;
      el.style.setProperty("--hu-reveal-delay", delay + "ms");
      el.classList.add("hu-reveal");
      revealObs.observe(el);
    });
  }

  function onPointerDown(ev) {
    const btn = ev.target && ev.target.closest &&
      ev.target.closest("button:not(:disabled), .primary:not(:disabled), a.primary, [role='button']:not([aria-disabled='true'])");
    if (!btn) return;
    if (btn.classList.contains("hu-no-ripple")) return;
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty("--hu-ripple-x", (ev.clientX - rect.left) + "px");
    btn.style.setProperty("--hu-ripple-y", (ev.clientY - rect.top) + "px");
    btn.classList.remove("hu-ripple-active");
    void btn.offsetWidth;
    btn.classList.add("hu-ripple-active");
  }
  function onAnimEnd(ev) {
    if (ev.animationName === "hu-ripple") {
      ev.target.classList.remove("hu-ripple-active");
    }
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  function animateCounter(el) {
    if (el.dataset.huCounted === "1") return;
    el.dataset.huCounted = "1";
    const target = parseFloat(el.getAttribute("data-animate-count"));
    if (!isFinite(target)) return;
    const fmt = el.getAttribute("data-count-format") || "int";
    const suffix = el.getAttribute("data-count-suffix") || "";
    const duration = Math.min(1200, 400 + Math.abs(target) * 6);
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = target * easeOutCubic(t);
      let out;
      if (fmt === "1") out = v.toFixed(1);
      else if (fmt === "2") out = v.toFixed(2);
      else out = Math.round(v).toLocaleString("fr-FR");
      el.textContent = out + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  const countObs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          animateCounter(e.target);
          countObs.unobserve(e.target);
        }
      }
    },
    { threshold: 0.4 }
  );
  function armCounters(root) {
    (root || document).querySelectorAll("[data-animate-count]").forEach((el) => {
      if (el.dataset.huCounted === "1") return;
      countObs.observe(el);
    });
  }

  let listenersBound = false;
  function scan(root) {
    const scope = root || document;
    if (!REDUCE_MOTION) {
      scanTilts(scope);
      if (!listenersBound) {
        listenersBound = true;
        document.addEventListener("pointerdown", onPointerDown, { passive: true });
        document.addEventListener("animationend", onAnimEnd, { passive: true });
      }
    }
    armReveal(scope);
    armCounters(scope);
  }

  function boot() {
    scan(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.HumanaAnimations = { scan, armReveal, scanTilts, armCounters };
})();
