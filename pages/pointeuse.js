/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "pointeuse" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function pointeusePage() {
    const { punches } = getClockState();
    const clockStatus = getClockStatusCopy();
    const hours = computeWorkedHours(punches);
    const todayPunches = getTodayPunches(punches);
    const breakDuration = computeBreakDuration(todayPunches);
    const dbNote = usesDatabase()
      ? ""
      : `<p class="data-note demo">Mode démo : données locales uniquement. Connectez-vous avec Microsoft pour sauvegarder.</p>`;

    return `
      ${dbNote}
      <article class="card">
        ${cardHeading("Chronologie du jour")}
        ${renderDayTimeline(todayPunches, appData.profile || {})}
      </article>
      <section class="hours-grid page-spacer">
        ${hoursCard("Aujourd'hui", hours.today)}
        ${hoursCard("Pause dej", breakDuration)}
        ${hoursCard("Cette semaine", hours.week)}
      </section>
      <section class="clock-grid page-spacer">
        <article class="card clock-card">
          ${renderClockStatus(clockStatus)}
          ${renderWorkLocationSelector(punches)}
          ${renderClockActions()}
          <p class="clock-hint">${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </article>
        <article class="card">
          ${cardHeading("Pointages du jour")}
          <div class="punch-list">
            ${todayPunches.length
              ? todayPunches.map((punch) => `
                <div class="punch-item">
                  <div class="punch-item-main">
                    <span class="punch-type ${punch.type}">${punchTypeLabel(punch.type)}</span>
                    ${punch.type === "in" ? renderWorkLocationBadge(punch.workLocation) : ""}
                  </div>
                  <strong>${formatTime(punch.time)}</strong>
                </div>`).join("")
              : `<p class="empty-state">Aucun pointage aujourd'hui.</p>`}
          </div>
        </article>
      </section>
      <article class="card page-spacer punch-history-card">
        <div class="card-heading">
          <h3>Historique récent</h3>
          <button type="button" id="export-punch-history" class="export-excel-btn">Extraire Excel</button>
        </div>
        ${renderPunchHistory(punches, appData.profile || {})}
      </article>
      ${renderGtaClockTools()}`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["pointeuse"] = pointeusePage;
})();
