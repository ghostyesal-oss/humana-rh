/* Page "reports" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function reportsPage() {
    if (!H.canViewReports()) {
      return `<article class="card"><p class="empty-state">Accès aux rapports non autorisé pour votre profil.</p></article>`;
    }
    const rows = H.buildEdsRows();
    const columns = H.visibleEdsColumns();
    const range = H.getEdsRange();
    const edsPage = H.paginateList("eds", rows);
    return `
      ${H.renderGtaTeamInbox()}
      ${H.edsFilterMarkup()}
      <article class="card form-card page-spacer">
        ${H.cardHeading("Exports")}
        <div class="team-punches-actions">
          ${H.canEditEdsPayroll() ? `<button type="button" id="eds-payroll-open" class="primary">Éléments de paie</button>` : ""}
          <button type="button" id="export-eds" class="${H.canEditEdsPayroll() ? "outline-button" : "primary"}">Export EDS consolidé</button>
          <button type="button" id="export-absences" class="outline-button">Absences / congés</button>
          <button type="button" id="export-retards" class="outline-button">Retards et heures manquantes</button>
        </div>
      </article>
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Aperçu EDS ${H.escapeHtml(H.edsPeriodLabel(range))}</h3></div>
        <div class="table-wrap eds-table-wrap">
          <table class="eds-table">
            <thead><tr>${columns.map((col) => `<th${col.payroll ? " class=\"eds-payroll\"" : ""}>${H.escapeHtml(col.label)}</th>`).join("")}</tr></thead>
            <tbody>
              ${edsPage.items.length
                ? edsPage.items.map((row) => `
                  <tr>
                    ${columns.map((col) => {
                      const value = row[col.key] ?? "";
                      const display = col.key === "nom" || col.key === "prenom" ? `<strong>${H.escapeHtml(value)}</strong>` : H.escapeHtml(value);
                      return `<td${col.payroll ? " class=\"eds-payroll\"" : ""} title="${H.escapeHtml(value)}">${display}</td>`;
                    }).join("")}
                  </tr>`).join("")
                : `<tr><td colspan="${columns.length}" class="empty-cell">Aucune donnée pour ce cycle.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${H.renderTablePager(edsPage)}
      </article>`;
  }

  (H.pages = H.pages || {})["reports"] = reportsPage;
})(window.Humana);
