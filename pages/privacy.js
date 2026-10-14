(function () {
  "use strict";

  function ownId() {
    return session?.user?.id || appData.profile?.id || "";
  }

  function ownRows(rows) {
    const id = ownId();
    const list = Array.isArray(rows) ? rows : [];
    if (!id) return list;
    return list.filter((row) => String(row.user_id || row.userId || "") === String(id));
  }

  function dash(value) {
    const text = String(value == null ? "" : value).trim();
    return text ? escapeHtml(text) : "—";
  }

  function privacyPack() {
    const profile = appData.profile || {};
    const punches = usesDatabase() ? (appData.punches || []) : getPunches();
    const leave = usesDatabase() ? ownRows(appData.leaveRequests) : getLeaveRequests();
    const attestations = ownRows(appData.attestationRequests);
    const advances = ownRows(appData.salaryAdvanceRequests);
    const payslips = appData.payslips || [];
    const documents = ownRows(appData.hrDocuments).map((doc) => ({
      id: doc.id,
      title: doc.title || doc.name,
      published_at: doc.published_at,
      created_at: doc.created_at
    }));
    return {
      exported_at: new Date().toISOString(),
      product: "Daylyx",
      profile: {
        id: profile.id,
        email: profile.email || session?.user?.email,
        full_name: profile.full_name,
        role: profile.role,
        job_title: profile.job_title,
        department: profile.department,
        matricule: profile.matricule,
        phone: profile.phone,
        hired_at: profile.hired_at,
        manager_id: profile.manager_id,
        leave_balance_cp: profile.leave_balance_cp,
        leave_balance_rtt: profile.leave_balance_rtt,
        leave_balance_recup: profile.leave_balance_recup
      },
      time_punches: punches,
      leave_requests: leave,
      attestation_requests: attestations,
      salary_advance_requests: advances,
      payslips: payslips,
      hr_documents: documents
    };
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportPrivacyJson() {
    const pack = privacyPack();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`daylyx-mes-donnees_${stamp}.json`, pack);
  }

  function exportPrivacyCsv() {
    const punches = privacyPack().time_punches || [];
    if (!punches.length) {
      alert("Aucun pointage à exporter pour le moment.");
      return;
    }
    downloadCsv(
      `daylyx-pointages_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Date", "Type", "Lieu", "Latitude", "Longitude", "IP", "Source"],
      punches.map((punch) => [
        punch.punched_at || punch.time || "",
        punch.punch_type || punch.type || "",
        punch.work_location || punch.location || punch.workLocation || "",
        punch.lat || punch.latitude || "",
        punch.lng || punch.longitude || "",
        punch.ip_address || "",
        punch.source || ""
      ])
    );
  }

  function dpoContactMarkup() {
    const cfg = window.HUMANA_CONFIG || {};
    const name = String(cfg.LEGAL_DPO_NAME || "").trim();
    const email = String(cfg.LEGAL_DPO_EMAIL || "").trim();
    const bits = [];
    if (name) bits.push(escapeHtml(name));
    if (email && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
      bits.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
    }
    if (bits.length) return bits.join(" — ");
    return "l’administration RH";
  }

  function privacyPage() {
    const profile = appData.profile || {};
    const pack = privacyPack();
    const name = profile.full_name || session?.user?.email || "Collaborateur";

    return `
      <div class="privacy-grid">
        <article class="card">
          ${cardHeading("Mon dossier")}
          <dl class="privacy-dl">
            <dt>Nom</dt><dd>${dash(name)}</dd>
            <dt>E-mail</dt><dd>${dash(profile.email || session?.user?.email)}</dd>
            <dt>Matricule</dt><dd>${dash(profile.matricule)}</dd>
            <dt>Poste</dt><dd>${dash(profile.job_title)}</dd>
            <dt>Service</dt><dd>${dash(profile.department)}</dd>
            <dt>Téléphone</dt><dd>${dash(profile.phone)}</dd>
            <dt>Rôle</dt><dd>${dash(roleLabels[profile.role] || profile.role)}</dd>
          </dl>
        </article>
        <article class="card">
          ${cardHeading("Données enregistrées")}
          <dl class="privacy-dl">
            <dt>Pointages</dt><dd>${pack.time_punches.length}</dd>
            <dt>Congés</dt><dd>${pack.leave_requests.length}</dd>
            <dt>Demandes RH</dt><dd>${pack.attestation_requests.length + pack.salary_advance_requests.length}</dd>
            <dt>Bulletins</dt><dd>${pack.payslips.length}</dd>
            <dt>Documents</dt><dd>${pack.hr_documents.length}</dd>
          </dl>
          <div class="privacy-actions">
            <button type="button" class="primary" id="privacy-export-json">Exporter mon dossier (JSON)</button>
            <button type="button" class="outline-button" id="privacy-export-csv">Exporter mes pointages (CSV)</button>
          </div>
        </article>
        <article class="card">
          ${cardHeading("Vos droits")}
          <p>Vous pouvez consulter et récupérer les informations ci-dessus. Pour une correction ou une suppression, contactez ${dpoContactMarkup()} : certaines données (pointages, éléments de paie) sont conservées 5 ans (paie) ou 1 an (détail quotidien des horaires).</p>
          <ul class="privacy-legal-links">
            <li><a href="/confidentialite">Confidentialité</a></li>
            <li><a href="/mentions-legales">Mentions légales</a></li>
            <li><a href="/cookies">Cookies</a></li>
          </ul>
        </article>
      </div>`;
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("#privacy-export-json")) {
      event.preventDefault();
      exportPrivacyJson();
    } else if (event.target.closest("#privacy-export-csv")) {
      event.preventDefault();
      exportPrivacyCsv();
    }
  });

  (window.Humana = window.Humana || {});
  (window.Humana.pages = window.Humana.pages || {});
  window.Humana.pages.privacy = privacyPage;
})();
