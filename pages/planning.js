/* Page "planning" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function planningPage() {
    if (!H.canViewPlanning()) {
      return `<article class="card"><p class="empty-state">L'onglet Planning n'est pas disponible pour votre profil.</p></article>`;
    }
    const model = H.buildPlanningModel();
    const monthLabel = model.cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return `
      <div class="planning-toolbar">
        <div class="segmented" role="tablist">
          <button type="button" class="planning-tab${H.planningState.tab === "grid" ? " is-active" : ""}" data-planning-tab="grid">Planning</button>
          <button type="button" class="planning-tab${H.planningState.tab === "log" ? " is-active" : ""}" data-planning-tab="log">Log</button>
          <button type="button" class="planning-tab${H.planningState.tab === "gaps" ? " is-active" : ""}" data-planning-tab="gaps">Écarts</button>
        </div>
        <div class="planning-filters">
          <label>
            Département
            <select id="planning-dept">
              ${H.PLANNING_DEPTS.map((item) => `<option value="${item.id}"${item.id === model.dept ? " selected" : ""}>${item.label}</option>`).join("")}
            </select>
          </label>
          <div class="planning-month">
            <button type="button" class="outline-button" id="planning-prev">‹</button>
            <strong>${H.escapeHtml(monthLabel)}</strong>
            <button type="button" class="outline-button" id="planning-next">›</button>
          </div>
          ${H.canImportPlanning() ? `
          <button type="button" class="outline-button" id="planning-tt-rotate">Générer planning du mois</button>` : ""}
        </div>
      </div>
      ${H.planningState.importNotice ? `<p class="planning-import-notice">${H.escapeHtml(H.planningState.importNotice)}</p>` : ""}
      ${H.renderPlanningAssignPanel()}
      ${H.renderUnjustifiedAbsenceInbox(model)}
      ${H.planningState.tab === "log" ? H.renderPlanningLog(model)
        : H.planningState.tab === "gaps" ? H.renderPlanningGaps(model)
        : H.renderPlanningGrid(model)}`;
  }

  (H.pages = H.pages || {})["planning"] = planningPage;
})(window.Humana);
