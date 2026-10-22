/* Page "home" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function homePage() {
    const firstName = H.escapeHtml(H.getUserName().split(" ")[0] || "vous");
    const clockStatus = H.getClockStatusCopy();
    const hours = H.computeWorkedHours(H.getPunches());
    const todayLabel = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long"
    });

    return `
      <section class="home-welcome">
        <h2 class="home-title">${H.dayGreeting()}, <b>${firstName}</b></h2>
        <p class="home-subtitle">Nous sommes ${todayLabel}. Voici votre espace du jour.</p>
      </section>

      <section class="home-day-wrap page-spacer">
        <article class="card home-widget home-day-widget">
          <div class="card-heading">
            <h3>Ma journée</h3>
            <button type="button" class="home-link" data-goto-page="pointeuse">Historique</button>
          </div>
          <div class="home-clock">
            ${H.renderClockStatus(clockStatus, "home-clock-status")}
            ${H.renderHomeShiftSummary()}
            <p class="home-hours-today">Temps aujourd'hui : <b>${H.formatDuration(hours.today)}</b></p>
            ${H.renderWorkLocationSelector()}
            ${H.renderClockActions()}
          </div>
        </article>
      </section>

      <section class="home-grid page-spacer">
        ${H.canViewHrAlerts() ? H.renderHrAlertsCard() : ""}
        ${H.renderHomeEventsCard()}
      </section>`;
  }

  (H.pages = H.pages || {})["home"] = homePage;
})(window.Humana);
