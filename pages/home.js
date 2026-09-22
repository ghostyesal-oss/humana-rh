/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "home" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function homePage() {
    const firstName = escapeHtml(getUserName().split(" ")[0] || "vous");
    const clockStatus = getClockStatusCopy();
    const hours = computeWorkedHours(getPunches());
    const todayLabel = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long"
    });

    return `
      <section class="home-welcome">
        <h2 class="home-title">${dayGreeting()}, <b>${firstName}</b></h2>
        <p class="home-subtitle">Nous sommes ${todayLabel}. Voici votre espace du jour.</p>
      </section>

      <section class="home-day-wrap page-spacer">
        <article class="card home-widget home-day-widget">
          <div class="card-heading">
            <h3>Ma journée</h3>
            <button type="button" class="home-link" data-goto-page="pointeuse">Historique</button>
          </div>
          <div class="home-clock">
            ${renderClockStatus(clockStatus, "home-clock-status")}
            ${renderHomeShiftSummary()}
            <p class="home-hours-today">Temps aujourd'hui : <b>${formatDuration(hours.today)}</b></p>
            ${renderWorkLocationSelector()}
            ${renderClockActions()}
          </div>
        </article>
      </section>

      <section class="home-grid page-spacer">
        ${canViewHrAlerts() ? renderHrAlertsCard() : ""}
        ${renderHomeEventsCard()}
      </section>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["home"] = homePage;
})();
