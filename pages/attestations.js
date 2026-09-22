/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "attestations" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function attestationsPage() {
    if (!isNavPageVisible("attestations")) {
      return `<article class="card"><p class="empty-state">L'onglet Demande RH n'est pas disponible pour votre profil.</p></article>`;
    }

    const requests = getHrRequests();
    const tableMissing = usesDatabase() && appData.salaryAdvanceTableMissing
      ? `<p class="data-note">Les avances sur salaire seront enregistrées après exécution de <code>supabase/salary-advance-requests.sql</code> dans SQL Editor.</p>`
      : "";

    return `
      ${tableMissing}
      <div class="feature-grid">
        <article class="card form-card">
          ${cardHeading("Avance sur salaire")}
          <form id="salary-advance-form" class="feature-form">
            <label>
              Montant
              <input type="number" name="amount" min="1" step="0.01" required placeholder="Ex. 2000">
            </label>
            <label>
              Date souhaitée
              <input type="date" name="requested_date">
            </label>
            <label>
              Motif
              <textarea name="reason" rows="4" placeholder="Ex. urgence familiale, frais exceptionnels..." required></textarea>
            </label>
            <button type="submit" class="primary">Envoyer la demande</button>
          </form>
        </article>
        <article class="card form-card">
          ${cardHeading("Nouvelle attestation")}
          <form id="attestation-form" class="feature-form">
            <label>
              Type de document
              <select name="type" required>
                ${attestationTypes.map((type) => `<option value="${type}">${type}</option>`).join("")}
              </select>
            </label>
            <label>
              Motif / précision
              <textarea name="reason" rows="4" placeholder="Ex. dossier de location, banque, administration..." required></textarea>
            </label>
            <button type="submit" class="primary">Envoyer la demande</button>
          </form>
        </article>
      </div>
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Mes demandes RH</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Détail</th><th>Date</th><th>Statut</th></tr></thead>
            <tbody>${hrRequestRows(requests)}</tbody>
          </table>
        </div>
      </article>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["attestations"] = attestationsPage;
})();
