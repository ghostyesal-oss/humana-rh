/* Page IBI : RIB marocain, IBAN calculé dans Daylyx.
 * Frontière window.Humana (app.js). Aucun appel vers un site de calcul.
 */
(function (H) {
  "use strict";

  let records = Object.create(null);
  const filters = { query: "", status: "all" };
  let editingId = "";
  let tableView = "ibi";
  let seeded = false;
  let stepUp = { status: "unknown", at: 0 };
  let storeStatus = { status: "idle", error: "" };
  let detail = { id: "", status: "idle", error: "" };

  function stepUpGate() {
    const refused = new URLSearchParams(window.location.search).get("stepup") === "required";
    return `
      <article class="card form-card">
        ${H.cardHeading("Confirmation Microsoft")}
        ${refused ? `<p class="error-message">L'approbation Authenticator n'a pas été confirmée.</p><div class="team-punches-actions"><a class="primary" href="${H.ibiStepUpHref()}">Réessayer</a></div>` : ""}
      </article>`;
  }

  function digits(value, size) {
    return String(value || "").replace(/\D/g, "").slice(0, size);
  }

  function expectedRibKey(first22) {
    const mod = BigInt(first22) % 97n;
    return String(97n - mod).padStart(2, "0");
  }

  function ibanFromRib(rib24) {
    const converted = `${rib24}221000`;
    const check = 98n - (BigInt(converted) % 97n);
    return `MA${String(check).padStart(2, "0")}${rib24}`;
  }

  function recordOf(profileId) {
    return records[profileId] || null;
  }

  function ribDigits(record) {
    if (!record) return "";
    return `${record.bank}${record.city}${record.account}${record.key}`;
  }

  function analyze(record) {
    if (record && record.last4 && !record.bank) {
      return { status: "ready", label: "IBAN calculé", rib: record.last4, iban: record.last4 };
    }
    if (!record || !record.bank) {
      return { status: "missing", label: "À renseigner", rib: "", iban: "" };
    }
    const first = `${record.bank}${record.city}${record.account}`;
    const rib = `${first}${record.key}`;
    if (first.length !== 22 || record.key.length !== 2) {
      return { status: "invalid", label: "RIB incomplet", rib, iban: "" };
    }
    if (record.key !== expectedRibKey(first)) {
      return { status: "invalid", label: "Clé invalide", rib, iban: "" };
    }
    return { status: "ready", label: "IBAN calculé", rib, iban: ibanFromRib(rib) };
  }

  function maskAccount(value) {
    const raw = String(value || "");
    if (raw.length < 4) return "—";
    return `•••• ${raw.slice(-4)}`;
  }

  const PAY_COLUMNS = [
    ["matriculeRh", "Matricule RH"],
    ["cegidId", "Cegid ID"],
    ["statut", "STATUT"],
    ["civilite", "CIVILITE"],
    ["nom", "Nom"],
    ["prenom", "PRENOM"],
    ["nomPrenom", "NOM & PRENOM"],
    ["dateNaissance", "DATE NAISSANCE"],
    ["sexe", "SEXE"],
    ["age", "AGE"],
    ["lieuNaissance", "LIEU NAISSANCE"],
    ["nationalite", "NATIONALITE"],
    ["situationFamille", "SITUATION FAMILLE"],
    ["situationConjoint", "SITUATION CONJOINT (E) TRAVAIL"],
    ["nombreEnfants", "NOMBRE ENFANTS"],
    ["nombreDeductions", "NOMBRE DEDUCTIONS"],
    ["immatriculation", "N°D'IMMATRICULATION / N°PASSEPORT / CARTE DE SÉJOUR"],
    ["dateExpiration", "DATE D'EXPIRATION"],
    ["cin", "N°CIN"],
    ["dateExpirationCin", "DATE D'EXPIRATION C.I.N"],
    ["certifResidence", "Certif de Résidence"],
    ["adresse", "ADRESSE"],
    ["ville", "VILLE"],
    ["pays", "PAYS"],
    ["telephone", "TELEPHONE"],
    ["numPro", "Num PRO"],
    ["email", "Email"],
    ["typeContrat", "TYPE CONTRAT"],
    ["dateRecrutement", "DATE DE RECRUTEMENT"],
    ["dateDepart", "DATE DEPART"],
    ["natureDepart", "NATURE DE DEPART"],
    ["motifDepart", "MOTIF DE DEPART"],
    ["respectPreavis", "RESPECT PREAVIS"],
    ["dateAnciennete", "DATE ANCIENNETE"],
    ["categorieProf", "CATEGORIE PROF"],
    ["nominationCegid", "NOMINATION CEGID"],
    ["jobCode", "Job Code"],
    ["jobTitle", "JOB TITLE NV"],
    ["activite", "Activité"],
    ["direction", "DIRECTION"],
    ["matriculeManager", "Matricule Manager"],
    ["manager", "Manager"],
    ["salaireBase", "SALAIRE DE BASE"],
    ["primeTransport", "PRIME TRANSPORT"],
    ["salaireNet", "SALAIRE NET"],
    ["statutCfc", "STATUT CFC"],
    ["primeProdCibleNet", "Prime Prod cible NET"],
    ["primeProdCibleBrut", "Prime Prod cible BRUT"],
    ["primeProjetBrut", "Prime Projet BRUT"],
    ["primeOtbBrut", "Prime OTB BRUT"],
    ["primeLangue", "Prime langue"],
    ["primeLangueBrut", "Prime langue BRUT"],
    ["salaireBrut", "Salaire Brut"],
    ["modePaiement", "MODE PAIEMENT"],
    ["banque", "BANQUE"],
    ["agence", "AGENCE"],
    ["noCompte", "NO COMPTE"],
    ["cnss", "N°CNSS"],
    ["retraitePp", "N°Retraite PP"],
    ["retraitePs", "N°Retraite PS"],
    ["matriculeMutuelle", "Matricule Mutuelle"],
    ["codeSwift", "CODE SWIFT"],
    ["bu", "BU"],
    ["subBu", "SUB BU"],
    ["job", "JOB"],
    ["profile", "PROFILE"]
  ];

  function visibleProfiles() {
    return H.appData.orgProfiles || [];
  }

  function tableSwitch() {
    const ibi = tableView === "ibi" ? " is-active" : "";
    const pay = tableView === "pay" ? " is-active" : "";
    return `<div class="team-punches-actions">
      <div class="segmented" role="tablist">
        <button type="button" class="planning-tab${ibi}" data-canva-table="ibi">Informations bancaires</button>
        <button type="button" class="planning-tab${pay}" data-canva-table="pay">Information perso</button>
      </div>
      <button type="button" class="outline-button" id="canva-export">Exporter Excel</button>
    </div>`;
  }

  function shown(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function payCells(profile) {
    const parts = String(profile.full_name || "").trim().split(/\s+/).filter(Boolean);
    const prenom = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
    const nom = parts.length ? parts[parts.length - 1] : "";
    const manager = visibleProfiles().find((item) => item.id === profile.manager_id);
    const known = {
      bu: profile.department,
      cegidId: profile.matricule,
      email: profile.email,
      job: profile.job_title,
      jobTitle: profile.job_title,
      manager: manager?.full_name,
      matriculeManager: manager?.matricule,
      matriculeRh: profile.matricule,
      nom,
      nomPrenom: profile.full_name,
      prenom,
      dateRecrutement: profile.hired_at,
      statut: profile.full_name ? "Actif" : ""
    };
    return PAY_COLUMNS.map(([key]) => shown(known[key]));
  }

  function payRows() {
    const query = filters.query.trim().toLowerCase();
    return visibleProfiles()
      .filter((profile) => {
        if (!query) return true;
        const haystack = `${profile.full_name || ""} ${profile.email || ""} ${profile.matricule || ""} ${profile.department || ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "fr"));
  }

  function excelText(value) {
    const text = String(value ?? "");
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  }

  function xmlCell(value) {
    const text = excelText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    return `<Cell><Data ss:Type="String">${text}</Data></Cell>`;
  }

  function worksheet(name, headers, dataRows) {
    const body = [headers, ...dataRows]
      .map((row) => `<Row>${row.map(xmlCell).join("")}</Row>`)
      .join("");
    return `<Worksheet ss:Name="${name}"><Table>${body}</Table></Worksheet>`;
  }

  function ibiExportRows() {
    return rows().map((row) => {
      const rib = row.analysis.rib && row.analysis.rib.length > 4
        ? row.analysis.rib
        : (row.analysis.rib ? `•••• ${String(row.analysis.rib).slice(-4)}` : "—");
      const iban = row.analysis.iban && row.analysis.iban.length > 4
        ? row.analysis.iban
        : (row.analysis.iban ? `•••• ${String(row.analysis.iban).slice(-4)}` : "—");
      return [
        shown(row.profile.matricule),
        shown(row.profile.full_name),
        shown(row.profile.department),
        rib,
        iban,
        shown(row.analysis.label)
      ];
    });
  }

  function exportCanvaExcel() {
    const stamp = new Date().toISOString().slice(0, 10);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheet("Informations bancaires", ["Matricule", "Collaborateur", "Service", "RIB", "IBAN", "Statut"], ibiExportRows())}
${worksheet("Information perso", PAY_COLUMNS.map(([, label]) => label), payRows().map(payCells))}
</Workbook>`;
    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `canva-${stamp}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function payTable() {
    const list = payRows();
    const page = H.paginateList("pay", list);
    return `
      <article class="card table-card">
        ${H.cardHeading("Information perso")}
        <div class="page-spacer">${tableSwitch()}</div>
        <details class="collapse-panel" ${H.isFilterPanelOpen("pay") ? "open" : ""} data-filter-panel="pay">
          <summary>Filtres</summary>
          <form id="pay-filter" class="feature-form collapse-panel-form">
            <div class="form-row">
              <label>Recherche
                <input name="query" type="search" placeholder="Nom, matricule, service" value="${H.escapeHtml(filters.query)}">
              </label>
            </div>
            <div class="team-punches-actions">
              <button type="submit" class="primary">Filtrer</button>
              <button type="button" class="outline-button" id="pay-filter-reset">Réinitialiser</button>
            </div>
          </form>
        </details>
        <div class="table-wrap">
          <table class="canva-pay-table">
            <thead>
              <tr>${PAY_COLUMNS.map(([, label]) => `<th>${H.escapeHtml(label)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${page.items.length ? page.items.map((profile) => `
                <tr>${payCells(profile).map((cell) => `<td>${H.escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${PAY_COLUMNS.length}" class="empty-cell">Aucune ligne de paie.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${H.renderTablePager(page)}
      </article>`;
  }

  function seedDemo() {
    if (seeded || !H.demoMode) return;
    seeded = true;
    const profiles = H.appData.orgProfiles || [];
    const samples = [
      ["007", "810", "0000000000000019"],
      ["011", "780", "0000000000000042"]
    ];
    profiles.slice(0, samples.length).forEach((profile, index) => {
      const [bank, city, account] = samples[index];
      records[profile.id] = {
        bank,
        city,
        account,
        key: expectedRibKey(`${bank}${city}${account}`),
        holder: profile.full_name || ""
      };
    });
  }

  function rows() {
    const query = filters.query.trim().toLowerCase();
    return visibleProfiles()
      .map((profile) => ({ profile, analysis: analyze(recordOf(profile.id)) }))
      .filter((row) => {
        if (filters.status !== "all" && row.analysis.status !== filters.status) return false;
        if (!query) return true;
        const haystack = `${row.profile.full_name || ""} ${row.profile.matricule || ""} ${row.profile.department || ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => String(a.profile.full_name || "").localeCompare(String(b.profile.full_name || ""), "fr"));
  }

  function editForm(profile) {
    const record = recordOf(profile.id) || { bank: "", city: "", account: "", key: "" };
    const holder = String(record.holder || "").trim() || profile.full_name || "";
    const analysis = analyze(record.bank ? record : null);
    const preview = analysis.status === "ready"
      ? `IBAN calculé : ${H.escapeHtml(analysis.iban)}`
      : "Saisissez les 24 chiffres du RIB marocain. L'IBAN apparaît quand la clé est bonne.";
    return `
      <article class="card form-card page-spacer">
        ${H.cardHeading("Modifier le RIB")}
        <p class="data-note">${H.escapeHtml(profile.full_name || "Collaborateur")} — RIB marocain de 24 chiffres : banque (3), localité (3), compte (16) et clé (2). Daylyx calcule l'IBAN MA ici. Rien n'est envoyé vers un site de calcul.</p>
        <form id="bank-edit-form" class="feature-form" data-profile-id="${H.escapeHtml(profile.id)}">
          <div class="form-row">
            <label>Titulaire<input name="holder" maxlength="80" value="${H.escapeHtml(holder)}"></label>
            <label>Code banque<input name="bank" inputmode="numeric" maxlength="3" required value="${H.escapeHtml(record.bank || "")}"></label>
            <label>Code localité<input name="city" inputmode="numeric" maxlength="3" required value="${H.escapeHtml(record.city || "")}"></label>
          </div>
          <div class="form-row">
            <label>Numéro de compte<input name="account" inputmode="numeric" maxlength="16" required value="${H.escapeHtml(record.account || "")}"></label>
            <label>Clé RIB<input name="key" inputmode="numeric" maxlength="2" required value="${H.escapeHtml(record.key || "")}"></label>
          </div>
          <p id="bank-preview" class="data-note">${preview}</p>
          ${detail.error ? `<p class="error-message">${H.escapeHtml(detail.error)}</p>` : ""}
          <p id="bank-edit-error" class="error-message" hidden></p>
          <div class="team-punches-actions">
            <button type="submit" class="primary">Enregistrer</button>
            <button type="button" class="outline-button" id="bank-cancel">Annuler</button>
          </div>
        </form>
      </article>`;
  }

  function bankPage() {
    if (!H.canViewBank()) {
      return `<article class="card"><p class="empty-state">Les informations bancaires sont réservées aux personnes désignées.</p></article>`;
    }
    if (H.demoMode) {
      stepUp = { status: "ready", at: Date.now() };
    }
    const fresh = stepUp.status !== "unknown" && Date.now() - stepUp.at < 20000;
    if (!H.demoMode && (stepUp.status === "pending" || !fresh)) {
      if (stepUp.status !== "pending") {
        stepUp = { status: "pending", at: Date.now() };
        H.ensureIbiStepUp().then((ok) => {
          stepUp = { status: ok ? "ready" : "locked", at: Date.now() };
          H.renderApp();
        });
      }
      return `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Vérification Microsoft...</div>`;
    }
    if (stepUp.status !== "ready") {
      if (new URLSearchParams(window.location.search).get("stepup") === "required") return stepUpGate();
      window.location.assign(H.ibiStepUpHref());
      return `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Authentification Microsoft...</div>`;
    }
    if (!H.demoMode && storeStatus.status !== "ready") {
      if (storeStatus.status === "error") {
        return `<article class="card"><p class="error-message">${H.escapeHtml(storeStatus.error || "Lecture impossible.")}</p></article>`;
      }
      if (storeStatus.status !== "pending") {
        storeStatus = { status: "pending", error: "" };
        loadAccounts();
      }
      return `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Lecture des comptes chiffrés...</div>`;
    }
    if (H.demoMode) seedDemo();
    if (tableView === "pay") return payTable();
    const list = rows();
    const page = H.paginateList("bank", list);
    const editing = editingId ? visibleProfiles().find((profile) => profile.id === editingId) : null;
    const counts = visibleProfiles().reduce((acc, profile) => {
      acc[analyze(recordOf(profile.id)).status] += 1;
      return acc;
    }, { ready: 0, missing: 0, invalid: 0 });
    return `
      ${editing ? (detail.status === "pending" ? `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Déchiffrement du RIB...</div>` : editForm(editing)) : ""}
      <article class="card table-card">
        ${H.cardHeading("Informations bancaires")}
        <div class="page-spacer">${tableSwitch()}</div>
        ${H.demoMode ? `<p class="data-note">Lien de démo : ${H.escapeHtml(window.location.origin + H.ibiPagePath())}</p>` : ""}
        <section class="team-punches-summary page-spacer">
          <article class="hours-card team-punch-summary-card"><span>IBAN calculé</span><strong>${counts.ready}</strong></article>
          <article class="hours-card team-punch-summary-card"><span>À renseigner</span><strong>${counts.missing}</strong></article>
          <article class="hours-card team-punch-summary-card"><span>Clé invalide</span><strong>${counts.invalid}</strong></article>
        </section>
        <details class="collapse-panel" ${H.isFilterPanelOpen("bank") ? "open" : ""} data-filter-panel="bank">
          <summary>Filtres</summary>
          <form id="bank-filter" class="feature-form collapse-panel-form">
            <div class="form-row">
              <label>Recherche
                <input name="query" type="search" placeholder="Nom, matricule, service" value="${H.escapeHtml(filters.query)}">
              </label>
              <label>Statut
                <select name="status">
                  <option value="all"${filters.status === "all" ? " selected" : ""}>Tous</option>
                  <option value="ready"${filters.status === "ready" ? " selected" : ""}>IBAN calculé</option>
                  <option value="missing"${filters.status === "missing" ? " selected" : ""}>À renseigner</option>
                  <option value="invalid"${filters.status === "invalid" ? " selected" : ""}>Clé invalide</option>
                </select>
              </label>
            </div>
            <div class="team-punches-actions">
              <button type="submit" class="primary">Filtrer</button>
              <button type="button" class="outline-button" id="bank-filter-reset">Réinitialiser</button>
            </div>
          </form>
        </details>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Matricule</th>
                <th>Collaborateur</th>
                <th>Service</th>
                <th>RIB</th>
                <th>IBAN</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${page.items.length ? page.items.map((row) => `
                <tr>
                  <td>${H.escapeHtml(row.profile.matricule || "—")}</td>
                  <td>${H.escapeHtml(row.profile.full_name || "—")}</td>
                  <td>${H.escapeHtml(row.profile.department || "—")}</td>
                  <td>${maskAccount(row.analysis.rib)}</td>
                  <td>${maskAccount(row.analysis.iban)}</td>
                  <td>${H.badge(row.analysis.label)}</td>
                  <td><button type="button" class="outline-button" data-bank-edit="${H.escapeHtml(row.profile.id)}">Modifier</button></td>
                </tr>`).join("") : `<tr><td colspan="7" class="empty-cell">Aucun compte ne correspond à la recherche.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${H.renderTablePager(page)}
      </article>`;
  }

  function readForm(form) {
    return {
      holder: String(new FormData(form).get("holder") || "").trim().slice(0, 80),
      bank: digits(new FormData(form).get("bank"), 3),
      city: digits(new FormData(form).get("city"), 3),
      account: digits(new FormData(form).get("account"), 16),
      key: digits(new FormData(form).get("key"), 2)
    };
  }

  function showEditError(message) {
    const node = document.querySelector("#bank-edit-error");
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
  }

  function refreshPreview(form) {
    const preview = document.querySelector("#bank-preview");
    if (!form || !preview) return;
    const draft = readForm(form);
    const analysis = analyze(draft);
    if (analysis.status === "ready") {
      preview.textContent = `IBAN calculé : ${analysis.iban}`;
      showEditError("");
      return;
    }
    preview.textContent = analysis.status === "invalid"
      ? "La clé RIB ne correspond pas aux 22 premiers chiffres."
      : "Saisissez les 24 chiffres du RIB marocain. L'IBAN apparaît quand la clé est bonne.";
  }

  if (!window.__humanaBankBound) {
    window.__humanaBankBound = true;
    document.addEventListener("submit", (event) => {
      if (event.target?.id === "pay-filter") {
        event.preventDefault();
        filters.query = String(new FormData(event.target).get("query") || "");
        H.resetTablePage("pay");
        H.renderApp();
      }
      if (event.target?.id === "bank-filter") {
        event.preventDefault();
        const data = new FormData(event.target);
        filters.query = String(data.get("query") || "");
        filters.status = String(data.get("status") || "all");
        H.resetTablePage("bank");
        H.renderApp();
      }
      if (event.target?.id === "bank-edit-form") {
        event.preventDefault();
        const profileId = event.target.dataset.profileId;
        const draft = readForm(event.target);
        const analysis = analyze(draft);
        if (analysis.status !== "ready") {
          showEditError(analysis.label === "RIB incomplet"
            ? "Le RIB doit contenir 3 + 3 + 16 + 2 chiffres."
            : "La clé RIB est incorrecte. Vérifiez le relevé avant d'enregistrer.");
          refreshPreview(event.target);
          return;
        }
        if (H.demoMode) {
          records[profileId] = draft;
          editingId = "";
          H.renderApp();
          return;
        }
        saveAccount(profileId, draft, analysis.rib.slice(-4));
      }
    });
    document.addEventListener("click", (event) => {
      if (event.target?.id === "canva-export") {
        exportCanvaExcel();
        return;
      }
      const tab = event.target.closest?.("[data-canva-table]");
      if (tab) {
        tableView = tab.dataset.canvaTable === "pay" ? "pay" : "ibi";
        if (tableView !== "ibi") editingId = "";
        H.renderApp();
        return;
      }
      const edit = event.target.closest?.("[data-bank-edit]");
      if (edit) {
        openEdit(edit.dataset.bankEdit);
        return;
      }
      if (event.target?.id === "bank-cancel") {
        if (!H.demoMode && editingId && records[editingId]?.bank) {
          records[editingId] = { last4: ribDigits(records[editingId]).slice(-4) };
        }
        editingId = "";
        H.renderApp();
        return;
      }
      if (event.target?.id === "pay-filter-reset") {
        filters.query = "";
        H.resetTablePage("pay");
        H.renderApp();
        return;
      }
      if (event.target?.id === "bank-filter-reset") {
        filters.query = "";
        filters.status = "all";
        H.resetTablePage("bank");
        H.renderApp();
      }
    });
    document.addEventListener("input", (event) => {
      if (event.target?.closest?.("#bank-edit-form")) refreshPreview(event.target.form);
    });
  }

  async function apiJson(path, options) {
    const method = options?.method || "GET";
    const headers = { Accept: "application/json" };
    if (method !== "GET") {
      const csrf = await fetch("/api/auth/csrf", { credentials: "include", headers: { Accept: "application/json" } });
      const token = await csrf.json();
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = token.csrfToken || "";
    }
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: options?.body
    });
    const json = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, json };
  }

  async function loadAccounts() {
    try {
      const result = await apiJson("/api/ibi/accounts");
      if (!result.ok) {
        storeStatus = { status: "error", error: result.json?.error?.message || "Lecture impossible." };
      } else {
        const next = Object.create(null);
        (result.json.data || []).forEach((row) => {
          next[row.profile_id] = { last4: String(row.last4 || "") };
        });
        records = next;
        storeStatus = { status: "ready", error: "" };
      }
    } catch (_) {
      storeStatus = { status: "error", error: "Lecture impossible." };
    }
    H.renderApp();
  }

  function openEdit(profileId) {
    editingId = profileId;
    const known = recordOf(profileId);
    if (H.demoMode || known?.bank) {
      detail = { id: profileId, status: "ready", error: "" };
      H.renderApp();
      return;
    }
    detail = { id: profileId, status: "pending", error: "" };
    H.renderApp();
    apiJson(`/api/ibi/accounts/${encodeURIComponent(profileId)}`).then((result) => {
      if (result.status === 404) {
        records[profileId] = { bank: "", city: "", account: "", key: "" };
        detail = { id: profileId, status: "ready", error: "" };
      } else if (!result.ok) {
        detail = { id: profileId, status: "ready", error: result.json?.error?.message || "Lecture impossible." };
      } else {
        records[profileId] = result.json.data || {};
        detail = { id: profileId, status: "ready", error: "" };
      }
      H.renderApp();
    }).catch(() => {
      detail = { id: profileId, status: "ready", error: "Lecture impossible." };
      H.renderApp();
    });
  }

  function saveAccount(profileId, draft, last4) {
    apiJson(`/api/ibi/accounts/${encodeURIComponent(profileId)}`, {
      method: "PUT",
      body: JSON.stringify(draft)
    }).then((result) => {
      if (!result.ok) {
        showEditError(result.json?.error?.message || "Enregistrement impossible.");
        return;
      }
      records[profileId] = { last4: result.json?.data?.last4 || last4 };
      editingId = "";
      H.renderApp();
    }).catch(() => {
      showEditError("Enregistrement impossible.");
    });
  }

  H.pages.bank = bankPage;
})(window.Humana);
