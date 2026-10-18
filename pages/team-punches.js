/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "team-punches" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function teamPunchesPage() {
    if (!usesDatabase() && !demoMode) {
      return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour consulter les pointages de votre équipe.</p></article>`;
    }

    if (!canViewTeamPunches()) {
      return `<article class="card"><p class="empty-state">Accès réservé aux managers et aux administrateurs.</p></article>`;
    }

    const range = teamPunchFilters.start && teamPunchFilters.end
      ? teamPunchFilters
      : getDefaultTeamPunchRange();
    const scope = getTeamPunchScope();
    const profiles = getTeamPunchProfiles(scope);
    const scopedProfiles = teamPunchFilters.userId
      ? profiles.filter((profile) => profile.id === teamPunchFilters.userId)
      : profiles;
    const summary = summarizeTeamPunchesByUser(appData.teamPunches, scopedProfiles, range.start, range.end);
    const dailyRows = summarizeTeamPunchesByDay(appData.teamPunches, range.start, range.end);
    const showLocationHint = dailyRows.some((row) => row.hasStarted)
      && !dailyRows.some((row) => resolveDailyRowWorkLocation(row));
    const scopeLabel = isAdmin()
      ? (scope === "team" ? "mon équipe directe" : "tous les collaborateurs")
      : "votre équipe directe";
    const directReports = getDirectReportProfiles();

    return `
      <p class="data-note">Périmètre : ${scopeLabel} · ${profiles.length} collaborateur${profiles.length > 1 ? "s" : ""}. Un manager, HR ou la Direction peut valider un retard ou rectifier l'entrée, la pause et la sortie. Sans action, le retard reste compté.</p>
      <article class="card form-card page-spacer">
        ${cardHeading("Filtres")}
        <form id="team-punches-filter" class="feature-form team-punches-filter">
          ${isAdmin() ? `
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
              <input type="date" name="start" value="${escapeHtml(range.start)}" required>
            </label>
            <label>
              Au
              <input type="date" name="end" value="${escapeHtml(range.end)}" required>
            </label>
          </div>
          <label>
            Collaborateur
            <select name="userId">
              <option value="">Tous</option>
              ${profiles.map((profile) => `
                <option value="${profile.id}"${teamPunchFilters.userId === profile.id ? " selected" : ""}>
                  ${escapeHtml(profile.full_name)}
                </option>`).join("")}
            </select>
          </label>
          <div class="team-punches-actions">
            <button type="submit" class="primary">Actualiser</button>
            <button type="button" id="team-punches-export" class="outline-button"${dailyRows.length ? "" : " disabled"}>Exporter CSV</button>
          </div>
        </form>
      </article>
      ${renderPendingDelayInbox(dailyRows)}
      <section class="team-punches-summary page-spacer">
        ${summary.length
          ? summary.map((item, index) => `
            <article class="hours-card team-punch-summary-card">
              <span>${escapeHtml(item.profile.full_name || "Collaborateur")}</span>
              <strong>${formatDuration(item.workedMs)}</strong>
              <small>${item.punchCount} pointage${item.punchCount > 1 ? "s" : ""}</small>
            </article>`).join("")
          : `<article class="card"><p class="empty-state">Aucun collaborateur dans votre périmètre.</p></article>`}
      </section>
      ${renderTeamPunchDetailCard(dailyRows, { showLocationHint })}`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["team-punches"] = teamPunchesPage;
})();
