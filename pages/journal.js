/* Page "journal" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function journalPage() {
    if (!H.canViewJournal()) {
      return `<article class="card"><p class="empty-state">Accès au journal non autorisé pour votre profil.</p></article>`;
    }
    if (!H.journalFilters.start || !H.journalFilters.end) {
      Object.assign(H.journalFilters, H.getDefaultTeamPunchRange());
    }

    const range = H.getJournalRange();
    const sessions = H.getJournalSessions();
    const sessionPage = H.paginateList("journal", sessions);
    const profiles = H.getJournalProfiles();
    const openCount = sessions.filter((entry) => entry.status === "Connecté").length;
    const canFilterPeople = H.usesDatabase();
    let dbNote = "";
    if (!H.usesDatabase()) {
      dbNote = `<p class="data-note demo">Mode démo : journal local. Connectez-vous avec Microsoft pour voir les sessions réelles.</p>`;
    } else if (H.appData.journalMetaMissing) {
      dbNote = `<p class="data-note">Colonnes techniques absentes de la base. Redémarrez l'API pour appliquer les migrations, puis refaites un pointage d'entrée.</p>`;
    } else if (sessions.length && sessions.every((entry) => entry.method === "—" && entry.os === "—" && entry.browser === "—" && entry.ip === "—")) {
      dbNote = `<p class="data-note">Les sessions déjà enregistrées n'ont pas d'OS ni de navigateur. Ces détails (sans adresse IP) apparaîtront au prochain pointage d'entrée.</p>`;
    }

    return `
      ${dbNote}
      <details class="collapse-panel page-spacer"${H.isFilterPanelOpen("journal") ? " open" : ""} data-filter-panel="journal">
        <summary>Filtres</summary>
        <form id="journal-filter" class="feature-form team-punches-filter collapse-panel-form">
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
          ${canFilterPeople ? `
          <label>
            Collaborateur
            <select name="userId">
              <option value="">Tous</option>
              ${profiles.map((profile) => `
                <option value="${profile.id}"${H.journalFilters.userId === profile.id ? " selected" : ""}>
                  ${H.escapeHtml(profile.full_name)}
                </option>`).join("")}
            </select>
          </label>` : ""}
          <label>
            Recherche
            <input type="search" name="query" value="${H.escapeHtml(H.journalFilters.query || "")}" placeholder="Nom, matricule, IP, statut...">
          </label>
          <div class="team-punches-actions">
            <button type="submit" class="primary">Actualiser</button>
            <button type="button" id="journal-export" class="outline-button"${sessions.length ? "" : " disabled"}>Exporter CSV</button>
          </div>
        </form>
      </details>
      <section class="team-punches-summary page-spacer">
        <article class="hours-card team-punch-summary-card">
          <span>Sessions</span>
          <strong>${sessions.length}</strong>
          <small>sur la période</small>
        </article>
        <article class="hours-card team-punch-summary-card">
          <span>En cours</span>
          <strong>${openCount}</strong>
          <small>connexion active</small>
        </article>
        <article class="hours-card team-punch-summary-card">
          <span>Déconnectées</span>
          <strong>${sessions.length - openCount}</strong>
          <small>sessions closes</small>
        </article>
      </section>
      <div class="journal-table-host">
      <article class="card table-card page-spacer journal-card${H.journalFullscreen ? " is-journal-expanded" : ""}">
        <div class="toolbar">
          <h3>Journal</h3>
          <div class="toolbar-actions">
            <span class="hierarchy-result-count">${sessions.length} ligne${sessions.length > 1 ? "s" : ""}</span>
            <button type="button" id="journal-fullscreen" class="outline-button" aria-pressed="${H.journalFullscreen ? "true" : "false"}">
              ${H.journalFullscreen ? "Fermer le plein écran" : "Ouvrir en plein écran"}
            </button>
          </div>
        </div>
        <div class="table-wrap journal-table-wrap">
          <table class="journal-table">
            <thead>
              <tr>
                ${H.JOURNAL_COLUMNS.map((column) => `
                  <th class="journal-th${H.journalSort.key === column.key ? " is-sorted" : ""}${H.journalColumnFilters[column.key] ? " is-filtered" : ""}">
                    <button type="button" class="journal-th-btn" data-journal-col="${column.key}" aria-haspopup="true" aria-expanded="${H.journalOpenColumn === column.key}">
                      <span>${column.label}</span>
                      <span class="journal-th-arrow" aria-hidden="true"></span>
                    </button>
                    ${H.renderJournalColumnMenu(column)}
                  </th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${sessionPage.items.length
                ? sessionPage.items.map((entry) => `
                  <tr>
                    <td><code class="journal-id">${H.escapeHtml(entry.sessionId)}</code></td>
                    <td>${H.escapeHtml(entry.matricule)}</td>
                    <td><strong>${H.escapeHtml(entry.name)}</strong></td>
                    <td>${H.escapeHtml(entry.department)}</td>
                    <td>${H.escapeHtml(entry.dateIn)}</td>
                    <td>${H.escapeHtml(entry.timeIn)}</td>
                    <td>${H.escapeHtml(entry.dateOut)}</td>
                    <td>${H.escapeHtml(entry.timeOut)}</td>
                    <td><strong>${H.escapeHtml(entry.duration)}</strong></td>
                    <td>${H.escapeHtml(entry.method)}</td>
                    <td>${H.escapeHtml(entry.os)}</td>
                    <td>${H.escapeHtml(entry.browser)}</td>
                    <td><code class="journal-id">${H.escapeHtml(entry.ip)}</code></td>
                    <td>${H.escapeHtml(entry.network)}</td>
                    <td>${H.escapeHtml(entry.location)}</td>
                    <td>${H.renderJournalStatus(entry.status)}</td>
                    <td>${H.escapeHtml(entry.reason)}</td>
                  </tr>`).join("")
                : `<tr><td colspan="${H.JOURNAL_COLUMNS.length}" class="empty-cell">Aucune session pour cette période. Ajustez les filtres ou pointez une entrée.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${H.renderTablePager(sessionPage)}
      </article>
      </div>`;
  }

  (H.pages = H.pages || {})["journal"] = journalPage;
})(window.Humana);
