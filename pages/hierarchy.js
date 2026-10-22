/* Page "hierarchy" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function hierarchyPage() {
    if (!H.isNavPageVisible("hierarchy")) {
      return `<article class="card"><p class="empty-state">L'onglet Hiérarchie n'est pas disponible pour votre profil.</p></article>`;
    }

    if (!H.usesDatabase() && !H.demoMode) {
      return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour afficher l'organigramme de l'entreprise.</p></article>`;
    }

    const profiles = H.appData.orgProfiles;
    const chain = H.getManagerChain(profiles, H.session.user.id);
    const tree = H.buildOrgTree(profiles);
    const manager = chain.length > 1 ? chain[chain.length - 2] : null;
    const directReports = profiles.filter((profile) => profile.manager_id === H.session.user.id);
    const searchQuery = H.hierarchySearch.trim();
    const searching = Boolean(searchQuery);
    const displayTree = searching ? H.filterOrgTree(tree, searchQuery) : tree;
    const visibleCount = H.countOrgNodes(displayTree);

    return `
      <section class="hierarchy-grid">
        <article class="card">
          ${H.cardHeading("Ma ligne hierarchique")}
          <div class="chain-list">
            ${chain.map((profile, index) => `
              <div class="chain-item ${profile.id === H.session.user.id ? "is-me" : ""}">
                ${H.avatarForProfile(profile, index, "org-avatar")}
                <div>
                  <strong>${H.escapeHtml(profile.full_name)}</strong>
                  <span>${H.escapeHtml(profile.job_title || "Collaborateur")}</span>
                </div>
              </div>`).join("")}
          </div>
          ${manager
            ? `<p class="hierarchy-meta">Votre manager : <strong>${H.escapeHtml(manager.full_name)}</strong></p>`
            : `<p class="hierarchy-meta">Vous n'avez pas de manager assigne.</p>`}
        </article>
        <article class="card">
          ${H.cardHeading("Mon équipe directe")}
          <div class="team-grid">
            ${directReports.length
              ? directReports.map((profile, index) => `
                <div class="team-card-wrap">
                  ${H.renderProfilePyramidCard(profile, index, { isMe: profile.id === H.session.user.id })}
                </div>`).join("")
              : `<p class="empty-inline">Aucun collaborateur rattaché pour le moment.</p>`}
          </div>
        </article>
      </section>
      <article class="card page-spacer hierarchy-org-card">
        <div class="card-heading hierarchy-org-heading">
          <h3>Organigramme</h3>
          <span class="hierarchy-result-count" id="hierarchy-result-count">${searching ? `${visibleCount} resultat${visibleCount > 1 ? "s" : ""}` : `${profiles.length} collaborateurs`}</span>
        </div>
        <label class="hierarchy-search" for="hierarchy-search">
          <span class="hierarchy-search-icon" aria-hidden="true"></span>
          <input
            type="search"
            id="hierarchy-search"
            placeholder="Rechercher par nom, poste, service..."
            value="${H.escapeHtml(searchQuery)}"
            autocomplete="off"
          >
        </label>
        <div class="org-tree" id="org-tree">
          ${displayTree.length
            ? displayTree.map((node) => H.renderOrgNode(node, { forceExpand: searching })).join("")
            : `<p class="empty-state">Aucun collaborateur ne correspond à votre recherche.</p>`}
        </div>
        <p class="hierarchy-meta">${H.isAdmin() ? "Les administrateurs peuvent modifier la hiérarchie dans Administration." : "Contactez un administrateur pour modifier la hiérarchie."}</p>
      </article>`;
  }

  (H.pages = H.pages || {})["hierarchy"] = hierarchyPage;
})(window.Humana);
