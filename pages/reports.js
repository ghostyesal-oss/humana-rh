/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "reports" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function reportsPage() {
    if (!canViewReports()) {
      return `<article class="card"><p class="empty-state">Accès aux rapports non autorisé pour votre profil.</p></article>`;
    }
    const rows = buildEdsRows();
    const columns = visibleEdsColumns();
    return `
      ${renderGtaTeamInbox()}
      <article class="card form-card page-spacer">
        ${cardHeading("Exports")}
        <div class="team-punches-actions">
          <button type="button" id="export-eds" class="primary">Export EDS consolide</button>
          <button type="button" id="export-absences" class="outline-button">Absences / congés</button>
          <button type="button" id="export-retards" class="outline-button">Retards et heures manquantes</button>
        </div>
      </article>
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Aperçu EDS</h3></div>
        <div class="table-wrap eds-table-wrap">
          <table class="eds-table">
            <thead><tr>${columns.map((col) => `<th${col.payroll ? " class=\"eds-payroll\"" : ""}>${escapeHtml(col.label)}</th>`).join("")}</tr></thead>
            <tbody>
              ${rows.length
                ? rows.map((row) => `
                  <tr>
                    ${columns.map((col) => {
                      const value = row[col.key] ?? "";
                      const display = col.key === "nom" || col.key === "prenom" ? `<strong>${escapeHtml(value)}</strong>` : escapeHtml(value);
                      return `<td${col.payroll ? " class=\"eds-payroll\"" : ""} title="${escapeHtml(value)}">${display}</td>`;
                    }).join("")}
                  </tr>`).join("")
                : `<tr><td colspan="${columns.length}" class="empty-cell">Aucune donnée pour ce cycle.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["reports"] = reportsPage;
})();
