/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "creator" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function creatorPage() {
    if (!isCreator()) {
      return `<article class="card"><p class="empty-state">Accès réservé au créateur de l'application.</p></article>`;
    }

    const visibility = getNavVisibility();

    return `
      <article class="card form-card">
        ${cardHeading("Visibilité des onglets")}
        <p class="creator-intro">Activez ou masquez chaque onglet pour les administrateurs, les managers et les collaborateurs. Les droits de sécurité propres à chaque onglet restent appliqués.</p>
        <form id="creator-nav-form" class="feature-form creator-nav-form">
          <div class="table-wrap">
            <table class="creator-nav-table">
              <thead>
                <tr>
                  <th>Onglet</th>
                  ${NAV_VISIBILITY_AUDIENCES.map((audience) => `<th>${audience.label}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${NAV_VISIBILITY_PAGES.map((page) => `
                  <tr>
                    <td><strong>${page.label}</strong></td>
                    ${NAV_VISIBILITY_AUDIENCES.map((audience) => `
                      <td>
                        <label class="creator-toggle">
                          <input
                            type="checkbox"
                            name="${page.id}_${audience.id}"
                            ${visibility[page.id]?.[audience.id] !== false ? "checked" : ""}
                          >
                          <span>Visible</span>
                        </label>
                      </td>`).join("")}
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <button type="submit" class="primary">Enregistrer les réglages</button>
        </form>
      </article>
      ${renderCreatorAccountsSection()}`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["creator"] = creatorPage;
})();
