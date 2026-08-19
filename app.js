(function () {
  if (window.__humanaAppLoaded) return;
  window.__humanaAppLoaded = true;

let supabaseClient = null;
let app = null;
let session = null;
let demoMode = false;
let portalMode = false;
let currentPage = "pointeuse";
let appData = {
  loading: false,
  error: "",
  profile: null,
  punches: [],
  leaveRequests: [],
  attestationRequests: [],
  orgProfiles: [],
  pendingInvites: [],
  adminEditingId: "",
  adminEditingInviteId: ""
};

const roleLabels = {
  admin: "Administrateur",
  manager: "Manager",
  employee: "Collaborateur"
};

const pages = {
  pointeuse: ["Pointeuse", "Enregistrez vos arrivees et departs du jour."],
  leave: ["Demandes de conges", "Deposez et suivez vos demandes d'absence."],
  attestations: ["Demandes d'attestations", "Demandez vos documents RH en quelques clics."],
  hierarchy: ["Hierarchie", "Visualisez l'organigramme et votre ligne hierarchique."],
  admin: ["Administration", "Gerez les utilisateurs, les roles et la hierarchie."]
};

const navigation = [
  ["pointeuse", "P", "Pointeuse"],
  ["leave", "C", "Conges"],
  ["attestations", "A", "Attestations"],
  ["hierarchy", "H", "Hierarchie"]
];

const leaveTypes = ["Conges payes", "RTT", "Conge maladie", "Conge sans solde"];
const attestationTypes = [
  "Attestation employeur",
  "Certificat de travail",
  "Attestation de salaire",
  "Attestation de conges"
];

const avatarColors = ["violet", "blue", "orange", "green", "pink"];

function avatar(initials, color = "violet") {
  return `<span class="avatar ${color}">${initials}</span>`;
}

function profileInitials(name) {
  return (name || "CO").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function avatarForProfile(profile, index = 0) {
  return avatar(profileInitials(profile.full_name), avatarColors[index % avatarColors.length]);
}

function badge(value) {
  const normalized = (value || "").toLowerCase();
  const tone = normalized.includes("approuv") || normalized.includes("pret") || normalized.includes("termine")
    ? "success"
    : normalized.includes("valid") || normalized.includes("cours") || normalized.includes("attente")
      ? "warning"
      : "neutral";
  return `<span class="badge ${tone}">${value}</span>`;
}

const cardHeading = (title, action = "") =>
  action
    ? `<div class="card-heading"><h3>${title}</h3><button type="button">${action}</button></div>`
    : `<div class="card-heading"><h3>${title}</h3></div>`;

function usesDatabase() {
  return Boolean(supabaseClient && session?.user?.id && !demoMode);
}

function isAdmin() {
  return appData.profile?.role === "admin";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getNavigationItems() {
  const items = [...navigation];
  if (isAdmin()) items.push(["admin", "!", "Administration"]);
  return items;
}

function managerName(managerId) {
  if (!managerId) return "—";
  const manager = appData.orgProfiles.find((profile) => profile.id === managerId);
  return manager?.full_name || "—";
}

function managerOptions(selectedId = "", excludeId = "") {
  const options = [`<option value="">Aucun manager</option>`];
  appData.orgProfiles
    .filter((profile) => profile.id !== excludeId)
    .forEach((profile) => {
      const selected = profile.id === selectedId ? " selected" : "";
      options.push(`<option value="${profile.id}"${selected}>${escapeHtml(profile.full_name)}</option>`);
    });
  return options.join("");
}

function roleOptions(selectedRole = "employee") {
  return ["employee", "manager", "admin"].map((role) => {
    const selected = role === selectedRole ? " selected" : "";
    return `<option value="${role}"${selected}>${roleLabels[role]}</option>`;
  }).join("");
}

function storagePrefix() {
  return `humana_${session?.user?.email || "demo"}_`;
}

function loadStore(key, fallback) {
  try {
    const raw = localStorage.getItem(storagePrefix() + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStore(key, value) {
  localStorage.setItem(storagePrefix() + key, JSON.stringify(value));
}

function getUserName() {
  const metadata = session?.user?.user_metadata || {};
  return appData.profile?.full_name || metadata.full_name || metadata.name || session?.user?.email?.split("@")[0] || "Collaborateur";
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getPunches() {
  if (usesDatabase()) {
    return appData.punches.map((punch) => ({
      type: punch.punch_type,
      time: punch.punched_at
    }));
  }
  return loadStore("punches", []);
}

function getLeaveRequests() {
  if (usesDatabase()) {
    return appData.leaveRequests.map((request) => ({
      id: request.id,
      type: request.leave_type,
      start: request.start_date,
      end: request.end_date,
      days: request.days,
      comment: request.comment,
      status: request.status,
      created: request.created_at
    }));
  }
  return loadStore("leaveRequests", []);
}

function getAttestationRequests() {
  if (usesDatabase()) {
    return appData.attestationRequests.map((request) => ({
      id: request.id,
      type: request.document_type,
      reason: request.reason,
      status: request.status,
      created: request.created_at
    }));
  }
  return loadStore("attestationRequests", []);
}

function countPendingLeave() {
  return getLeaveRequests().filter((item) => item.status === "A valider").length;
}

function countPendingAttestations() {
  return getAttestationRequests().filter((item) => item.status === "En attente").length;
}

function navBadge(page) {
  if (page === "leave" && countPendingLeave()) return `<i>${countPendingLeave()}</i>`;
  if (page === "attestations" && countPendingAttestations()) return `<i>${countPendingAttestations()}</i>`;
  return "";
}

function getClockState() {
  const punches = getPunches();
  const last = punches[punches.length - 1];
  return { punches, isIn: last?.type === "in" };
}

function pointeusePage() {
  const { punches, isIn } = getClockState();
  const today = new Date().toDateString();
  const todayPunches = punches.filter((p) => new Date(p.time).toDateString() === today);
  const dbNote = usesDatabase()
    ? `<p class="data-note">Donnees enregistrees dans Supabase.</p>`
    : `<p class="data-note demo">Mode demo : donnees locales uniquement. Connectez-vous avec Microsoft pour sauvegarder.</p>`;

  return `
    ${dbNote}
    <section class="clock-grid">
      <article class="card clock-card">
        <p class="clock-label">Statut actuel</p>
        <div class="clock-status ${isIn ? "in" : "out"}">
          <strong>${isIn ? "En poste" : "Hors poste"}</strong>
          <span>${isIn ? "Vous etes pointe en entree." : "Pointez votre arrivee pour commencer."}</span>
        </div>
        <button type="button" id="clock-toggle" class="clock-button ${isIn ? "out" : "in"}">
          ${isIn ? "Pointer la sortie" : "Pointer l'arrivee"}
        </button>
        <p class="clock-hint">${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </article>
      <article class="card">
        ${cardHeading("Pointages du jour")}
        <div class="punch-list">
          ${todayPunches.length
            ? todayPunches.map((punch) => `
              <div class="punch-item">
                <span class="punch-type ${punch.type}">${punch.type === "in" ? "Entree" : "Sortie"}</span>
                <strong>${formatTime(punch.time)}</strong>
              </div>`).join("")
            : `<p class="empty-state">Aucun pointage aujourd'hui.</p>`}
        </div>
      </article>
    </section>
    <article class="card table-card page-spacer">
      ${cardHeading("Historique recent")}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Heure</th></tr></thead>
          <tbody>
            ${punches.length
              ? [...punches].reverse().slice(0, 10).map((punch) => `
                <tr>
                  <td>${formatDate(punch.time)}</td>
                  <td>${punch.type === "in" ? "Entree" : "Sortie"}</td>
                  <td>${formatTime(punch.time)}</td>
                </tr>`).join("")
              : `<tr><td colspan="3" class="empty-cell">Aucun historique pour le moment.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>`;
}

function leavePage() {
  const requests = getLeaveRequests();

  return `
    <div class="feature-grid">
      <article class="card form-card">
        ${cardHeading("Nouvelle demande")}
        <form id="leave-form" class="feature-form">
          <label>
            Type de conge
            <select name="type" required>
              ${leaveTypes.map((type) => `<option value="${type}">${type}</option>`).join("")}
            </select>
          </label>
          <div class="form-row">
            <label>
              Date de debut
              <input type="date" name="start" required>
            </label>
            <label>
              Date de fin
              <input type="date" name="end" required>
            </label>
          </div>
          <label>
            Commentaire (optionnel)
            <textarea name="comment" rows="3" placeholder="Precisez le contexte si besoin..."></textarea>
          </label>
          <button type="submit" class="primary">Envoyer la demande</button>
        </form>
      </article>
      <article class="card table-card">
        <div class="toolbar"><h3>Mes demandes</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Periode</th><th>Duree</th><th>Statut</th></tr></thead>
            <tbody>${leaveRows(requests)}</tbody>
          </table>
        </div>
      </article>
    </div>`;
}

function leaveRows(requests) {
  if (!requests.length) {
    return `<tr><td colspan="4" class="empty-cell">Aucune demande de conge pour le moment.</td></tr>`;
  }
  return requests.map((request) => `
    <tr>
      <td>${request.type}</td>
      <td>${formatDate(request.start)} - ${formatDate(request.end)}</td>
      <td>${request.days} jour${request.days > 1 ? "s" : ""}</td>
      <td>${badge(request.status)}</td>
    </tr>`).join("");
}

function attestationsPage() {
  const requests = getAttestationRequests();

  return `
    <div class="feature-grid">
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
            Motif / precision
            <textarea name="reason" rows="4" placeholder="Ex. dossier de location, banque, administration..." required></textarea>
          </label>
          <button type="submit" class="primary">Envoyer la demande</button>
        </form>
      </article>
      <article class="card table-card">
        <div class="toolbar"><h3>Mes attestations</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Document</th><th>Date</th><th>Statut</th></tr></thead>
            <tbody>${attestationRows(requests)}</tbody>
          </table>
        </div>
      </article>
    </div>`;
}

function attestationRows(requests) {
  if (!requests.length) {
    return `<tr><td colspan="3" class="empty-cell">Aucune demande d'attestation pour le moment.</td></tr>`;
  }
  return requests.map((request) => `
    <tr>
      <td><strong>${request.type}</strong><br><small>${request.reason}</small></td>
      <td>${formatDate(request.created)}</td>
      <td>${badge(request.status)}</td>
    </tr>`).join("");
}

function buildOrgTree(profiles) {
  const nodes = new Map(profiles.map((profile, index) => [
    profile.id,
    { ...profile, children: [], index }
  ]));
  const roots = [];

  nodes.forEach((node) => {
    if (node.manager_id && nodes.has(node.manager_id) && node.manager_id !== node.id) {
      nodes.get(node.manager_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (list) => {
    list.sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));
    list.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function getManagerChain(profiles, userId) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const chain = [];
  let current = byId.get(userId);
  const guard = new Set();

  while (current && !guard.has(current.id)) {
    chain.unshift(current);
    guard.add(current.id);
    current = current.manager_id ? byId.get(current.manager_id) : null;
  }
  return chain;
}

function renderOrgNode(node) {
  const isMe = node.id === session?.user?.id;
  return `
    <div class="org-branch">
      <div class="org-card ${isMe ? "is-me" : ""}">
        ${avatarForProfile(node, node.index)}
        <div>
          <strong>${node.full_name || "Sans nom"}</strong>
          <span>${node.job_title || "Collaborateur"}</span>
          <small>${node.department || ""}${node.role === "admin" ? " · Admin" : node.role === "manager" ? " · Manager" : ""}</small>
        </div>
      </div>
      ${node.children.length
        ? `<div class="org-children">${node.children.map((child) => renderOrgNode(child)).join("")}</div>`
        : ""}
    </div>`;
}

function hierarchyPage() {
  if (!usesDatabase()) {
    return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour afficher l'organigramme de l'entreprise.</p></article>`;
  }

  const profiles = appData.orgProfiles;
  const chain = getManagerChain(profiles, session.user.id);
  const tree = buildOrgTree(profiles);
  const manager = chain.length > 1 ? chain[chain.length - 2] : null;
  const directReports = profiles.filter((profile) => profile.manager_id === session.user.id);

  return `
    <section class="hierarchy-grid">
      <article class="card">
        ${cardHeading("Ma ligne hierarchique")}
        <div class="chain-list">
          ${chain.map((profile, index) => `
            <div class="chain-item ${profile.id === session.user.id ? "is-me" : ""}">
              ${avatarForProfile(profile, index)}
              <div>
                <strong>${profile.full_name}</strong>
                <span>${profile.job_title || "Collaborateur"}</span>
              </div>
            </div>`).join("")}
        </div>
        ${manager
          ? `<p class="hierarchy-meta">Votre manager : <strong>${manager.full_name}</strong></p>`
          : `<p class="hierarchy-meta">Vous n'avez pas de manager assigne.</p>`}
      </article>
      <article class="card">
        ${cardHeading("Mon equipe directe")}
        <div class="team-list">
          ${directReports.length
            ? directReports.map((profile, index) => `
              <div class="team-item">
                ${avatarForProfile(profile, index)}
                <div>
                  <strong>${profile.full_name}</strong>
                  <span>${profile.job_title || "Collaborateur"}</span>
                </div>
              </div>`).join("")
            : `<p class="empty-state">Aucun collaborateur rattache pour le moment.</p>`}
        </div>
      </article>
    </section>
    <article class="card page-spacer">
      ${cardHeading("Organigramme")}
      <div class="org-tree">
        ${tree.length
          ? tree.map((node) => renderOrgNode(node)).join("")
          : `<p class="empty-state">Aucun profil dans l'organigramme.</p>`}
      </div>
      <p class="hierarchy-meta">${isAdmin() ? "Les administrateurs peuvent modifier la hierarchie dans Administration." : "Contactez un administrateur pour modifier la hierarchie."}</p>
    </article>`;
}

function adminPage() {
  if (!isAdmin()) {
    return `<article class="card"><p class="empty-state">Acces reserve aux administrateurs.</p></article>`;
  }

  const editingId = appData.adminEditingId || "";
  const editingInviteId = appData.adminEditingInviteId || "";
  const editingProfile = appData.orgProfiles.find((profile) => profile.id === editingId);
  const editingInvite = appData.pendingInvites.find((invite) => invite.id === editingInviteId);
  const editing = editingProfile || editingInvite;
  const isInvite = Boolean(editingInvite && !editingProfile);

  return `
    <div class="feature-grid">
      <article class="card form-card">
        ${cardHeading(isInvite ? "Invitation en attente" : editing ? "Modifier un utilisateur" : "Ajouter un utilisateur")}
        <form id="admin-user-form" class="feature-form">
          <input type="hidden" name="profile_id" value="${editingProfile?.id || ""}">
          <input type="hidden" name="invite_id" value="${editingInvite?.id || ""}">
          <label>
            Adresse e-mail
            <input type="email" name="email" required value="${escapeHtml(editing?.email || "")}" ${editingProfile ? "readonly" : ""}>
          </label>
          <label>
            Nom complet
            <input type="text" name="full_name" required value="${escapeHtml(editing?.full_name || "")}">
          </label>
          <div class="form-row">
            <label>
              Poste
              <input type="text" name="job_title" value="${escapeHtml(editing?.job_title || "Collaborateur")}">
            </label>
            <label>
              Equipe
              <input type="text" name="department" value="${escapeHtml(editing?.department || "General")}">
            </label>
          </div>
          <div class="form-row">
            <label>
              Role
              <select name="role" required>${roleOptions(editing?.role || "employee")}</select>
            </label>
            <label>
              Manager
              <select name="manager_id">${managerOptions(editing?.manager_id || "", editingProfile?.id || "")}</select>
            </label>
          </div>
          <div class="admin-form-actions">
            <button type="submit" class="primary">${editing ? "Enregistrer" : "Ajouter"}</button>
            ${editing ? `<button type="button" id="admin-cancel-edit" class="outline-button">Annuler</button>` : ""}
          </div>
        </form>
        <p class="hierarchy-meta">Si la personne n'a jamais connecte Humana, elle sera invitee par e-mail. A la premiere connexion Microsoft, son compte sera cree automatiquement.</p>
      </article>
      <article class="card table-card">
        <div class="toolbar"><h3>Utilisateurs actifs</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Email</th><th>Role</th><th>Manager</th><th></th></tr></thead>
            <tbody>
              ${appData.orgProfiles.length
                ? appData.orgProfiles.map((profile) => `
                  <tr>
                    <td><strong>${escapeHtml(profile.full_name)}</strong><br><small>${escapeHtml(profile.job_title || "")}</small></td>
                    <td>${escapeHtml(profile.email)}</td>
                    <td>${badge(roleLabels[profile.role] || profile.role)}</td>
                    <td>${escapeHtml(managerName(profile.manager_id))}</td>
                    <td><button type="button" class="outline-button admin-edit-profile" data-profile-id="${profile.id}">Gerer</button></td>
                  </tr>`).join("")
                : `<tr><td colspan="5" class="empty-cell">Aucun utilisateur actif.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
    </div>
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Invitations en attente</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Nom</th><th>Role</th><th>Manager</th><th></th></tr></thead>
          <tbody>
            ${appData.pendingInvites.length
              ? appData.pendingInvites.map((invite) => `
                <tr>
                  <td>${escapeHtml(invite.email)}</td>
                  <td>${escapeHtml(invite.full_name)}</td>
                  <td>${badge(roleLabels[invite.role] || invite.role)}</td>
                  <td>${escapeHtml(managerName(invite.manager_id))}</td>
                  <td class="admin-row-actions">
                    <button type="button" class="outline-button admin-edit-invite" data-invite-id="${invite.id}">Gerer</button>
                    <button type="button" class="outline-button admin-delete-invite" data-invite-id="${invite.id}">Supprimer</button>
                  </td>
                </tr>`).join("")
              : `<tr><td colspan="5" class="empty-cell">Aucune invitation en attente.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>`;
}

function pageContent() {
  if (appData.loading) {
    return `<div class="boot-message">Chargement des donnees...</div>`;
  }
  if (appData.error) {
    return `
      <article class="card">
        <p class="error-message">${appData.error}</p>
        <button type="button" id="retry-load" class="primary" style="margin-top:14px">Reessayer</button>
      </article>`;
  }
  return {
    pointeuse: pointeusePage,
    leave: leavePage,
    attestations: attestationsPage,
    hierarchy: hierarchyPage,
    admin: adminPage
  }[currentPage]();
}

function isJwtClockError(error) {
  const message = (error?.message || error?.details || String(error || "")).toLowerCase();
  return message.includes("jwt issued at future") || message.includes("issued at future");
}

function formatAppError(error) {
  if (isJwtClockError(error)) {
    return "Synchronisation de session en cours. Cliquez sur Reessayer ou attendez quelques secondes. Verifiez aussi que l'heure de votre ordinateur est correcte.";
  }
  return error?.message || "Impossible de charger les donnees Supabase.";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncSessionAfterLogin() {
  if (!supabaseClient) return;
  await wait(1200);
  const { error } = await supabaseClient.auth.refreshSession();
  if (error && !isJwtClockError(error)) throw error;
  if (error) await wait(2000);
}

async function withSupabaseRetry(action, attempts = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isJwtClockError(error) || attempt === attempts - 1) throw error;
      await supabaseClient.auth.refreshSession().catch(() => {});
      await wait(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function ensureProfile() {
  if (!usesDatabase()) return;

  const user = session.user;
  const metadata = user.user_metadata || {};
  const payload = {
    id: user.id,
    email: user.email || "",
    full_name: metadata.full_name || metadata.name || user.email?.split("@")[0] || "Collaborateur"
  };

  await withSupabaseRetry(async () => {
    const { data, error } = await supabaseClient
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;
    appData.profile = data;
    await supabaseClient.rpc("apply_pending_invite", {
      user_id: user.id,
      user_email: user.email || ""
    });
  });
}

async function refreshAppData() {
  if (!usesDatabase()) return;

  const userId = session.user.id;
  await withSupabaseRetry(async () => {
    const [punchesRes, leaveRes, attestationRes, profilesRes, profileRes] = await Promise.all([
      supabaseClient.from("time_punches").select("*").eq("user_id", userId).order("punched_at", { ascending: true }),
      supabaseClient.from("leave_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabaseClient.from("attestation_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabaseClient.from("profiles").select("id, full_name, email, job_title, department, manager_id, role").order("full_name"),
      supabaseClient.from("profiles").select("*").eq("id", userId).maybeSingle()
    ]);

    if (punchesRes.error) throw punchesRes.error;
    if (leaveRes.error) throw leaveRes.error;
    if (attestationRes.error) throw attestationRes.error;
    if (profilesRes.error) throw profilesRes.error;
    if (profileRes.error) throw profileRes.error;

    appData.punches = punchesRes.data || [];
    appData.leaveRequests = leaveRes.data || [];
    appData.attestationRequests = attestationRes.data || [];
    appData.orgProfiles = profilesRes.data || [];
    appData.profile = profileRes.data || appData.profile;
    appData.pendingInvites = [];

    if (appData.profile?.role === "admin") {
      const invitesRes = await supabaseClient
        .from("pending_invites")
        .select("*")
        .order("created_at", { ascending: false });
      if (invitesRes.error) throw invitesRes.error;
      appData.pendingInvites = invitesRes.data || [];
    }
  });
}

async function bootstrapUser() {
  if (!usesDatabase()) {
    renderApp();
    return;
  }

  appData.loading = true;
  appData.error = "";
  renderApp();

  try {
    await syncSessionAfterLogin();
    await ensureProfile();
    await refreshAppData();
  } catch (error) {
    appData.error = formatAppError(error);
  } finally {
    appData.loading = false;
    renderApp();
  }
}

function bindLoginEvents() {
  const demoBtn = document.querySelector("#demo-login");
  if (demoBtn && !demoBtn.dataset.humanaBound) {
    demoBtn.dataset.humanaBound = "1";
    demoBtn.addEventListener("click", () => {
      demoMode = true;
      renderApp();
    });
  }

  const microsoftBtn = document.querySelector("#microsoft-login");
  if (microsoftBtn && !microsoftBtn.dataset.humanaBound) {
    microsoftBtn.dataset.humanaBound = "1";
    microsoftBtn.addEventListener("click", () => {
      if (typeof window.humanaSignIn === "function") window.humanaSignIn();
      else signInWithMicrosoft();
    });
  }
}

function setLoginState({ ready = false, error } = {}) {
  const microsoftButton = document.querySelector("#microsoft-login");
  const configNote = document.querySelector("#config-note");
  const errorMessage = document.querySelector("#login-error");

  if (microsoftButton) microsoftButton.disabled = !ready;
  if (configNote) configNote.hidden = ready;
  if (errorMessage && error !== undefined) {
    errorMessage.hidden = !error;
    errorMessage.textContent = error;
  }
}

function renderLogin(error = "") {
  if (!document.querySelector(".login-page")) {
    app.innerHTML = `
      <main class="login-page">
        <section class="login-brand">
          <div class="brand brand-large"><span>H</span> Humana</div>
          <div class="login-message">
            <span class="eyebrow">L'espace RH qui rassemble</span>
            <h1>Votre equipe.<br><em>Simplement.</em></h1>
            <p>Connectez-vous avec votre compte professionnel pour acceder a votre espace RH.</p>
          </div>
        </section>
        <section class="login-panel">
          <div class="login-card">
            <h2>Bienvenue</h2>
            <button id="microsoft-login" type="button" class="microsoft-button" disabled>Continuer avec Microsoft</button>
            <div id="config-note" class="config-note">Connexion en cours de preparation...</div>
            <p id="login-error" class="error-message" hidden></p>
            <button id="demo-login" type="button" class="demo-button">Voir l'apercu de demonstration</button>
          </div>
        </section>
      </main>`;
  }

  bindLoginEvents();
  setLoginState({ ready: Boolean(supabaseClient), error });
}

async function signInWithMicrosoft() {
  if (!supabaseClient) supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    setLoginState({ ready: false, error: "Connexion Supabase indisponible. Rechargez la page." });
    return;
  }
  const button = document.querySelector("#microsoft-login");
  button.disabled = true;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: window.HUMANA_CONFIG?.REDIRECT_URL || "https://humana-rh.vercel.app",
      scopes: "openid email profile"
    }
  });
  if (error) renderLogin(error.message);
}

function renderApp() {
  const name = getUserName();
  const email = session?.user?.email || "collaborateur@entreprise.fr";
  const initials = profileInitials(name);

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span>H</span> Humana</div>
        <button class="close-menu" type="button" aria-label="Fermer">x</button>
        <nav><p>ESPACE RH</p>${getNavigationItems().map((item) => `
          <button type="button" data-page="${item[0]}" class="${currentPage === item[0] ? "active" : ""}">
            <span class="nav-icon">${item[1]}</span>${item[2]}${navBadge(item[0])}
          </button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <div class="user-card">${avatar(initials)}<div><strong>${name}</strong><span>${email}</span>${isAdmin() ? `<span class="admin-pill">Admin</span>` : ""}</div><button type="button" id="logout" aria-label="Se deconnecter"></button></div>
        </div>
      </aside>
      <button class="backdrop" type="button" aria-label="Fermer le menu"></button>
      <main class="main-content">
        <header class="topbar">
          <button class="menu-button" type="button" aria-label="Menu"></button>
          <div class="topbar-title">${pages[currentPage][0]}</div>
        </header>
        <div class="page">
          <div class="page-heading">
            <div>
              <h1>${pages[currentPage][0]}</h1>
              <p>${pages[currentPage][1]}</p>
            </div>
            ${demoMode ? `<span class="demo-pill">Mode demo</span>` : ""}
          </div>
          <div id="page-content">${pageContent()}</div>
        </div>
      </main>
    </div>`;

  bindAppEvents();
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.max(1, Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
}

async function withAction(handler) {
  try {
    appData.loading = true;
    renderApp();
    await handler();
    if (usesDatabase()) await refreshAppData();
  } catch (error) {
    alert(error.message || "Une erreur est survenue.");
  } finally {
    appData.loading = false;
    renderApp();
  }
}

function bindPageEvents() {
  document.querySelector("#clock-toggle")?.addEventListener("click", () => {
    withAction(async () => {
      const { isIn } = getClockState();
      if (usesDatabase()) {
        const { error } = await supabaseClient.from("time_punches").insert({
          user_id: session.user.id,
          punch_type: isIn ? "out" : "in",
          punched_at: new Date().toISOString()
        });
        if (error) throw error;
      } else {
        const punches = loadStore("punches", []);
        punches.push({ type: isIn ? "out" : "in", time: new Date().toISOString() });
        saveStore("punches", punches);
      }
      currentPage = "pointeuse";
    });
  });

  document.querySelector("#leave-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const start = data.get("start");
    const end = data.get("end");
    if (new Date(end) < new Date(start)) {
      alert("La date de fin doit etre apres la date de debut.");
      return;
    }

    withAction(async () => {
      const payload = {
        type: data.get("type"),
        start,
        end,
        days: daysBetween(start, end),
        comment: data.get("comment") || "",
        status: "A valider"
      };

      if (usesDatabase()) {
        const { error } = await supabaseClient.from("leave_requests").insert({
          user_id: session.user.id,
          leave_type: payload.type,
          start_date: payload.start,
          end_date: payload.end,
          days: payload.days,
          comment: payload.comment,
          status: payload.status
        });
        if (error) throw error;
      } else {
        const requests = loadStore("leaveRequests", []);
        requests.unshift({ id: Date.now(), ...payload, created: new Date().toISOString() });
        saveStore("leaveRequests", requests);
      }

      form.reset();
      currentPage = "leave";
    });
  });

  document.querySelector("#attestation-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    withAction(async () => {
      const payload = {
        type: data.get("type"),
        reason: data.get("reason"),
        status: "En attente"
      };

      if (usesDatabase()) {
        const { error } = await supabaseClient.from("attestation_requests").insert({
          user_id: session.user.id,
          document_type: payload.type,
          reason: payload.reason,
          status: payload.status
        });
        if (error) throw error;
      } else {
        const requests = loadStore("attestationRequests", []);
        requests.unshift({ id: Date.now(), ...payload, created: new Date().toISOString() });
        saveStore("attestationRequests", requests);
      }

      form.reset();
      currentPage = "attestations";
    });
  });

  document.querySelector("#admin-cancel-edit")?.addEventListener("click", () => {
    appData.adminEditingId = "";
    appData.adminEditingInviteId = "";
    renderApp();
  });

  document.querySelectorAll(".admin-edit-profile").forEach((button) => {
    button.addEventListener("click", () => {
      appData.adminEditingId = button.dataset.profileId;
      appData.adminEditingInviteId = "";
      renderApp();
    });
  });

  document.querySelectorAll(".admin-edit-invite").forEach((button) => {
    button.addEventListener("click", () => {
      appData.adminEditingInviteId = button.dataset.inviteId;
      appData.adminEditingId = "";
      renderApp();
    });
  });

  document.querySelectorAll(".admin-delete-invite").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("Supprimer cette invitation ?")) return;
      withAction(async () => {
        const { error } = await supabaseClient
          .from("pending_invites")
          .delete()
          .eq("id", button.dataset.inviteId);
        if (error) throw error;
        appData.adminEditingInviteId = "";
      });
    });
  });

  document.querySelector("#admin-user-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const profileId = String(data.get("profile_id") || "");
    const inviteId = String(data.get("invite_id") || "");
    const payload = {
      full_name: String(data.get("full_name") || "").trim(),
      job_title: String(data.get("job_title") || "Collaborateur").trim(),
      department: String(data.get("department") || "General").trim(),
      role: String(data.get("role") || "employee"),
      manager_id: String(data.get("manager_id") || "") || null
    };

    if (!email) {
      alert("L'adresse e-mail est obligatoire.");
      return;
    }

    withAction(async () => {
      if (profileId) {
        if (profileId === session.user.id && payload.role !== "admin" && appData.profile?.role === "admin") {
          const adminCount = appData.orgProfiles.filter((profile) => profile.role === "admin").length;
          if (adminCount <= 1) {
            throw new Error("Vous etes le dernier administrateur. Ajoutez un autre admin avant de modifier votre role.");
          }
        }
        const { error } = await supabaseClient.from("profiles").update(payload).eq("id", profileId);
        if (error) throw error;
      } else if (inviteId) {
        const { error } = await supabaseClient.from("pending_invites").update({
          email,
          ...payload,
          created_by: session.user.id
        }).eq("id", inviteId);
        if (error) throw error;
      } else {
        const existing = appData.orgProfiles.find((profile) => profile.email?.toLowerCase() === email);
        if (existing) {
          const { error } = await supabaseClient.from("profiles").update(payload).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabaseClient.from("pending_invites").upsert({
            email,
            ...payload,
            created_by: session.user.id
          }, { onConflict: "email" });
          if (error) throw error;
        }
      }

      appData.adminEditingId = "";
      appData.adminEditingInviteId = "";
      form.reset();
      currentPage = "admin";
    });
  });
}

function bindAppEvents() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      currentPage = button.dataset.page;
      renderApp();
    });
  });

  const sidebar = document.querySelector(".sidebar");
  const backdrop = document.querySelector(".backdrop");
  document.querySelector(".menu-button")?.addEventListener("click", () => sidebar.classList.add("open"));
  document.querySelector(".close-menu")?.addEventListener("click", () => sidebar.classList.remove("open"));
  backdrop?.addEventListener("click", () => sidebar.classList.remove("open"));

  document.querySelector("#logout")?.addEventListener("click", async () => {
    if (portalMode) {
      window.location.href = "/_services/auth/logout";
      return;
    }
    if (session && supabaseClient) await supabaseClient.auth.signOut();
    session = null;
    demoMode = false;
    currentPage = "pointeuse";
    appData = {
      loading: false,
      error: "",
      profile: null,
      punches: [],
      leaveRequests: [],
      attestationRequests: [],
      orgProfiles: [],
      pendingInvites: [],
      adminEditingId: "",
      adminEditingInviteId: ""
    };
    renderLogin();
  });

  document.querySelector("#retry-load")?.addEventListener("click", () => {
    bootstrapUser();
  });

  bindPageEvents();
}

function ensureAppContainer() {
  app = document.querySelector("#app");
  if (app) return;

  app = document.createElement("div");
  app.id = "app";
  app.setAttribute("aria-live", "polite");
  const host = document.querySelector("#mainContent, .page-copy, main") || document.body;
  host.appendChild(app);
}

function readPortalUser() {
  const liquidName = app.dataset.portalUser || "";
  const liquidEmail = app.dataset.portalEmail || "";
  const liquidId = app.dataset.portalId || "";
  const liquidWasRendered = liquidId && !liquidId.includes("{{");

  if (liquidWasRendered) {
    return { name: liquidName || "Utilisateur", email: liquidEmail };
  }

  const userElement = document.querySelector(
    ".navbar .user-name, .navbar .username, a[title*='Sign Out'], a[title*='Deconnexion']"
  );
  const visibleName = userElement?.textContent?.trim();
  if (visibleName) return { name: visibleName.replace(/^Signed in as\s*/i, ""), email: "" };

  const pageText = document.body.innerText || "";
  const match = pageText.match(/Signed in as\s+([^\n]+)/i);
  return match ? { name: match[1].trim(), email: "" } : null;
}

function getSupabaseSettings() {
  const { SUPABASE_URL = "", SUPABASE_ANON_KEY = "" } = window.HUMANA_CONFIG || {};
  return {
    url: SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""),
    key: SUPABASE_ANON_KEY
  };
}

function createSupabaseClient(url, key) {
  return window.supabase.createClient(url, key, {
    auth: {
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
      appendPkceFlowIdToRedirects: true
    }
  });
}

function getSupabaseClient() {
  if (window.__humanaSupabase) return window.__humanaSupabase;
  const { url, key } = getSupabaseSettings();
  if (!url || !key) return null;
  if (!window.supabase?.createClient) return null;
  window.__humanaSupabase = createSupabaseClient(url, key);
  return window.__humanaSupabase;
}

function isOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  return params.has("code") || window.location.hash.includes("access_token");
}

function clearAuthParamsFromUrl() {
  if (!isOAuthReturn()) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function initialize() {
  try {
    ensureAppContainer();
    bindLoginEvents();
    if (window.__authReady) await window.__authReady;
    supabaseClient = getSupabaseClient();
    setLoginState({ ready: Boolean(supabaseClient) });

    if (window.__pendingAuthSession) {
      await window.humanaRender(window.__pendingAuthSession);
      return;
    }

    const portalUser = readPortalUser();
    if (portalUser) {
      portalMode = true;
      session = {
        user: {
          email: portalUser.email,
          user_metadata: { full_name: portalUser.name }
        }
      };
      renderApp();
      return;
    }

    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange(async (event, nextSession) => {
      if (nextSession && event !== "SIGNED_OUT") {
        session = nextSession;
        demoMode = false;
        await bootstrapUser();
        clearAuthParamsFromUrl();
        return;
      }
      if (event === "SIGNED_OUT") renderLogin();
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session) {
      session = data.session;
      demoMode = false;
      await bootstrapUser();
      clearAuthParamsFromUrl();
    }
  } catch (error) {
    setLoginState({ ready: false, error: error.message || "Impossible de demarrer l'application." });
  }
}

window.humanaRender = async function (authSession) {
  session = authSession;
  demoMode = false;
  ensureAppContainer();
  await bootstrapUser();
  clearAuthParamsFromUrl();
};

window.humanaStartDemo = function () {
  demoMode = true;
  supabaseClient = getSupabaseClient();
  ensureAppContainer();
  renderApp();
};

if (window.__pendingAuthSession) {
  window.humanaRender(window.__pendingAuthSession);
}

initialize();
})();
