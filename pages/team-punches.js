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
      <p class="data-note">Périmètre : ${scopeLabel} · ${profiles.length} collaborateur${profiles.length > 1 ? "s" : ""}</p>
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
      <article class="card table-card page-spacer">
        <div class="toolbar">
          <h3>Détail des pointages</h3>
          <span class="hierarchy-result-count">${dailyRows.length} jour${dailyRows.length > 1 ? "s" : ""}</span>
        </div>
        ${showLocationHint ? `<p class="data-note">Le lieu n'est renseigné que sur les pointages d'entrée. Si la colonne est vide, exécutez <code>supabase/time-punches-location.sql</code>, puis refaites un pointage d'entrée.</p>` : ""}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Collaborateur</th>
                <th>Date</th>
                <th>Lieu</th>
                <th>Début</th>
                <th>Fin</th>
                <th>Pause déjeuner</th>
                <th>Heures planifiées</th>
                <th>Heures réalisées</th>
                <th>Retard</th>
                <th>Heures manquantes</th>
                <th>HS payables</th>
                <th>Journal du service</th>
                <th>Heure rectifiée</th>
                <th>Modifié par</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRows.length
                ? dailyRows.map((row) => {
                    const profile = profileById(row.userId) || { full_name: row.name, id: row.userId };
                    const stats = analyzeWorkedDay(row, profile);
                    const correction = formatDayCorrectionSummary(row.userId, row.dayKey);
                    return `
                  <tr>
                    <td><strong>${escapeHtml(row.name)}</strong></td>
                    <td>${formatDate(row.dayKey)}</td>
                    <td>${resolveWorkLocationLabel(row)}</td>
                    <td>${row.startTime ? formatTime(row.startTime) : "—"}</td>
                    <td>${formatDayEndTime(row)}</td>
                    <td>${row.breakDurationMs ? formatDuration(row.breakDurationMs) : "—"}</td>
                    <td>${formatDuration(stats.plannedMs)}</td>
                    <td><strong>${formatDuration(stats.realizedMs)}</strong></td>
                    <td>${stats.delayMin ? `${stats.delayMin} min` : "—"}</td>
                    <td>${stats.missingMs ? formatDuration(stats.missingMs) : "—"}</td>
                    <td>${stats.payableOtMs ? formatDuration(stats.payableOtMs) : "—"}</td>
                    <td>${formatDayPunchLog(row)}</td>
                    <td>${correction.rectified === "Oui" ? badge("Oui") : escapeHtml(correction.rectified)}</td>
                    <td>${escapeHtml(correction.who)}</td>
                    <td>${escapeHtml(correction.motif)}</td>
                  </tr>`;
                  }).join("")
                : `<tr><td colspan="15" class="empty-cell">Aucun pointage pour cette période. Ajustez les filtres, puis actualisez.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["team-punches"] = teamPunchesPage;
})();
