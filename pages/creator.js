/* Page "creator" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function creatorPage() {
    if (!H.isCreator()) {
      return `<article class="card"><p class="empty-state">Accès réservé au créateur de l'application.</p></article>`;
    }

    const visibility = H.getNavVisibility();

    return `
      <article class="card form-card">
        ${H.cardHeading("Visibilité des onglets")}
        <p class="creator-intro">Activez ou masquez chaque onglet pour les administrateurs (y compris le rôle RH), les managers et les collaborateurs. Les droits de sécurité propres à chaque onglet restent appliqués.</p>
        <form id="creator-nav-form" class="feature-form creator-nav-form">
          <div class="table-wrap">
            <table class="creator-nav-table">
              <thead>
                <tr>
                  <th>Onglet</th>
                  ${H.NAV_VISIBILITY_AUDIENCES.map((audience) => `<th>${audience.label}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${H.NAV_VISIBILITY_PAGES.map((page) => `
                  <tr>
                    <td><strong>${page.label}</strong></td>
                    ${H.NAV_VISIBILITY_AUDIENCES.map((audience) => {
                      const locked = page.id === "reports" && audience.id === "employee";
                      const checked = !locked && visibility[page.id]?.[audience.id] !== false;
                      return `
                      <td>
                        <label class="creator-toggle">
                          <input
                            type="checkbox"
                            name="${page.id}_${audience.id}"
                            ${checked ? "checked" : ""}
                            ${locked ? "disabled" : ""}
                          >
                          <span>${locked ? "Masqué" : "Visible"}</span>
                        </label>
                      </td>`;
                    }).join("")}
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <button type="submit" class="primary">Enregistrer les réglages</button>
        </form>
      </article>
      <article class="card form-card page-spacer">
        ${H.cardHeading("Accès IBI")}
        <p class="creator-intro">Le bouton Canva de l'en-tête reste masqué, sauf pour les deux ou trois adresses désignées ici. En mode démo, le bouton reste visible.</p>
        <form id="ibi-operators-form" class="feature-form">
          <div class="form-row">
            ${[0, 1, 2].map((index) => `
              <label>
                Personne ${index + 1}
                <input type="email" name="ibi_email_${index}" value="${H.escapeHtml(H.getIbiOperators()[index] || "")}" placeholder="prenom.nom@entreprise.fr">
              </label>`).join("")}
          </div>
          <button type="submit" class="primary">Enregistrer les accès IBI</button>
        </form>
      </article>
      ${H.renderCreatorAccountsSection()}`;
  }

  (H.pages = H.pages || {})["creator"] = creatorPage;
})(window.Humana);
