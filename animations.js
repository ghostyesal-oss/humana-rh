/* Humana - couche d'animations "fluide + 3D".
 *
 * Toutes les animations sont passives (aucune mutation du DOM applicatif,
 * aucun effet metier). Elles :
 *   - respectent `prefers-reduced-motion`,
 *   - se debranchent quand l'element sort du DOM,
 *   - s'attachent automatiquement aux elements rendus plus tard (SPA/MPA).
 *
 * Effets :
 *   1) Tilt 3D souris sur les cartes (perspective + rotateX/Y + spot light).
 *   2) Reveal on scroll : sections apparaissent en fade + slide + rotateX.
 *   3) Press effect + ripple sur les boutons.
 *   4) Compteurs animes pour [data-animate-count].
 *   5) Transitions inter-pages (navigation MPA) : gestion du :root pendant le
 *      chargement pour eviter le flash et laisser la place a l'API native
 *      View Transitions (dans Chromium recent).
 */
(function () {
  "use strict";

  const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------------
  // 1) Tilt 3D souris
  // ------------------------------------------------------------------------
  // .card:has(.day-timeline) et .punch-history-card ont overflow: visible
  // et un contenu qui deborde volontairement : on les exclut du tilt.
  const TILT_SELECTOR = [
    ".card:not(.punch-history-card):not(.error-card)",
    ".home-widget",
    ".stat-card",
    ".balance-card",
    ".hours-card",
    ".document-card"
  ].join(",");
  const TILT_MAX_DEG = 5.5;

  function bindTilt(el) {
    if (el.dataset.huTilt === "1") return;
    if (el.matches(".card:has(.day-timeline)")) return;
    el.dataset.huTilt = "1";

    let raf = null;
    let tx = 0, ty = 0;
    let sx = 50, sy = 50;
    let active = false;

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

    const onEnter = () => {
      active = true;
      el.classList.add("hu-tilt-active");
    };
    const onLeave = () => {
      active = false;
      el.classList.remove("hu-tilt-active");
      tx = 0; ty = 0; sx = 50; sy = 50;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    el.addEventListener("pointerenter", onEnter, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
  }

  function scanTilts(root) {
    (root || document).querySelectorAll(TILT_SELECTOR).forEach(bindTilt);
  }

  // ------------------------------------------------------------------------
  // 2) Reveal on scroll
  // ------------------------------------------------------------------------
  // On evite de mettre "opacity: 0" sur des elements qui contiennent des
  // formulaires ou du contenu vital tant que JS n'a pas eu le temps de tourner :
  // le CSS applique .hu-reveal seulement quand l'element a la classe.
  const REVEAL_SELECTOR = "section, article.card, .home-widget, .stat-card";
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
      // Stagger progressif limite (evite les tres longs delais).
      const delay = (revealIndex++ % 12) * 45;
      el.style.setProperty("--hu-reveal-delay", delay + "ms");
      el.classList.add("hu-reveal");
      revealObs.observe(el);
    });
  }

  // ------------------------------------------------------------------------
  // 3) Press ripple sur boutons
  // ------------------------------------------------------------------------
  function onPointerDown(ev) {
    const btn = ev.target && ev.target.closest &&
      ev.target.closest("button:not(:disabled), .primary:not(:disabled), a.primary, [role='button']:not([aria-disabled='true'])");
    if (!btn) return;
    if (btn.classList.contains("hu-no-ripple")) return;
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty("--hu-ripple-x", (ev.clientX - rect.left) + "px");
    btn.style.setProperty("--hu-ripple-y", (ev.clientY - rect.top) + "px");
    btn.classList.remove("hu-ripple-active");
    void btn.offsetWidth; // reflow force le redemarrage de l'anim
    btn.classList.add("hu-ripple-active");
  }
  function onAnimEnd(ev) {
    if (ev.animationName === "hu-ripple") {
      ev.target.classList.remove("hu-ripple-active");
    }
  }

  // ------------------------------------------------------------------------
  // 4) Compteurs [data-animate-count]
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // 5) MPA : eviter le flash blanc entre pages
  // ------------------------------------------------------------------------
  // Chromium supporte les cross-document view transitions via @view-transition
  // dans le CSS. Pour les autres navigateurs on fait un fondu manuel : on
  // fade legerement le body quand on quitte la page.
  function bindMpaFade() {
    if (!("startViewTransition" in document)) {
      // Fallback : on ecoute les clicks internes et on ajoute une classe
      // qui fait un mini fondu pendant la navigation.
      document.addEventListener("click", (ev) => {
        const a = ev.target && ev.target.closest && ev.target.closest("a[href]");
        if (!a) return;
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("http") || a.target === "_blank") return;
        document.documentElement.classList.add("hu-nav-leaving");
      }, { capture: true, passive: true });
      window.addEventListener("pageshow", () => {
        document.documentElement.classList.remove("hu-nav-leaving");
      });
    }
  }

  // ------------------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------------------
  function boot() {
    if (!REDUCE_MOTION) {
      scanTilts(document);
      document.addEventListener("pointerdown", onPointerDown, { passive: true });
      document.addEventListener("animationend", onAnimEnd, { passive: true });
    }
    // Reveal + counters restent utiles meme en reduced-motion : le CSS
    // desactive alors les transforms.
    armReveal(document);
    armCounters(document);
    bindMpaFade();

    // Observe le DOM pour attraper les elements rendus plus tard.
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (!REDUCE_MOTION) {
            if (n.matches && n.matches(TILT_SELECTOR)) bindTilt(n);
            scanTilts(n);
          }
          armReveal(n);
          armCounters(n);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.HumanaAnimations = { armReveal, scanTilts, armCounters };
})();
