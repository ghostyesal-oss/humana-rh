/* Auto-generated from app.js by scripts/extract-pages.mjs.
 * Renderer for the "leave" tab.
 * Shared state/helpers are read from app.js (loaded first) via the
 * classic script scope. Registers itself on window.Humana.pages so
 * pageContent() in app.js can dispatch by currentPage.
 */
(function () {
  "use strict";
  function leavePage() {
    if (!isNavPageVisible("leave")) {
      return `<article class="card"><p class="empty-state">L'onglet Congés n'est pas disponible pour votre profil.</p></article>`;
    }

    const requests = getLeaveRequests();
    const balances = getLeaveBalances();
    const pending = pendingLeaveForValidator();
    const months = seniorityMonths();
    const carryFlag = balances[0] && balances[0].remaining > 3 && new Date().getMonth() === 11;
    const chain = getLeaveValidatorChain(session?.user?.id);

    return `
      ${carryFlag ? `<p class="data-note">Alerte de report : plus de 3 jours de CP restants au 31/12. Le solde non consommé est reportable une seule année.</p>` : ""}
      ${months < 6 && !isAdmin() ? `<p class="data-note">Ancienneté : ${months} mois. La durée légale requise est de 6 mois, sauf dérogation RH.</p>` : ""}
      <section class="balance-grid">
        ${balances.map((balance) => balanceCard(balance)).join("")}
      </section>
      ${renderLeaveCalendar()}
      ${pending.length ? `
      <article class="card table-card page-spacer">
        <div class="toolbar"><h3>Demandes à valider</h3></div>
        <p class="hierarchy-meta">Circuit : ${chain.map((item) => item.role).join(" → ")}</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Collaborateur</th><th>Type</th><th>Période</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${pending.map((request) => `
                <tr>
                  <td>${escapeHtml(request.name || profileById(request.userId || request.user_id)?.full_name || getUserName())}</td>
                  <td>${escapeHtml(request.type)}${request.motif ? `<br><small>${escapeHtml(request.motif)}</small>` : ""}</td>
                  <td>${formatDate(request.start)} - ${formatDate(request.end)} · ${request.days || request.hours || 0}${leaveIsHoursUnit(request.type) ? " h" : " j"}</td>
                  <td>${badge(request.status)}</td>
                  <td>
                    <button type="button" class="primary leave-approve" data-leave-id="${request.id}">Valider</button>
                    <button type="button" class="outline-button leave-reject" data-leave-id="${request.id}">Refuser</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </article>` : ""}
      <div class="feature-grid page-spacer">
        <article class="card form-card">
          ${cardHeading("Nouvelle demande")}
          <form id="leave-form" class="feature-form">
            <label>
              Code d'absence
              <select name="type" id="leave-type" required>
                ${leaveTypeOptionsHtml()}
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
          <p class="hierarchy-meta">Validation : ${chain.map((item) => escapeHtml(item.role)).join(" → ")}. Les absences ne peuvent pas se chevaucher.</p>
        </article>
        <article class="card table-card">
          <div class="toolbar"><h3>Mes demandes</h3></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Période</th><th>Durée</th><th>Justificatif</th><th>Statut</th></tr></thead>
              <tbody>${leaveRows(requests)}</tbody>
            </table>
          </div>
        </article>
      </div>`;
  }

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages["leave"] = leavePage;
})();
