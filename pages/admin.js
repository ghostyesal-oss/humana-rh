/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "admin" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function adminPage() {
    if (!isAdmin()) {
      return `<article class="card"><p class="empty-state">Accès réservé aux administrateurs.</p></article>`;
    }

    return `
      ${renderUserAccountSection()}
      ${renderGtaSettingsSection()}
      <div class="feature-grid page-spacer">
        <article class="card form-card">
          ${cardHeading("Publier un document RH")}
          <form id="admin-hr-doc-form" class="feature-form" enctype="multipart/form-data">
            <label>
              Titre
              <input type="text" name="title" required placeholder="Ex. Règlement intérieur">
            </label>
            <label>
              Description
              <input type="text" name="description" placeholder="Courte description">
            </label>
            <label>
              Catégorie
              <input type="text" name="category" value="General">
            </label>
            <label>
              Visibilité
              <select name="visibility">
                ${EVENT_VISIBILITIES.map((vis) => `<option value="${vis.id}">${escapeHtml(vis.label)}</option>`).join("")}
              </select>
            </label>
            <label class="file-upload">
              Fichier a publier
              <input type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,application/pdf" ${usesDatabase() ? "required" : ""}>
              <span class="file-upload-hint">PDF, Word, Excel ou image — maximum 10 Mo</span>
            </label>
            <button type="submit" class="primary">Televerser et publier</button>
          </form>
          ${usesDatabase() ? "" : `<p class="hierarchy-meta">Le téléversement de fichiers est disponible après connexion à Microsoft.</p>`}
        </article>
        <article class="card form-card">
          ${cardHeading("Ajouter un bulletin de paie")}
          <form id="admin-payslip-form" class="feature-form" enctype="multipart/form-data">
            <label>
              Collaborateur
              <select name="user_id" required>
                <option value="">Selectionner...</option>
                ${appData.orgProfiles.map((profile) => `
                  <option value="${profile.id}">${escapeHtml(profile.full_name)} (${escapeHtml(profile.email)})</option>`).join("")}
              </select>
            </label>
            <div class="form-row">
              <label>
                Mois
                <select name="period_month" required>
                  ${Array.from({ length: 12 }, (_, index) => {
                    const month = index + 1;
                    const label = new Date(2026, index, 1).toLocaleDateString("fr-FR", { month: "long" });
                    return `<option value="${month}">${label}</option>`;
                  }).join("")}
                </select>
              </label>
              <label>
                Annee
                <input type="number" name="period_year" min="2020" max="2099" value="${new Date().getFullYear()}" required>
              </label>
            </div>
            <label class="file-upload">
              Fichier bulletin (PDF)
              <input type="file" name="file" accept=".pdf,application/pdf" ${usesDatabase() ? "required" : ""}>
              <span class="file-upload-hint">PDF uniquement — maximum 10 Mo</span>
            </label>
            <button type="submit" class="primary">Televerser le bulletin</button>
          </form>
          ${usesDatabase() ? "" : `<p class="hierarchy-meta">Le téléversement de fichiers est disponible après connexion à Microsoft.</p>`}
        </article>
      </div>
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Documents RH publiés</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Document</th><th>Catégorie</th><th>Visibilité</th><th>Date</th><th>Fichier</th><th></th></tr></thead>
            <tbody>
              ${getHrDocuments().length
                ? getHrDocuments().map((doc) => `
                  <tr>
                    <td><strong>${escapeHtml(doc.title)}</strong><br><small>${escapeHtml(doc.description || "")}</small></td>
                    <td>${escapeHtml(doc.category || "General")}</td>
                    <td>${escapeHtml(eventVisibilityLabel(doc.visibility || "all"))}</td>
                    <td>${formatDate(doc.published_at)}</td>
                    <td><a ${privateFileLinkAttributes("hr-document", doc)} target="_blank" rel="noopener noreferrer">Ouvrir</a></td>
                    <td><button type="button" class="outline-button admin-delete-hr-doc" data-doc-id="${doc.id}" data-storage-path="${escapeHtml(doc.storage_path || "")}">Supprimer</button></td>
                  </tr>`).join("")
                : `<tr><td colspan="6" class="empty-cell">Aucun document publié.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["admin"] = adminPage;
})();
