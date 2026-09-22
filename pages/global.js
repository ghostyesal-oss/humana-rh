/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "global" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function globalPage() {
    if (!canViewGlobal()) {
      return `<article class="card"><p class="empty-state">Accès au tableau de bord global réservé aux managers et administrateurs.</p></article>`;
    }
    if (!usesDatabase() && !demoMode) {
      return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour consulter le tableau de bord global.</p></article>`;
    }

    if (!teamPunchFilters.start || !teamPunchFilters.end) {
      teamPunchFilters = { ...teamPunchFilters, ...getDefaultTeamPunchRange() };
    }
    const data = buildGlobalDashboardData();

    return `
      <p class="data-note">Périmètre : ${data.profiles.length} collaborateur${data.profiles.length > 1 ? "s" : ""} · Période du ${formatDate(data.range.start)} au ${formatDate(data.range.end)}.</p>
      <article class="card form-card page-spacer">
        ${cardHeading("Période")}
        <form id="global-filter" class="feature-form team-punches-filter">
          <div class="form-row">
            <label>
              Du
              <input type="date" name="start" value="${escapeHtml(data.range.start)}" required>
            </label>
            <label>
              Au
              <input type="date" name="end" value="${escapeHtml(data.range.end)}" required>
            </label>
          </div>
          ${isAdmin() ? `
          <label>
            Périmètre
            <select name="scope">
              <option value="all"${teamPunchFilters.scope !== "team" ? " selected" : ""}>Tous les collaborateurs</option>
              <option value="team"${teamPunchFilters.scope === "team" ? " selected" : ""}>Mon équipe directe</option>
            </select>
          </label>` : ""}
          <div class="team-punches-actions">
            <button type="submit" class="primary">Actualiser</button>
          </div>
        </form>
      </article>
      ${renderGlobalKpiCards(data)}
      <div class="global-charts-grid">
        ${renderGlobalDailyChart(data)}
        ${renderGlobalDonut(data)}
        ${renderGlobalTopDelays(data)}
        ${renderGlobalDepartments(data)}
      </div>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["global"] = globalPage;
})();
