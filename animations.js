/* Humana - couche d'animations restreinte à l'accueil et aux événements.
 *
 * Tilt / ripple / reveal n'écrivent plus d'attributs style (CSP style-src-attr none).
 * Tilt et ripple passent par l'API Web Animations.
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
    let anim = null;

    const apply = () => {
      raf = null;
      const transform = `perspective(1000px) rotateX(${ty.toFixed(2)}deg) rotateY(${tx.toFixed(2)}deg) translateY(-3px) translateZ(6px)`;
      if (typeof el.animate === "function") {
        if (anim) anim.cancel();
        anim = el.animate(
          { transform },
          { duration: 90, fill: "forwards", easing: "ease-out" }
        );
      }
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
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onEnter = () => el.classList.add("hu-tilt-active");
    const onLeave = () => {
      el.classList.remove("hu-tilt-active");
      tx = 0; ty = 0;
      if (typeof el.animate === "function") {
        if (anim) anim.cancel();
        anim = el.animate(
          { transform: "none" },
          { duration: 180, fill: "forwards", easing: "ease-out" }
        );
      }
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
      el.classList.add("hu-reveal", "hu-reveal-d" + (revealIndex++ % 12));
      revealObs.observe(el);
    });
  }

  function onPointerDown(ev) {
    const btn = ev.target && ev.target.closest &&
      ev.target.closest("button:not(:disabled), .primary:not(:disabled), a.primary, [role='button']:not([aria-disabled='true'])");
    if (!btn) return;
    if (btn.classList.contains("hu-no-ripple")) return;
    if (btn.classList.contains("icon-button") || btn.classList.contains("close-button")) return;
    const rect = btn.getBoundingClientRect();
    const ink = document.createElement("span");
    ink.className = "hu-ripple-ink";
    ink.setAttribute("aria-hidden", "true");
    btn.appendChild(ink);
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (typeof ink.animate === "function") {
      ink.animate(
        [
          { transform: `translate(${x}px, ${y}px) scale(0)`, opacity: 0.5 },
          { transform: `translate(${x}px, ${y}px) scale(22)`, opacity: 0 }
        ],
        { duration: 560, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" }
      ).onfinish = () => ink.remove();
    } else {
      window.setTimeout(() => ink.remove(), 560);
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
