/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "planning" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function planningPage() {
    if (!canViewPlanning()) {
      return `<article class="card"><p class="empty-state">L'onglet Planning n'est pas disponible pour votre profil.</p></article>`;
    }
    const model = buildPlanningModel();
    const monthLabel = model.cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return `
      <div class="planning-toolbar">
        <div class="segmented" role="tablist">
          <button type="button" class="planning-tab${planningState.tab === "grid" ? " is-active" : ""}" data-planning-tab="grid">Planning</button>
          <button type="button" class="planning-tab${planningState.tab === "log" ? " is-active" : ""}" data-planning-tab="log">Log</button>
          <button type="button" class="planning-tab${planningState.tab === "gaps" ? " is-active" : ""}" data-planning-tab="gaps">Écarts</button>
        </div>
        <div class="planning-filters">
          <label>
            Département
            <select id="planning-dept">
              ${PLANNING_DEPTS.map((item) => `<option value="${item.id}"${item.id === model.dept ? " selected" : ""}>${item.label}</option>`).join("")}
            </select>
          </label>
          <div class="planning-month">
            <button type="button" class="outline-button" id="planning-prev">‹</button>
            <strong>${escapeHtml(monthLabel)}</strong>
            <button type="button" class="outline-button" id="planning-next">›</button>
          </div>
        </div>
      </div>
      ${planningState.tab === "log" ? renderPlanningLog(model)
        : planningState.tab === "gaps" ? renderPlanningGaps(model)
        : renderPlanningGrid(model)}`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["planning"] = planningPage;
})();
