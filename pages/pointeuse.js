/* Page "pointeuse" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function pointeusePage() {
    const { punches } = H.getClockState();
    const clockStatus = H.getClockStatusCopy();
    const hours = H.computeWorkedHours(punches);
    const todayPunches = H.getTodayPunches(punches);
    const breakDuration = H.computeBreakDuration(todayPunches);
    const dbNote = H.usesDatabase()
      ? ""
      : `<p class="data-note demo">Mode démo : données locales uniquement. Connectez-vous avec Microsoft pour sauvegarder.</p>`;

    return `
      ${dbNote}
      <article class="card">
        ${H.cardHeading("Chronologie du jour")}
        ${H.renderDayTimeline(todayPunches, H.appData.profile || {})}
      </article>
      <section class="hours-grid page-spacer">
        ${H.hoursCard("Aujourd'hui", hours.today)}
        ${H.hoursCard("Pause dej", breakDuration, { liveBreak: true })}
        ${H.hoursCard("Cette semaine", hours.week)}
      </section>
      <section class="clock-grid page-spacer">
        <article class="card clock-card">
          ${H.renderClockStatus(clockStatus)}
          ${H.renderWorkLocationSelector(punches)}
          ${H.renderClockActions()}
          <p class="clock-hint">${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </article>
        <article class="card">
          ${H.cardHeading("Pointages du jour")}
          <div class="punch-list">
            ${todayPunches.length
              ? todayPunches.map((punch) => `
                <div class="punch-item">
                  <div class="punch-item-main">
                    <span class="punch-type ${punch.type}">${H.punchTypeLabel(punch.type)}</span>
                    ${punch.type === "in" ? H.renderWorkLocationBadge(punch.workLocation) : ""}
                  </div>
                  <strong>${punch.type === "break_start" || punch.type === "break_end" ? H.formatTimeSeconds(punch.time) : H.formatTime(punch.time)}</strong>
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
        ${H.renderPunchHistory(punches, H.appData.profile || {})}
      </article>
      ${H.renderGtaClockTools()}`;
  }

  (H.pages = H.pages || {})["pointeuse"] = pointeusePage;
})(window.Humana);
