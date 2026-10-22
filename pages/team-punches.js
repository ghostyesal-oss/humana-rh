/* Page "team-punches" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function teamPunchesPage() {
    if (!H.usesDatabase() && !H.demoMode) {
      return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour consulter les pointages de votre équipe.</p></article>`;
    }

    if (!H.canViewTeamPunches()) {
      return `<article class="card"><p class="empty-state">Accès réservé aux managers et aux administrateurs.</p></article>`;
    }

    const range = H.teamPunchFilters.start && H.teamPunchFilters.end
      ? H.teamPunchFilters
      : H.getDefaultTeamPunchRange();
    const scope = H.getTeamPunchScope();
    const profiles = H.getTeamPunchProfiles(scope);
    const scopedProfiles = H.teamPunchFilters.userId
      ? profiles.filter((profile) => profile.id === H.teamPunchFilters.userId)
      : profiles;
    const summary = H.summarizeTeamPunchesByUser(H.appData.teamPunches, scopedProfiles, range.start, range.end);
    const dailyRows = H.summarizeTeamPunchesByDay(H.appData.teamPunches, range.start, range.end);
    const showLocationHint = dailyRows.some((row) => row.hasStarted)
      && !dailyRows.some((row) => H.resolveDailyRowWorkLocation(row));
    const scopeLabel = H.isAdmin()
      ? (scope === "team" ? "mon équipe directe" : "tous les collaborateurs")
      : "votre équipe directe";
    const directReports = H.getDirectReportProfiles();

    return `
      <p class="data-note">Périmètre : ${scopeLabel} · ${profiles.length} collaborateur${profiles.length > 1 ? "s" : ""}. Un manager, HR ou la Direction peut valider un retard ou rectifier l'entrée, la pause et la sortie. Sans action, le retard reste compté.</p>
      <details class="collapse-panel page-spacer"${H.isFilterPanelOpen("teamPunches") ? " open" : ""} data-filter-panel="teamPunches">
        <summary>Filtres</summary>
        <form id="team-punches-filter" class="feature-form team-punches-filter collapse-panel-form">
          ${H.isAdmin() ? `
          <label>
            Périmètre
            <select name="scope">
              <option value="all"${scope === "all" ? " selected" : ""}>Tous les collaborateurs</option>
              <option value="team"${scope === "team" ? " selected" : ""}>Mon équipe directe${directReports.length ? ` (${directReports.length})` : ""}</option>
            </select>
          </label>` : ""}
          <div class="form-row">
            <label>
              Du
              <input type="date" name="start" value="${H.escapeHtml(range.start)}" required>
            </label>
            <label>
              Au
              <input type="date" name="end" value="${H.escapeHtml(range.end)}" required>
            </label>
          </div>
          <label>
            Collaborateur
            <select name="userId">
              <option value="">Tous</option>
              ${profiles.map((profile) => `
                <option value="${profile.id}"${H.teamPunchFilters.userId === profile.id ? " selected" : ""}>
                  ${H.escapeHtml(profile.full_name)}
                </option>`).join("")}
            </select>
          </label>
          <div class="team-punches-actions">
            <button type="submit" class="primary">Actualiser</button>
            <button type="button" id="team-punches-export" class="outline-button"${dailyRows.length ? "" : " disabled"}>Exporter CSV</button>
          </div>
        </form>
      </details>
      ${H.renderPendingDelayInbox(dailyRows)}
      <section class="team-punches-summary page-spacer">
        ${summary.length
          ? summary.map((item, index) => `
            <article class="hours-card team-punch-summary-card">
              <span>${H.escapeHtml(item.profile.full_name || "Collaborateur")}</span>
              <strong>${H.formatDuration(item.workedMs)}</strong>
              <small>${item.punchCount} pointage${item.punchCount > 1 ? "s" : ""}</small>
            </article>`).join("")
          : `<article class="card"><p class="empty-state">Aucun collaborateur dans votre périmètre.</p></article>`}
      </section>
      ${H.renderTeamPunchDetailCard(dailyRows, { showLocationHint })}`;
  }

  (H.pages = H.pages || {})["team-punches"] = teamPunchesPage;
})(window.Humana);
