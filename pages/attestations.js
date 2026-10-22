/* Page "attestations" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function salaryAdvanceFormCard() {
    const quota = H.getSalaryAdvanceQuota();
    const blocked = !quota.ok;
    return `
        <article class="card form-card">
          ${H.cardHeading("Avance sur salaire")}
          ${quota.reason ? `<p class="data-note">${H.escapeHtml(quota.reason)}</p>` : ""}
          <form id="salary-advance-form" class="feature-form">
            <label>
              Montant
              <input type="number" name="amount" min="1" step="0.01" required placeholder="Ex. 2000"${quota.maxAmount ? ` max="${quota.maxAmount}"` : ""}${blocked ? " disabled" : ""}>
            </label>
            <label>
              Date souhaitée
              <input type="date" name="requested_date"${blocked ? " disabled" : ""}>
            </label>
            <label>
              Motif
              <textarea name="reason" rows="4" placeholder="Ex. urgence familiale, frais exceptionnels..." required${blocked ? " disabled" : ""}></textarea>
            </label>
            <button type="submit" class="primary"${blocked ? " disabled" : ""}>Envoyer la demande</button>
          </form>
        </article>`;
  }

  function hrTypeDropdown(placeholder, types) {
    return `
              <div class="hr-dropdown" data-hr-dropdown data-placeholder="${H.escapeHtml(placeholder)}">
                <button type="button" class="hr-dropdown__toggle is-placeholder" data-hr-toggle aria-expanded="false" aria-haspopup="listbox">
                  <span data-hr-summary>${H.escapeHtml(placeholder)}</span>
                </button>
                <div class="hr-dropdown__menu" role="listbox" aria-multiselectable="true">
                  ${types.map((type) => `
                    <label>
                      <input type="checkbox" name="types" value="${H.escapeHtml(type)}">
                      <span>${H.escapeHtml(type)}</span>
                    </label>`).join("")}
                </div>
              </div>`;
  }

  function attestationsPage() {
    if (!H.isNavPageVisible("attestations")) {
      return `<article class="card"><p class="empty-state">L'onglet Demande RH n'est pas disponible pour votre profil.</p></article>`;
    }

    const requestPage = H.paginateList("hr-mine", H.getOwnHrRequests());

    return `
      ${H.renderHrValidationInbox()}
      ${H.renderHrTeamFollowup()}
      <div class="feature-grid feature-grid--hr">
        ${salaryAdvanceFormCard()}
        <article class="card form-card">
          ${H.cardHeading("Nouvelle attestation")}
          <form id="attestation-form" class="feature-form">
            <label class="hr-select">
              Types de documents
              ${hrTypeDropdown("Choisir une ou plusieurs attestations", H.attestationTypes)}
            </label>
            <label>
              Motif / précision
              <textarea name="reason" rows="4" placeholder="Ex. dossier de location, banque, administration..." required></textarea>
            </label>
            <button type="submit" class="primary">Envoyer la demande</button>
          </form>
        </article>
        <article class="card form-card">
          ${H.cardHeading("Autres demandes")}
          <form id="other-request-form" class="feature-form">
            <label class="hr-select">
              Type de demande
              ${hrTypeDropdown("Choisir une ou plusieurs demandes", H.otherRequestTypes)}
            </label>
            <label data-other-detail hidden>
              Précisez
              <input type="text" name="other_detail" maxlength="120" placeholder="Ex. mutuelle, prestataire, dossier...">
            </label>
            <label>
              Motif / précision
              <textarea name="reason" rows="4" placeholder="Ex. erreur de bulletin, question mutuelle..." required></textarea>
            </label>
            <button type="submit" class="primary">Envoyer la demande</button>
          </form>
        </article>
      </div>
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Mes demandes RH</h3></div>
        <p class="hierarchy-meta">Prise en charge (dépôt) → Validé ou Refusé par le RH ou le Directeur.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Détail</th><th>Date</th><th>Statut</th></tr></thead>
            <tbody>${H.hrRequestRows(requestPage.items)}</tbody>
          </table>
        </div>
        ${H.renderTablePager(requestPage)}
      </article>`;
  }

  (H.pages = H.pages || {})["attestations"] = attestationsPage;
})(window.Humana);
