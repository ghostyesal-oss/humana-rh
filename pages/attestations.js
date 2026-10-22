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

  function hrTypeDropdown(placeholder, types, options = {}) {
    const single = Boolean(options.single);
    const inputType = single ? "radio" : "checkbox";
    const blocked = new Set(options.blockedTypes || []);
    return `
              <div class="hr-dropdown" data-hr-dropdown data-placeholder="${H.escapeHtml(placeholder)}"${single ? " data-hr-single" : ""}>
                <button type="button" class="hr-dropdown__toggle is-placeholder" data-hr-toggle aria-expanded="false" aria-haspopup="listbox">
                  <span data-hr-summary>${H.escapeHtml(placeholder)}</span>
                </button>
                <div class="hr-dropdown__menu" role="listbox" aria-multiselectable="${single ? "false" : "true"}">
                  ${types.map((type) => {
                    const used = blocked.has(type);
                    const next = options.blockedNext?.[type];
                    const hint = used
                      ? (next ? ` — disponible le ${next}` : " — déjà demandé il y a moins de 3 mois")
                      : "";
                    return `
                    <label${used ? ' class="is-disabled"' : ""}>
                      <input type="${inputType}" name="types" value="${H.escapeHtml(type)}"${used ? " disabled" : ""}>
                      <span>${H.escapeHtml(type)}${H.escapeHtml(hint)}</span>
                    </label>`;
                  }).join("")}
                </div>
              </div>`;
  }

  function attestationsPage() {
    if (!H.isNavPageVisible("attestations")) {
      return `<article class="card"><p class="empty-state">L'onglet Demande RH n'est pas disponible pour votre profil.</p></article>`;
    }

    const requestPage = H.paginateList("hr-mine", H.getOwnHrRequests());
    const quota = H.getAttestationQuota();
    const attestationBlocked = quota.allBlocked;

    return `
      ${H.renderHrValidationInbox()}
      ${H.renderHrTeamFollowup()}
      <div class="feature-grid feature-grid--hr">
        ${salaryAdvanceFormCard()}
        <article class="card form-card">
          ${H.cardHeading("Nouvelle attestation")}
          <p class="data-note">Un même type d'attestation ne peut être demandé qu'une fois tous les ${quota.cooldownMonths} mois, à compter de la date de la dernière demande.</p>
          ${quota.blockedTypes.length ? `<p class="data-note">Déjà demandé : ${H.escapeHtml(quota.blockedTypes.map((type) => {
            const next = quota.byType[type]?.nextAvailableLabel;
            return next ? `${type} (prochaine le ${next})` : type;
          }).join(", "))}.</p>` : ""}
          <form id="attestation-form" class="feature-form">
            <label class="hr-select">
              Types de documents
              ${hrTypeDropdown("Choisir une ou plusieurs attestations", H.attestationTypes, { blockedTypes: quota.blockedTypes, blockedNext: quota.blockedNext })}
            </label>
            <label>
              Motif / précision
              <textarea name="reason" rows="4" placeholder="Ex. dossier de location, banque, administration..." required${attestationBlocked ? " disabled" : ""}></textarea>
            </label>
            <button type="submit" class="primary"${attestationBlocked ? " disabled" : ""}>Envoyer la demande</button>
          </form>
        </article>
        <article class="card form-card">
          ${H.cardHeading("Autres demandes")}
          <form id="other-request-form" class="feature-form">
            <label class="hr-select">
              Type de demande
              ${hrTypeDropdown("Choisir une demande", H.otherRequestTypes, { single: true })}
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
