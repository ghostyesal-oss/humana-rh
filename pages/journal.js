/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "journal" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function journalPage() {
    if (!canViewJournal()) {
      return `<article class="card"><p class="empty-state">Accès au journal non autorisé pour votre profil.</p></article>`;
    }
    if (!journalFilters.start || !journalFilters.end) {
      journalFilters = { ...journalFilters, ...getDefaultTeamPunchRange() };
    }

    const range = getJournalRange();
    const sessions = getJournalSessions();
    const profiles = getJournalProfiles();
    const openCount = sessions.filter((session) => session.status === "Connecté").length;
    const canFilterPeople = usesDatabase();
    let dbNote = "";
    if (!usesDatabase()) {
      dbNote = `<p class="data-note demo">Mode démo : journal local. Connectez-vous avec Microsoft pour voir les sessions réelles.</p>`;
    } else if (appData.journalMetaMissing) {
      dbNote = `<p class="data-note">Colonnes techniques absentes de la base. Exécutez <code>supabase/time-punches-journal.sql</code> dans Supabase SQL Editor, puis refaites un pointage d'entrée.</p>`;
    } else if (sessions.length && sessions.every((session) => session.method === "—" && session.os === "—" && session.browser === "—" && session.ip === "—")) {
      dbNote = `<p class="data-note">Les sessions déjà enregistrées n'ont pas d'IP, d'OS ni de navigateur. Ces détails apparaîtront au prochain pointage d'entrée.</p>`;
    }

    return `
      ${dbNote}
      <article class="card form-card page-spacer">
        ${cardHeading("Filtres")}
        <form id="journal-filter" class="feature-form team-punches-filter">
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
          ${canFilterPeople ? `
          <label>
            Collaborateur
            <select name="userId">
              <option value="">Tous</option>
              ${profiles.map((profile) => `
                <option value="${profile.id}"${journalFilters.userId === profile.id ? " selected" : ""}>
                  ${escapeHtml(profile.full_name)}
                </option>`).join("")}
            </select>
          </label>` : ""}
          <label>
            Recherche
            <input type="search" name="query" value="${escapeHtml(journalFilters.query || "")}" placeholder="Nom, matricule, IP, statut...">
          </label>
          <div class="team-punches-actions">
            <button type="submit" class="primary">Actualiser</button>
            <button type="button" id="journal-export" class="outline-button"${sessions.length ? "" : " disabled"}>Exporter CSV</button>
          </div>
        </form>
      </article>
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
      <article class="card table-card page-spacer journal-card${journalFullscreen ? " is-journal-expanded" : ""}">
        <div class="toolbar">
          <h3>Journal</h3>
          <div class="toolbar-actions">
            <span class="hierarchy-result-count">${sessions.length} ligne${sessions.length > 1 ? "s" : ""}</span>
            <button type="button" id="journal-fullscreen" class="outline-button" aria-pressed="${journalFullscreen ? "true" : "false"}">
              ${journalFullscreen ? "Fermer le plein écran" : "Ouvrir en plein écran"}
            </button>
          </div>
        </div>
        <div class="table-wrap journal-table-wrap">
          <table class="journal-table">
            <thead>
              <tr>
                ${JOURNAL_COLUMNS.map((column) => `
                  <th class="journal-th${journalSort.key === column.key ? " is-sorted" : ""}${journalColumnFilters[column.key] ? " is-filtered" : ""}">
                    <button type="button" class="journal-th-btn" data-journal-col="${column.key}" aria-haspopup="true" aria-expanded="${journalOpenColumn === column.key}">
                      <span>${column.label}</span>
                      <span class="journal-th-arrow" aria-hidden="true"></span>
                    </button>
                    ${renderJournalColumnMenu(column)}
                  </th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${sessions.length
                ? sessions.map((session) => `
                  <tr>
                    <td><code class="journal-id">${escapeHtml(session.sessionId)}</code></td>
                    <td>${escapeHtml(session.matricule)}</td>
                    <td><strong>${escapeHtml(session.name)}</strong></td>
                    <td>${escapeHtml(session.department)}</td>
                    <td>${escapeHtml(session.dateIn)}</td>
                    <td>${escapeHtml(session.timeIn)}</td>
                    <td>${escapeHtml(session.dateOut)}</td>
                    <td>${escapeHtml(session.timeOut)}</td>
                    <td><strong>${escapeHtml(session.duration)}</strong></td>
                    <td>${escapeHtml(session.method)}</td>
                    <td>${escapeHtml(session.os)}</td>
                    <td>${escapeHtml(session.browser)}</td>
                    <td><code class="journal-id">${escapeHtml(session.ip)}</code></td>
                    <td>${escapeHtml(session.network)}</td>
                    <td>${escapeHtml(session.location)}</td>
                    <td>${renderJournalStatus(session.status)}</td>
                    <td>${escapeHtml(session.reason)}</td>
                  </tr>`).join("")
                : `<tr><td colspan="${JOURNAL_COLUMNS.length}" class="empty-cell">Aucune session pour cette période. Ajustez les filtres ou pointez une entrée.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
      </div>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["journal"] = journalPage;
})();
