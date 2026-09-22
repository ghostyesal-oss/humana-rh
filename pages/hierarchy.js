/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "hierarchy" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function hierarchyPage() {
    if (!isNavPageVisible("hierarchy")) {
      return `<article class="card"><p class="empty-state">L'onglet Hiérarchie n'est pas disponible pour votre profil.</p></article>`;
    }

    if (!usesDatabase() && !demoMode) {
      return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour afficher l'organigramme de l'entreprise.</p></article>`;
    }

    const profiles = appData.orgProfiles;
    const chain = getManagerChain(profiles, session.user.id);
    const tree = buildOrgTree(profiles);
    const manager = chain.length > 1 ? chain[chain.length - 2] : null;
    const directReports = profiles.filter((profile) => profile.manager_id === session.user.id);
    const searchQuery = hierarchySearch.trim();
    const searching = Boolean(searchQuery);
    const displayTree = searching ? filterOrgTree(tree, searchQuery) : tree;
    const visibleCount = countOrgNodes(displayTree);

    return `
      <section class="hierarchy-grid">
        <article class="card">
          ${cardHeading("Ma ligne hierarchique")}
          <div class="chain-list">
            ${chain.map((profile, index) => `
              <div class="chain-item ${profile.id === session.user.id ? "is-me" : ""}">
                ${avatarForProfile(profile, index, "org-avatar")}
                <div>
                  <strong>${escapeHtml(profile.full_name)}</strong>
                  <span>${escapeHtml(profile.job_title || "Collaborateur")}</span>
                </div>
              </div>`).join("")}
          </div>
          ${manager
            ? `<p class="hierarchy-meta">Votre manager : <strong>${escapeHtml(manager.full_name)}</strong></p>`
            : `<p class="hierarchy-meta">Vous n'avez pas de manager assigne.</p>`}
        </article>
        <article class="card">
          ${cardHeading("Mon équipe directe")}
          <div class="team-grid">
            ${directReports.length
              ? directReports.map((profile, index) => `
                <div class="team-card-wrap">
                  ${renderProfilePyramidCard(profile, index, { isMe: profile.id === session.user.id })}
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
            value="${escapeHtml(searchQuery)}"
            autocomplete="off"
          >
        </label>
        <div class="org-tree" id="org-tree">
          ${displayTree.length
            ? displayTree.map((node) => renderOrgNode(node, { forceExpand: searching })).join("")
            : `<p class="empty-state">Aucun collaborateur ne correspond à votre recherche.</p>`}
        </div>
        <p class="hierarchy-meta">${isAdmin() ? "Les administrateurs peuvent modifier la hiérarchie dans Administration." : "Contactez un administrateur pour modifier la hiérarchie."}</p>
      </article>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["hierarchy"] = hierarchyPage;
})();
