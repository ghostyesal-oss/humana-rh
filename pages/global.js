/* Page "global" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function globalPage() {
    if (!H.canViewGlobal()) {
      return `<article class="card"><p class="empty-state">Accès au tableau de bord global réservé aux managers et administrateurs.</p></article>`;
    }
    if (!H.usesDatabase() && !H.demoMode) {
      return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour consulter le tableau de bord global.</p></article>`;
    }

    if (!H.teamPunchFilters.start || !H.teamPunchFilters.end) {
      Object.assign(H.teamPunchFilters, H.getDefaultTeamPunchRange());
    }
    const data = H.buildGlobalDashboardData();

    return `
      <p class="data-note">Périmètre : ${data.profiles.length} collaborateur${data.profiles.length > 1 ? "s" : ""} · Période du ${H.formatDate(data.range.start)} au ${H.formatDate(data.range.end)}.</p>
      <details class="collapse-panel page-spacer"${H.isFilterPanelOpen("global") ? " open" : ""} data-filter-panel="global">
        <summary>Période</summary>
        <form id="global-filter" class="feature-form team-punches-filter collapse-panel-form">
          <div class="form-row">
            <label>
              Du
              <input type="date" name="start" value="${H.escapeHtml(data.range.start)}" required>
            </label>
            <label>
              Au
              <input type="date" name="end" value="${H.escapeHtml(data.range.end)}" required>
            </label>
          </div>
          ${H.isAdmin() ? `
          <label>
            Périmètre
            <select name="scope">
              <option value="all"${H.teamPunchFilters.scope !== "team" ? " selected" : ""}>Tous les collaborateurs</option>
              <option value="team"${H.teamPunchFilters.scope === "team" ? " selected" : ""}>Mon équipe directe</option>
            </select>
          </label>` : ""}
          <div class="team-punches-actions">
            <button type="submit" class="primary">Actualiser</button>
          </div>
        </form>
      </details>
      ${H.renderGlobalKpiCards(data)}
      <div class="global-charts-grid">
        ${H.renderGlobalDailyChart(data)}
        ${H.renderGlobalDonut(data)}
        ${H.renderGlobalTopDelays(data)}
        ${H.renderGlobalDepartments(data)}
      </div>`;
  }

  (H.pages = H.pages || {})["global"] = globalPage;
})(window.Humana);
