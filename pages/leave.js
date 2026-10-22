/* Page "leave" : frontière window.Humana (app.js).
 * Plus de dépendance au scope global. Source maintenue dans pages/.
 */
(function (H) {
  "use strict";
  function leavePage() {
    if (!H.isNavPageVisible("leave")) {
      return `<article class="card"><p class="empty-state">L'onglet Congés n'est pas disponible pour votre profil.</p></article>`;
    }

    const requests = H.getLeaveRequests();
    const balances = H.getLeaveBalances();
    const pendingPage = H.paginateList("leave-pending", H.pendingLeaveForValidator());
    const minePage = H.paginateList("leave-mine", requests);
    const months = H.seniorityMonths();
    const carryFlag = balances[0] && balances[0].remaining > 3 && new Date().getMonth() === 11;
    const chain = H.getLeaveValidatorChain(H.session?.user?.id);

    return `
      ${carryFlag ? `<p class="data-note">Alerte de report : plus de 3 jours de CP restants au 31/12. Le solde non consommé est reportable une seule année.</p>` : ""}
      ${months < 6 && !H.hasOrgWideAccess() ? `<p class="data-note">Ancienneté : ${months} mois. La durée légale requise est de 6 mois, sauf dérogation RH.</p>` : ""}
      <section class="balance-grid">
        ${balances.map((balance) => H.balanceCard(balance)).join("")}
      </section>
      ${H.renderLeaveCalendar()}
      ${pendingPage.total ? `
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Demandes à valider</h3></div>
        <p class="hierarchy-meta">Après le N+1 (et le N+2 s'il existe), le Directeur ou le RH valide — un seul visa suffit.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Collaborateur</th><th>Type</th><th>Période</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${pendingPage.items.map((request) => `
                <tr>
                  <td>${H.escapeHtml(request.name || H.profileById(request.userId || request.user_id)?.full_name || H.getUserName())}</td>
                  <td>${H.escapeHtml(request.type)}${request.motif ? `<br><small>${H.escapeHtml(request.motif)}</small>` : ""}</td>
                  <td>${H.formatDate(request.start)} - ${H.formatDate(request.end)} · ${request.days || request.hours || 0}${H.leaveIsHoursUnit(request.type) ? " h" : " j"}</td>
                  <td>${H.badge(request.status)}</td>
                  <td>
                    <button type="button" class="primary leave-approve" data-leave-id="${request.id}">Valider</button>
                    <button type="button" class="outline-button leave-reject" data-leave-id="${request.id}">Refuser</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        ${H.renderTablePager(pendingPage)}
      </article>` : ""}
      <div class="feature-grid page-spacer">
        <article class="card form-card">
          ${H.cardHeading("Nouvelle demande")}
          <form id="leave-form" class="feature-form">
            <label>
              Code d'absence
              <select name="type" id="leave-type" required>
                ${H.leaveTypeOptionsHtml()}
              </select>
            </label>
            <div class="form-row">
              <label>
                Date de début
                <input type="date" name="start" required>
              </label>
              <label>
                Date de fin
                <input type="date" name="end" required>
              </label>
            </div>
            <label>
              Durée
              <select name="unit">
                <option value="days">Jours ouvrés</option>
                <option value="half">Demi-journée</option>
                <option value="hours">Heures (retard / départ)</option>
              </select>
            </label>
            <label id="leave-half-wrap" hidden>
              Demi-journée
              <select name="half_day">
                <option value="morning">Matin</option>
                <option value="afternoon">Après-midi</option>
              </select>
            </label>
            <label id="leave-hours-wrap" hidden>
              Heures
              <input type="number" name="hours" min="0.5" step="0.5" value="1">
            </label>
            <label>
              Commentaire
              <textarea name="comment" rows="3" placeholder="Precisez le contexte si besoin..."></textarea>
            </label>
            <label id="leave-file-wrap">
              Justificatif
              <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx">
            </label>
            <button type="submit" class="primary">Envoyer la demande</button>
          </form>
          <p class="hierarchy-meta">Validation : ${H.escapeHtml(H.leaveChainLabel(chain) || "N+1 → Directeur / RH")}. Directeur et RH sont interchangeables. Les absences ne peuvent pas se chevaucher.</p>
        </article>
        <article class="card table-card">
          <div class="toolbar"><h3>Mes demandes</h3></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Période</th><th>Durée</th><th>Justificatif</th><th>Statut</th></tr></thead>
            <tbody>${H.leaveRows(minePage.items)}</tbody>
          </table>
        </div>
        ${H.renderTablePager(minePage)}
      </article>
      </div>`;
  }

  (H.pages = H.pages || {})["leave"] = leavePage;
})(window.Humana);
