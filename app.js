(function () {
  if (window.__humanaAppLoaded) return;
  window.__humanaAppLoaded = true;

let supabaseClient = null;
let app = null;
let session = null;
let demoMode = false;
let portalMode = false;
let currentPage = "home";
let bootstrapInFlight = null;
let hierarchySearch = "";
const collapsedOrgNodes = new Set();

let appData = {
  loading: false,
  error: "",
  profile: null,
  punches: [],
  leaveRequests: [],
  attestationRequests: [],
  orgProfiles: [],
  pendingInvites: [],
  hrDocuments: [],
  payslips: [],
  adminEditingId: "",
  adminEditingInviteId: ""
};

const roleLabels = {
  admin: "Administrateur",
  manager: "Manager",
  employee: "Collaborateur"
};

const pages = {
  home: ["Accueil", "Tout ce dont vous avez besoin, au meme endroit."],
  pointeuse: ["Pointeuse", "Enregistrez vos arrivees et vos departs."],
  leave: ["Conges", "Consultez vos soldes et faites vos demandes."],
  attestations: ["Attestations", "Demandez vos documents en quelques clics."],
  hierarchy: ["Hierarchie", "Votre manager, votre equipe, l'organigramme."],
  admin: ["Administration", "Gestion des comptes et des acces."]
};

const THEME_KEY = "humana-theme";
const MS_WELCOME_FLAG = "humana_ms_welcome";

function markMicrosoftWelcomePending() {
  try {
    sessionStorage.setItem(MS_WELCOME_FLAG, "1");
  } catch (_) {
    /* ignore */
  }
}

function maybeShowMicrosoftWelcome() {
  if (demoMode || portalMode || !session?.user || appData.error) return;
  try {
    if (sessionStorage.getItem(MS_WELCOME_FLAG) !== "1") return;
    sessionStorage.removeItem(MS_WELCOME_FLAG);
  } catch (_) {
    return;
  }
  showMicrosoftWelcomePopup();
}

function showMicrosoftWelcomePopup() {
  if (document.querySelector(".welcome-overlay")) return;

  const firstName = escapeHtml(getUserName().split(" ")[0] || "vous");
  const overlay = document.createElement("div");
  overlay.className = "welcome-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "welcome-title");
  overlay.innerHTML = `
    <div class="welcome-scene" aria-hidden="false">
      <div class="welcome-orb welcome-orb-1"></div>
      <div class="welcome-orb welcome-orb-2"></div>
      <article class="welcome-card">
        <div class="welcome-card-face">
          <span class="welcome-logo" aria-hidden="true"></span>
          <p class="welcome-eyebrow">Connexion reussie</p>
          <h2 id="welcome-title">${dayGreeting()}, <b>${firstName}</b></h2>
          <p class="welcome-text">Bienvenue sur Humana. Votre espace RH est pret.</p>
          <button type="button" class="welcome-cta primary">Commencer</button>
        </div>
      </article>
    </div>`;

  const close = () => {
    if (overlay.classList.contains("is-closing")) return;
    overlay.classList.remove("is-visible");
    overlay.classList.add("is-closing");
    window.setTimeout(() => overlay.remove(), 520);
  };

  overlay.querySelector(".welcome-cta")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKeyDown);
    }
  };
  document.addEventListener("keydown", onKeyDown);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === "dark" ? "#0b1220" : "#022341";
}

function toggleTheme() {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
}

function themeToggleMarkup() {
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Changer le theme">
    <span class="theme-toggle-track"><span class="theme-toggle-thumb"></span></span>
    <span class="theme-toggle-label" aria-hidden="true"></span>
  </button>`;
}

function bindThemeToggle() {
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    if (btn.dataset.humanaBound) return;
    btn.dataset.humanaBound = "1";
    btn.addEventListener("click", toggleTheme);
  });
}

const navigation = [
  ["home", "Accueil"],
  ["pointeuse", "Pointeuse"],
  ["leave", "Conges"],
  ["attestations", "Attestations"],
  ["hierarchy", "Hierarchie"]
];

const HR_DOCUMENTS_BUCKET = "hr-documents";
const HR_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

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
  if (isAdmin()) items.push(["admin", "Administration"]);
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
  if (page === "leave" && countPendingLeave()) return `<span class="nav-badge">${countPendingLeave()}</span>`;
  if (page === "attestations" && countPendingAttestations()) return `<span class="nav-badge">${countPendingAttestations()}</span>`;
  return "";
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function computeWorkedHours(punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const now = Date.now();
  const sessions = [];

  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].type !== "in") continue;
    const next = sorted[index + 1];
    const end = next?.type === "out"
      ? new Date(next.time).getTime()
      : (index === sorted.length - 1 ? now : null);
    if (end) {
      sessions.push({
        start: new Date(sorted[index].time).getTime(),
        end
      });
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  const day = weekStart.getDay() || 7;
  weekStart.setDate(weekStart.getDate() - (day - 1));
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const sumFrom = (fromTime) => sessions
    .filter((session) => session.start >= fromTime.getTime())
    .reduce((total, session) => total + (session.end - session.start), 0);

  return {
    today: sumFrom(todayStart),
    week: sumFrom(weekStart),
    month: sumFrom(monthStart)
  };
}

function leaveTypeKey(type) {
  const normalized = (type || "").toLowerCase();
  if (normalized.includes("rtt")) return "rtt";
  if (normalized.includes("maladie")) return "maladie";
  if (normalized.includes("sans solde")) return null;
  if (normalized.includes("conge")) return "cp";
  return null;
}

function getLeaveBalances() {
  const requests = getLeaveRequests();
  const totals = usesDatabase()
    ? {
        cp: Number(appData.profile?.leave_balance_cp ?? 25),
        rtt: Number(appData.profile?.leave_balance_rtt ?? 8)
      }
    : loadStore("leaveBalances", { cp: 25, rtt: 8 });

  const used = { cp: 0, rtt: 0 };
  const pending = { cp: 0, rtt: 0 };

  requests.forEach((request) => {
    const key = leaveTypeKey(request.type);
    if (!key || key === "maladie") return;
    const bucket = request.status === "A valider" ? pending : used;
    if (request.status === "A valider" || request.status.toLowerCase().includes("approuv")) {
      bucket[key] += Number(request.days) || 0;
    }
  });

  return [
    {
      label: "Conges payes",
      total: totals.cp,
      used: used.cp,
      pending: pending.cp,
      remaining: Math.max(0, totals.cp - used.cp - pending.cp)
    },
    {
      label: "RTT",
      total: totals.rtt,
      used: used.rtt,
      pending: pending.rtt,
      remaining: Math.max(0, totals.rtt - used.rtt - pending.rtt)
    }
  ];
}

function balanceCard(balance) {
  const usedPercent = balance.total ? Math.min(100, Math.round((balance.used / balance.total) * 100)) : 0;
  return `
    <article class="balance-card">
      <div class="balance-head">
        <strong>${balance.label}</strong>
        <span>${balance.remaining} j restants</span>
      </div>
      <div class="balance-track"><i style="width:${usedPercent}%"></i></div>
      <div class="balance-meta">
        <span>Alloue : <b>${balance.total} j</b></span>
        <span>Utilise : <b>${balance.used} j</b></span>
        <span>En attente : <b>${balance.pending} j</b></span>
      </div>
    </article>`;
}

function hoursCard(label, value) {
  return `
    <article class="hours-card">
      <span class="hours-label">${label}</span>
      <strong>${formatDuration(value)}</strong>
    </article>`;
}

function getClockState() {
  const punches = getPunches();
  const last = punches[punches.length - 1];
  return { punches, isIn: last?.type === "in" };
}

function getTodayPunches(punches = getPunches()) {
  const today = new Date().toDateString();
  return punches.filter((punch) => new Date(punch.time).toDateString() === today);
}

function getClockStatusCopy() {
  const { isIn } = getClockState();
  const hasToday = getTodayPunches().length > 0;

  if (isIn) {
    return {
      title: "Vous êtes en poste",
      hint: "Bonne journée, vous êtes bien enregistré.",
      tone: "in",
      homeLine: "Vous êtes en poste"
    };
  }

  if (hasToday) {
    return {
      title: "Hors poste",
      hint: "Votre pointage du jour est enregistré.",
      tone: "done",
      homeLine: "Pointage enregistré aujourd'hui"
    };
  }

  return {
    title: "Pas encore pointé",
    hint: "Un clic pour signaler votre arrivée.",
    tone: "out",
    homeLine: "Vous n'avez pas encore pointé aujourd'hui"
  };
}

function renderClockStatus(clockStatus, extraClass = "") {
  return `
    <div class="clock-status ${extraClass} ${clockStatus.tone}" role="status" aria-live="polite">
      <span class="clock-status-dot" aria-hidden="true"></span>
      <div class="clock-status-body">
        <strong>${clockStatus.title}</strong>
        <span>${clockStatus.hint}</span>
      </div>
    </div>`;
}

function profileMatchesSearch(profile, query) {
  if (!query) return true;
  const normalize = (value) => String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const haystack = normalize(`${profile.full_name} ${profile.email} ${profile.job_title} ${profile.department} ${profile.role}`);
  return haystack.includes(normalize(query));
}

function filterOrgTree(nodes, query) {
  if (!query) return nodes;

  const visit = (node) => {
    const children = node.children.map(visit).filter(Boolean);
    if (profileMatchesSearch(node, query) || children.length) {
      return { ...node, children };
    }
    return null;
  };

  return nodes.map(visit).filter(Boolean);
}

function countOrgNodes(nodes) {
  return nodes.reduce((total, node) => total + 1 + countOrgNodes(node.children), 0);
}

function buildDemoPayslips() {
  const items = [];
  const now = new Date();
  for (let index = 1; index <= 6; index += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    items.push({
      id: `demo-${index}`,
      period_label: date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      period_year: date.getFullYear(),
      period_month: date.getMonth() + 1,
      file_url: "#",
      published_at: date.toISOString()
    });
  }
  return items;
}

const demoHrDocuments = [
  { id: "d1", title: "Reglement interieur", description: "Version 2026", category: "Politique", file_url: "#", published_at: "2026-01-15" },
  { id: "d2", title: "Charte du teletravail", description: "Politique hybride", category: "Politique", file_url: "#", published_at: "2026-02-01" },
  { id: "d3", title: "Guide des conges", description: "CP, RTT et absences", category: "Conges", file_url: "#", published_at: "2026-02-10" },
  { id: "d4", title: "Note service Q1", description: "Actualites RH", category: "Communication", file_url: "#", published_at: "2026-03-01" }
];

function getHrDocuments() {
  if (usesDatabase()) return appData.hrDocuments || [];
  return loadStore("hrDocuments", demoHrDocuments);
}

function resolveHrDocumentUrl(doc) {
  return doc?.file_url || "#";
}

function sanitizeFileName(name) {
  return String(name || "document")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || "document";
}

async function uploadHrDocumentFile(file) {
  const safeName = sanitizeFileName(file.name);
  const storagePath = `docs/${Date.now()}-${safeName}`;
  const { error } = await supabaseClient.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });
  if (error) throw error;
  const { data } = supabaseClient.storage.from(HR_DOCUMENTS_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, storagePath };
}

async function uploadPayslipFile(file, userId) {
  const safeName = sanitizeFileName(file.name);
  const storagePath = `payslips/${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabaseClient.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/pdf"
    });
  if (error) throw error;
  const { data } = supabaseClient.storage.from(HR_DOCUMENTS_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, storagePath };
}

function getPayslips() {
  if (usesDatabase()) return appData.payslips || [];
  return loadStore("payslips", buildDemoPayslips());
}

function homeBalanceSummary(balance) {
  const usedPercent = balance.total ? Math.min(100, Math.round(((balance.used + balance.pending) / balance.total) * 100)) : 0;
  return `
    <div class="home-balance-item">
      <div class="home-balance-head">
        <span>${balance.label}</span>
        <strong>${balance.remaining} j</strong>
      </div>
      <div class="balance-track"><i style="width:${usedPercent}%"></i></div>
      <small>${balance.used} j utilises · ${balance.pending} j en attente</small>
    </div>`;
}

function dayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon apres-midi";
  return "Bonsoir";
}

function homePage() {
  const firstName = escapeHtml(getUserName().split(" ")[0] || "vous");
  const { isIn } = getClockState();
  const clockStatus = getClockStatusCopy();
  const hours = computeWorkedHours(getPunches());
  const balances = getLeaveBalances();
  const documents = getHrDocuments().slice(0, 4);
  const payslips = getPayslips().slice(0, 6);
  const todayLabel = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });

  return `
    <section class="home-welcome">
      <h2 class="home-title">${dayGreeting()}, <b>${firstName}</b></h2>
      <p class="home-subtitle">Nous sommes ${todayLabel}. Voici votre espace du jour.</p>
    </section>

    <section class="home-grid page-spacer">
      <article class="card home-widget">
        <div class="card-heading">
          <h3>Ma journee</h3>
          <button type="button" class="home-link" data-goto-page="pointeuse">Historique</button>
        </div>
        <div class="home-clock">
          ${renderClockStatus(clockStatus, "home-clock-status")}
          <p class="home-hours-today">Temps aujourd'hui : <b>${formatDuration(hours.today)}</b></p>
          <button type="button" id="clock-toggle" class="clock-button ${isIn ? "out" : "in"}">
            ${isIn ? "Je pars" : "J'arrive"}
          </button>
        </div>
      </article>

      <article class="card home-widget">
        <div class="card-heading">
          <h3>Conges</h3>
          <button type="button" class="home-link" data-goto-page="leave">Faire une demande</button>
        </div>
        <div class="home-balance-list">
          ${balances.map((balance) => homeBalanceSummary(balance)).join("")}
        </div>
      </article>

      <article class="card home-widget">
        <div class="card-heading">
          <h3>Documents partages</h3>
        </div>
        <div class="home-doc-list">
          ${documents.length
            ? documents.map((doc) => `
              <a class="home-doc-item" href="${escapeHtml(resolveHrDocumentUrl(doc))}" target="_blank" rel="noopener noreferrer">
                <span class="file-mark" aria-hidden="true"></span>
                <div>
                  <strong>${escapeHtml(doc.title)}</strong>
                  <span>${escapeHtml(doc.description || doc.category || "Document")} · ${formatDate(doc.published_at)}</span>
                </div>
              </a>`).join("")
            : `<p class="empty-state">Rien de nouveau pour l'instant. Les RH publieront les documents ici.</p>`}
        </div>
      </article>

      <article class="card home-widget">
        <div class="card-heading">
          <h3>Bulletins de paie</h3>
        </div>
        <div class="home-payslip-list">
          ${payslips.length
            ? payslips.map((slip) => `
              <div class="home-payslip-item">
                <span class="payslip-month" aria-hidden="true">${escapeHtml((slip.period_label || "").slice(0, 3))}</span>
                <div>
                  <strong>${escapeHtml(slip.period_label)}</strong>
                  <span>Bulletin mensuel</span>
                </div>
                <a class="home-payslip-btn" href="${escapeHtml(slip.file_url || "#")}" target="_blank" rel="noopener noreferrer">Ouvrir</a>
              </div>`).join("")
            : `<p class="empty-state">Vos bulletins apparaitront ici des qu'ils seront disponibles.</p>`}
        </div>
      </article>
    </section>`;
}

function pointeusePage() {
  const { punches, isIn } = getClockState();
  const clockStatus = getClockStatusCopy();
  const hours = computeWorkedHours(punches);
  const todayPunches = getTodayPunches(punches);
  const dbNote = usesDatabase()
    ? ""
    : `<p class="data-note demo">Mode demo : donnees locales uniquement. Connectez-vous avec Microsoft pour sauvegarder.</p>`;

  return `
    ${dbNote}
    <section class="hours-grid">
      ${hoursCard("Aujourd'hui", hours.today)}
      ${hoursCard("Cette semaine", hours.week)}
      ${hoursCard("Ce mois", hours.month)}
    </section>
    <section class="clock-grid page-spacer">
      <article class="card clock-card">
        ${renderClockStatus(clockStatus)}
        <button type="button" id="clock-toggle" class="clock-button ${isIn ? "out" : "in"}">
          ${isIn ? "Je pars" : "J'arrive"}
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
  const balances = getLeaveBalances();

  return `
    <section class="balance-grid">
      ${balances.map((balance) => balanceCard(balance)).join("")}
    </section>
    <div class="feature-grid page-spacer">
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

function renderOrgNode(node, options = {}) {
  const { forceExpand = false, depth = 0 } = options;
  const isMe = node.id === session?.user?.id;
  const hasChildren = node.children.length > 0;
  const isCollapsed = !forceExpand && collapsedOrgNodes.has(node.id);
  const childOptions = { ...options, depth: depth + 1 };

  return `
    <div class="org-branch ${isCollapsed ? "is-collapsed" : ""}" data-org-id="${node.id}" data-depth="${depth}">
      <div class="org-node-row">
        ${hasChildren
          ? `<button type="button" class="org-toggle" data-org-toggle="${node.id}" aria-expanded="${!isCollapsed}" aria-label="Afficher ou masquer l'equipe de ${escapeHtml(node.full_name || "ce manager")}">
              <span class="org-toggle-icon" aria-hidden="true"></span>
            </button>`
          : `<span class="org-toggle-spacer" aria-hidden="true"></span>`}
        <div class="org-card ${isMe ? "is-me" : ""} ${hasChildren ? "has-team" : ""}">
          ${avatarForProfile(node, node.index)}
          <div>
            <strong>${escapeHtml(node.full_name || "Sans nom")}</strong>
            <span>${escapeHtml(node.job_title || "Collaborateur")}</span>
            <small>${escapeHtml(node.department || "")}${node.role === "admin" ? " · Admin" : node.role === "manager" ? " · Manager" : ""}</small>
          </div>
          ${hasChildren ? `<span class="org-team-count">${node.children.length}</span>` : ""}
        </div>
      </div>
      ${hasChildren
        ? `<div class="org-children">${node.children.map((child) => renderOrgNode(child, childOptions)).join("")}</div>`
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
              ${avatarForProfile(profile, index)}
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
        ${cardHeading("Mon equipe directe")}
        <div class="team-list">
          ${directReports.length
            ? directReports.map((profile, index) => `
              <div class="team-item">
                ${avatarForProfile(profile, index)}
                <div>
                  <strong>${escapeHtml(profile.full_name)}</strong>
                  <span>${escapeHtml(profile.job_title || "Collaborateur")}</span>
                </div>
              </div>`).join("")
            : `<p class="empty-inline">Aucun collaborateur rattache pour le moment.</p>`}
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
          : `<p class="empty-state">Aucun collaborateur ne correspond a votre recherche.</p>`}
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
          <div class="form-row">
            <label>
              Solde conges payes (jours)
              <input type="number" min="0" step="0.5" name="leave_balance_cp" value="${escapeHtml(editing?.leave_balance_cp ?? 25)}">
            </label>
            <label>
              Solde RTT (jours)
              <input type="number" min="0" step="0.5" name="leave_balance_rtt" value="${escapeHtml(editing?.leave_balance_rtt ?? 8)}">
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
    </article>
    <div class="feature-grid page-spacer">
      <article class="card form-card">
        ${cardHeading("Publier un document RH")}
        <form id="admin-hr-doc-form" class="feature-form" enctype="multipart/form-data">
          <label>
            Titre
            <input type="text" name="title" required placeholder="Ex. Reglement interieur">
          </label>
          <label>
            Description
            <input type="text" name="description" placeholder="Courte description">
          </label>
          <label>
            Categorie
            <input type="text" name="category" value="General">
          </label>
          <label class="file-upload">
            Fichier a publier
            <input type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,application/pdf" ${usesDatabase() ? "required" : ""}>
            <span class="file-upload-hint">PDF, Word, Excel ou image — maximum 10 Mo</span>
          </label>
          <button type="submit" class="primary">Televerser et publier</button>
        </form>
        ${usesDatabase() ? "" : `<p class="hierarchy-meta">Le televersement de fichiers est disponible apres connexion Microsoft.</p>`}
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
        ${usesDatabase() ? "" : `<p class="hierarchy-meta">Le televersement de fichiers est disponible apres connexion Microsoft.</p>`}
      </article>
    </div>
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Documents RH publies</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Document</th><th>Categorie</th><th>Date</th><th>Fichier</th><th></th></tr></thead>
          <tbody>
            ${getHrDocuments().length
              ? getHrDocuments().map((doc) => `
                <tr>
                  <td><strong>${escapeHtml(doc.title)}</strong><br><small>${escapeHtml(doc.description || "")}</small></td>
                  <td>${escapeHtml(doc.category || "General")}</td>
                  <td>${formatDate(doc.published_at)}</td>
                  <td><a href="${escapeHtml(resolveHrDocumentUrl(doc))}" target="_blank" rel="noopener noreferrer">Ouvrir</a></td>
                  <td><button type="button" class="outline-button admin-delete-hr-doc" data-doc-id="${doc.id}" data-storage-path="${escapeHtml(doc.storage_path || "")}">Supprimer</button></td>
                </tr>`).join("")
              : `<tr><td colspan="5" class="empty-cell">Aucun document publie.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>`;
}

function pageContent() {
  if (appData.loading) {
    return `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Chargement des donnees...</div>`;
  }
  if (appData.error) {
    return `
      <article class="card error-card">
        <p class="error-message">${appData.error}</p>
        <button type="button" id="retry-load" class="primary">Reessayer</button>
      </article>`;
  }
  return {
    home: homePage,
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
  const message = (error?.message || "").toLowerCase();
  if (isJwtClockError(error)) {
    return "Synchronisation de session en cours. Cliquez sur Reessayer ou attendez quelques secondes. Verifiez aussi que l'heure de votre ordinateur est correcte.";
  }
  if (message.includes("does not exist") || (message.includes("relation") && message.includes("profiles"))) {
    return "Base Supabase non configuree. Executez supabase/schema.sql puis supabase/admin.sql dans SQL Editor.";
  }
  if (message.includes("bucket") || message.includes("storage")) {
    return "Stockage Supabase non configure. Executez supabase/storage-hr-documents.sql dans SQL Editor.";
  }
  return error?.message || "Impossible de charger les donnees Supabase.";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = "Requete") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} trop longue. Reessayez.`)), ms);
    })
  ]);
}

async function syncSessionAfterLogin() {
  if (!supabaseClient) return;
  await wait(400);
  try {
    await withTimeout(supabaseClient.auth.refreshSession(), 6000, "Connexion");
  } catch {
    // On continue avec la session existante si le refresh echoue ou expire.
  }
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
    const { error: inviteError } = await supabaseClient.rpc("apply_pending_invite", {
      user_id: user.id,
      user_email: user.email || ""
    });
    if (inviteError && !inviteError.message.includes("does not exist")) {
      console.warn("apply_pending_invite:", inviteError.message);
    }
  });
}

async function refreshAppData() {
  if (!usesDatabase()) return;

  const userId = session.user.id;
  await withSupabaseRetry(async () => {
    const [punchesRes, leaveRes, attestationRes, profilesRes, profileRes] = await withTimeout(
      Promise.all([
        supabaseClient.from("time_punches").select("*").eq("user_id", userId).order("punched_at", { ascending: true }),
        supabaseClient.from("leave_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabaseClient.from("attestation_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabaseClient.from("profiles").select("*").order("full_name"),
        supabaseClient.from("profiles").select("*").eq("id", userId).maybeSingle()
      ]),
      12000,
      "Chargement des donnees"
    );

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

    if ((appData.profile?.role || "employee") === "admin") {
      const invitesRes = await withTimeout(
        supabaseClient.from("pending_invites").select("*").order("created_at", { ascending: false }),
        8000,
        "Chargement des invitations"
      );
      if (!invitesRes.error) {
        appData.pendingInvites = invitesRes.data || [];
      }
    }

    const [docsRes, payslipsRes] = await Promise.all([
      supabaseClient.from("hr_documents").select("*").order("published_at", { ascending: false }),
      supabaseClient.from("payslips").select("*").eq("user_id", userId)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
    ]);
    if (!docsRes.error) appData.hrDocuments = docsRes.data || [];
    if (!payslipsRes.error) appData.payslips = payslipsRes.data || [];
  });
}

async function bootstrapUser(options = {}) {
  const { showSpinner = true } = options;

  if (!usesDatabase()) {
    renderApp();
    return;
  }

  if (bootstrapInFlight) {
    await bootstrapInFlight;
    return;
  }

  bootstrapInFlight = (async () => {
    if (showSpinner) {
      appData.loading = true;
      appData.error = "";
      renderApp();
    }

    try {
      await syncSessionAfterLogin();
      await ensureProfile();
      await refreshAppData();
    } catch (error) {
      appData.error = formatAppError(error);
    } finally {
      appData.loading = false;
      renderApp();
      maybeShowMicrosoftWelcome();
    }
  })();

  try {
    await bootstrapInFlight;
  } finally {
    bootstrapInFlight = null;
  }
}

function bindLoginEvents() {
  bindThemeToggle();
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
          <div class="login-bg" aria-hidden="true">
            <span class="login-blob login-blob-1"></span>
            <span class="login-blob login-blob-2"></span>
            <span class="login-blob login-blob-3"></span>
          </div>
          <div class="brand brand-large"><span>H</span> Humana</div>
          <div class="login-message">
            <span class="eyebrow">Humana RH</span>
            <h1>Gestion RH<br><em>simplifiee</em>.</h1>
            <p>Pointage, conges, documents — un espace fiable pour votre quotidien professionnel.</p>
          </div>
        </section>
        <section class="login-panel">
          <div class="login-theme-wrap">${themeToggleMarkup()}</div>
          <div class="login-card">
            <h2>Connexion</h2>
            <p>Utilisez votre compte Microsoft professionnel.</p>
            <button id="microsoft-login" type="button" class="microsoft-button" disabled>
              <span class="microsoft-logo"><i></i><i></i><i></i><i></i></span>
              Continuer avec Microsoft
            </button>
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
  markMicrosoftWelcomePending();
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: window.HUMANA_CONFIG?.REDIRECT_URL || "https://humana-rh.vercel.app",
      scopes: "openid email profile"
    }
  });
  if (error) renderLogin(error.message);
}

function playViewAnimations() {
  const shell = document.querySelector(".app-shell");
  const content = document.querySelector("#page-content");
  const topbar = document.querySelector(".topbar-page");
  const heading = document.querySelector(".page-heading");

  [shell, content, topbar, heading].forEach((el) => {
    if (!el) return;
    el.classList.remove("is-animating");
  });

  requestAnimationFrame(() => {
    shell?.classList.add("is-animating");
    [content, topbar, heading].forEach((el) => el?.classList.add("is-animating"));
  });
}

function renderApp() {
  const name = getUserName();
  const email = session?.user?.email || "collaborateur@entreprise.fr";
  const initials = profileInitials(name);

  app.innerHTML = `
    <div class="app-shell" data-current-page="${currentPage}">
      <aside class="sidebar">
        <div class="brand"><span>H</span> Humana</div>
        <button class="close-menu" type="button" aria-label="Fermer"></button>
        <nav>${getNavigationItems().map((item) => `
          <button type="button" data-page="${item[0]}" class="${currentPage === item[0] ? "active" : ""}">
            ${item[1]}${navBadge(item[0])}
          </button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <div class="user-card"><span class="avatar avatar-sidebar-user" aria-hidden="true">${initials}</span><div class="user-card-text"><strong title="${name}">${name}</strong><span class="user-card-email" title="${email}">${email}</span>${isAdmin() ? `<span class="admin-pill">Admin</span>` : ""}</div><button type="button" id="logout" class="logout-btn" aria-label="Se deconnecter">Sortir</button></div>
        </div>
      </aside>
      <button class="backdrop" type="button" aria-label="Fermer le menu"></button>
      <main class="main-content">
        <div class="main-bg" aria-hidden="true">
          <span class="main-blob main-blob-1"></span>
          <span class="main-blob main-blob-2"></span>
        </div>
        <header class="topbar">
          <button class="menu-button" type="button" aria-label="Menu"></button>
          <div class="topbar-page">${pages[currentPage][0]}</div>
          <div class="topbar-actions">${demoMode ? `<span class="demo-pill">Mode demo</span>` : ""}${themeToggleMarkup()}</div>
        </header>
        <div class="page">
          <header class="page-heading">
            <p>${pages[currentPage][1]}</p>
          </header>
          <div id="page-content" class="page-content">${pageContent()}</div>
        </div>
      </main>
    </div>`;

  bindAppEvents();
  playViewAnimations();
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
    await withTimeout(handler(), 15000, "Action");
    if (usesDatabase()) await refreshAppData();
  } catch (error) {
    appData.error = formatAppError(error);
  } finally {
    appData.loading = false;
    renderApp();
  }
}

function bindHierarchyOrgEvents() {
  document.querySelectorAll("[data-org-toggle]").forEach((button) => {
    if (button.dataset.humanaBound) return;
    button.dataset.humanaBound = "1";
    button.addEventListener("click", () => {
      const nodeId = button.dataset.orgToggle;
      const branch = button.closest(".org-branch");
      const expanded = button.getAttribute("aria-expanded") === "true";

      if (expanded) {
        collapsedOrgNodes.add(nodeId);
        branch?.classList.add("is-collapsed");
        button.setAttribute("aria-expanded", "false");
      } else {
        collapsedOrgNodes.delete(nodeId);
        branch?.classList.remove("is-collapsed");
        button.setAttribute("aria-expanded", "true");
      }
    });
  });
}

function bindPageEvents() {
  document.querySelectorAll("[data-goto-page]").forEach((button) => {
    button.addEventListener("click", () => {
      currentPage = button.dataset.gotoPage;
      renderApp();
    });
  });

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
    });
  });

  const hierarchySearchInput = document.querySelector("#hierarchy-search");
  if (hierarchySearchInput && !hierarchySearchInput.dataset.humanaBound) {
    hierarchySearchInput.dataset.humanaBound = "1";
    hierarchySearchInput.addEventListener("input", (event) => {
      hierarchySearch = event.currentTarget.value;
      if (currentPage !== "hierarchy") return;
      const tree = document.querySelector("#org-tree");
      const count = document.querySelector("#hierarchy-result-count");
      if (!tree || !count) return;

      const profiles = appData.orgProfiles;
      const fullTree = buildOrgTree(profiles);
      const query = hierarchySearch.trim();
      const displayTree = query ? filterOrgTree(fullTree, query) : fullTree;
      const visibleCount = countOrgNodes(displayTree);

      count.textContent = query
        ? `${visibleCount} resultat${visibleCount > 1 ? "s" : ""}`
        : `${profiles.length} collaborateurs`;
      tree.innerHTML = displayTree.length
        ? displayTree.map((node) => renderOrgNode(node, { forceExpand: Boolean(query) })).join("")
        : `<p class="empty-state">Aucun collaborateur ne correspond a votre recherche.</p>`;
      bindHierarchyOrgEvents();
    });
  }

  bindHierarchyOrgEvents();

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
      manager_id: String(data.get("manager_id") || "") || null,
      leave_balance_cp: Number(data.get("leave_balance_cp") || 25),
      leave_balance_rtt: Number(data.get("leave_balance_rtt") || 8)
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

  document.querySelector("#admin-hr-doc-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const fileEntry = file instanceof File && file.size > 0 ? file : null;

    withAction(async () => {
      const payload = {
        title: String(data.get("title") || "").trim(),
        description: String(data.get("description") || "").trim(),
        category: String(data.get("category") || "General").trim(),
        published_at: new Date().toISOString().slice(0, 10),
        created_by: session.user.id,
        file_url: "",
        storage_path: null
      };

      if (usesDatabase()) {
        if (!fileEntry) throw new Error("Selectionnez un fichier a televerser.");
        if (fileEntry.size > HR_DOCUMENT_MAX_BYTES) {
          throw new Error("Fichier trop volumineux. Taille maximum : 10 Mo.");
        }
        const uploaded = await uploadHrDocumentFile(fileEntry);
        payload.file_url = uploaded.publicUrl;
        payload.storage_path = uploaded.storagePath;
        const { error } = await supabaseClient.from("hr_documents").insert(payload);
        if (error) throw error;
      } else {
        if (!fileEntry) throw new Error("Selectionnez un fichier ou connectez-vous avec Microsoft.");
        const docs = loadStore("hrDocuments", demoHrDocuments);
        docs.unshift({
          id: `local-${Date.now()}`,
          ...payload,
          file_url: "#",
          file_name: fileEntry.name
        });
        saveStore("hrDocuments", docs);
      }

      form.reset();
      currentPage = "admin";
    });
  });

  document.querySelectorAll(".admin-delete-hr-doc").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("Supprimer ce document RH ?")) return;
      withAction(async () => {
        const docId = button.dataset.docId;
        const storagePath = button.dataset.storagePath;
        if (usesDatabase()) {
          if (storagePath) {
            const { error: storageError } = await supabaseClient.storage
              .from(HR_DOCUMENTS_BUCKET)
              .remove([storagePath]);
            if (storageError) throw storageError;
          }
          const { error } = await supabaseClient.from("hr_documents").delete().eq("id", docId);
          if (error) throw error;
        } else {
          const docs = loadStore("hrDocuments", demoHrDocuments).filter((doc) => doc.id !== docId);
          saveStore("hrDocuments", docs);
        }
        currentPage = "admin";
      });
    });
  });

  document.querySelector("#admin-payslip-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const fileEntry = file instanceof File && file.size > 0 ? file : null;
    const month = Number(data.get("period_month"));
    const year = Number(data.get("period_year"));
    const userId = String(data.get("user_id") || "");
    const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

    withAction(async () => {
      const payload = {
        user_id: userId,
        period_month: month,
        period_year: year,
        period_label: periodLabel,
        file_url: "",
        storage_path: null
      };

      if (usesDatabase()) {
        if (!fileEntry) throw new Error("Selectionnez un fichier PDF a televerser.");
        if (fileEntry.size > HR_DOCUMENT_MAX_BYTES) {
          throw new Error("Fichier trop volumineux. Taille maximum : 10 Mo.");
        }
        const { data: existing } = await supabaseClient
          .from("payslips")
          .select("storage_path")
          .eq("user_id", userId)
          .eq("period_year", year)
          .eq("period_month", month)
          .maybeSingle();
        const uploaded = await uploadPayslipFile(fileEntry, userId);
        payload.file_url = uploaded.publicUrl;
        payload.storage_path = uploaded.storagePath;
        const { error } = await supabaseClient.from("payslips").upsert(payload, {
          onConflict: "user_id,period_year,period_month"
        });
        if (error) throw error;
        if (existing?.storage_path && existing.storage_path !== uploaded.storagePath) {
          await supabaseClient.storage.from(HR_DOCUMENTS_BUCKET).remove([existing.storage_path]);
        }
      } else if (userId === session?.user?.id || demoMode) {
        if (!fileEntry) throw new Error("Selectionnez un fichier ou connectez-vous avec Microsoft.");
        const slips = loadStore("payslips", buildDemoPayslips());
        slips.unshift({
          id: `local-${Date.now()}`,
          ...payload,
          file_url: "#",
          file_name: fileEntry.name
        });
        saveStore("payslips", slips.slice(0, 12));
      }

      form.reset();
      currentPage = "admin";
    });
  });
}

function bindAppEvents() {
  bindThemeToggle();

  document.querySelectorAll(".sidebar nav [data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      currentPage = button.dataset.page;
      document.querySelector(".sidebar")?.classList.remove("open");
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
    currentPage = "home";
    appData = {
      loading: false,
      error: "",
      profile: null,
      punches: [],
      leaveRequests: [],
      attestationRequests: [],
      orgProfiles: [],
      pendingInvites: [],
      hrDocuments: [],
      payslips: [],
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
      if (nextSession && event === "SIGNED_IN") {
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
