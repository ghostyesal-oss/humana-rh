(function () {
  if (window.__humanaAppLoaded) return;
  window.__humanaAppLoaded = true;
  window.Humana = window.Humana || {};
  window.Humana.pages = window.Humana.pages || {};

let supabaseClient = null;
let app = null;
let session = null;
let demoMode = false;
let portalMode = false;
// MPA mode : chaque HTML porte <body data-page="xxx">.
// Fallback SPA : index.html sans data-page → navigation interne classique.
const mpaMode = typeof document !== "undefined" && !!document.body?.dataset?.page;
let currentPage = (mpaMode && document.body.dataset.page) || "home";

const pageModulePromises = {};
let dataStamp = Object.create(null);
const DATA_TTL_MS = 5 * 60 * 1000;
const ANIM_PAGES = { home: true, events: true };

/* HUMANA_ASSET_HASHES_START */
const HUMANA_ASSET_HASHES = {};
/* HUMANA_ASSET_HASHES_END */

function assetUrl(path) {
  const clean = String(path || "").replace(/^\//, "");
  const hash = HUMANA_ASSET_HASHES[clean];
  return hash ? `/${clean}?h=${hash}` : `/${clean}`;
}

const PAGE_MODULE_REV = "h7";

function ensurePageModule(page) {
  if (window.Humana?.pages?.[page]) return Promise.resolve();
  if (pageModulePromises[page]) return pageModulePromises[page];
  pageModulePromises[page] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let src = assetUrl(`pages/${page}.js`);
    if (!/[?&]h=/.test(src)) src += (src.includes("?") ? "&" : "?") + "r=" + PAGE_MODULE_REV;
    script.src = src;
    script.charset = "UTF-8";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Module ${page} introuvable`));
    document.body.appendChild(script);
  });
  return pageModulePromises[page];
}

function ensureAnimations() {
  if (!ANIM_PAGES[currentPage]) return Promise.resolve();
  if (window.HumanaAnimations) return Promise.resolve();
  if (pageModulePromises.__animations) return pageModulePromises.__animations;
  pageModulePromises.__animations = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = assetUrl("animations.js");
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });
  return pageModulePromises.__animations;
}

function pageHref(page) {
  return `/${page}`;
}

function loginHref() {
  return "/";
}

function pageFromPath() {
  const file = String(window.location.pathname.split("/").pop() || "").replace(/\.html$/i, "");
  if (file && Object.prototype.hasOwnProperty.call(pages, file)) return file;
  const fromBody = document.body?.dataset?.page;
  if (fromBody && Object.prototype.hasOwnProperty.call(pages, fromBody)) return fromBody;
  return "home";
}

function syncPageUrl(page) {
  if (!mpaMode) return;
  try {
    const next = pageHref(page);
    const current = String(window.location.pathname || "/").replace(/\/$/, "") || "/";
    if (current !== next) {
      window.history.pushState({ humanaPage: page }, "", next);
    }
    document.body.dataset.page = page;
    if (pages[page]) document.title = `${pages[page][0]} — Daylyx`;
  } catch (_) { /* ignore */ }
}

function navigateToPage(nextPage, options = {}) {
  const target = String(nextPage || "home");
  document.querySelector(".sidebar")?.classList.remove("open");
  if (currentPage === "journal" && target !== "journal") {
    try { closeJournalFullscreen(); } catch (_) { /* ok si non défini encore */ }
  }
  currentPage = target;
  syncPageUrl(target);
  return ensurePageModule(target)
    .then(() => loadPageData(target))
    .then(() => ensureAnimations())
    .then(() => {
      if (options.render !== false) renderApp();
    })
    .catch((error) => {
      if (!window.Humana?.pages?.[target]) {
        window.location.href = pageHref(target);
        return;
      }
      appData.error = formatAppError(error);
      if (options.render !== false) renderApp();
    });
}

if (typeof window !== "undefined" && !window.__humanaPopstateBound) {
  window.__humanaPopstateBound = true;
  window.addEventListener("popstate", () => {
    if (!session?.user && !demoMode) return;
    const target = pageFromPath();
    currentPage = target;
    ensurePageModule(target)
      .then(() => loadPageData(target))
      .then(() => ensureAnimations())
      .then(() => renderApp())
      .catch(() => {
        window.location.href = pageHref(target);
      });
  });
}
let bootstrapInFlight = null;
let hierarchySearch = "";
const collapsedOrgNodes = new Set();
let teamPunchFilters = { start: "", end: "", userId: "", scope: "all", detailView: "punches" };
let edsFilters = { start: "", end: "" };
let teamPunchesInitialLoadDone = false;
let journalFilters = { start: "", end: "", userId: "", query: "" };
let journalSort = { key: "connectedAt", dir: "desc" };
let journalColumnFilters = {};
let journalOpenColumn = "";
let journalPunchesInitialLoadDone = false;
let journalMetaColumnsEnabled = true;
let workLocationColumnEnabled = true;
let workStatusColumnEnabled = false;
let journalFullscreen = false;
let journalFullscreenListenerBound = false;
let leaveCalendarMonth = null;
let planningState = { tab: "grid", dept: "cs", cursor: null, importNotice: "", assignOpen: false, aiPage: 1 };
const AI_INBOX_PAGE_SIZE = 5;
const OWN_PUNCH_DAYS = 62;
const OWN_PUNCH_LIMIT = 1500;
const PRIVACY_PUNCH_DAYS = 1100;
const PRIVACY_PUNCH_LIMIT = 5000;
const OWN_LEAVE_MONTHS = 18;
const OWN_HR_LIMIT = 200;
const OWN_DOCS_LIMIT = 80;
const TEAM_PUNCH_LIMIT = 8000;
const TEAM_LEAVE_LIMIT = 500;
const PLANNING_ENTRY_LIMIT = 15000;
let adminUserQuery = "";
let adminUserFormOpen = false;
let adminAssignOpen = false;
let adminAssignNotice = "";
const adminUserFilters = {
  role: "",
  managerId: "",
  department: "",
  leaveGrade: "",
  holidayCalendar: "",
  shiftCode: ""
};
const filterPanelOpen = { journal: false, teamPunches: false, global: false, admin: false };

function isFilterPanelOpen(key) {
  return Boolean(filterPanelOpen[tablePageKey(key)]);
}

function bindFilterPanels() {
  document.querySelectorAll("[data-filter-panel]").forEach((panel) => {
    if (panel.dataset.humanaBound) return;
    panel.dataset.humanaBound = "1";
    panel.addEventListener("toggle", () => {
      const key = tablePageKey(panel.dataset.filterPanel);
      if (!key || key === "table") return;
      filterPanelOpen[key] = panel.open;
    });
  });
}
const TABLE_PAGE_SIZE = 5;
const tablePageState = Object.create(null);
let initialAuthHandled = false;

function tablePageKey(key) {
  return String(key || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "table";
}

function resetTablePage(key) {
  tablePageState[tablePageKey(key)] = 1;
}

function paginateList(key, items, pageSize = TABLE_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || TABLE_PAGE_SIZE);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size) || 1);
  const id = tablePageKey(key);
  let page = Number(tablePageState[id]) || 1;
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  tablePageState[id] = page;
  const start = total ? (page - 1) * size : 0;
  const end = Math.min(start + size, total);
  return {
    key: id,
    items: list.slice(start, end),
    page,
    pages,
    size,
    start,
    end,
    total,
    from: total ? start + 1 : 0,
    to: end
  };
}

function renderTablePager(page) {
  if (!page || page.total <= page.size) return "";
  return `
    <nav class="table-pager" data-table-pager="${escapeHtml(page.key)}" aria-label="Pagination du tableau">
      <button type="button" class="outline-button" data-table-page="${page.page - 1}"${page.page <= 1 ? " disabled" : ""}>Précédent</button>
      <span class="table-pager__status">${page.from}–${page.to} / ${page.total}</span>
      <button type="button" class="outline-button" data-table-page="${page.page + 1}"${page.page >= page.pages ? " disabled" : ""}>Suivant</button>
    </nav>`;
}

function bindTablePagers() {
  document.querySelectorAll("[data-table-pager]").forEach((nav) => {
    if (nav.dataset.humanaBound) return;
    nav.dataset.humanaBound = "1";
    nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-table-page]");
      if (!button || button.disabled || !nav.contains(button)) return;
      const next = Number(button.dataset.tablePage);
      if (!Number.isFinite(next) || next < 1) return;
      tablePageState[tablePageKey(nav.dataset.tablePager)] = next;
      refreshPageContent();
    });
  });
}

let appData = {
  loading: false,
  error: "",
  profile: null,
  punches: [],
  teamPunches: [],
  journalPunches: [],
  journalMetaMissing: false,
  teamLeaveRequests: [],
  leaveRequests: [],
  attestationRequests: [],
  salaryAdvanceRequests: [],
  salaryAdvanceTableMissing: false,
  salaryAdvanceQuota: null,
  orgProfiles: [],
  pendingInvites: [],
  hrDocuments: [],
  payslips: [],
  hrAlerts: [],
  punchCorrections: [],
  overtimeRequests: [],
  activityEntries: [],
  navVisibility: null,
  studioCreators: [],
  companyEvents: [],
  companyEventsTableMissing: false,
  eventEditingId: "",
  eventDetailId: "",
  adminEditingId: "",
  adminEditingInviteId: "",
  companyTimezone: "GMT+1",
  shiftHours: null,
  planningEntries: [],
  employeeImportNotice: "",
  edsPayroll: {},
  delayReviews: []
};

const roleLabels = {
  admin: "Administrateur",
  rh: "RH",
  manager: "Manager",
  employee: "Collaborateur",
  creator: "Créateur"
};

const ASSIGNABLE_ROLES = ["employee", "manager", "rh", "admin"];

const NAV_VISIBILITY_PAGES = [
  { id: "home", label: "Accueil" },
  { id: "pointeuse", label: "Pointeuse" },
  { id: "global", label: "Global" },
  { id: "team-punches", label: "Pointages équipe" },
  { id: "reports", label: "Rapports EDS" },
  { id: "leave", label: "Congés" },
  { id: "attestations", label: "Demande RH" },
  { id: "planning", label: "Planning" },
  { id: "events", label: "Événements" },
  { id: "hierarchy", label: "Hiérarchie" },
  { id: "journal", label: "Journal" },
  { id: "admin", label: "Administration" }
];

const NAV_VISIBILITY_AUDIENCES = [
  { id: "admin", label: "Administrateurs" },
  { id: "manager", label: "Managers" },
  { id: "employee", label: "Collaborateurs" }
];

function getDefaultNavVisibility() {
  return {
    home: { admin: true, manager: true, employee: true },
    pointeuse: { admin: true, manager: true, employee: true },
    global: { admin: true, manager: true, employee: false },
    "team-punches": { admin: true, manager: true, employee: false },
    reports: { admin: true, manager: true, employee: true },
    leave: { admin: true, manager: true, employee: true },
    attestations: { admin: true, manager: true, employee: true },
    planning: { admin: true, manager: true, employee: false },
    events: { admin: true, manager: true, employee: true },
    hierarchy: { admin: true, manager: true, employee: true },
    journal: { admin: true, manager: false, employee: false },
    admin: { admin: true, manager: false, employee: false }
  };
}

const pages = {
  home: ["Accueil", "Tout ce dont vous avez besoin, au même endroit."],
  pointeuse: ["Pointeuse", "Enregistrez vos arrivées et vos départs."],
  global: ["Global", "Tableau de bord synthétique des pointages : KPI, tendances, top retards."],
  journal: ["Journal", "Consultez l'historique des connexions et les détails techniques."],
  leave: ["Congés", "Demandes, soldes, validations et justificatifs."],
  attestations: ["Demande RH", "Attestations et avance sur salaire."],
  planning: ["Planning", "Grille d'équipe, journal et écarts par département."],
  events: ["Événements", "Annonces, réunions et temps forts partagés par les administrateurs."],
  hierarchy: ["Hiérarchie", "Votre manager, votre équipe et l'organigramme."],
  "team-punches": ["Pointages équipe", "Admin : tous les collaborateurs. Manager : son équipe directe."],
  reports: ["Rapports EDS", "Temps, absences, retards et export paie du 21 au 20."],
  admin: ["Administration", "Gestion des comptes et des accès."],
  creator: ["Studio créateur", "Contrôlez la visibilité des onglets par profil."],
  privacy: ["Mes données", "Consultez et exportez les informations vous concernant."]
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

function daylyxLockupMarkup(extraClass) {
  if (window.DaylyxMark && typeof window.DaylyxMark.html === "function") {
    return window.DaylyxMark.html(extraClass);
  }
  return `<div class="daylyx-lockup ${extraClass || ""} is-static" role="img" aria-label="Daylyx">Daylyx</div>`;
}

function showAuthBootScreen() {
  document.documentElement.classList.remove("daylyx-presenting");
  document.documentElement.classList.add("auth-booting");
  const bootScreen = document.getElementById("auth-boot-screen");
  if (bootScreen) {
    bootScreen.hidden = false;
    bootScreen.setAttribute("aria-hidden", "false");
    bootScreen.setAttribute("aria-busy", "true");
  }
  if (window.DaylyxMark) window.DaylyxMark.sync();
}

function hideAuthBootScreen() {
  const finish = () => {
    document.documentElement.classList.remove("auth-booting");
    const bootScreen = document.getElementById("auth-boot-screen");
    if (bootScreen) {
      bootScreen.hidden = true;
      bootScreen.setAttribute("aria-hidden", "true");
      bootScreen.setAttribute("aria-busy", "false");
    }
    try {
      sessionStorage.removeItem("humana_auth_boot");
    } catch (_) {
      /* ignore */
    }
  };
  if (!document.documentElement.classList.contains("auth-booting")) {
    finish();
    return;
  }
  if (window.DaylyxMark && typeof window.DaylyxMark.hideBootWithReveal === "function") {
    window.DaylyxMark.hideBootWithReveal(finish);
  } else {
    finish();
  }
}

function hasStoredSupabaseSession() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.includes("-auth-token")) continue;
      const value = localStorage.getItem(key);
      if (value && value.includes("access_token")) return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

function shouldBootAuthenticatedUi() {
  if (isOAuthReturn()) return true;
  if (window.__pendingAuthSession) return true;
  try {
    if (sessionStorage.getItem("humana_auth_boot") === "1") return true;
  } catch (_) {
    /* ignore */
  }
  return hasStoredSupabaseSession();
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
          <div class="welcome-lockup">${daylyxLockupMarkup("is-compact is-static")}</div>
          <p class="welcome-eyebrow">Connexion réussie</p>
          <h2 id="welcome-title">${dayGreeting()}, <b>${firstName}</b></h2>
          <p class="welcome-text">Bienvenue sur Daylyx. Votre espace RH est prêt.</p>
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
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Changer le thème">
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
  ["leave", "Congés"],
  ["attestations", "Demande RH"],
  ["planning", "Planning"],
  ["events", "Événements"],
  ["hierarchy", "Hiérarchie"]
];

const EVENT_TYPES = [
  { id: "general", label: "Annonce", icon: "📣" },
  { id: "meeting", label: "Réunion", icon: "🗓️" },
  { id: "celebration", label: "Célébration", icon: "🎉" },
  { id: "training", label: "Formation", icon: "🎓" },
  { id: "reminder", label: "Rappel", icon: "⏰" }
];

const EVENT_VISIBILITIES = [
  { id: "all", label: "Tous les collaborateurs" },
  { id: "managers", label: "Managers uniquement" },
  { id: "admins", label: "Administrateurs uniquement" }
];

const HR_DOCUMENTS_BUCKET = "hr-documents";
const EVENT_POSTERS_BUCKET = "event-posters";
const EVENT_POSTER_MAX_BYTES = 5 * 1024 * 1024;
const EVENT_POSTER_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const HR_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const PRIVATE_FILE_URL_TTL_SECONDS = 120;
const AUTO_CLOCK_OUT_MS = 10 * 60 * 60 * 1000;
const JOURNAL_META_FIELDS = [
  "connection_method",
  "operating_system",
  "browser_application",
  "ip_address",
  "network_type",
  "disconnect_reason"
];
const JOURNAL_COLUMNS = [
  { key: "sessionId", label: "ID_Session" },
  { key: "matricule", label: "Matricule" },
  { key: "name", label: "Nom_Collaborateur" },
  { key: "department", label: "Département" },
  { key: "dateIn", label: "Date_Connexion" },
  { key: "timeIn", label: "Heure_Connexion" },
  { key: "dateOut", label: "Date_Déconnexion" },
  { key: "timeOut", label: "Heure_Déconnexion" },
  { key: "duration", label: "Durée_Session" },
  { key: "method", label: "Moyen_Connexion" },
  { key: "os", label: "Système_Exploitation" },
  { key: "browser", label: "Navigateur_Application" },
  { key: "ip", label: "Adresse_IP" },
  { key: "network", label: "Type_Réseau" },
  { key: "location", label: "Localisation" },
  { key: "status", label: "Statut_Connexion" },
  { key: "reason", label: "Raison_Déconnexion" }
];
const WORK_LOCATION_STORE_KEY = "workLocation";
const SHOW_WORK_LOCATION_UI = false;
const WORK_LOCATIONS = {
  onsite: "Sur site",
  remote: "Télétravail"
};

const ABSENCE_CODES = [
  { code: "Congés Payés", label: "Congés payés", key: "cp", group: "cp", attachment: false, grades: ["employee", "manager", "codir"] },
  { code: "Congés Payés Responsable Département", label: "Congés payés responsable département", key: "cp", group: "cp", attachment: false, grades: ["manager", "codir"] },
  { code: "Congés Payés Management", label: "Congés payés management", key: "cp", group: "cp", attachment: false, grades: ["codir"] },
  { code: "Récupération", label: "Récupération", key: "recup", group: "recup", attachment: false },
  { code: "Conge Maternite", label: "Congé maternité", key: "maternity", group: "family", attachment: true },
  { code: "Conges Paternite", label: "Congé paternité", key: "paternity", group: "family", attachment: true },
  { code: "Circoncision", label: "Circoncision", key: "special", group: "event", attachment: true },
  { code: "Décès 2 Jours", label: "Décès — 2 jours", key: "special", group: "event", attachment: true, fixedDays: 2 },
  { code: "Décès 3 Jours", label: "Décès — 3 jours", key: "special", group: "event", attachment: true, fixedDays: 3 },
  { code: "Mariage salarié", label: "Mariage du salarié", key: "special", group: "event", attachment: true },
  { code: "Opération conjoint / Enfant", label: "Opération du conjoint / enfant", key: "special", group: "event", attachment: true },
  { code: "Congé Sans Solde", label: "Congé sans solde", key: "unpaid", group: "unpaid", attachment: true },
  { code: "ABS JUSTTIFIER", label: "Absence justifiée", key: "justified", group: "admin", attachment: true },
  { code: "ABS INJUSTIFIER", label: "Absence injustifiée", key: "unjustified", group: "admin", attachment: false, adminOnly: true },
  { code: "Déplacement", label: "Déplacement", key: "travel", group: "work", attachment: false },
  { code: "RETARD", label: "Retard", key: "hours", group: "time", attachment: false, unit: "hours" },
  { code: "DEPART", label: "Départ anticipé", key: "hours", group: "time", attachment: false, unit: "hours" },
  { code: "MISE A PIED", label: "Mise à pied", key: "suspension", group: "admin", attachment: false, adminOnly: true }
];
const ABSENCE_GROUP_LABELS = {
  cp: "Congés payés",
  recup: "Récupération",
  family: "Familial",
  event: "Événements",
  unpaid: "Sans solde",
  admin: "Absences / mesures RH",
  work: "Déplacement",
  time: "Retard / départ"
};
const activityCategories = ["Production", "Réunion", "Formation", "Coaching", "Pause payée"];

const WORK_STATUSES = [
  { value: "production",  label: "Production",  color: "#1e3a8a" },
  { value: "reunion",     label: "Réunion",     color: "#7c3aed" },
  { value: "formation",   label: "Formation",   color: "#0891b2" },
  { value: "coaching",    label: "Coaching",     color: "#059669" },
  { value: "break",       label: "Break",       color: "#ea580c" }
];

function getCurrentWorkStatus() {
  try { return sessionStorage.getItem("humana_work_status") || "production"; } catch (_) { return "production"; }
}

function setCurrentWorkStatus(value) {
  const next = WORK_STATUSES.some((status) => status.value === value) ? value : "production";
  try { sessionStorage.setItem("humana_work_status", next); } catch (_) { /* ignore */ }
  return next;
}

function canChangeWorkStatus() {
  return Boolean(getClockState().isWorking);
}

function pctN(value) {
  return Math.max(0, Math.min(100, Math.round(Number.parseFloat(String(value)) || 0)));
}

function pctProps(map) {
  return Object.entries(map).map(([key, value]) => `data-${key}="${pctN(value)}"`).join(" ");
}

function workStatusDef(value) {
  return WORK_STATUSES.find((s) => s.value === value) || WORK_STATUSES[0];
}

function topbarTimelineMarkup() {
  return `<span class="dtl-elapsed" data-elapsed-clock aria-label="Temps écoulé">${formatElapsedHms(getTodayElapsedMs())}</span>`;
}

function workStatusPickerMarkup() {
  const enabled = canChangeWorkStatus();
  const current = workStatusDef(enabled ? getCurrentWorkStatus() : "production");
  const options = WORK_STATUSES.map((s) =>
    `<option value="${s.value}" ${s.value === current.value ? "selected" : ""}>${s.label}</option>`
  ).join("");
  const title = enabled
    ? "Production démarre à J'arrive et s'arrête à Je pars. Les autres statuts s'intercalent pendant le service."
    : "Le statut Production démarre lorsque vous cliquez sur J'arrive.";
  return `<div class="work-status-picker${enabled ? "" : " is-disabled"}" title="${escapeHtml(title)}">
    <span class="work-status-dot work-status-dot--${current.value}"></span>
    <select id="work-status-select" aria-label="Statut de travail"${enabled ? "" : " disabled"}>${options}</select>
  </div>`;
}

function bindWorkStatusPicker() {
  const select = document.getElementById("work-status-select");
  if (!select || select.dataset.humanaBound) return;
  select.dataset.humanaBound = "1";
  select.addEventListener("change", () => {
    const newStatus = select.value;
    const oldStatus = getCurrentWorkStatus();
    if (!canChangeWorkStatus()) {
      select.value = "production";
      return;
    }
    if (newStatus === oldStatus) return;
    withAction(async () => {
      setCurrentWorkStatus(newStatus);
      switchStatusClock(newStatus);
      const punchData = {
        type: "status_change",
        time: new Date().toISOString(),
        workStatus: newStatus,
        prevWorkStatus: oldStatus
      };
      if (usesDatabase()) {
        await insertTimePunch({
          user_id: session.user.id,
          punch_type: "status_change",
          punched_at: punchData.time,
          work_status: newStatus
        });
        appData.punches = [...(appData.punches || []), {
          user_id: session.user.id,
          punch_type: "status_change",
          punched_at: punchData.time,
          work_status: newStatus
        }];
      } else {
        const punches = loadStore("punches", []);
        punches.push(punchData);
        saveStore("punches", punches);
      }
    });
  });
}
const PUNCH_CORRECTION_QUOTA = 3;
const PUNCH_KIND_OPTIONS = [
  { value: "in", label: "Début de service (entrée)" },
  { value: "break_start", label: "Début de pause" },
  { value: "break_end", label: "Fin de pause (reprise)" },
  { value: "out", label: "Fin de service (sortie)" }
];
const PUNCH_CORRECTION_FIELDS = ["punch_kind", "reviewed_by", "reviewed_at"];
const SHIFT_PRESETS = {
  h7: {
    code: "h7",
    label: "07h–17h",
    start: "07:00",
    end: "17:00",
    lunchMin: 60,
    lunchFrom: "12:00",
    lunchTo: "14:00",
    plannedHours: 9,
    lateAfter: "07:15",
    earliestEnd: "17:00"
  },
  h8: {
    code: "h8",
    label: "08h–18h",
    start: "08:00",
    end: "18:00",
    lunchMin: 60,
    lunchFrom: "12:00",
    lunchTo: "14:00",
    plannedHours: 9,
    lateAfter: "08:15",
    earliestEnd: "18:00"
  },
  cs: {
    code: "cs",
    label: "CS · 08h–17h",
    start: "08:00",
    end: "17:00",
    lunchMin: 60,
    lunchFrom: "12:00",
    lunchTo: "14:00",
    plannedHours: 8,
    lateAfter: "08:15",
    earliestEnd: "17:00"
  },
  ces: {
    code: "ces",
    label: "CES · 08h–17h",
    start: "08:00",
    end: "17:00",
    lunchMin: 60,
    lunchFrom: "12:00",
    lunchTo: "14:00",
    plannedHours: 8,
    lateAfter: "08:15",
    earliestEnd: "17:00"
  },
  rnd: {
    code: "rnd",
    label: "R&D · 8h + pause",
    start: "09:00",
    end: "18:00",
    lunchMin: 60,
    lunchFrom: "12:00",
    lunchTo: "14:00",
    plannedHours: 8,
    lateAfter: "10:15",
    earliestEnd: "18:00",
    flexible: true
  }
};
const COMPANY_TIMEZONES = [
  { id: "GMT+1", label: "GMT+1 (UTC+1)", offsetMinutes: 60 },
  { id: "GMT", label: "GMT (UTC)", offsetMinutes: 0 }
];
const SHIFT_DEPT_META = [
  { code: "cs", name: "CS" },
  { code: "ces", name: "CES" },
  { code: "rnd", name: "R&D" }
];
const TIMELINE_LIMITS_MIN = [7 * 60, 17 * 60];

function normalizeHhmm(value, fallback = "08:00") {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function hhmmToLabel(value) {
  const [hours, minutes] = normalizeHhmm(value).split(":");
  return minutes === "00" ? `${hours}h` : `${hours}h${minutes}`;
}

function defaultShiftHours() {
  return {
    cs: { start: SHIFT_PRESETS.cs.start, end: SHIFT_PRESETS.cs.end },
    ces: { start: SHIFT_PRESETS.ces.start, end: SHIFT_PRESETS.ces.end },
    rnd: { start: SHIFT_PRESETS.rnd.start, end: SHIFT_PRESETS.rnd.end }
  };
}

function normalizeShiftHours(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const defaults = defaultShiftHours();
  const next = {};
  SHIFT_DEPT_META.forEach(({ code }) => {
    const row = source[code] && typeof source[code] === "object" ? source[code] : {};
    next[code] = {
      start: normalizeHhmm(row.start, defaults[code].start),
      end: normalizeHhmm(row.end, defaults[code].end)
    };
  });
  return next;
}

function getCompanyTimezoneId() {
  return appData.companyTimezone === "GMT" ? "GMT" : "GMT+1";
}

function getCompanyOffsetMinutes() {
  const found = COMPANY_TIMEZONES.find((entry) => entry.id === getCompanyTimezoneId());
  return found ? found.offsetMinutes : 60;
}

function toCompanyCivil(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const shifted = new Date(date.getTime() + getCompanyOffsetMinutes() * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds()
  };
}

function companyDateKey(value = new Date()) {
  const civil = toCompanyCivil(value);
  return `${civil.year}-${String(civil.month + 1).padStart(2, "0")}-${String(civil.day).padStart(2, "0")}`;
}

function companyMinutesOfDay(value = new Date()) {
  const civil = toCompanyCivil(value);
  return civil.hours * 60 + civil.minutes + civil.seconds / 60;
}

function formatShiftRange(start, end) {
  return `${hhmmToLabel(start)}–${hhmmToLabel(end)}`;
}

function getConfiguredShiftHours() {
  return normalizeShiftHours(appData.shiftHours);
}

function resolveShiftPreset(code) {
  const key = String(code || "").toLowerCase();
  const base = SHIFT_PRESETS[key] || SHIFT_PRESETS.cs;
  const hours = getConfiguredShiftHours()[base.code] || { start: base.start, end: base.end };
  const start = hours.start || base.start;
  const end = hours.end || base.end;
  const startMin = minutesFromHhmm(start);
  const endMin = minutesFromHhmm(end);
  const lunchMin = Number(base.lunchMin) || 60;
  const span = Math.max(0, endMin - startMin);
  const plannedHours = Math.max(0, (span - lunchMin) / 60);
  const lateAfterMin = startMin + 15;
  const lateAfter = `${String(Math.floor(lateAfterMin / 60) % 24).padStart(2, "0")}:${String(lateAfterMin % 60).padStart(2, "0")}`;
  const deptName = (SHIFT_DEPT_META.find((entry) => entry.code === base.code) || {}).name || base.code.toUpperCase();
  return {
    ...base,
    start,
    end,
    plannedHours,
    lateAfter,
    earliestEnd: end,
    label: `${deptName} · ${formatShiftRange(start, end)}`
  };
}

function shiftSelectOptions(selected) {
  const current = String(selected || "cs").toLowerCase();
  return SHIFT_DEPT_META.map(({ code }) => {
    const shift = resolveShiftPreset(code);
    const isSelected = current === code ? " selected" : "";
    return `<option value="${code}"${isSelected}>${escapeHtml(shift.label)}</option>`;
  }).join("");
}
const FR_HOLIDAYS_2026 = ["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"];
const MA_HOLIDAYS_2026 = ["2026-01-01", "2026-01-11", "2026-05-01", "2026-07-30", "2026-08-14", "2026-08-20", "2026-08-21", "2026-11-06", "2026-11-18"];
const RAMADAN_2026 = { start: "2026-02-18", end: "2026-03-19" };
const LEAVE_ACCRUAL = { employee: 1.5, manager: 2, codir: 2.5 };
const attestationTypes = [
  "Attestation employeur",
  "Certificat de travail",
  "Attestation de salaire",
  "Attestation de congés"
];
const OTHER_REQUEST_CUSTOM = "Autre";
const otherRequestTypes = [
  "Réclamation",
  "Info assurance",
  "Réclamation assurance",
  OTHER_REQUEST_CUSTOM
];

function isOtherHrType(type) {
  const value = String(type || "").trim();
  if (!value) return false;
  if (otherRequestTypes.includes(value)) return true;
  return /^autre(\s|:|$)/i.test(value);
}

function hrKindLabel(request) {
  if (request?.kind === "advance") return "Avance sur salaire";
  if (request?.kind === "other") return "Autre demande";
  return "Attestation";
}

const avatarColors = ["violet", "blue", "orange", "green", "pink"];

function avatar(initials, color = "violet", extraClass = "") {
  const classes = ["avatar", color, extraClass].filter(Boolean).join(" ");
  return `<span class="${classes}">${escapeHtml(initials)}</span>`;
}

function profileInitials(name) {
  return (name || "CO").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function avatarForProfile(profile, index = 0, extraClass = "") {
  return avatar(profileInitials(profile.full_name), avatarColors[index % avatarColors.length], extraClass);
}

function profileRoleLabel(profile) {
  const parts = [];
  if (profile.department) parts.push(profile.department);
  if (profile.role === "creator") parts.push("Créateur");
  else if (profile.role === "admin") parts.push("Admin");
  else if (profile.role === "manager") parts.push("Manager");
  return parts.join(" · ");
}

function renderProfilePyramidCard(profile, index, options = {}) {
  const {
    isMe = false,
    hasTeam = false,
    teamCount = 0,
    toggleId = "",
    collapsed = false
  } = options;
  const roleLabel = profileRoleLabel(profile);
  const expandControl = toggleId && hasTeam
    ? `<button type="button" class="org-expand" data-org-toggle="${toggleId}" aria-expanded="${!collapsed}" aria-label="Afficher ou masquer l'équipe de ${escapeHtml(profile.full_name || "ce manager")}">
        <span class="org-team-count">${teamCount}</span>
        <span class="org-toggle-icon" aria-hidden="true"></span>
      </button>`
    : hasTeam
      ? `<span class="org-team-count org-team-count-static">${teamCount}</span>`
      : "";

  return `
    <article class="org-pyramid-card ${isMe ? "is-me" : ""} ${hasTeam ? "has-team" : ""}">
      <div class="org-card-avatar">
        ${avatarForProfile(profile, index, "org-avatar")}
      </div>
      <div class="org-card-info">
        <strong>${escapeHtml(profile.full_name || "Sans nom")}</strong>
        <span>${escapeHtml(profile.job_title || "Collaborateur")}</span>
        ${roleLabel ? `<small>${escapeHtml(roleLabel)}</small>` : ""}
      </div>
      ${expandControl}
    </article>`;
}

function badge(value) {
  const normalized = String(value || "").toLowerCase();
  const isDone = normalized.includes("approuv") || normalized.includes("pret") || normalized.includes("termine")
    || normalized.includes("confirm") || normalized.includes("rectif")
    || normalized === "validé" || normalized.startsWith("validé");
  const isPending = normalized.includes("a valider") || normalized.includes("à valider")
    || normalized.includes("prise en charge") || normalized.includes("cours") || normalized.includes("attente");
  const tone = isDone ? "success" : isPending ? "warning" : "neutral";
  const displayValue = String(value || "")
    .replace(/^A valider\b/, "À valider")
    .replace(/^Approuve\b/, "Approuvé")
    .replace(/^Refuse\b/, "Refusé")
    .replace(/^Confirme\b/, "Confirmé")
    .replace(/^Rectifie\b/, "Rectifié");
  return `<span class="badge ${tone}">${escapeHtml(displayValue)}</span>`;
}

const cardHeading = (title, action = "") =>
  action
    ? `<div class="card-heading"><h3>${title}</h3><button type="button">${action}</button></div>`
    : `<div class="card-heading"><h3>${title}</h3></div>`;

function usesDatabase() {
  return Boolean(supabaseClient && session?.user?.id && !demoMode);
}

function isCreator() {
  if (appData.profile?.role === "creator") return true;
  const email = session?.user?.email?.toLowerCase();
  return Boolean(email && getStudioCreatorEmails().includes(email));
}

function isAdmin() {
  const role = appData.profile?.role;
  return role === "admin" || role === "creator";
}

function isRhRole(role) {
  const value = String(role || "").toLowerCase();
  return value === "rh" || value === "admin" || value === "creator";
}

function isHr() {
  return isRhRole(appData.profile?.role);
}

function hasOrgWideAccess() {
  return isAdmin() || isHr();
}

function getStudioCreatorEmails() {
  return (appData.studioCreators || [])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean);
}

function normalizeStudioCreators(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))];
}

function isStudioCreatorEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return Boolean(normalized && getStudioCreatorEmails().includes(normalized));
}

function renderUserRolePills() {
  const pills = [];
  if (appData.profile?.role === "rh" || (isHr() && !isAdmin() && !isCreator())) {
    pills.push(`<span class="admin-pill">RH</span>`);
  }
  if (appData.profile?.role === "manager") pills.push(`<span class="admin-pill">Manager</span>`);
  if (isAdmin()) pills.push(`<span class="admin-pill">Admin</span>`);
  if (isCreator()) pills.push(`<span class="creator-pill">Créateur</span>`);
  return pills.join("");
}

function getNavAudienceRole() {
  const role = appData.profile?.role || "employee";
  if (role === "admin" || role === "creator" || role === "rh") return "admin";
  if (role === "manager" || hasDirectReports()) return "manager";
  return "employee";
}

function normalizeNavVisibility(raw) {
  const base = getDefaultNavVisibility();
  NAV_VISIBILITY_PAGES.forEach(({ id }) => {
    base[id] = { ...base[id], ...(raw?.[id] || {}) };
  });
  return base;
}

function getNavVisibility() {
  return normalizeNavVisibility(appData.navVisibility);
}

function isNavPageVisible(pageId) {
  if (!NAV_VISIBILITY_PAGES.some((page) => page.id === pageId)) return true;
  if (isCreator()) return true;
  if (!usesDatabase() && !demoMode) return true;
  const audience = getNavAudienceRole();
  return getNavVisibility()[pageId]?.[audience] !== false;
}

async function loadNavVisibility() {
  if (!usesDatabase()) {
    appData.navVisibility = normalizeNavVisibility(loadStore("navVisibility", null));
    return;
  }

  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("value")
    .eq("key", "nav_visibility")
    .maybeSingle();

  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("app_settings")) {
      appData.navVisibility = getDefaultNavVisibility();
      return;
    }
    throw error;
  }

  appData.navVisibility = normalizeNavVisibility(data?.value || null);
}

async function saveNavVisibility(settings) {
  if (usesDatabase() && !isCreator()) {
    throw new Error("Seul un créateur peut modifier la visibilité des onglets.");
  }
  const normalized = normalizeNavVisibility(settings);
  if (!usesDatabase()) {
    saveStore("navVisibility", normalized);
    appData.navVisibility = normalized;
    return;
  }

  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: "nav_visibility", value: normalized }, { onConflict: "key" });
  if (error) throw error;
  appData.navVisibility = normalized;
}

async function loadStudioCreators() {
  if (!usesDatabase()) {
    appData.studioCreators = normalizeStudioCreators(loadStore("studioCreators", []));
    return;
  }

  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("value")
    .eq("key", "studio_creators")
    .maybeSingle();

  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("app_settings")) {
      appData.studioCreators = [];
      return;
    }
    throw error;
  }

  appData.studioCreators = normalizeStudioCreators(data?.value || []);
}

async function saveStudioCreators(emails) {
  if (usesDatabase() && !isCreator()) {
    throw new Error("Seul un créateur peut modifier les comptes créateur.");
  }
  const normalized = normalizeStudioCreators(emails);
  if (!usesDatabase()) {
    saveStore("studioCreators", normalized);
    appData.studioCreators = normalized;
    return;
  }

  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: "studio_creators", value: normalized }, { onConflict: "key" });
  if (error) throw error;
  appData.studioCreators = normalized;
}

async function loadGtaSettings() {
  const fallbackTimezone = "GMT+1";
  const fallbackHours = defaultShiftHours();
  if (!usesDatabase()) {
    appData.companyTimezone = loadStore("companyTimezone", fallbackTimezone) === "GMT" ? "GMT" : "GMT+1";
    appData.shiftHours = normalizeShiftHours(loadStore("shiftHours", fallbackHours));
    return;
  }

  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("key, value")
    .in("key", ["company_timezone", "gta_shifts"]);

  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("app_settings")) {
      appData.companyTimezone = fallbackTimezone;
      appData.shiftHours = fallbackHours;
    return;
  }
    throw error;
  }

  const rows = data || [];
  const timezoneRow = rows.find((row) => row.key === "company_timezone");
  const shiftsRow = rows.find((row) => row.key === "gta_shifts");
  const timezoneValue = typeof timezoneRow?.value === "string"
    ? timezoneRow.value
    : timezoneRow?.value?.id || timezoneRow?.value?.timezone;
  appData.companyTimezone = timezoneValue === "GMT" ? "GMT" : "GMT+1";
  appData.shiftHours = normalizeShiftHours(shiftsRow?.value);
}

async function saveGtaSettings({ timezone, shiftHours }) {
  if (!isAdmin()) {
    throw new Error("Seul un administrateur peut modifier le paramétrage GTA.");
  }
  const nextTimezone = timezone === "GMT" ? "GMT" : "GMT+1";
  const nextHours = normalizeShiftHours(shiftHours);
  if (!usesDatabase()) {
    saveStore("companyTimezone", nextTimezone);
    saveStore("shiftHours", nextHours);
    appData.companyTimezone = nextTimezone;
    appData.shiftHours = nextHours;
    return;
  }

  const { error: timezoneError } = await supabaseClient
    .from("app_settings")
    .upsert({ key: "company_timezone", value: nextTimezone }, { onConflict: "key" });
  if (timezoneError) throw timezoneError;
  const { error: hoursError } = await supabaseClient
    .from("app_settings")
    .upsert({ key: "gta_shifts", value: nextHours }, { onConflict: "key" });
  if (hoursError) throw hoursError;
  appData.companyTimezone = nextTimezone;
  appData.shiftHours = nextHours;
}

function ensureAccessiblePage() {
  if (canAccessPage(currentPage)) return true;
  const fallbackPage = getFirstAccessiblePage();
  if (mpaMode) {
    window.location.replace(`${fallbackPage}.html`);
    return false;
  }
  currentPage = fallbackPage;
  return true;
}

function hasDirectReports() {
  return appData.orgProfiles.some((profile) => profile.manager_id === session?.user?.id);
}

function canViewJournal() {
  return Boolean(session?.user) && isNavPageVisible("journal");
}

function canViewTeamPunches() {
  return isNavPageVisible("team-punches")
    && (demoMode || usesDatabase())
    && (hasOrgWideAccess() || hasDirectReports());
}

function canViewGlobal() {
  return isNavPageVisible("global")
    && (demoMode || usesDatabase())
    && (hasOrgWideAccess() || hasDirectReports());
}

function canViewReports() {
  return Boolean(session?.user) && isNavPageVisible("reports");
}

function canViewPlanning() {
  return Boolean(session?.user) && isNavPageVisible("planning");
}

function canImportPlanning() {
  const role = String(appData.profile?.role || "").toLowerCase();
  return role === "admin" || role === "creator" || role === "rh" || role === "manager";
}

function canViewPrivacy() {
  return Boolean(session?.user) && !demoMode;
}

function canAccessPage(pageId) {
  if (pageId === "privacy") return canViewPrivacy();
  if (pageId === "creator") return isCreator();
  if (pageId === "admin") return isAdmin() && isNavPageVisible("admin");
  if (pageId === "global") return canViewGlobal();
  if (pageId === "team-punches") return canViewTeamPunches();
  if (pageId === "reports") return canViewReports();
  if (pageId === "journal") return canViewJournal();
  if (pageId === "planning") return canViewPlanning();
  return Boolean(pages[pageId]) && isNavPageVisible(pageId);
}

function getFirstAccessiblePage() {
  const preferredOrder = [
    "home",
    "pointeuse",
    "events",
    "leave",
    "attestations",
    "planning",
    "hierarchy",
    "global",
    "team-punches",
    "reports",
    "journal",
    "privacy",
    "admin",
    "creator"
  ];
  return preferredOrder.find((pageId) => canAccessPage(pageId)) || "home";
}

function canViewTeamLeaveCalendar() {
  return usesDatabase() && (hasOrgWideAccess() || hasDirectReports());
}

function getDirectReportProfiles() {
  return appData.orgProfiles.filter((profile) => profile.manager_id === session?.user?.id);
}

function getTeamPunchScope() {
  if (!hasOrgWideAccess()) return "team";
  return teamPunchFilters.scope === "team" ? "team" : "all";
}

function getTeamPunchProfiles(scope = getTeamPunchScope()) {
  const profiles = scope === "team"
    ? getDirectReportProfiles()
    : appData.orgProfiles;
  return [...profiles].sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "fr"));
}

function getDefaultTeamPunchRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: toDateKey(start),
    end: toDateKey(end)
  };
}

function profileById(profileId) {
  return appData.orgProfiles.find((profile) => profile.id === profileId);
}

function getManagerNameForProfile(userId) {
  const profile = profileById(userId);
  if (!profile?.manager_id) return "";
  return profileById(profile.manager_id)?.full_name || "";
}

function getProfileMatricule(userId) {
  const matricule = profileById(userId)?.matricule;
  return matricule == null ? "" : String(matricule);
}

function getTeamDayWorkLocation(userId, dayKey) {
  if (!userId || !dayKey || !appData.teamPunches?.length) return null;

  const rows = appData.teamPunches
    .filter((row) => row.user_id === userId && row.punch_type === "in")
    .filter((row) => toDateKey(new Date(row.punched_at)) === dayKey)
    .sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));

  for (const row of rows) {
    if (row.work_location) return row.work_location;
  }
  return null;
}

function resolveDailyRowWorkLocation(row) {
  if (row.workLocation) return row.workLocation;
  const fromPunches = getDayWorkLocation(row.punches || []);
  if (fromPunches) return fromPunches;
  return getTeamDayWorkLocation(row.userId, row.dayKey);
}

function resolveWorkLocationLabel(row) {
  return workLocationLabel(resolveDailyRowWorkLocation(row));
}

function isMissingColumnError(error) {
  const message = (error?.message || error?.details || "").toLowerCase();
  return message.includes("does not exist")
    || message.includes("schema cache")
    || message.includes("could not find the")
    || (message.includes("column") && message.includes("time_punches"));
}

function isMissingWorkLocationColumnError(error) {
  const message = (error?.message || "").toLowerCase();
  return message.includes("work_location") && isMissingColumnError(error);
}

function isMissingJournalColumnError(error) {
  const message = (error?.message || error?.details || "").toLowerCase();
  return JOURNAL_META_FIELDS.some((field) => message.includes(field));
}

function stripJournalMetaFields(payload) {
  const next = { ...payload };
  JOURNAL_META_FIELDS.forEach((field) => {
    delete next[field];
  });
  return next;
}

function optionalPunchFields() {
  return ["work_location", "work_status", ...JOURNAL_META_FIELDS];
}

function stripOptionalPunchFields(payload) {
  return stripFields(payload, optionalPunchFields());
}

function disableOptionalPunchField(field) {
  if (field === "work_location") workLocationColumnEnabled = false;
  if (field === "work_status") workStatusColumnEnabled = false;
  if (JOURNAL_META_FIELDS.includes(field)) {
    journalMetaColumnsEnabled = false;
    appData.journalMetaMissing = true;
  }
}

function preparePunchPayload(payload) {
  let next = { ...payload };
  if (!journalMetaColumnsEnabled) next = stripJournalMetaFields(next);
  if (!workLocationColumnEnabled) delete next.work_location;
  if (!workStatusColumnEnabled) delete next.work_status;
  return next;
}

function corePunchPayload(payload) {
  return {
    user_id: payload.user_id,
    punch_type: payload.punch_type,
    punched_at: payload.punched_at
  };
}

async function insertTimePunch(payload) {
  const full = preparePunchPayload(payload);
  const attempts = [full, stripOptionalPunchFields(full), corePunchPayload(payload)];
  const seen = new Set();
  let lastError = null;

  for (const attempt of attempts) {
    const key = JSON.stringify(attempt);
    if (seen.has(key)) continue;
    seen.add(key);

    const { error } = await supabaseClient.from("time_punches").insert(attempt);
    if (!error) {
      optionalPunchFields().forEach((field) => {
        if (full[field] !== undefined && attempt[field] === undefined) {
          disableOptionalPunchField(field);
        }
      });
      return;
    }

    lastError = error;
    const message = (error?.message || error?.details || error?.code || "").toLowerCase();
    const schemaIssue = isMissingColumnError(error)
      || optionalPunchFields().some((field) => message.includes(field))
      || message.includes("pgrst")
      || message.includes("42703");
    if (!schemaIssue) throw error;
  }

  throw lastError;
}

const LEAVE_GTA_FIELDS = ["unit", "half_day", "hours", "motif", "attachment_name", "workflow_step"];
const PROFILE_GTA_FIELDS = ["hired_at", "shift_code", "leave_grade", "holiday_calendar"];
const PROFILE_DIRECTORY_FIELDS = [
  "id",
  "email",
  "full_name",
  "job_title",
  "department",
  "role",
  "manager_id",
  "shift_code",
  "leave_grade",
  "holiday_calendar",
  "matricule",
  "hired_at"
];
const PROFILE_ADMIN_FIELDS = [
  ...PROFILE_DIRECTORY_FIELDS,
  "phone",
  "avatar_url",
  "created_at",
  "updated_at",
  "leave_balance_cp",
  "leave_balance_rtt",
  "leave_balance_recup"
];
const HR_DOCUMENT_OPTIONAL_FIELDS = ["visibility"];
const GTA_KINDS = {
  corrections: { store: "punchCorrections", table: "punch_corrections" },
  overtime: { store: "overtimeRequests", table: "overtime_requests" },
  activity: { store: "activityEntries", table: "activity_entries" },
  delayReviews: { store: "delayReviews", table: "delay_reviews" }
};

function isMissingDbObjectError(error) {
  const message = (error?.message || error?.details || "").toLowerCase();
  return message.includes("does not exist")
    || message.includes("schema cache")
    || message.includes("could not find the table")
    || (message.includes("could not find the") && message.includes("column"));
}

function errorMentionsAny(error, fields) {
  const message = (error?.message || error?.details || "").toLowerCase();
  return fields.some((field) => message.includes(String(field).toLowerCase()));
}

function stripFields(payload, fields) {
  const next = { ...payload };
  fields.forEach((field) => {
    delete next[field];
  });
  return next;
}

async function insertLeaveRequestRow(row) {
  const { error } = await supabaseClient.from("leave_requests").insert(row);
  if (!error) return;
  if (errorMentionsAny(error, LEAVE_GTA_FIELDS)) {
    const retry = await supabaseClient.from("leave_requests").insert(stripFields(row, LEAVE_GTA_FIELDS));
    if (!retry.error) return;
    throw retry.error;
  }
  throw error;
}

async function insertPunchCorrectionRow(row) {
  const { error } = await supabaseClient.from("punch_corrections").insert(row);
  if (!error) return;
  if (errorMentionsAny(error, PUNCH_CORRECTION_FIELDS)) {
    const retry = await supabaseClient.from("punch_corrections").insert(stripFields(row, PUNCH_CORRECTION_FIELDS));
    if (!retry.error) return;
    throw retry.error;
  }
  throw error;
}

async function updateWithOptionalFields(table, payload, matchColumn, matchValue, optionalFields) {
  const { error } = await supabaseClient.from(table).update(payload).eq(matchColumn, matchValue);
  if (!error) return;
  if (errorMentionsAny(error, optionalFields)) {
    const retry = await supabaseClient.from(table).update(stripFields(payload, optionalFields)).eq(matchColumn, matchValue);
    if (!retry.error) return;
    throw retry.error;
  }
  throw error;
}

function gtaItemUserId(item) {
  return item?.userId || item?.user_id || "";
}

function gtaItemDate(item) {
  return item?.date || item?.punch_date || item?.work_date || "";
}

function gtaItemCreated(item) {
  return item?.created || item?.created_at || "";
}

function canManageGtaItem(item) {
  const userId = gtaItemUserId(item);
  if (!userId) return false;
  if (userId === session?.user?.id && !isAdmin()) return false;
  if (hasOrgWideAccess()) return true;
  return getDirectReportProfiles().some((profile) => profile.id === userId);
}

function pendingGtaItems(list) {
  return (list || []).filter((item) => String(item.status || "").toLowerCase().includes("valider"));
}

function normalizeTeamPunchRow(row) {
  const profile = row.profiles || profileById(row.user_id);
  const time = row.punched_at || row.time;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.punch_type || row.type,
    time,
    punchDate: row.punch_date ? String(row.punch_date).slice(0, 10) : (time ? companyDateKey(time) : ""),
    workLocation: row.work_location || row.workLocation || null,
    workStatus: row.work_status || row.workStatus || null,
    name: profile?.full_name || "Collaborateur",
    email: profile?.email || ""
  };
}

function fromCompanyCivil(year, month, day, hours, minutes, seconds = 0) {
  const utc = Date.UTC(year, month, day, hours, minutes, seconds);
  return new Date(utc - getCompanyOffsetMinutes() * 60000);
}

function companyDateTimeIso(dayKey, hhmm) {
  const [year, month, day] = String(dayKey || "").split("-").map(Number);
  const [hours, minutes] = String(hhmm || "").split(":").map(Number);
  if (![year, month, day, hours, minutes].every((value) => Number.isFinite(value))) return "";
  return fromCompanyCivil(year, month - 1, day, hours, minutes, 0).toISOString();
}

function companyDayUtcRange(dayKey) {
  const [year, month, day] = String(dayKey || "").split("-").map(Number);
  if (![year, month, day].every((value) => Number.isFinite(value))) return null;
  return {
    start: fromCompanyCivil(year, month - 1, day, 0, 0, 0).toISOString(),
    end: fromCompanyCivil(year, month - 1, day, 23, 59, 59).toISOString()
  };
}

function parseHhmm(value) {
  const match = String(value || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function hhmmToMinutes(value) {
  const hhmm = parseHhmm(value);
  if (!hhmm) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function canRectifyCollaboratorPunches(userId) {
  if (!userId) return false;
  if (!canViewTeamPunches() && !isAdmin()) return false;
  return canManageGtaItem({ user_id: userId });
}

function getDelayReviews() {
  if (usesDatabase()) return appData.delayReviews || [];
  return loadStore("delayReviews", []);
}

function delayReviewUserId(row) {
  return row?.user_id || row?.userId || "";
}

function delayReviewDate(row) {
  return String(row?.work_date || row?.workDate || row?.date || "").slice(0, 10);
}

function delayReviewRecord(userId, dayKey) {
  const dateKey = String(dayKey || "").slice(0, 10);
  return getDelayReviews().find((row) => delayReviewUserId(row) === userId && delayReviewDate(row) === dateKey) || null;
}

function pendingDelayItems(dailyRows) {
  return (dailyRows || []).reduce((list, row) => {
    if (!canRectifyCollaboratorPunches(row.userId)) return list;
    if (delayReviewRecord(row.userId, row.dayKey)) return list;
    const profile = profileById(row.userId) || { full_name: row.name, id: row.userId };
    const stats = analyzeWorkedDay(row, profile);
    if (!stats.delayMin) return list;
    list.push({ row, profile, stats });
    return list;
  }, []);
}

function countPendingDelays() {
  if (!canViewTeamPunches()) return 0;
  const range = teamPunchFilters.start && teamPunchFilters.end
    ? teamPunchFilters
    : getDefaultTeamPunchRange();
  const dailyRows = summarizeTeamPunchesByDay(appData.teamPunches || [], range.start, range.end);
  return pendingDelayItems(dailyRows).length;
}

function formatDelayCell(userId, dayKey, delayMin, canManage) {
  if (!delayMin) return "—";
  const review = delayReviewRecord(userId, dayKey);
  const minutes = `${delayMin} min`;
  if (review) return `${minutes} ${badge(review.status)}`;
  if (canManage) return `${minutes} ${badge("A valider")}`;
  return minutes;
}

async function upsertDelayReview({ userId, dayKey, delayMin, status }) {
  if (!canRectifyCollaboratorPunches(userId)) {
    throw new Error("Seul le manager, RH ou la Direction peut traiter le retard d'un collaborateur.");
  }
  const nextStatus = status === "Rectifie" ? "Rectifie" : "Confirme";
  const minutes = Math.max(0, Math.min(1440, Math.round(Number(delayMin) || 0)));
  const payload = {
    user_id: userId,
    work_date: dayKey,
    delay_min: minutes,
    status: nextStatus,
    reviewed_by: session?.user?.id || null,
    reviewed_at: new Date().toISOString()
  };
  if (usesDatabase()) {
    const { error } = await supabaseClient.from("delay_reviews").upsert(payload, { onConflict: "user_id,work_date" });
    if (error) {
      if (isMissingDbObjectError(error)) {
        throw new Error("La revue des retards n'est pas encore déployée. Relancez les migrations, puis réessayez.");
      }
      throw error;
    }
    const rows = [...getDelayReviews().filter((row) => !(delayReviewUserId(row) === userId && delayReviewDate(row) === dayKey)), payload];
    appData.delayReviews = rows;
    return;
  }
  const rows = loadStore("delayReviews", []);
  const next = {
    id: `${userId}-${dayKey}`,
    userId,
    workDate: dayKey,
    delayMin: minutes,
    status: nextStatus,
    reviewedBy: session?.user?.id,
    reviewedByName: getUserName(),
    reviewedAt: payload.reviewed_at
  };
  const index = rows.findIndex((row) => delayReviewUserId(row) === userId && delayReviewDate(row) === dayKey);
  if (index >= 0) rows[index] = { ...rows[index], ...next };
  else rows.unshift(next);
  saveStore("delayReviews", rows);
  appData.delayReviews = rows;
}

function renderPendingDelayInbox(dailyRows) {
  const pending = pendingDelayItems(dailyRows);
  const page = paginateList("delay-inbox", pending);
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar">
        <h3>Retards à valider</h3>
        <span class="hierarchy-result-count">${pending.length} retard${pending.length > 1 ? "s" : ""}</span>
      </div>
      <p class="hierarchy-meta">Validez le retard, rectifiez l'heure d'arrivée, ou ne faites rien : sans action, le retard reste compté dans EDS.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Collaborateur</th>
              <th>Date</th>
              <th>Arrivée</th>
              <th>Heure max</th>
              <th>Retard</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${page.items.length
              ? page.items.map(({ row, stats }) => `
                <tr>
                  <td><strong>${escapeHtml(row.name)}</strong></td>
                  <td>${formatDate(row.dayKey)}</td>
                  <td>${row.startTime ? formatTime(row.startTime) : "—"}</td>
                  <td>${escapeHtml(String(stats.shift?.lateAfter || "").replace(":", "h") || "—")}</td>
                  <td><strong>${stats.delayMin} min</strong></td>
                  <td>${badge("A valider")}</td>
                  <td class="delay-review-actions">
                    <button type="button" class="primary" data-delay-confirm data-user-id="${escapeHtml(row.userId)}" data-day-key="${escapeHtml(row.dayKey)}" data-delay-min="${stats.delayMin}">Valider</button>
                    <button type="button" class="outline-button punch-rectify-btn" data-punch-rectify data-user-id="${escapeHtml(row.userId)}" data-day-key="${escapeHtml(row.dayKey)}">Rectifier</button>
                  </td>
                </tr>`).join("")
              : `<tr><td colspan="7" class="empty-cell">Aucun retard à valider sur cette période.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
}

function sanitizePunchReason(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

function pickPunchOfKind(rows, kind) {
  const matches = (rows || []).filter((row) => {
    const type = row.punch_type || row.type;
    return type === kind;
  }).sort((a, b) => new Date(a.punched_at || a.time) - new Date(b.punched_at || b.time));
  if (!matches.length) return null;
  return kind === "out" ? matches[matches.length - 1] : matches[0];
}

function currentPunchTimesForDay(rows) {
  const times = {};
  PUNCH_KIND_OPTIONS.forEach(({ value }) => {
    const punch = pickPunchOfKind(rows, value);
    times[value] = punch ? formatTime(punch.punched_at || punch.time) : "";
  });
  return times;
}

function assertPunchTimesOrder(times) {
  const sequence = ["in", "break_start", "break_end", "out"]
    .map((kind) => ({ kind, minutes: hhmmToMinutes(times[kind]) }))
    .filter((item) => item.minutes != null);
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index].minutes < sequence[index - 1].minutes) {
      throw new Error("Les heures doivent se suivre : entrée, pause, reprise, puis sortie.");
    }
  }
}

async function loadPunchesForUserDay(userId, dayKey) {
  if (!usesDatabase()) {
    return (appData.teamPunches || []).filter((row) => {
      const normalized = normalizeTeamPunchRow(row);
      return normalized.userId === userId && normalized.punchDate === dayKey;
    });
  }
  const range = companyDayUtcRange(dayKey);
  if (!range) return [];
  const { data, error } = await supabaseClient
    .from("time_punches")
    .select("*")
    .eq("user_id", userId)
    .gte("punched_at", range.start)
    .lte("punched_at", range.end)
    .order("punched_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function upsertPunchAt(userId, dayKey, kind, hhmm, existingRows = []) {
  if (!PUNCH_KIND_OPTIONS.some((item) => item.value === kind)) {
    throw new Error("Type de pointage invalide.");
  }
  const time = parseHhmm(hhmm);
  if (!time) return null;
  const punchedAt = companyDateTimeIso(dayKey, time);
  if (!punchedAt) throw new Error("Heure invalide.");
  const current = pickPunchOfKind(existingRows, kind);
  if (usesDatabase()) {
    if (current?.id) {
      const { error } = await supabaseClient
        .from("time_punches")
        .update({ punched_at: punchedAt })
        .eq("id", current.id);
      if (error) throw error;
      return { id: current.id, action: "update" };
    }
    await insertTimePunch({
      user_id: userId,
      punch_type: kind,
      punched_at: punchedAt
    });
    return { action: "insert" };
  }
  const punches = appData.teamPunches || [];
  if (current) {
    current.punched_at = punchedAt;
    current.punch_type = kind;
  } else {
    const profile = profileById(userId);
    punches.push({
      id: `demo-${userId}-${kind}-${dayKey}`,
      user_id: userId,
      punch_type: kind,
      punched_at: punchedAt,
      punch_date: dayKey,
      profiles: { full_name: profile?.full_name, email: profile?.email }
    });
    appData.teamPunches = punches;
  }
  return { action: current ? "update" : "insert" };
}

async function recordPunchRectification({ userId, dayKey, kind, time, reason }) {
  const payload = {
    user_id: userId,
    punch_date: dayKey,
    requested_time: time,
    punch_kind: kind,
    reason,
    status: "Approuve",
    reviewed_by: session?.user?.id || null,
    reviewed_at: new Date().toISOString()
  };
  if (usesDatabase()) {
    await insertPunchCorrectionRow(payload);
    return;
  }
  const rows = getPunchCorrections();
  rows.unshift({
    id: Date.now(),
    userId,
    date: dayKey,
    time,
    punchKind: kind,
    reason,
    status: "Approuve",
    reviewedBy: session?.user?.id,
    reviewedByName: getUserName(),
    created: new Date().toISOString()
  });
  saveGtaStore("punchCorrections", rows);
}

async function applyApprovedPunchCorrection(item) {
  const userId = gtaItemUserId(item);
  const dayKey = gtaItemDate(item);
  const kind = item.punch_kind || item.punchKind || "in";
  const time = parseHhmm(item.time || item.requested_time);
  if (!userId || !dayKey || !time) return;
  if (!canRectifyCollaboratorPunches(userId) && !isAdmin()) {
    throw new Error("Vous ne pouvez pas rectifier ce pointage.");
  }
  const existing = await loadPunchesForUserDay(userId, dayKey);
  await upsertPunchAt(userId, dayKey, kind, time, existing);
}

async function rectifyCollaboratorPunchDay({ userId, dayKey, times, reason }) {
  if (!canRectifyCollaboratorPunches(userId)) {
    throw new Error("Seul le manager, HR ou la Direction peut rectifier le pointage d'un collaborateur.");
  }
  const motif = sanitizePunchReason(reason);
  if (motif.length < 4) throw new Error("Indiquez un motif (au moins 4 caractères).");
  const existing = await loadPunchesForUserDay(userId, dayKey);
  const currentTimes = currentPunchTimesForDay(existing);
  const nextTimes = { ...currentTimes };
  const changed = [];
  PUNCH_KIND_OPTIONS.forEach(({ value }) => {
    const next = parseHhmm(times[value]);
    if (!next) return;
    nextTimes[value] = next;
    if (next !== currentTimes[value]) changed.push({ kind: value, time: next });
  });
  if (!changed.length) throw new Error("Aucune heure n'a été modifiée.");
  assertPunchTimesOrder(nextTimes);
  for (const item of changed) {
    const rows = await loadPunchesForUserDay(userId, dayKey);
    await upsertPunchAt(userId, dayKey, item.kind, item.time, rows);
    await recordPunchRectification({
      userId,
      dayKey,
      kind: item.kind,
      time: item.time,
      reason: motif
    });
  }
  const refreshed = await loadPunchesForUserDay(userId, dayKey);
  const punches = refreshed.map((row) => ({
    type: row.punch_type || row.type,
    time: row.punched_at || row.time,
    workLocation: row.work_location || row.workLocation || null
  }));
  const summary = getDayShiftSummaryFromPunches(punches);
  const profile = profileById(userId);
  const stats = analyzeWorkedDay({
    ...summary,
    userId,
    dayKey,
    punches
  }, profile);
  try {
    await upsertDelayReview({
      userId,
      dayKey,
      delayMin: stats.delayMin,
      status: "Rectifie"
    });
  } catch (error) {
    if (!isMissingDbObjectError(error) && !String(error.message || "").includes("n'est pas encore déployée")) {
      throw error;
    }
  }
}

function closePunchRectifyDialog() {
  document.removeEventListener("keydown", onPunchRectifyKeydown);
  document.getElementById("punch-rectify-overlay")?.remove();
}

function onPunchRectifyKeydown(event) {
  if (event.key === "Escape") closePunchRectifyDialog();
}

function openPunchRectifyDialog(userId, dayKey) {
  if (!canRectifyCollaboratorPunches(userId)) return;
  closePunchRectifyDialog();
  const profile = profileById(userId);
  const rows = (appData.teamPunches || []).filter((row) => {
    const normalized = normalizeTeamPunchRow(row);
    return normalized.userId === userId && normalized.punchDate === dayKey;
  });
  const times = currentPunchTimesForDay(rows);
  const overlay = document.createElement("div");
  overlay.id = "punch-rectify-overlay";
  overlay.className = "punch-rectify-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "punch-rectify-title");
  overlay.innerHTML = `
    <form id="punch-rectify-form" class="punch-rectify-card">
      <h3 id="punch-rectify-title">Rectifier les horaires</h3>
      <p class="hierarchy-meta">${escapeHtml(profile?.full_name || "Collaborateur")} · ${escapeHtml(formatDate(dayKey))}</p>
      <p class="data-note">Utilisez cette correction lorsque le retard affiché n'est pas réel (oubli de badge, pause non pointée, heure erronée). Les heures EDS / retards sont recalculées.</p>
      <div class="form-row">
        <label>Entrée <input type="time" name="in" value="${escapeHtml(times.in)}"></label>
        <label>Sortie <input type="time" name="out" value="${escapeHtml(times.out)}"></label>
      </div>
      <div class="form-row">
        <label>Début pause <input type="time" name="break_start" value="${escapeHtml(times.break_start)}"></label>
        <label>Fin pause <input type="time" name="break_end" value="${escapeHtml(times.break_end)}"></label>
      </div>
      <label class="popup-comment-field">
        Commentaire
        <textarea name="reason" rows="6" required minlength="4" maxlength="400" placeholder="Ex. : arrivée à l'heure, oubli de pointer"></textarea>
      </label>
      <input type="hidden" name="userId" value="${escapeHtml(userId)}">
      <input type="hidden" name="dayKey" value="${escapeHtml(dayKey)}">
      <div class="punch-rectify-actions">
        <button type="button" class="outline-button" data-punch-rectify-close>Annuler</button>
        <button type="submit" class="primary">Enregistrer</button>
      </div>
    </form>`;
  const close = () => closePunchRectifyDialog();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-punch-rectify-close]")?.addEventListener("click", close);
  overlay.querySelector("#punch-rectify-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const targetUserId = String(data.get("userId") || "");
    const targetDay = String(data.get("dayKey") || "");
    withAction(async () => {
      await rectifyCollaboratorPunchDay({
        userId: targetUserId,
        dayKey: targetDay,
        times: {
          in: data.get("in"),
          out: data.get("out"),
          break_start: data.get("break_start"),
          break_end: data.get("break_end")
        },
        reason: data.get("reason")
      });
      closePunchRectifyDialog();
      if (usesDatabase()) {
        dataStamp.teamPunches = 0;
        dataStamp.gta = 0;
      }
    });
  });
  document.body.appendChild(overlay);
  overlay.querySelector("textarea[name='reason']")?.focus();
  document.addEventListener("keydown", onPunchRectifyKeydown);
}

function computeWorkedMsInRange(punches, startStr, endStr) {
  const rangeStart = new Date(`${startStr}T00:00:00`).getTime();
  const rangeEnd = new Date(`${endStr}T23:59:59`).getTime();
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  let total = 0;
  let workStart = null;

  const now = Date.now();
  sorted.forEach((punch) => {
    const time = punchTimeMs(punch);
    if (!Number.isFinite(time) || time > now + PUNCH_FUTURE_SLACK_MS) return;
    if (punch.type === "in" || punch.type === "break_end") {
      workStart = time;
      return;
    }
    if (punch.type === "break_start" && workStart !== null) {
      const sessionStart = Math.max(workStart, rangeStart);
      const sessionEnd = Math.min(time, rangeEnd, now);
      if (sessionEnd > sessionStart) total += sessionEnd - sessionStart;
      workStart = null;
      return;
    }
    if (punch.type === "out" && workStart !== null) {
      const sessionStart = Math.max(workStart, rangeStart);
      const sessionEnd = Math.min(time, rangeEnd, now);
      if (sessionEnd > sessionStart) total += sessionEnd - sessionStart;
      workStart = null;
    }
  });

  if (workStart !== null) {
    const sessionStart = Math.max(workStart, rangeStart);
    const sessionEnd = Math.min(Date.now(), rangeEnd);
    if (sessionEnd > sessionStart) total += sessionEnd - sessionStart;
  }

  return total;
}

function summarizeTeamPunchesByUser(punches, profiles, startStr, endStr) {
  const byUser = new Map();
  punches.forEach((row) => {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push({ type: row.punch_type, time: row.punched_at });
  });

  return profiles.map((profile) => {
    const userPunches = byUser.get(profile.id) || [];
    return {
      profile,
      punchCount: userPunches.length,
      workedMs: computeWorkedMsInRange(userPunches, startStr, endStr)
    };
  });
}

function getDayShiftSummaryFromPunches(punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const startPunch = sorted.find((punch) => punch.type === "in");
  const endPunch = [...sorted].reverse().find((punch) => punch.type === "out");
  const lastPunch = sorted[sorted.length - 1];
  const dayKey = sorted.length ? toDateKey(new Date(sorted[0].time)) : "";
  const isToday = sorted.length
    && new Date(sorted[0].time).toDateString() === new Date().toDateString();

  return {
    startTime: startPunch?.time || null,
    endTime: endPunch?.time || null,
    breakDurationMs: computeBreakDuration(sorted),
    workedMs: dayKey ? computeWorkedMsInRange(sorted, dayKey, dayKey) : 0,
    workLocation: getDayWorkLocation(sorted),
    isDayClosed: lastPunch?.type === "out",
    hasStarted: Boolean(startPunch),
    isToday
  };
}

function formatDayEndTime(summary) {
  if (summary.endTime) return formatTime(summary.endTime);
  if (summary.hasStarted && !summary.isDayClosed) return "En cours";
  return "—";
}

function summarizeTeamPunchesByDay(teamPunchesRows, startStr, endStr) {
  const byUserDay = new Map();

  teamPunchesRows.forEach((row) => {
    const normalized = normalizeTeamPunchRow(row);
    const dayKey = normalized.punchDate || companyDateKey(normalized.time);
    if (!dayKey || dayKey < startStr || dayKey > endStr) return;

    const mapKey = `${normalized.userId}|${dayKey}`;
    if (!byUserDay.has(mapKey)) {
      byUserDay.set(mapKey, {
        userId: normalized.userId,
        name: normalized.name,
        email: normalized.email,
        dayKey,
        punches: []
      });
    }
    byUserDay.get(mapKey).punches.push({
      id: normalized.id,
      type: normalized.type,
      time: normalized.time,
      workLocation: normalized.workLocation,
      workStatus: normalized.workStatus
    });
  });

  return [...byUserDay.values()]
    .map((entry) => {
      const summary = getDayShiftSummaryFromPunches(entry.punches);
      const workLocation = summary.workLocation
        || getDayWorkLocation(entry.punches)
        || getTeamDayWorkLocation(entry.userId, entry.dayKey);
      return {
        ...entry,
        ...summary,
        workLocation,
        matricule: getProfileMatricule(entry.userId),
        managerName: getManagerNameForProfile(entry.userId)
      };
    })
    .sort((a, b) => {
      const dayCmp = b.dayKey.localeCompare(a.dayKey);
      if (dayCmp !== 0) return dayCmp;
      return (a.name || "").localeCompare(b.name || "", "fr");
    });
}

function downloadCsv(filename, headers, rows) {
  const sep = ";";
  const CSV_FORMULA_TRIGGERS = /^[=+\-@\t\r]/;
  const escapeCell = (value) => {
    let text = String(value ?? "");
    if (CSV_FORMULA_TRIGGERS.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.map(escapeCell).join(sep),
    ...rows.map((row) => row.map(escapeCell).join(sep))
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportTeamPunchesCsv() {
  const range = teamPunchFilters.start && teamPunchFilters.end
    ? teamPunchFilters
    : getDefaultTeamPunchRange();
  const dailyRows = summarizeTeamPunchesByDay(appData.teamPunches, range.start, range.end);
  if (!dailyRows.length) {
    alert("Aucun pointage à exporter pour cette période.");
    return;
  }

  if (getTeamPunchDetailView() === "status") {
    downloadCsv(
      `statuts-equipe_${range.start}_${range.end}.csv`,
      ["Matricule", "Nom", "E-mail", "Date", ...WORK_STATUSES.map((status) => status.label), "Pause déjeuner", "Durée totale"],
      dailyRows.map((row) => {
        const durations = computeDayStatusDurations(row.punches, row.dayKey);
        return [
          row.matricule,
          row.name,
          row.email,
          formatDate(row.dayKey),
          ...WORK_STATUSES.map((status) => formatDuration(durations[status.value] || 0)),
          formatDuration(durations.lunch || 0),
          formatDuration(totalStatusDurationMs(durations))
        ];
      })
    );
    return;
  }

  downloadCsv(
    `pointages-equipe_${range.start}_${range.end}.csv`,
    ["Matricule", "Nom", "E-mail", "Manager", "Date", "Lieu", "Début", "Fin", "Pause déjeuner", "Planifié", "Réalisé", "Retard (min)", "Manquant", "HS payables", "Journal du service", "Heure rectifiée", "Modifié par", "Motif"],
    dailyRows.map((row) => {
      const stats = analyzeWorkedDay(row, profileById(row.userId) || {});
      const correction = formatDayCorrectionSummary(row.userId, row.dayKey);
      return [
        row.matricule,
        row.name,
        row.email,
        row.managerName,
        formatDate(row.dayKey),
        resolveWorkLocationLabel(row),
        row.startTime ? formatTime(row.startTime) : "",
        row.endTime ? formatTime(row.endTime) : (row.hasStarted && !row.isDayClosed ? "En cours" : ""),
        formatDuration(row.breakDurationMs),
        formatDuration(stats.plannedMs),
        formatDuration(stats.realizedMs),
        stats.delayMin,
        formatDuration(stats.missingMs),
        formatDuration(stats.payableOtMs),
        formatDayPunchLogText(row),
        correction.rectified,
        correction.who,
        correction.motif
      ];
    })
  );
}

async function loadTeamPunches(filters = teamPunchFilters) {
  if (!canViewTeamPunches()) {
    appData.teamPunches = [];
    return [];
  }

  const scope = filters.scope === "team" ? "team" : (isAdmin() ? "all" : "team");
  const profiles = getTeamPunchProfiles(scope);
  const userIds = filters.userId
    ? [filters.userId]
    : profiles.map((profile) => profile.id);

  if (!isAdmin() || scope === "team" || filters.userId) {
    if (!userIds.length) {
      appData.teamPunches = [];
      return [];
    }
  }

  const range = {
    start: filters.start || getDefaultTeamPunchRange().start,
    end: filters.end || getDefaultTeamPunchRange().end
  };
  let query = supabaseClient
    .from("time_punches")
    .select("*, profiles(full_name, email)")
    .gte("punched_at", `${range.start}T00:00:00`)
    .lte("punched_at", `${range.end}T23:59:59`)
    .order("punched_at", { ascending: false })
    .limit(TEAM_PUNCH_LIMIT);

  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  } else if (!isAdmin() || scope === "team") {
    query = query.in("user_id", userIds);
  }

  const result = await withSupabaseRetry(async () => {
    const response = await query;
    if (response.error) throw response.error;
    return response.data;
  });
  appData.teamPunches = result || [];
  return appData.teamPunches;
}

function getLeaveCalendarMonth() {
  if (!leaveCalendarMonth) {
    const now = new Date();
    leaveCalendarMonth = { year: now.getFullYear(), month: now.getMonth() };
  }
  return leaveCalendarMonth;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isLeaveStatusVisible(status) {
  const normalized = (status || "").toLowerCase();
  return !normalized.includes("refus") && !normalized.includes("rejet");
}

function normalizeTeamLeaveRequest(row) {
  return {
    id: row.id,
    userId: row.user_id || row.userId,
    type: row.leave_type || row.type,
    start: row.start_date || row.start,
    end: row.end_date || row.end,
    days: row.days,
    hours: row.hours,
    unit: row.unit,
    halfDay: row.half_day || row.halfDay || "",
    motif: row.motif,
    attachmentName: row.attachment_name || row.attachmentName,
    workflowStep: row.workflow_step || row.workflowStep || 1,
    comment: row.comment || "",
    status: row.status,
    created: row.created_at || row.created,
    name: row.profiles?.full_name || row.name || profileById(row.user_id || row.userId)?.full_name || "Collaborateur"
  };
}

function leaveQueryRange(monthRef = getLeaveCalendarMonth()) {
  if (monthRef?.start && monthRef?.end) {
    return { start: monthRef.start, end: monthRef.end };
  }
  const year = Number(monthRef?.year);
  const month = Number(monthRef?.month);
  const cursor = Number.isFinite(year) && Number.isFinite(month)
    ? { year, month }
    : getLeaveCalendarMonth();
  const monthStart = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const monthEnd = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start: monthStart, end: monthEnd };
}

async function loadTeamLeaveRequests(monthRef = getLeaveCalendarMonth()) {
  if (!canViewTeamLeaveCalendar()) {
    appData.teamLeaveRequests = [];
    return [];
  }

  const { start: monthStart, end: monthEnd } = leaveQueryRange(monthRef);

  const userIds = hasOrgWideAccess()
    ? appData.orgProfiles.map((profile) => profile.id)
    : getDirectReportProfiles().map((profile) => profile.id);

  if (!userIds.length) {
    appData.teamLeaveRequests = [];
    return [];
  }

  const result = await withSupabaseRetry(async () => {
    const fullSelect = "id, user_id, leave_type, start_date, end_date, days, hours, unit, motif, attachment_name, workflow_step, comment, status, created_at, profiles(full_name, email)";
    const baseSelect = "id, user_id, leave_type, start_date, end_date, days, comment, status, created_at, profiles(full_name, email)";
    let response = await supabaseClient
      .from("leave_requests")
      .select(fullSelect)
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart)
      .in("user_id", userIds)
      .order("start_date", { ascending: true })
      .limit(TEAM_LEAVE_LIMIT);
    if (response.error && errorMentionsAny(response.error, LEAVE_GTA_FIELDS)) {
      response = await supabaseClient
        .from("leave_requests")
        .select(baseSelect)
        .lte("start_date", monthEnd)
        .gte("end_date", monthStart)
        .in("user_id", userIds)
        .order("start_date", { ascending: true })
        .limit(TEAM_LEAVE_LIMIT);
    }
    if (response.error) throw response.error;
    return response.data;
  });

  appData.teamLeaveRequests = result || [];
  return appData.teamLeaveRequests;
}

function getCalendarLeaveRequests() {
  const own = getLeaveRequests()
    .filter((request) => isLeaveStatusVisible(request.status))
    .map((request) => ({
      ...request,
      userId: session?.user?.id,
      name: getUserName()
    }));

  if (!canViewTeamLeaveCalendar()) return own;

  const team = (appData.teamLeaveRequests || [])
    .map(normalizeTeamLeaveRequest)
    .filter((request) => isLeaveStatusVisible(request.status));

  const merged = new Map();
  [...own, ...team].forEach((request) => {
    merged.set(request.id || `${request.userId}-${request.start}-${request.end}`, request);
  });
  return [...merged.values()];
}

function isDateInLeaveRange(dayKey, start, end) {
  const dayTime = parseLocalDate(dayKey).getTime();
  return dayTime >= parseLocalDate(start).getTime() && dayTime <= parseLocalDate(end).getTime();
}

function getLeaveEventsForDay(dayKey, requests) {
  return requests.filter((request) => isDateInLeaveRange(dayKey, request.start, request.end));
}

function leaveTypeColorClass(type) {
  const key = leaveTypeKey(type);
  if (key === "recup") return "leave-type-rtt";
  if (key === "justified" || key === "maternity" || key === "paternity") return "leave-type-sick";
  if (key === "unpaid" || key === "suspension") return "leave-type-unpaid";
  if (key === "special") return "leave-type-special";
  if (key === "unjustified") return "leave-type-unjustified";
  if (key === "travel") return "leave-type-travel";
  if (key === "hours") return "leave-type-hours";
  return "leave-type-cp";
}

function buildLeaveCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const startPad = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < startPad; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function renderLeaveCalendar() {
  const { year, month } = getLeaveCalendarMonth();
  const requests = getCalendarLeaveRequests();
  const cells = buildLeaveCalendarDays(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const todayKey = toDateKey(new Date());
  const teamScope = canViewTeamLeaveCalendar();
  const teamLabel = isAdmin() ? "toute l'organisation" : "votre équipe";

  const dayCells = cells.map((date) => {
    if (!date) return `<div class="leave-cal-cell leave-cal-cell--empty" aria-hidden="true"></div>`;

    const key = toDateKey(date);
    const events = getLeaveEventsForDay(key, requests);
    const hasConflict = teamScope && events.length >= 2;
    const isToday = key === todayKey;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const isHoliday = isHolidayKey(key);

    return `
      <div class="leave-cal-cell${isToday ? " is-today" : ""}${hasConflict ? " has-conflict" : ""}${isWeekend ? " is-weekend" : ""}${isHoliday ? " is-holiday" : ""}" data-date="${key}">
        <span class="leave-cal-day">${date.getDate()}</span>
        <div class="leave-cal-events">
          ${events.slice(0, 3).map((event) => `
            <span class="leave-cal-event ${leaveTypeColorClass(event.type)}${event.status === "A valider" ? " is-pending" : ""}"
              title="${escapeHtml(event.name)} · ${escapeHtml(event.type)} · ${formatDate(event.start)} - ${formatDate(event.end)}">
              ${escapeHtml((event.name || "Congé").split(" ")[0])}
            </span>`).join("")}
          ${events.length > 3 ? `<span class="leave-cal-more">+${events.length - 3}</span>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <article class="card leave-calendar-card page-spacer">
      <div class="card-heading leave-cal-heading">
        <h3>${teamScope ? `Calendrier des congés — ${teamLabel}` : "Calendrier des congés"}</h3>
        <div class="leave-cal-nav">
          <button type="button" class="outline-button leave-cal-prev" aria-label="Mois précédent">‹</button>
          <strong class="leave-cal-month">${monthLabel}</strong>
          <button type="button" class="outline-button leave-cal-next" aria-label="Mois suivant">›</button>
          <button type="button" class="outline-button leave-cal-today">Aujourd'hui</button>
        </div>
      </div>
      ${teamScope
        ? `<p class="leave-cal-note">Les jours en surbrillance signalent plusieurs absences simultanées afin d'anticiper les conflits.</p>`
        : ""}
      <div class="leave-cal-grid" role="grid" aria-label="Calendrier des congés">
        ${weekdays.map((weekday) => `<div class="leave-cal-weekday" role="columnheader">${weekday}</div>`).join("")}
        ${dayCells}
      </div>
      <div class="leave-cal-legend">
        <span class="leave-cal-legend-item"><i class="leave-type-cp"></i> Congés payés</span>
        <span class="leave-cal-legend-item"><i class="leave-type-special"></i> Événements</span>
        <span class="leave-cal-legend-item"><i class="leave-type-rtt"></i> Récupération</span>
        <span class="leave-cal-legend-item"><i class="leave-type-sick"></i> Justifiée / familial</span>
        <span class="leave-cal-legend-item"><i class="leave-type-unpaid"></i> Sans solde / mise à pied</span>
        <span class="leave-cal-legend-item"><i class="leave-type-unjustified"></i> Injustifiée</span>
        <span class="leave-cal-legend-item leave-cal-legend-pending"><i></i> En attente</span>
        ${teamScope ? `<span class="leave-cal-legend-item leave-cal-legend-conflict"><i></i> Conflit d'équipe</span>` : ""}
        <span class="leave-cal-legend-item leave-cal-legend-holiday"><i></i> Férié (${escapeHtml(holidayCalendarLabel(getHolidayCalendar()))})</span>
      </div>
    </article>`;
}

async function reloadLeavePageContent() {
  if (currentPage !== "leave") return;
  const content = document.querySelector("#page-content");
  if (!content) return;
  content.innerHTML = pageContent();
  bindPageEvents();
}

async function shiftLeaveCalendarMonth(delta) {
  const current = getLeaveCalendarMonth();
  const next = new Date(current.year, current.month + delta, 1);
  leaveCalendarMonth = { year: next.getFullYear(), month: next.getMonth() };
  try {
    if (canViewTeamLeaveCalendar()) await loadTeamLeaveRequests(leaveCalendarMonth);
    await reloadLeavePageContent();
  } catch (error) {
    appData.error = formatAppError(error);
    renderApp();
  }
}

async function resetLeaveCalendarToToday() {
  const now = new Date();
  leaveCalendarMonth = { year: now.getFullYear(), month: now.getMonth() };
  try {
    if (canViewTeamLeaveCalendar()) await loadTeamLeaveRequests(leaveCalendarMonth);
    await reloadLeavePageContent();
  } catch (error) {
    appData.error = formatAppError(error);
    renderApp();
  }
}

function canViewHrAlerts() {
  return usesDatabase() && (hasOrgWideAccess() || hasDirectReports());
}

function countUnreadHrAlerts() {
  return (appData.hrAlerts || []).filter((alert) => !alert.read_at).length;
}

function getFirstInOfOpenSession(punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  let firstIn = null;
  sorted.forEach((punch) => {
    if (punch.type === "in") firstIn = punch;
    if (punch.type === "out") firstIn = null;
  });
  return firstIn;
}

async function processAutoClockOutForUser(userId, punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const last = sorted[sorted.length - 1];
  if (!last || last.type === "out") return false;

  const firstIn = getFirstInOfOpenSession(sorted);
  if (!firstIn) return false;

  const autoOutTime = new Date(new Date(firstIn.time).getTime() + AUTO_CLOCK_OUT_MS);
  if (Date.now() < autoOutTime.getTime()) return false;

  if (sorted.some((punch) => punch.type === "out" && new Date(punch.time) >= new Date(firstIn.time))) {
    return false;
  }

  if (last.type === "break_start") {
    const { error: breakError } = await supabaseClient.from("time_punches").insert({
      user_id: userId,
      punch_type: "break_end",
      punched_at: new Date(autoOutTime.getTime() - 1000).toISOString()
    });
    if (breakError) throw breakError;
  }

  const { error } = await supabaseClient.from("time_punches").insert({
    user_id: userId,
    punch_type: "out",
    punched_at: autoOutTime.toISOString()
  });
  if (error) throw error;

  const collaborator = profileById(userId);
  const { error: notifyError } = await supabaseClient.rpc("notify_auto_clock_out", {
    p_subject_user_id: userId,
    p_collaborator_name: collaborator?.full_name || "",
    p_auto_out_time: autoOutTime.toISOString()
  });
  if (notifyError) console.warn("notify_auto_clock_out:", notifyError.message);
  return true;
}

async function runAutoClockOutChecks() {
  if (!usesDatabase() || !session?.user?.id) return;

  let usedRpc = false;
  try {
    const { error } = await supabaseClient.rpc("process_auto_clock_outs");
    if (!error) {
      usedRpc = true;
    } else if (
      !error.message.includes("does not exist")
      && !error.message.includes("Could not find the function")
    ) {
      console.warn("process_auto_clock_outs:", error.message);
    }
  } catch (error) {
    console.warn("runAutoClockOutChecks:", error.message || error);
  }

  if (!usedRpc) {
    try {
      await processAutoClockOutForUser(session.user.id, getPunches());
    } catch (error) {
      console.warn("processAutoClockOutForUser:", error.message || error);
    }
  }

  await loadOwnPunches();
}

async function loadCompanyEvents() {
  if (!usesDatabase()) {
    appData.companyEvents = [];
    return;
  }
  const { data, error } = await supabaseClient
    .from("company_events")
    .select("*")
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) {
    const message = (error.message || "").toLowerCase();
    if (message.includes("does not exist") || message.includes("company_events") || message.includes("relation")) {
      appData.companyEvents = [];
      appData.companyEventsTableMissing = true;
      return;
    }
    console.warn("[humana] company_events load failed", error);
    appData.companyEvents = [];
    return;
  }
  appData.companyEventsTableMissing = false;
  appData.companyEvents = data || [];
}

function getCompanyEvents() {
  const events = Array.isArray(appData.companyEvents) ? appData.companyEvents : [];
  return events.filter((event) => canSeeVisibility(event.visibility));
}

function getUpcomingCompanyEvents(limit = 3) {
  const now = Date.now();
  return getCompanyEvents()
    .filter((event) => {
      const end = event.ends_at ? new Date(event.ends_at).getTime() : new Date(event.starts_at).getTime();
      return Number.isFinite(end) && end >= now;
    })
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    .slice(0, limit);
}

function eventTypeMeta(typeId) {
  return EVENT_TYPES.find((entry) => entry.id === typeId) || EVENT_TYPES[0];
}

function eventVisibilityLabel(visibilityId) {
  return (EVENT_VISIBILITIES.find((entry) => entry.id === visibilityId) || EVENT_VISIBILITIES[0]).label;
}

function formatDateTimeShort(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatEventWhen(event) {
  if (!event?.starts_at) return "";
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  if (event.all_day) {
    return end && end.toDateString() !== start.toDateString()
      ? `${formatDateOnly(start)} → ${formatDateOnly(end)} · Toute la journée`
      : `${formatDateOnly(start)} · Toute la journée`;
  }
  if (!end) return formatDateTimeShort(start);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const endTime = end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${formatDateTimeShort(start)} → ${endTime}`;
  }
  return `${formatDateTimeShort(start)} → ${formatDateTimeShort(end)}`;
}

function eventLocalDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadHrAlerts(userId) {
  const { data, error } = await supabaseClient
    .from("hr_alerts")
    .select("*")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("hr_alerts")) {
      appData.hrAlerts = [];
      return;
    }
    throw error;
  }
  appData.hrAlerts = data || [];
}

function renderHomeEventsCard() {
  const events = getUpcomingCompanyEvents(3);
  if (!events.length) return "";
  return `
    <article class="card home-widget home-events-widget">
      <div class="card-heading">
        <h3>Prochains événements</h3>
        <button type="button" class="home-link" data-goto-page="events">Tout voir</button>
      </div>
      <div class="home-event-list">
        ${events.map((event) => {
          const meta = eventTypeMeta(event.event_type);
          const posterUrl = sanitizeEventPosterUrl(event);
          const thumb = posterUrl
            ? `<span class="home-event-thumb" aria-hidden="true"><img src="${escapeHtml(posterUrl)}" alt=""></span>`
            : `<span class="home-event-icon event-type--${meta.id}" aria-hidden="true">${meta.icon}</span>`;
          return `
            <button type="button" class="home-event-item" data-goto-page="events">
              ${thumb}
              <div>
                <strong>${escapeHtml(event.title)}</strong>
                <span>${escapeHtml(formatEventWhen(event))}${event.location ? ` · ${escapeHtml(event.location)}` : ""}</span>
              </div>
            </button>`;
        }).join("")}
      </div>
    </article>`;
}

function renderHrAlertsCard() {
  if (!canViewHrAlerts()) return "";

  const alerts = appData.hrAlerts || [];
  const unread = countUnreadHrAlerts();

  return `
    <article class="card home-widget home-alerts-widget">
      <div class="card-heading">
        <h3>Alertes RH${unread ? ` <span class="nav-badge">${unread}</span>` : ""}</h3>
        <div class="hr-alert-heading-actions">
          ${unread ? `<button type="button" class="home-link" id="mark-all-alerts-read">Tout marquer lu</button>` : ""}
          ${alerts.length ? `<button type="button" class="home-link hr-alert-delete-all" id="delete-all-alerts">Tout supprimer</button>` : ""}
        </div>
      </div>
      <div class="hr-alert-list">
        ${alerts.length
          ? alerts.slice(0, 6).map((alert) => {
            const subjectName = escapeHtml(profileById(alert.subject_user_id)?.full_name || "Collaborateur");
            return `
              <div class="hr-alert-item ${alert.read_at ? "is-read" : "is-unread"}">
                <div>
                  <strong>${subjectName}</strong>
                  <p>${escapeHtml(alert.message)}</p>
                  <small>${formatDate(alert.created_at)} · ${formatTime(alert.created_at)}</small>
                </div>
                <div class="hr-alert-actions">
                  ${alert.read_at
                    ? ""
                    : `<button type="button" class="outline-button" data-alert-read="${alert.id}">Lu</button>`}
                  <button type="button" class="outline-button hr-alert-delete-btn" data-alert-delete="${alert.id}" aria-label="Supprimer l'alerte">Supprimer</button>
                </div>
              </div>`;
          }).join("")
          : `<p class="empty-state">Aucune alerte pour le moment.</p>`}
      </div>
    </article>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:") {
      return url.toString();
    }
  } catch (_) { /* fall-through */ }
  return "";
}

function getNavigationItems() {
  const items = navigation.filter(([pageId]) => isNavPageVisible(pageId));
  const pointeuseIndex = items.findIndex(([pageId]) => pageId === "pointeuse");
  if (canViewGlobal()) {
    items.splice(pointeuseIndex + 1, 0, ["global", "Global"]);
  }
  if (canViewTeamPunches()) {
    const insertAfter = items.findIndex(([pageId]) => pageId === "global");
    items.splice((insertAfter >= 0 ? insertAfter : pointeuseIndex) + 1, 0, ["team-punches", "Pointages équipe"]);
  }
  if (canViewReports()) {
    const teamIndex = items.findIndex(([pageId]) => pageId === "team-punches");
    const after = teamIndex >= 0 ? teamIndex : items.findIndex(([pageId]) => pageId === "pointeuse");
    items.splice((after >= 0 ? after : items.length - 1) + 1, 0, ["reports", "Rapports EDS"]);
  }
  if (canViewPrivacy()) {
    items.push(["privacy", "Mes données"]);
  }
  if (canViewJournal()) {
    items.push(["journal", "Journal"]);
  }
  if (isAdmin() && isNavPageVisible("admin")) {
    items.push(["admin", "Administration"]);
  }
  if (isCreator()) items.push(["creator", "Studio créateur"]);
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
  const roles = selectedRole === "creator" ? ["creator", ...ASSIGNABLE_ROLES] : ASSIGNABLE_ROLES;
  return roles.map((role) => {
    const selected = role === selectedRole ? " selected" : "";
    return `<option value="${role}"${selected}>${roleLabels[role] || role}</option>`;
  }).join("");
}

function getUserAccountEditing() {
  return {
    editingId: appData.adminEditingId || "",
    editingInviteId: appData.adminEditingInviteId || ""
  };
}

function clearUserAccountEditing() {
  appData.adminEditingId = "";
  appData.adminEditingInviteId = "";
  adminUserFormOpen = false;
}

function setUserAccountEditing({ profileId = "", inviteId = "" }) {
  appData.adminEditingId = profileId;
  appData.adminEditingInviteId = inviteId;
  adminUserFormOpen = true;
}

function getCreatorProfiles() {
  return appData.orgProfiles.filter((profile) =>
    profile.role === "creator" || isStudioCreatorEmail(profile.email)
  );
}

function getPendingCreatorInvites() {
  return appData.pendingInvites.filter((invite) =>
    invite.role === "creator" || isStudioCreatorEmail(invite.email)
  );
}

async function persistCreatorAccount({ email, fullName }) {
  if (usesDatabase() && !isCreator()) {
    throw new Error("Seul un créateur peut ajouter un compte créateur.");
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const payload = {
    full_name: fullName,
    job_title: "Administrateur",
    department: "General",
    role: "admin",
    manager_id: null,
    leave_balance_cp: 25,
    leave_balance_rtt: 8
  };

  const existing = appData.orgProfiles.find((profile) => profile.email?.toLowerCase() === normalizedEmail);
  if (existing) {
    if (existing.role === "creator" || isStudioCreatorEmail(existing.email)) {
      throw new Error("Cette personne est déjà créateur.");
    }
    if (!usesDatabase()) {
      existing.role = "admin";
    } else {
      const { error } = await supabaseClient.from("profiles").update(payload).eq("id", existing.id);
      if (error) throw error;
    }
  } else if (!usesDatabase()) {
    if (getPendingCreatorInvites().some((invite) => invite.email?.toLowerCase() === normalizedEmail)) {
      throw new Error("Une invitation créateur existe déjà pour cette adresse e-mail.");
    }
    appData.pendingInvites.push({
      email: normalizedEmail,
      ...payload,
      created_by: session.user.id
    });
  } else {
    if (getPendingCreatorInvites().some((invite) => invite.email?.toLowerCase() === normalizedEmail)) {
      throw new Error("Une invitation créateur existe déjà pour cette adresse e-mail.");
    }
    const { error } = await supabaseClient.from("pending_invites").upsert({
      email: normalizedEmail,
      ...payload,
      created_by: session.user.id
    }, { onConflict: "email" });
    if (error) throw error;
  }

  await saveStudioCreators([...getStudioCreatorEmails(), normalizedEmail]);
}

function renderCreatorAccountsSection() {
  const creators = getCreatorProfiles();
  const pendingCreators = getPendingCreatorInvites();

  return `
    <article class="card form-card page-spacer">
      ${cardHeading("Comptes créateur")}
      <p class="creator-intro">Votre compte créateur reste actif. Ajoutez ici un second accès créateur : la personne aura le rôle <strong>Administrateur</strong> et l'accès au Studio créateur.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Email</th><th>Statut</th></tr></thead>
          <tbody>
            ${creators.length
              ? creators.map((profile) => `
                <tr>
                  <td><strong>${escapeHtml(profile.full_name)}</strong>${profile.id === session.user.id ? ` <span class="creator-pill">Vous</span>` : ""}</td>
                  <td>${escapeHtml(profile.email)}</td>
                  <td>${badge("Actif")}</td>
                </tr>`).join("")
              : ""}
            ${pendingCreators.map((invite) => `
              <tr>
                <td><strong>${escapeHtml(invite.full_name || "—")}</strong></td>
                <td>${escapeHtml(invite.email)}</td>
                <td>${badge("En attente")}</td>
              </tr>`).join("")}
            ${!creators.length && !pendingCreators.length
              ? `<tr><td colspan="3" class="empty-cell">Aucun compte créateur pour le moment.</td></tr>`
              : ""}
          </tbody>
        </table>
      </div>
      <form id="creator-account-form" class="feature-form creator-account-form">
        <div class="form-row">
          <label>
            Adresse e-mail
            <input type="email" name="email" required placeholder="nouveau.createur@entreprise.fr">
          </label>
          <label>
            Nom complet
            <input type="text" name="full_name" required placeholder="Prénom Nom">
          </label>
        </div>
        <button type="submit" class="primary">Ajouter un compte créateur</button>
      </form>
      <p class="hierarchy-meta">Si la personne ne s'est jamais connectée à Daylyx, elle sera préenregistrée comme administrateur créateur. Sinon, son profil existant sera promu administrateur créateur.</p>
    </article>`;
}

function bindCreatorAccountsSection() {
  document.querySelector("#creator-account-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const fullName = String(data.get("full_name") || "").trim();

    if (!email || !fullName) {
      alert("L'e-mail et le nom complet sont obligatoires.");
      return;
    }

    if (email === session.user.email?.toLowerCase()) {
      alert("Votre compte est déjà créateur.");
      return;
    }

    withAction(async () => {
      await persistCreatorAccount({ email, fullName });
      form.reset();
      currentPage = "creator";
    });
  });
}

function parseUserAccountForm(data) {
  const requestedRole = String(data.get("role") || "employee");
  const role = ASSIGNABLE_ROLES.includes(requestedRole)
    ? requestedRole
    : "employee";
  return {
    email: String(data.get("email") || "").trim().toLowerCase(),
    profileId: String(data.get("profile_id") || ""),
    inviteId: String(data.get("invite_id") || ""),
    payload: {
      full_name: String(data.get("full_name") || "").trim(),
      job_title: String(data.get("job_title") || "Collaborateur").trim(),
      department: String(data.get("department") || "General").trim(),
      role,
      manager_id: String(data.get("manager_id") || "") || null,
      leave_balance_cp: Number(data.get("leave_balance_cp") || 25),
      leave_balance_rtt: Number(data.get("leave_balance_rtt") || 0),
      hired_at: String(data.get("hired_at") || "") || null,
      shift_code: String(data.get("shift_code") || "cs"),
      leave_grade: String(data.get("leave_grade") || "employee"),
      holiday_calendar: normalizeHolidayCalendar(data.get("holiday_calendar"), data.get("shift_code"))
    }
  };
}

async function persistWithGtaFallback(action, payload) {
  const result = await action(payload);
  if (!result.error) return;
  if (!errorMentionsAny(result.error, PROFILE_GTA_FIELDS)) throw result.error;
  const retry = await action(stripFields(payload, PROFILE_GTA_FIELDS));
  if (retry.error) throw retry.error;
}

async function persistUserAccount({ email, profileId, inviteId, payload }) {
  if (usesDatabase() && !isAdmin()) {
    throw new Error("Seul un administrateur peut gérer les comptes.");
  }
  if (!usesDatabase()) {
    if (profileId) {
      const profile = appData.orgProfiles.find((item) => item.id === profileId);
      if (profile) Object.assign(profile, payload, { email: email || profile.email });
      if (appData.profile?.id === profileId) Object.assign(appData.profile, payload);
      return;
    }
    if (inviteId) {
      const invite = appData.pendingInvites.find((item) => item.id === inviteId);
      if (invite) Object.assign(invite, payload, { email });
      return;
    }
    const existing = appData.orgProfiles.find((profile) => profile.email?.toLowerCase() === email);
    if (existing) {
      Object.assign(existing, payload);
      return;
    }
    appData.pendingInvites.push({
      id: `invite-${Date.now()}`,
      email,
      ...payload,
      created_by: session.user.id
    });
    return;
  }
  if (profileId) {
    if (profileId === session.user.id && payload.role !== "admin" && appData.profile?.role === "admin") {
      const adminCount = appData.orgProfiles.filter((profile) => profile.role === "admin").length;
      if (adminCount <= 1) {
        throw new Error("Vous êtes le dernier administrateur. Ajoutez un autre admin avant de modifier votre rôle.");
      }
    }
    await persistWithGtaFallback((row) => supabaseClient.from("profiles").update(row).eq("id", profileId), payload);
    return;
  }

  if (inviteId) {
    await persistWithGtaFallback((row) => supabaseClient.from("pending_invites").update({
      email,
      ...row,
      created_by: session.user.id
    }).eq("id", inviteId), payload);
    return;
  }

  const existing = appData.orgProfiles.find((profile) => profile.email?.toLowerCase() === email);
  if (existing) {
    await persistWithGtaFallback((row) => supabaseClient.from("profiles").update(row).eq("id", existing.id), payload);
    return;
  }

  await persistWithGtaFallback((row) => supabaseClient.from("pending_invites").upsert({
    email,
    ...row,
    created_by: session.user.id
  }, { onConflict: "email" }), payload);
}

function adminDepartmentList() {
  return [...new Set((appData.orgProfiles || [])
    .map((profile) => String(profile.department || "").trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "fr"));
}

function hasAdminUserFilters() {
  return Boolean(
    adminUserQuery
    || adminUserFilters.role
    || adminUserFilters.managerId
    || adminUserFilters.department
    || adminUserFilters.leaveGrade
    || adminUserFilters.holidayCalendar
    || adminUserFilters.shiftCode
  );
}

function getFilteredAdminProfiles() {
  let list = [...(appData.orgProfiles || [])]
    .filter(Boolean)
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "fr"));
  const query = foldPlanningToken(adminUserQuery);
  if (query) {
    list = list.filter((profile) => foldPlanningToken(
      `${profile.full_name || ""} ${profile.email || ""} ${profile.matricule || ""} ${profile.job_title || ""} ${profile.department || ""}`
    ).includes(query));
  }
  if (adminUserFilters.role) {
    list = list.filter((profile) => profile.role === adminUserFilters.role);
  }
  if (adminUserFilters.managerId) {
    list = list.filter((profile) => adminUserFilters.managerId === "__none__"
      ? !profile.manager_id
      : profile.manager_id === adminUserFilters.managerId);
  }
  if (adminUserFilters.department) {
    list = list.filter((profile) => String(profile.department || "") === adminUserFilters.department);
  }
  if (adminUserFilters.leaveGrade) {
    list = list.filter((profile) => getLeaveGrade(profile) === adminUserFilters.leaveGrade);
  }
  if (adminUserFilters.holidayCalendar) {
    list = list.filter((profile) => getHolidayCalendar(profile) === adminUserFilters.holidayCalendar);
  }
  if (adminUserFilters.shiftCode) {
    list = list.filter((profile) => String(profile.shift_code || "cs").toLowerCase() === adminUserFilters.shiftCode);
  }
  return list;
}

function renderAdminUserRows(profiles) {
  if (!profiles.length) {
    return `<tr><td colspan="5" class="empty-cell">Aucun utilisateur${hasAdminUserFilters() ? " ne correspond aux filtres" : " actif"}.</td></tr>`;
  }
  return profiles.map((profile) => `
    <tr>
      <td><strong>${escapeHtml(profile.full_name)}</strong><br><small>${escapeHtml(profile.job_title || "")}${profile.matricule ? ` · ${escapeHtml(profile.matricule)}` : ""}</small></td>
      <td>${escapeHtml(profile.email || "—")}</td>
      <td>${badge(roleLabels[profile.role] || profile.role)}</td>
      <td>${escapeHtml(managerName(profile.manager_id))}</td>
      <td><button type="button" class="outline-button admin-edit-profile" data-profile-id="${profile.id}">Gérer</button></td>
    </tr>`).join("");
}

function renderUserAccountSection() {
  const { editingId, editingInviteId } = getUserAccountEditing();
  const editingProfile = appData.orgProfiles.find((profile) => profile.id === editingId);
  const editingInvite = appData.pendingInvites.find((invite) => invite.id === editingInviteId);
  const editing = editingProfile || editingInvite;
  const isInvite = Boolean(editingInvite && !editingProfile);
  const userPage = paginateList("admin-users", getFilteredAdminProfiles());
  const invitePage = paginateList("admin-invites", appData.pendingInvites);
  const formOpen = Boolean(editing) || adminUserFormOpen;
  const formTitle = isInvite ? "Invitation en attente" : editing ? "Modifier un utilisateur" : "Ajouter un utilisateur";

  return `
    <div class="feature-grid admin-user-stack">
      <details class="admin-user-assign"${formOpen ? " open" : ""}>
        <summary>${formTitle}</summary>
        <form id="admin-user-form" class="feature-form admin-user-assign-form">
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
              Équipe
              <input type="text" name="department" value="${escapeHtml(editing?.department || "General")}">
            </label>
          </div>
          <div class="form-row">
            <label>
              Rôle
              <select name="role" required>${roleOptions(editing?.role || "employee")}</select>
            </label>
            <label>
              Manager
              <select name="manager_id">${managerOptions(editing?.manager_id || "", editingProfile?.id || "")}</select>
            </label>
          </div>
          <div class="form-row">
            <label>
              Solde de congés payés (jours)
              <input type="number" min="0" step="0.5" name="leave_balance_cp" value="${escapeHtml(editing?.leave_balance_cp ?? 25)}">
            </label>
          </div>
          <div class="form-row">
            <label>
              Date d'entrée
              <input type="date" name="hired_at" value="${escapeHtml(editing?.hired_at || "")}">
            </label>
            <label>
              Vacation
              <select name="shift_code">
                ${shiftSelectOptions(editing?.shift_code || "cs")}
              </select>
            </label>
          </div>
          <div class="form-row">
            <label>
              Grade de congés
              <select name="leave_grade">
                <option value="employee"${(editing?.leave_grade || "employee") === "employee" ? " selected" : ""}>Collaborateur — 1,5 j/mois</option>
                <option value="manager"${editing?.leave_grade === "manager" ? " selected" : ""}>Responsable — 2 j/mois</option>
                <option value="codir"${editing?.leave_grade === "codir" ? " selected" : ""}>CODIR — 2,5 j/mois</option>
              </select>
            </label>
            <label>
              Jours fériés
              <select name="holiday_calendar">
                ${holidayCalendarOptions(editing?.holiday_calendar, { shiftCode: editing?.shift_code || "cs" })}
              </select>
            </label>
          </div>
          <p class="hierarchy-meta">Par défaut : CS / CES → jours fériés français, R&amp;D → jours fériés marocains (modifiable ici).</p>
          <div class="admin-form-actions">
            <button type="submit" class="primary">${editing ? "Enregistrer" : "Ajouter"}</button>
            ${editing ? `<button type="button" id="admin-cancel-edit" class="outline-button">Annuler</button>` : ""}
          </div>
        </form>
        <p class="hierarchy-meta">Si la personne ne s'est jamais connectée à Daylyx, elle sera préenregistrée. À la première connexion Microsoft, son compte sera créé automatiquement.</p>
        <div class="planning-import admin-employee-import">
          <strong>Importer les employés (Excel)</strong>
          <p class="hierarchy-meta">L'identifiant employé du fichier = matricule Daylyx (le Matricule RH 1, 2, 3… est ignoré). STATUT Inactif et DATE DEPART déjà passée sont exclus. Manager = Nom + Prénom (vide = pas de manager).</p>
          <input type="file" id="admin-employee-import" accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">
          ${appData.employeeImportNotice ? `<p class="planning-import-notice">${escapeHtml(appData.employeeImportNotice)}</p>` : ""}
        </div>
      </details>
      ${renderAdminAssignPanel(userPage.total)}
      <article class="card table-card admin-user-list">
        <div class="toolbar">
          <h3>Utilisateurs actifs <span id="admin-user-count" class="admin-user-count">${userPage.total} / ${appData.orgProfiles.length}</span></h3>
          <label class="admin-user-search">
            Rechercher
            <input type="search" id="admin-user-search" value="${escapeHtml(adminUserQuery)}" placeholder="Nom, matricule, e-mail…">
          </label>
        </div>
        ${renderAdminUserFilterPanel()}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Manager</th><th></th></tr></thead>
            <tbody id="admin-user-tbody">
              ${renderAdminUserRows(userPage.items)}
            </tbody>
          </table>
        </div>
        <div data-table-pager-host="admin-users">${renderTablePager(userPage)}</div>
      </article>
    </div>
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Invitations en attente</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>E-mail</th><th>Nom</th><th>Rôle</th><th>Manager</th><th></th></tr></thead>
          <tbody>
            ${invitePage.items.length
              ? invitePage.items.map((invite) => `
                <tr>
                  <td>${escapeHtml(invite.email)}</td>
                  <td>${escapeHtml(invite.full_name)}</td>
                  <td>${badge(roleLabels[invite.role] || invite.role)}</td>
                  <td>${escapeHtml(managerName(invite.manager_id))}</td>
                  <td class="admin-row-actions">
                    <button type="button" class="outline-button admin-edit-invite" data-invite-id="${invite.id}">Gérer</button>
                    <button type="button" class="outline-button admin-delete-invite" data-invite-id="${invite.id}">Supprimer</button>
                  </td>
                </tr>`).join("")
              : `<tr><td colspan="5" class="empty-cell">Aucune invitation en attente.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${renderTablePager(invitePage)}
    </article>`;
}

function holidayCalendarLabel(calendar) {
  return String(calendar || "").toLowerCase() === "ma" ? "Maroc" : "France";
}

function holidayCalendarOptions(selected, { emptyLabel, shiftCode } = {}) {
  const current = emptyLabel && (selected == null || selected === "")
    ? ""
    : normalizeHolidayCalendar(selected, shiftCode);
  const empty = emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : "";
  return `
    ${empty}
    <option value="ma"${current === "ma" ? " selected" : ""}>Maroc</option>
    <option value="fr"${current === "fr" ? " selected" : ""}>France</option>`;
}

function adminFilterSelect(name, label, optionsHtml) {
  return `
    <label>
      ${label}
      <select data-admin-user-filter="${name}">
        ${optionsHtml}
      </select>
    </label>`;
}

function renderAdminUserFilterPanel() {
  const managers = (appData.orgProfiles || [])
    .filter((profile) => (appData.orgProfiles || []).some((item) => item.manager_id === profile.id))
    .sort((left, right) => String(left.full_name || "").localeCompare(String(right.full_name || ""), "fr"));
  const roleFilter = `
    <option value="">Tous</option>
    ${ASSIGNABLE_ROLES.map((role) => `<option value="${role}"${adminUserFilters.role === role ? " selected" : ""}>${escapeHtml(roleLabels[role])}</option>`).join("")}`;
  const managerFilter = `
    <option value="">Tous</option>
    <option value="__none__"${adminUserFilters.managerId === "__none__" ? " selected" : ""}>Sans manager</option>
    ${managers.map((profile) => `<option value="${profile.id}"${adminUserFilters.managerId === profile.id ? " selected" : ""}>${escapeHtml(profile.full_name)}</option>`).join("")}`;
  const deptFilter = `
    <option value="">Toutes</option>
    ${adminDepartmentList().map((dept) => `<option value="${escapeHtml(dept)}"${adminUserFilters.department === dept ? " selected" : ""}>${escapeHtml(dept)}</option>`).join("")}`;
  const gradeFilter = `
    <option value="">Tous</option>
    <option value="employee"${adminUserFilters.leaveGrade === "employee" ? " selected" : ""}>Collaborateur</option>
    <option value="manager"${adminUserFilters.leaveGrade === "manager" ? " selected" : ""}>Responsable</option>
    <option value="codir"${adminUserFilters.leaveGrade === "codir" ? " selected" : ""}>CODIR</option>`;
  const shiftFilter = `
    <option value="">Toutes</option>
    ${SHIFT_DEPT_META.map(({ code, name }) => `<option value="${code}"${adminUserFilters.shiftCode === code ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  return `
    <details class="collapse-panel"${isFilterPanelOpen("admin") ? " open" : ""} data-filter-panel="admin">
      <summary>Filtres</summary>
      <div class="feature-form collapse-panel-form admin-user-filters">
        <div class="form-row">
          ${adminFilterSelect("role", "Rôle", roleFilter)}
          ${adminFilterSelect("managerId", "Manager", managerFilter)}
        </div>
        <div class="form-row">
          ${adminFilterSelect("department", "Équipe", deptFilter)}
          ${adminFilterSelect("leaveGrade", "Grade de congés", gradeFilter)}
        </div>
        <div class="form-row">
          ${adminFilterSelect("holidayCalendar", "Jours fériés", holidayCalendarOptions(adminUserFilters.holidayCalendar, { emptyLabel: "Tous" }))}
          ${adminFilterSelect("shiftCode", "Vacation", shiftFilter)}
        </div>
      </div>
    </details>`;
}

function adminAssignPreviewText(count = getFilteredAdminProfiles().length) {
  if (!count) return "Aucun collaborateur dans le filtre actuel.";
  if (count === 1) return "1 personne du filtre actuel sera mise à jour (seuls les champs renseignés changent).";
  return `${count} personnes du filtre actuel seront mises à jour (seuls les champs renseignés changent).`;
}

function renderAdminAssignPanel(count = getFilteredAdminProfiles().length) {
  return `
    <details class="admin-user-assign"${adminAssignOpen ? " open" : ""} id="admin-assign-panel">
      <summary>Affecter un rôle, une équipe, un grade…</summary>
      <form id="admin-assign-form" class="feature-form admin-user-assign-form">
        <p class="hierarchy-meta" id="admin-assign-preview">${escapeHtml(adminAssignPreviewText(count))}</p>
        <p class="hierarchy-meta">Par défaut, CS et CES chôment les jours fériés français, R&amp;D les jours fériés marocains.</p>
        ${adminAssignNotice ? `<p class="planning-import-notice">${escapeHtml(adminAssignNotice)}</p>` : ""}
        <div class="form-row">
          <label>
            Rôle
            <select name="role">
              <option value="">Inchangé</option>
              ${ASSIGNABLE_ROLES.map((role) => `<option value="${role}">${escapeHtml(roleLabels[role])}</option>`).join("")}
            </select>
          </label>
          <label>
            Manager
            <select name="manager_id">
              <option value="">Inchangé</option>
              <option value="__none__">Aucun manager</option>
              ${(appData.orgProfiles || []).map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="form-row">
          <label>
            Équipe
            <select name="department">
              <option value="">Inchangée</option>
              ${adminDepartmentList().map((dept) => `<option value="${escapeHtml(dept)}">${escapeHtml(dept)}</option>`).join("")}
            </select>
          </label>
          <label>
            Nouvelle équipe
            <input type="text" name="department_custom" placeholder="Laisser vide pour ne pas créer">
          </label>
        </div>
        <div class="form-row">
          <label>
            Grade de congés
            <select name="leave_grade">
              <option value="">Inchangé</option>
              <option value="employee">Collaborateur — 1,5 j/mois</option>
              <option value="manager">Responsable — 2 j/mois</option>
              <option value="codir">CODIR — 2,5 j/mois</option>
            </select>
          </label>
          <label>
            Jours fériés
            <select name="holiday_calendar">
              ${holidayCalendarOptions("", { emptyLabel: "Inchangés" })}
            </select>
          </label>
        </div>
        <label>
          Vacation
          <select name="shift_code">
            <option value="">Inchangée</option>
            ${SHIFT_DEPT_META.map(({ code, name }) => `<option value="${code}">${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
        <button type="submit" class="primary">Appliquer au filtre</button>
      </form>
    </details>`;
}

function parseAdminAssignPatch(data) {
  const patch = {};
  const role = String(data.get("role") || "");
  if (ASSIGNABLE_ROLES.includes(role)) patch.role = role;
  const managerId = String(data.get("manager_id") || "");
  if (managerId === "__none__") patch.manager_id = null;
  else if (managerId) patch.manager_id = managerId;
  const customDept = String(data.get("department_custom") || "").trim();
  const department = customDept || String(data.get("department") || "").trim();
  if (department) patch.department = department;
  const leaveGrade = String(data.get("leave_grade") || "");
  if (["employee", "manager", "codir"].includes(leaveGrade)) patch.leave_grade = leaveGrade;
  const holiday = String(data.get("holiday_calendar") || "");
  if (holiday === "ma" || holiday === "fr") patch.holiday_calendar = holiday;
  const shift = String(data.get("shift_code") || "").toLowerCase();
  if (["cs", "ces", "rnd"].includes(shift)) {
    patch.shift_code = shift;
    if (!patch.holiday_calendar) patch.holiday_calendar = defaultHolidayCalendarForShift(shift);
  }
  return patch;
}

function countAdmins() {
  return (appData.orgProfiles || []).filter((profile) => profile.role === "admin" || profile.role === "creator").length;
}

async function persistAdminAssign(profiles, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) throw new Error("Choisissez au moins un champ à modifier.");
  if (!profiles.length) throw new Error("Aucun collaborateur dans le filtre actuel.");
  let remainingAdmins = countAdmins();
  let updated = 0;
  let skipped = 0;
  for (const profile of profiles) {
    const next = { ...patch };
    if (next.manager_id === profile.id) delete next.manager_id;
    if (next.role) {
      if (profile.role === "creator" || (profile.role === "admin" && next.role !== "admin" && remainingAdmins <= 1)) {
        delete next.role;
      } else if (profile.role === "admin" && next.role !== "admin") {
        remainingAdmins -= 1;
      }
    }
    const changed = {};
    Object.entries(next).forEach(([key, value]) => {
      if (profile[key] !== value) changed[key] = value;
    });
    if (!Object.keys(changed).length) {
      skipped += 1;
      continue;
    }
    Object.assign(profile, changed);
    if (appData.profile?.id === profile.id) Object.assign(appData.profile, changed);
    if (usesDatabase()) {
      await persistWithGtaFallback(
        (row) => supabaseClient.from("profiles").update(row).eq("id", profile.id),
        changed
      );
    }
    updated += 1;
  }
  return { updated, skipped };
}

function refreshAdminUserTable() {
  resetTablePage("admin-users");
  const page = paginateList("admin-users", getFilteredAdminProfiles());
  const tbody = document.querySelector("#admin-user-tbody");
  const count = document.querySelector("#admin-user-count");
  const host = document.querySelector("[data-table-pager-host='admin-users']");
  const preview = document.querySelector("#admin-assign-preview");
  if (tbody) tbody.innerHTML = renderAdminUserRows(page.items);
  if (count) count.textContent = `${page.total} / ${appData.orgProfiles.length}`;
  if (host) host.innerHTML = renderTablePager(page);
  if (preview) preview.textContent = adminAssignPreviewText(page.total);
  document.querySelectorAll(".admin-edit-profile").forEach((button) => {
    button.addEventListener("click", () => {
      setUserAccountEditing({ profileId: button.dataset.profileId, inviteId: "" });
      renderApp();
    });
  });
  bindTablePagers();
}

function bindUserAccountSection() {
  document.querySelector(".admin-user-assign")?.addEventListener("toggle", (event) => {
    adminUserFormOpen = event.currentTarget.open;
  });
  document.querySelector("#admin-assign-panel")?.addEventListener("toggle", (event) => {
    adminAssignOpen = event.currentTarget.open;
  });

  const userForm = document.querySelector("#admin-user-form");
  const shiftSelect = userForm?.querySelector("[name='shift_code']");
  const holidaySelect = userForm?.querySelector("[name='holiday_calendar']");
  if (shiftSelect && holidaySelect) {
    shiftSelect.addEventListener("change", () => {
      holidaySelect.value = defaultHolidayCalendarForShift(shiftSelect.value);
    });
  }

  document.querySelector("#admin-user-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = parseUserAccountForm(new FormData(form));

    if (!parsed.email) {
      alert("L'adresse e-mail est obligatoire.");
      return;
    }

    withAction(async () => {
      await persistUserAccount(parsed);
      clearUserAccountEditing();
      form.reset();
      currentPage = "admin";
    });
  });

  document.querySelector("#admin-employee-import")?.addEventListener("change", (event) => {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    (async () => {
      appData.loading = true;
      appData.error = "";
      renderApp();
      try {
        await withTimeout(importEmployeesFromFile(file), 180000, "Import employés");
        if (usesDatabase()) await loadPageData(currentPage, { force: true });
      } catch (error) {
        appData.error = formatAppError(error);
      } finally {
        appData.loading = false;
        renderApp();
      }
    })();
  });

  document.querySelector("#admin-cancel-edit")?.addEventListener("click", () => {
    clearUserAccountEditing();
    renderApp();
  });

  document.querySelectorAll(".admin-edit-profile").forEach((button) => {
    button.addEventListener("click", () => {
      setUserAccountEditing({ profileId: button.dataset.profileId, inviteId: "" });
      renderApp();
    });
  });

  document.querySelector("#admin-user-search")?.addEventListener("input", (event) => {
    adminUserQuery = event.currentTarget.value;
    refreshAdminUserTable();
  });

  document.querySelectorAll("[data-admin-user-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.adminUserFilter;
      if (!Object.prototype.hasOwnProperty.call(adminUserFilters, key)) return;
      adminUserFilters[key] = select.value;
      refreshAdminUserTable();
    });
  });

  document.querySelector("#admin-assign-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const patch = parseAdminAssignPatch(new FormData(event.currentTarget));
    const profiles = getFilteredAdminProfiles();
    adminAssignOpen = true;
    withAction(async () => {
      const result = await persistAdminAssign(profiles, patch);
      adminAssignNotice = `${result.updated} mise${result.updated > 1 ? "s" : ""} à jour${result.skipped ? ` · ${result.skipped} inchangé${result.skipped > 1 ? "s" : ""}` : ""}.`;
      currentPage = "admin";
    });
  });

  document.querySelectorAll(".admin-edit-invite").forEach((button) => {
    button.addEventListener("click", () => {
      setUserAccountEditing({ profileId: "", inviteId: button.dataset.inviteId });
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
        clearUserAccountEditing();
        currentPage = "admin";
      });
    });
  });

  document.querySelector("#admin-gta-settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const shiftHours = {};
    SHIFT_DEPT_META.forEach(({ code }) => {
      shiftHours[code] = {
        start: normalizeHhmm(data.get(`start_${code}`), defaultShiftHours()[code].start),
        end: normalizeHhmm(data.get(`end_${code}`), defaultShiftHours()[code].end)
      };
    });
    withAction(async () => {
      await saveGtaSettings({
        timezone: String(data.get("timezone") || "GMT+1"),
        shiftHours
      });
      currentPage = "admin";
    });
  });
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

function formatMad(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} MAD`;
}

function isHrRequestPending(status) {
  const value = String(status || "").toLowerCase();
  return value.includes("attente") || value.includes("valider") || value.includes("prise en charge");
}

function formatTime(value) {
  const civil = toCompanyCivil(value);
  return `${String(civil.hours).padStart(2, "0")}:${String(civil.minutes).padStart(2, "0")}`;
}

function formatTimeSeconds(value) {
  if (!value) return "—";
  const civil = toCompanyCivil(value);
  return `${String(civil.hours).padStart(2, "0")}:${String(civil.minutes).padStart(2, "0")}:${String(civil.seconds).padStart(2, "0")}`;
}

function getPunches() {
  if (usesDatabase()) {
    const fromDb = (appData.punches || []).map((punch) => ({
      type: punch.punch_type,
      time: punch.punched_at,
      workLocation: punch.work_location || null,
      workStatus: punch.work_status || punch.workStatus || null
    }));
    const localStatus = loadStore("workStatusPunches", []);
    return [...fromDb, ...localStatus].sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  return loadStore("punches", []);
}

function getLeaveRequests() {
  if (usesDatabase()) {
    return appData.leaveRequests.map((request) => ({
      id: request.id,
      userId: request.user_id,
      type: request.leave_type,
      start: request.start_date,
      end: request.end_date,
      days: request.days,
      hours: request.hours,
      unit: request.unit,
      halfDay: request.half_day,
      motif: request.motif,
      attachmentName: request.attachment_name,
      workflowStep: request.workflow_step || 1,
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
      userId: request.user_id,
      kind: isOtherHrType(request.document_type) ? "other" : "attestation",
      type: request.document_type,
      reason: request.reason,
      status: request.status,
      created: request.created_at
    }));
  }
  return loadStore("attestationRequests", []).map((request) => ({
    ...request,
    kind: request.kind || (isOtherHrType(request.type) ? "other" : "attestation")
  }));
}

function getSalaryAdvanceRequests() {
  if (usesDatabase()) {
    return (appData.salaryAdvanceRequests || []).map((request) => ({
      id: request.id,
      userId: request.user_id,
      kind: "advance",
      amount: request.amount,
      reason: request.reason,
      requestedDate: request.requested_date,
      status: request.status,
      created: request.created_at
    }));
  }
  return loadStore("salaryAdvanceRequests", []).map((request) => ({ ...request, kind: "advance" }));
}

const ADVANCE_CUTOFF_DAY = 6;
const ADVANCE_YEAR_LIMIT = 4;
const ADVANCE_NET_RATIO = 0.3;

function isCadreForAdvance(profile = appData.profile) {
  if (isDirecteurLike(profile)) return true;
  if (["manager", "codir"].includes(String(profile?.leave_grade || "").toLowerCase())) return true;
  const role = String(profile?.role || "").toLowerCase();
  return role === "manager" || role === "admin" || role === "creator";
}

function minAdvanceMonths(profile = appData.profile) {
  return isCadreForAdvance(profile) ? 3 : 6;
}

function addMonthsToIso(iso, months) {
  const [year, month, day] = String(iso || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1 + months, day);
}

function hasAdvanceSeniority(profile = appData.profile, at = new Date()) {
  const hired = getHiredAt(profile);
  if (!hired) return false;
  const eligible = addMonthsToIso(hired, minAdvanceMonths(profile));
  return Boolean(eligible) && at.getTime() >= eligible.getTime();
}

function latestEdsNetSalary(userId = session?.user?.id) {
  const cycles = edsPayrollState();
  let bestStart = "";
  let best = null;
  Object.entries(cycles).forEach(([cycle, users]) => {
    const start = String(cycle).split("_")[0] || "";
    const net = Number(String(users?.[userId]?.salaireNet ?? "").replace(",", "."));
    if (!Number.isFinite(net) || net <= 0) return;
    if (start >= bestStart) {
      bestStart = start;
      best = net;
    }
  });
  return best;
}

function computeSalaryAdvanceQuota(userId = session?.user?.id) {
  const profile = profileById(userId) || appData.profile || {};
  const civil = toCompanyCivil(new Date());
  const year = civil.year;
  const used = getSalaryAdvanceRequests().filter((row) => {
    if ((row.userId || session?.user?.id) !== userId) return false;
    const status = String(row.status || "").toLowerCase();
    if (status.includes("refus") || status.includes("rejet")) return false;
    const stamp = new Date(row.created || row.created_at || Date.now());
    return stamp.getFullYear() === year;
  }).length;
  const netSalary = latestEdsNetSalary(userId);
  const maxAmount = Number.isFinite(netSalary) ? Math.round(netSalary * ADVANCE_NET_RATIO * 100) / 100 : null;
  const windowOpen = civil.day < ADVANCE_CUTOFF_DAY;
  const eligible = hasAdvanceSeniority(profile);
  const cadre = isCadreForAdvance(profile);
  const minMonths = minAdvanceMonths(profile);
  let reason = null;
  if (!windowOpen) reason = `Les demandes d'avance sont bloquées à partir du ${ADVANCE_CUTOFF_DAY} du mois.`;
  else if (!eligible) reason = `L'avance est possible après ${minMonths} mois d'ancienneté (${cadre ? "cadre" : "collaborateur"}).`;
  else if (used >= ADVANCE_YEAR_LIMIT) reason = `Quatre avances maximum par an (${used}/${ADVANCE_YEAR_LIMIT}).`;
  else if (!maxAmount) reason = "Salaire net EDS introuvable. Contactez le RH.";
  return {
    ok: !reason,
    reason,
    windowOpen,
    cutoffDay: ADVANCE_CUTOFF_DAY,
    companyDay: civil.day,
    year,
    eligible,
    cadre,
    minMonths,
    yearUsed: used,
    yearLimit: ADVANCE_YEAR_LIMIT,
    yearRemaining: Math.max(0, ADVANCE_YEAR_LIMIT - used),
    netSalary,
    maxAmount,
    ratio: ADVANCE_NET_RATIO
  };
}

function getSalaryAdvanceQuota() {
  return appData.salaryAdvanceQuota && typeof appData.salaryAdvanceQuota === "object"
    ? appData.salaryAdvanceQuota
    : computeSalaryAdvanceQuota();
}

function advanceStatusLabel(status) {
  const value = String(status || "");
  if (/^A valider/i.test(value) || /prise en charge/i.test(value)) return "Prise en charge";
  if (/^Approuve/i.test(value) || /^Valid/i.test(value)) return "Validé";
  if (/^Refuse/i.test(value)) return "Refusé";
  return value;
}

function hrStatusBadge(request) {
  if (request?.kind === "advance" || request?.kind === "attestation" || request?.kind === "other") {
    return badge(advanceStatusLabel(request.status));
  }
  return badge(request?.status);
}

function hrShowsProgress(request) {
  return request?.kind === "advance" || request?.kind === "attestation" || request?.kind === "other";
}

function hrAdvanceProgress(request) {
  const label = advanceStatusLabel(request.status);
  const refused = label === "Refusé";
  const done = label === "Validé";
  return `<ol class="hr-progress" aria-label="Avancement">
    <li class="is-done">Prise en charge</li>
    <li class="${done ? "is-done" : refused ? "is-rejected" : "is-current"}">${done ? "Validé" : refused ? "Refusé" : "En cours"}</li>
  </ol>`;
}

function getHrRequests() {
  return [...getSalaryAdvanceRequests(), ...getAttestationRequests()]
    .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
}

function getOwnHrRequests() {
  const me = session?.user?.id;
  return getHrRequests().filter((request) => !request.userId || request.userId === me);
}

function canApproveHrRequests() {
  return isHr() || isDirecteurLike(appData.profile);
}

function canValidateHrRequest(request) {
  if (!canApproveHrRequests()) return false;
  const userId = request?.userId;
  return Boolean(userId && userId !== session?.user?.id);
}

function getTeamHrRequests() {
  const me = session?.user?.id;
  const reportIds = new Set(getDirectReportProfiles().map((profile) => profile.id));
  return getHrRequests().filter((request) => {
    const userId = request?.userId;
    if (!userId || userId === me) return false;
    if (hasOrgWideAccess()) return true;
    return reportIds.has(userId);
  });
}

function canFollowTeamHrRequests() {
  return hasDirectReports() && !canApproveHrRequests();
}

function pendingHrForValidator() {
  return getHrRequests().filter((request) => isHrRequestPending(request.status) && canValidateHrRequest(request));
}

function countPendingLeave() {
  return getLeaveRequests().filter((item) => String(item.status || "").toLowerCase().includes("valider")).length;
}

function countPendingHrRequests() {
  return pendingHrForValidator().length;
}

function navBadge(page) {
  if (page === "home" && canViewHrAlerts() && countUnreadHrAlerts()) {
    return `<span class="nav-badge">${countUnreadHrAlerts()}</span>`;
  }
  if (page === "leave" && countPendingLeave()) return `<span class="nav-badge">${countPendingLeave()}</span>`;
  if (page === "attestations" && countPendingHrRequests()) return `<span class="nav-badge">${countPendingHrRequests()}</span>`;
  if (page === "team-punches") {
    const pendingDelays = countPendingDelays();
    if (pendingDelays) return `<span class="nav-badge">${pendingDelays}</span>`;
  }
  if (page === "planning") {
    const pendingAbsences = countPendingUnjustifiedAbsences();
    if (pendingAbsences) return `<span class="nav-badge">${pendingAbsences}</span>`;
  }
  return "";
}

function parseClientEnvironment() {
  const uaData = navigator.userAgentData;
  const ua = navigator.userAgent || "";
  let os = "Inconnu";
  if (/Windows/i.test(uaData?.platform || "") || /Windows/i.test(ua)) os = "Windows";
  else if (/Mac/i.test(uaData?.platform || "") || /Mac OS X/i.test(ua)) os = "macOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(uaData?.platform || "") || /Linux/i.test(ua)) os = "Linux";

  let browser = "Navigateur";
  const brands = uaData?.brands || [];
  const brand = brands.find((item) => item.brand && !/not.?a.?brand/i.test(item.brand) && !/chromium/i.test(item.brand));
  if (/Edg\//i.test(ua) || /Edge/i.test(brand?.brand || "")) browser = "Microsoft Edge";
  else if (/OPR\/|Opera/i.test(ua) || /Opera/i.test(brand?.brand || "")) browser = "Opera";
  else if (/Firefox/i.test(ua) || /Firefox/i.test(brand?.brand || "")) browser = "Mozilla Firefox";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Chrome/i.test(ua) || /Chrome/i.test(brand?.brand || "") || /Google Chrome/i.test(brand?.brand || "")) {
    browser = "Google Chrome";
  }

  const method = /Mobi|Android|iPhone|iPad/i.test(ua) || uaData?.mobile
    ? "Web mobile"
    : "Web";
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const rawType = String(connection?.type || "").toLowerCase();
  const networkMap = {
    wifi: "Wi-Fi",
    wlan: "Wi-Fi",
    ethernet: "Ethernet",
    cellular: "Mobile",
    bluetooth: "Bluetooth",
    wimax: "WiMAX",
    other: "Autre"
  };
  const network = networkMap[rawType]
    || (getPreferredWorkLocation() === "onsite" ? "LAN" : "Internet");

  return { method, os, browser, network };
}

async function collectJournalMeta() {
  return { ...parseClientEnvironment(), ip: "" };
}

function applyJournalMetaToPayload(payload, meta, punchType) {
  if (!meta || !journalMetaColumnsEnabled) return payload;
  if (punchType === "in") {
    payload.connection_method = meta.method;
    payload.operating_system = meta.os;
    payload.browser_application = meta.browser;
    payload.network_type = meta.network;
  }
  if (punchType === "out") {
    payload.disconnect_reason = payload.disconnect_reason || "Sortie manuelle";
  }
  return payload;
}

function applyJournalMetaToDemoPunch(punch, meta, punchType) {
  if (!meta) return punch;
  if (punchType === "in") {
    punch.connection_method = meta.method;
    punch.operating_system = meta.os;
    punch.browser_application = meta.browser;
    punch.ip_address = "";
    punch.network_type = meta.network;
    punch.method = meta.method;
    punch.os = meta.os;
    punch.browser = meta.browser;
    punch.ip = "";
    punch.network = meta.network;
  }
  if (punchType === "out") punch.disconnect_reason = "Sortie manuelle";
  return punch;
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function formatElapsedHms(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

let elapsedClockTimer = null;
const STATUS_CLOCK_KEY = "humana_status_clock";

function statusClockDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isStatusClockFromToday(data) {
  if (!data || typeof data !== "object") return false;
  const today = statusClockDayKey();
  if (data.day && data.day !== today) return false;
  if (data.start) {
    const started = new Date(Number(data.start));
    if (!Number.isNaN(started.getTime()) && statusClockDayKey(started) !== today) return false;
  }
  return true;
}

function readStatusClock() {
  try {
    const data = JSON.parse(sessionStorage.getItem(STATUS_CLOCK_KEY) || "null");
    if (!data) return null;
    if (!isStatusClockFromToday(data)) {
      sessionStorage.removeItem(STATUS_CLOCK_KEY);
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function writeStatusClock(data) {
  try {
    sessionStorage.setItem(STATUS_CLOCK_KEY, JSON.stringify({
      ...data,
      day: statusClockDayKey()
    }));
  } catch (_) {
    /* ignore */
  }
}

function pauseStatusClock() {
  const data = readStatusClock();
  if (!data) return;
  const totals = { ...(data.totals || {}) };
  if (data.running && data.start && data.status) {
    totals[data.status] = (Number(totals[data.status]) || 0) + Math.max(0, Date.now() - Number(data.start));
  }
  writeStatusClock({ totals, status: data.status || getCurrentWorkStatus(), start: null, running: false });
}

function switchStatusClock(newStatus, startedAt = Date.now()) {
  const status = String(newStatus || getCurrentWorkStatus() || "production");
  const data = readStatusClock() || { totals: {} };
  const totals = { ...(data.totals || {}) };
  if (data.running && data.start && data.status) {
    totals[data.status] = (Number(totals[data.status]) || 0) + Math.max(0, Date.now() - Number(data.start));
  }
  const start = Number(startedAt);
  writeStatusClock({
    totals,
    status,
    start: Number.isFinite(start) ? start : Date.now(),
    running: true
  });
}

function lastOpenWorkSegmentStartMs() {
  const sorted = [...getTodayPunches()].sort((a, b) => new Date(a.time) - new Date(b.time));
  let start = null;
  sorted.forEach((punch) => {
    const time = new Date(punch.time).getTime();
    if (!Number.isFinite(time)) return;
    if (punch.type === "in" || punch.type === "break_end" || punch.type === "status_change") start = time;
    if (punch.type === "break_start" || punch.type === "out") start = null;
  });
  return start;
}

function activeWorkStatusFromPunches() {
  const sorted = [...getTodayPunches()].sort((a, b) => new Date(a.time) - new Date(b.time));
  let status = "production";
  sorted.forEach((punch) => {
    if (punch.type === "in" || punch.type === "status_change" || punch.type === "break_end") {
      status = resolvePunchWorkStatus(punch, status);
    }
  });
  return status;
}

function ensureStatusClockFromShift() {
  const { isWorking, onBreak, isOut } = getClockState();
  if (isOut) {
    const data = readStatusClock();
    if (data?.running) pauseStatusClock();
    setCurrentWorkStatus("production");
    return;
  }
  if (onBreak) {
    const data = readStatusClock();
    if (data?.running) pauseStatusClock();
    return;
  }
  if (!isWorking) return;
  const status = activeWorkStatusFromPunches();
  setCurrentWorkStatus(status);
  const data = readStatusClock();
  if (data?.running && String(data.status) === status) return;
  switchStatusClock(status, lastOpenWorkSegmentStartMs() || Date.now());
}

function getTodayElapsedMs() {
  const punches = getTodayPunches();
  if (punches.length) {
    const durations = computeDayStatusDurations(punches, companyDateKey());
    if (getClockState().onBreak) return Number(durations?.lunch) || 0;
    const status = String(getCurrentWorkStatus() || "production");
    return Number(durations?.[status]) || 0;
  }
  const status = String(getCurrentWorkStatus() || "production");
  const data = readStatusClock();
  if (!data) return 0;
  let ms = Number(data.totals?.[status]) || 0;
  if (data.running && data.start && String(data.status) === status) {
    ms += Math.max(0, Date.now() - Number(data.start));
  }
  return ms;
}

function updateElapsedClocks() {
  const label = formatElapsedHms(getTodayElapsedMs());
  document.querySelectorAll("[data-elapsed-clock]").forEach((el) => {
    el.textContent = label;
  });

  const breakLive = document.querySelectorAll("[data-break-live], [data-break-duration-live]");
  if (!breakLive.length) return;

  const summary = getTodayShiftSummary();
  const now = new Date();
  document.querySelectorAll("[data-break-live]").forEach((el) => {
    el.textContent = formatBreakSummary(summary, now);
  });
  document.querySelectorAll("[data-break-duration-live]").forEach((el) => {
    el.textContent = formatElapsedHms(Number(summary.breakDurationMs) || 0);
  });
}

function bindElapsedClock() {
  ensureStatusClockFromShift();
  updateElapsedClocks();
  if (window.__humanaElapsedClock) return;
  window.__humanaElapsedClock = setInterval(updateElapsedClocks, 200);
  elapsedClockTimer = window.__humanaElapsedClock;
}

function punchTypeLabel(type) {
  switch (type) {
    case "in": return "Début de service";
    case "out": return "Fin de service";
    case "break_start": return "Début de pause";
    case "break_end": return "Fin de pause";
    case "status_change": return "Chgmt activité";
    default: return type || "Autre";
  }
}

function formatPunchKind(kind) {
  const option = PUNCH_KIND_OPTIONS.find((item) => item.value === kind);
  if (option) return option.label;
  return punchTypeLabel(kind);
}

function formatDayPunchLog(row) {
  const punches = [...(row.punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
  const pick = (type) => punches.find((punch) => punch.type === type);
  const lastOut = [...punches].reverse().find((punch) => punch.type === "out");
  const lines = [
    ["Début", pick("in")],
    ["Pause in", pick("break_start")],
    ["Pause out", pick("break_end")],
    ["Sortie", lastOut]
  ];
  return `<div class="punch-log">${lines.map(([label, punch]) => (
    `<span><b>${label}</b> ${punch ? formatTime(punch.time) : (label === "Sortie" && row.hasStarted && !row.isDayClosed ? "en cours" : "—")}</span>`
  )).join("")}</div>`;
}

function formatDayPunchLogText(row) {
  const punches = [...(row.punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
  const pick = (type) => punches.find((punch) => punch.type === type);
  const lastOut = [...punches].reverse().find((punch) => punch.type === "out");
  return [
    `Début ${pick("in") ? formatTime(pick("in").time) : "—"}`,
    `Pause in ${pick("break_start") ? formatTime(pick("break_start").time) : "—"}`,
    `Pause out ${pick("break_end") ? formatTime(pick("break_end").time) : "—"}`,
    `Sortie ${lastOut ? formatTime(lastOut.time) : (row.hasStarted && !row.isDayClosed ? "en cours" : "—")}`
  ].join(" | ");
}

function getDayPunchCorrections(userId, dayKey) {
  return getPunchCorrections().filter((item) => gtaItemUserId(item) === userId && gtaItemDate(item) === dayKey);
}

function formatDayCorrectionSummary(userId, dayKey) {
  const items = getDayPunchCorrections(userId, dayKey);
  if (!items.length) {
    return { rectified: "Non", who: "—", motif: "—" };
  }
  const approved = items.filter((item) => String(item.status || "").toLowerCase().includes("approuv"));
  const pending = items.filter((item) => String(item.status || "").toLowerCase().includes("valider"));
  const source = approved.length ? approved : items;
  const who = source.map((item) => {
    const reviewerId = item.reviewed_by || item.reviewedBy;
    if (reviewerId) return profileById(reviewerId)?.full_name || item.reviewedByName || "Valideur";
    if (item.reviewedByName) return item.reviewedByName;
    if (approved.length) return getUserName();
    return `Demande : ${profileById(gtaItemUserId(item))?.full_name || "collaborateur"}`;
  }).filter((value, index, list) => value && list.indexOf(value) === index).join(", ");
  const motif = source.map((item) => {
    const kind = formatPunchKind(item.punch_kind || item.punchKind || item.kind || "");
    const time = String(item.time || item.requested_time || "").slice(0, 5);
    const reason = item.reason || "Sans motif";
    return `${kind}${time ? ` ${time}` : ""} — ${reason}`;
  }).join(" | ");
  return {
    rectified: approved.length ? "Oui" : (pending.length ? "En attente" : "Non"),
    who: who || "—",
    motif: motif || "—"
  };
}

function getPreferredWorkLocation() {
  const stored = loadStore(WORK_LOCATION_STORE_KEY, "onsite");
  return stored === "remote" ? "remote" : "onsite";
}

function savePreferredWorkLocation(location) {
  saveStore(WORK_LOCATION_STORE_KEY, location === "remote" ? "remote" : "onsite");
}

function getWorkLocationFromPunch(punch) {
  return punch?.workLocation || punch?.work_location || null;
}

function workLocationLabel(location) {
  if (!location) return "—";
  return WORK_LOCATIONS[location] || "—";
}

function getDayWorkLocation(punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  for (const punch of sorted) {
    if (punch.type !== "in") continue;
    const location = getWorkLocationFromPunch(punch);
    if (location) return location;
  }
  const firstIn = sorted.find((punch) => punch.type === "in");
  return getWorkLocationFromPunch(firstIn);
}

function getActiveSessionWorkLocation(punches = getPunches()) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  let sessionIn = null;
  sorted.forEach((punch) => {
    if (punch.type === "in") sessionIn = punch;
    if (punch.type === "out") sessionIn = null;
  });
  if (sessionIn) return getWorkLocationFromPunch(sessionIn);
  return getDayWorkLocation(getTodayPunches(punches)) || getPreferredWorkLocation();
}

function renderWorkLocationBadge(location) {
  if (!location) return "";
  return `<span class="work-location-badge work-location-badge--${location}">${workLocationLabel(location)}</span>`;
}

function renderWorkLocationSelector(punches = getPunches()) {
  if (!SHOW_WORK_LOCATION_UI) return "";
  const { isOut } = getClockState();
  const currentLocation = getActiveSessionWorkLocation(punches);
  const selected = isOut ? getPreferredWorkLocation() : currentLocation;

  if (!isOut) {
    return `
      <div class="work-location-panel work-location-panel--readonly" aria-label="Lieu de travail">
        <span class="work-location-label">Lieu de travail</span>
        ${renderWorkLocationBadge(currentLocation || "onsite")}
      </div>`;
  }

  return `
    <div class="work-location-panel" role="group" aria-label="Choisir le lieu de travail">
      <span class="work-location-label">Lieu de travail</span>
      <div class="work-location-toggle">
        <button type="button" class="work-location-option${selected === "onsite" ? " is-active" : ""}" data-work-location="onsite">Sur site</button>
        <button type="button" class="work-location-option${selected === "remote" ? " is-active" : ""}" data-work-location="remote">Télétravail</button>
      </div>
    </div>`;
}

function buildClockPunchPayload(punchType) {
  const payload = {
    user_id: session.user.id,
    punch_type: punchType,
    punched_at: new Date().toISOString()
  };
  if (punchType === "in") {
    payload.work_location = getPreferredWorkLocation();
    payload.work_status = "production";
  } else {
    payload.work_status = getCurrentWorkStatus();
  }
  return payload;
}

function buildDemoClockPunch(punchType) {
  const punch = { type: punchType, time: new Date().toISOString() };
  if (punchType === "in") {
    punch.workLocation = getPreferredWorkLocation();
    punch.workStatus = "production";
  } else {
    punch.workStatus = getCurrentWorkStatus();
  }
  return punch;
}

const PUNCH_FUTURE_SLACK_MS = 2000;

function punchTimeMs(punch) {
  const time = new Date(punch?.time || punch?.punched_at || "").getTime();
  return Number.isFinite(time) ? time : NaN;
}

function isFuturePunch(punch, now = Date.now()) {
  const time = punchTimeMs(punch);
  return Number.isFinite(time) && time > now + PUNCH_FUTURE_SLACK_MS;
}

function punchesObservedUntil(punches, now = Date.now()) {
  return (punches || []).filter((punch) => !isFuturePunch(punch, now));
}

function computeWorkedHours(punches) {
  const now = Date.now();
  const sorted = punchesObservedUntil(punches, now).sort((a, b) => new Date(a.time) - new Date(b.time));
  const sessions = [];
  let workStart = null;

  sorted.forEach((punch) => {
    const time = punchTimeMs(punch);
    if (!Number.isFinite(time)) return;
    if (punch.type === "in" || punch.type === "break_end") {
      workStart = time;
      return;
    }
    if (punch.type === "break_start" && workStart !== null) {
      const end = Math.min(time, now);
      if (end > workStart) sessions.push({ start: workStart, end });
      workStart = null;
      return;
    }
    if (punch.type === "out" && workStart !== null) {
      const end = Math.min(time, now);
      if (end > workStart) sessions.push({ start: workStart, end });
      workStart = null;
    }
  });

  if (workStart !== null && now > workStart) {
    sessions.push({ start: workStart, end: now });
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

function computeBreakDuration(punches, fromTime = null) {
  const now = Date.now();
  const sorted = punchesObservedUntil(punches, now).sort((a, b) => punchTimeMs(a) - punchTimeMs(b));
  let breakStart = null;
  let total = 0;
  const fromMs = fromTime ? new Date(fromTime).getTime() : 0;

  sorted.forEach((punch) => {
    const time = punchTimeMs(punch);
    if (!Number.isFinite(time) || time < fromMs) return;

    if (punch.type === "break_start") {
      breakStart = time;
      return;
    }

    if ((punch.type === "break_end" || punch.type === "out") && breakStart !== null) {
      total += Math.max(0, Math.min(time, now) - breakStart);
      breakStart = null;
    }
  });

  if (breakStart !== null) total += Math.max(0, now - breakStart);
  return total;
}

function emptyStatusDurations() {
  const totals = { lunch: 0 };
  WORK_STATUSES.forEach((status) => {
    totals[status.value] = 0;
  });
  return totals;
}

function resolvePunchWorkStatus(punch, fallback = "production") {
  const value = String(punch?.workStatus || punch?.work_status || "").trim().toLowerCase();
  if (WORK_STATUSES.some((status) => status.value === value)) return value;
  return fallback;
}

function computeDayStatusDurations(punches, dayKey) {
  const totals = emptyStatusDurations();
  const sorted = [...(punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
  if (!sorted.length) return totals;

  const isToday = companyDateKey(dayKey) === companyDateKey();
  const lastTime = punchTimeMs(sorted[sorted.length - 1]);
  const cap = isToday ? Date.now() : lastTime;
  let workStart = null;
  let lunchStart = null;
  let currentStatus = "production";

  const closeWork = (at) => {
    if (workStart == null) return;
    const end = Math.max(workStart, Number(at) || workStart);
    totals[currentStatus] = (Number(totals[currentStatus]) || 0) + Math.max(0, end - workStart);
    workStart = null;
  };
  const closeLunch = (at) => {
    if (lunchStart == null) return;
    const end = Math.max(lunchStart, Number(at) || lunchStart);
    totals.lunch += Math.max(0, end - lunchStart);
    lunchStart = null;
  };

  sorted.forEach((punch) => {
    const time = punchTimeMs(punch);
    if (!Number.isFinite(time) || time > cap + PUNCH_FUTURE_SLACK_MS) return;
    if (punch.type === "in") {
      closeLunch(time);
      currentStatus = resolvePunchWorkStatus(punch, "production");
      workStart = time;
      return;
    }
    if (punch.type === "status_change") {
      if (workStart != null) {
        closeWork(time);
        currentStatus = resolvePunchWorkStatus(punch, currentStatus);
        workStart = time;
      } else {
        currentStatus = resolvePunchWorkStatus(punch, currentStatus);
      }
      return;
    }
    if (punch.type === "break_start") {
      closeWork(time);
      lunchStart = time;
      return;
    }
    if (punch.type === "break_end") {
      closeLunch(time);
      currentStatus = resolvePunchWorkStatus(punch, currentStatus);
      workStart = time;
      return;
    }
    if (punch.type === "out") {
      closeLunch(time);
      closeWork(time);
    }
  });

  closeLunch(cap);
  closeWork(cap);
  return totals;
}

function formatStatusDurationCell(ms) {
  return Number(ms) > 0 ? formatDuration(ms) : "—";
}

function totalStatusDurationMs(durations) {
  const workMs = WORK_STATUSES.reduce((sum, status) => sum + (Number(durations?.[status.value]) || 0), 0);
  return workMs + (Number(durations?.lunch) || 0);
}

function getTeamPunchDetailView() {
  return teamPunchFilters.detailView === "status" ? "status" : "punches";
}

function renderTeamPunchDetailViewToggle() {
  const view = getTeamPunchDetailView();
  return `
    <div class="segmented team-detail-toggle" role="tablist" aria-label="Type de détail">
      <button type="button" class="planning-tab${view === "punches" ? " is-active" : ""}" data-team-detail-view="punches" role="tab" aria-selected="${view === "punches" ? "true" : "false"}">Détail des pointages</button>
      <button type="button" class="planning-tab${view === "status" ? " is-active" : ""}" data-team-detail-view="status" role="tab" aria-selected="${view === "status" ? "true" : "false"}">Détail des statuts</button>
    </div>`;
}

function renderTeamPunchRows(dailyRows) {
  if (!dailyRows.length) {
    return `<tr><td colspan="16" class="empty-cell">Aucun pointage pour cette période. Ajustez les filtres, puis actualisez.</td></tr>`;
  }
  return dailyRows.map((row) => {
    const profile = profileById(row.userId) || { full_name: row.name, id: row.userId };
    const stats = analyzeWorkedDay(row, profile);
    const correction = formatDayCorrectionSummary(row.userId, row.dayKey);
    const canRectify = canRectifyCollaboratorPunches(row.userId);
    return `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${formatDate(row.dayKey)}</td>
        <td>${resolveWorkLocationLabel(row)}</td>
        <td>${row.startTime ? formatTime(row.startTime) : "—"}</td>
        <td>${formatDayEndTime(row)}</td>
        <td>${row.breakDurationMs ? formatDuration(row.breakDurationMs) : "—"}</td>
        <td>${formatDuration(stats.plannedMs)}</td>
        <td><strong>${formatDuration(stats.realizedMs)}</strong></td>
        <td>${formatDelayCell(row.userId, row.dayKey, stats.delayMin, canRectify)}</td>
        <td>${stats.missingMs ? formatDuration(stats.missingMs) : "—"}</td>
        <td>${stats.payableOtMs ? formatDuration(stats.payableOtMs) : "—"}</td>
        <td>${formatDayPunchLog(row)}</td>
        <td>${correction.rectified === "Oui" ? badge("Oui") : escapeHtml(correction.rectified)}</td>
        <td>${escapeHtml(correction.who)}</td>
        <td>${escapeHtml(correction.motif)}</td>
        <td>${canRectify
          ? `<button type="button" class="outline-button punch-rectify-btn" data-punch-rectify data-user-id="${escapeHtml(row.userId)}" data-day-key="${escapeHtml(row.dayKey)}">Rectifier</button>`
          : ""}</td>
      </tr>`;
  }).join("");
}

function renderTeamStatusRows(dailyRows) {
  const statusCols = WORK_STATUSES.length + 4;
  if (!dailyRows.length) {
    return `<tr><td colspan="${statusCols}" class="empty-cell">Aucun statut pour cette période. Ajustez les filtres, puis actualisez.</td></tr>`;
  }
  return dailyRows.map((row) => {
    const durations = computeDayStatusDurations(row.punches, row.dayKey);
    return `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${formatDate(row.dayKey)}</td>
        ${WORK_STATUSES.map((status) => `<td>${formatStatusDurationCell(durations[status.value])}</td>`).join("")}
        <td>${formatStatusDurationCell(durations.lunch)}</td>
        <td><strong>${formatStatusDurationCell(totalStatusDurationMs(durations))}</strong></td>
      </tr>`;
  }).join("");
}

function renderTeamPunchDetailCard(dailyRows, options = {}) {
  const view = getTeamPunchDetailView();
  const showLocationHint = Boolean(options.showLocationHint);
  const page = paginateList(view === "status" ? "team-status" : "team-punches", dailyRows);
  if (view === "status") {
    return `
      <article class="card table-card page-spacer">
        <div class="toolbar">
          <h3>Détail des statuts</h3>
          <div class="toolbar-actions">
            ${renderTeamPunchDetailViewToggle()}
            <span class="hierarchy-result-count">${dailyRows.length} jour${dailyRows.length > 1 ? "s" : ""}</span>
          </div>
        </div>
        <p class="hierarchy-meta">Temps passé en production, réunion, formation, coaching, break et pause déjeuner, d'après les pointages et les changements d'activité.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Collaborateur</th>
                <th>Date</th>
                ${WORK_STATUSES.map((status) => `<th>${escapeHtml(status.label)}</th>`).join("")}
                <th>Pause déjeuner</th>
                <th>Durée totale</th>
              </tr>
            </thead>
            <tbody>${renderTeamStatusRows(page.items)}</tbody>
          </table>
        </div>
        ${renderTablePager(page)}
      </article>`;
  }
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar">
        <h3>Détail des pointages</h3>
        <div class="toolbar-actions">
          ${renderTeamPunchDetailViewToggle()}
          <span class="hierarchy-result-count">${dailyRows.length} jour${dailyRows.length > 1 ? "s" : ""}</span>
        </div>
      </div>
      ${showLocationHint ? `<p class="data-note">Le lieu n'est renseigné que sur les pointages d'entrée. S'il reste vide après un nouveau pointage, redémarrez l'API pour appliquer les migrations.</p>` : ""}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Collaborateur</th>
              <th>Date</th>
              <th>Lieu</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Pause déjeuner</th>
              <th>Heures planifiées</th>
              <th>Heures réalisées</th>
              <th>Retard</th>
              <th>Heures manquantes</th>
              <th>HS payables</th>
              <th>Journal du service</th>
              <th>Heure rectifiée</th>
              <th>Modifié par</th>
              <th>Motif</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${renderTeamPunchRows(page.items)}</tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
}

function lastMeaningfulPunch(sorted) {
  return [...sorted].reverse().find((punch) => punch.type !== "status_change") || null;
}

function latestBreakInterval(sorted) {
  let breakStart = null;
  let breakEnd = null;
  sorted.forEach((punch) => {
    if (punch.type === "break_start") {
      breakStart = punch.time;
      breakEnd = null;
      return;
    }
    if (punch.type === "break_end" && breakStart) {
      breakEnd = punch.time;
    }
  });
  const last = lastMeaningfulPunch(sorted);
  return {
    breakStart,
    breakEnd,
    onBreak: last?.type === "break_start"
  };
}

function getTodayShiftSummary(punches = getPunches()) {
  const todayPunches = getTodayPunches(punches);
  const sorted = [...todayPunches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const startPunch = sorted.find((punch) => punch.type === "in");
  const breakInterval = latestBreakInterval(sorted);
  const endPunch = [...sorted].reverse().find((punch) => punch.type === "out");
  const lastToday = lastMeaningfulPunch(sorted);

  return {
    startTime: startPunch?.time || null,
    breakStart: breakInterval.breakStart,
    breakEnd: breakInterval.breakEnd,
    endTime: endPunch?.time || null,
    breakDurationMs: computeBreakDuration(todayPunches),
    onBreak: breakInterval.onBreak,
    isWorking: lastToday?.type === "in" || lastToday?.type === "break_end",
    isDayClosed: lastToday?.type === "out",
    hasStarted: Boolean(startPunch)
  };
}

function formatShiftTime(value) {
  return value ? formatTime(value) : "—";
}

function formatBreakSummary(summary, now = new Date()) {
  if (!summary.breakStart) return "—";
  const startMs = new Date(summary.breakStart).getTime();
  if (Number.isNaN(startMs)) return "—";

  if (summary.onBreak) {
    const elapsed = Math.max(0, now.getTime() - startMs);
    return `${formatTime(summary.breakStart)} – en cours · ${formatElapsedHms(elapsed)}`;
  }

  if (summary.breakEnd) {
    const endMs = new Date(summary.breakEnd).getTime();
    const elapsed = Math.max(0, Number.isNaN(endMs) ? 0 : endMs - startMs);
    const sameMinute = formatTime(summary.breakStart) === formatTime(summary.breakEnd);
    const startLabel = sameMinute ? formatTimeSeconds(summary.breakStart) : formatTime(summary.breakStart);
    const endLabel = sameMinute ? formatTimeSeconds(summary.breakEnd) : formatTime(summary.breakEnd);
    if (elapsed < 120000) {
      return `${startLabel} – ${endLabel} · ${formatElapsedHms(elapsed)}`;
    }
    return `${startLabel} – ${endLabel}`;
  }

  return formatTime(summary.breakStart);
}

function formatEndShiftSummary(summary) {
  if (summary.endTime) return formatTime(summary.endTime);
  if (summary.hasStarted && !summary.isDayClosed) return "En cours";
  return "—";
}

function renderHomeShiftSummary(punches = getPunches()) {
  const summary = getTodayShiftSummary(punches);

  return `
    <div class="home-shift-summary" aria-label="Résumé de la journée">
      <div class="home-shift-item">
        <span>Début</span>
        <strong>${formatShiftTime(summary.startTime)}</strong>
      </div>
      <div class="home-shift-item">
        <span>Pause déjeuner</span>
        <strong data-break-live>${formatBreakSummary(summary)}</strong>
      </div>
      <div class="home-shift-item">
        <span>Fin de service</span>
        <strong>${formatEndShiftSummary(summary)}</strong>
      </div>
    </div>`;
}

/* ──────────────────────────────────────────────────────────
   TIMELINE JOURNEE — barre visuelle type "filmstrip"
   ────────────────────────────────────────────────────────── */
function renderDayTimeline(punches, profile, options = {}) {
  const opts = options === true ? { compact: true } : (options || {});
  const compact = Boolean(opts.compact);
  const variant = opts.variant || (compact ? "compact" : "full");
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  if (!sorted.length && variant === "history") return "";

  const shift = getActiveShift(profile);
  const lateAfterMin  = minutesFromHhmm(shift.lateAfter);

  // Plage commune : 6h → 21h (prises de poste 7h / 8h / 9h, journée 10h dont 1h de pause)
  const dispStart = 6 * 60;
  const dispEnd   = 21 * 60;
  const dispRange = dispEnd - dispStart;

  const toPercent = (min) => `${Math.min(100, Math.max(0, ((min - dispStart) / dispRange) * 100)).toFixed(3)}%`;

  // Convertit un timestamp en minute de la journée
  const toMin = (t) => companyMinutesOfDay(t);

  const now = new Date();
  const nowMin = opts.asOfMin != null
    ? Number(opts.asOfMin)
    : companyMinutesOfDay(now);
  const dayLocation = getDayWorkLocation(sorted);
  const statusAt = (min) => {
    let status = null;
    sorted.forEach((punch) => {
      if (toMin(punch.time) - min > 0.01) return;
      const ws = punch.workStatus || punch.work_status;
      if (ws) status = ws;
    });
    return status;
  };

  /* ------ Construire les segments ------- */
  const segments = [];

  // Heure off : de dispStart jusqu'au premier IN
  const inPunch = sorted.find((p) => p.type === "in");
  const inMin   = inPunch ? toMin(inPunch.time) : nowMin;

  // Avant arrivée
  if (inPunch) {
    segments.push({ from: dispStart, to: inMin, type: "off" });
  }

  // Retard si arrivée après lateAfter
  if (inPunch && inMin > lateAfterMin) {
    // On corrige : la partie "off" s'arrête à lateAfter, le retard commence là
    const lastOff = segments.pop();
    segments.push({ from: dispStart, to: lateAfterMin, type: "off" });
    segments.push({ from: lateAfterMin, to: inMin, type: "late" });
  }

  // Parcourir les pointages pour construire les segments de travail et de pause
  let workStart = inPunch ? inMin : null;
  let breakStart = null;

  sorted.forEach((p) => {
    const min = toMin(p.time);
    if (p.type === "in") { workStart = min; }
    else if (p.type === "break_start" && workStart !== null) {
      segments.push({ from: workStart, to: min, type: "work" });
      breakStart = min;
      workStart = null;
    } else if ((p.type === "break_end") && breakStart !== null) {
      segments.push({ from: breakStart, to: min, type: "lunch" });
      breakStart = null;
      workStart = min;
    } else if (p.type === "out") {
      if (breakStart !== null) {
        segments.push({ from: breakStart, to: min, type: "lunch" });
        breakStart = null;
      } else if (workStart !== null) {
        segments.push({ from: workStart, to: min, type: "work" });
        workStart = null;
      }
      segments.push({ from: min, to: dispEnd, type: "off" });
    }
  });

  // Si la journée est encore ouverte
  if (workStart !== null) {
    segments.push({ from: workStart, to: nowMin, type: "work" });
    segments.push({ from: nowMin, to: dispEnd, type: "future" });
  } else if (breakStart !== null) {
    segments.push({ from: breakStart, to: nowMin, type: "lunch" });
    segments.push({ from: nowMin, to: dispEnd, type: "future" });
  }

  // Fusionner les segments adjacents de même type
  const merged = [];
  segments.forEach((seg) => {
    if (seg.from >= seg.to) return;
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type && last.to === seg.from) {
      last.to = seg.to;
    } else {
      merged.push({ ...seg });
    }
  });

  /* ------ Markers horaires ------- */
  // Afficher des repères toutes les heures entre dispStart et dispEnd
  const markerMins = [];
  const firstHour = Math.ceil(dispStart / 60) * 60;
  for (let m = firstHour; m <= dispEnd; m += 60) {
    markerMins.push(m);
  }

  /* ------ Statistiques résumées ------- */
  const workMs    = merged.filter((s) => s.type === "work").reduce((sum, s) => sum + (s.to - s.from) * 60000, 0);
  const lunchMs   = merged.filter((s) => s.type === "lunch").reduce((sum, s) => sum + (s.to - s.from) * 60000, 0);
  const lateMs    = merged.filter((s) => s.type === "late").reduce((sum, s) => sum + (s.to - s.from) * 60000, 0);
  const lateMin   = Math.round(lateMs / 60000);

  const fmtMs = (ms) => {
    const total = Math.round(ms / 60000);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
  };

  const typeLabels = {
    work: "En poste",
    lunch: "Pause déjeuner",
    off: "Hors poste",
    late: "Retard",
    future: "Non écoulé"
  };

  const formatClock = (min) => {
    const rounded = Math.max(0, Math.round(min));
    const h = Math.floor(rounded / 60) % 24;
    const m = rounded % 60;
    return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}`;
  };

  const expectedArrivalLabel = formatClock(lateAfterMin);
  const actualArrivalLabel = inPunch ? formatClock(inMin) : "non pointée";

  const segmentTip = (s) => {
    const label = typeLabels[s.type] || s.type;
    const duration = fmtMs((s.to - s.from) * 60000);
    const lines = [
      `<b>${escapeHtml(label)}</b>`,
      `${escapeHtml(formatClock(s.from))} → ${escapeHtml(formatClock(s.to))} · ${escapeHtml(duration)}`,
      `Heure max attendue : ${escapeHtml(expectedArrivalLabel)}`,
      `Arrivée : ${escapeHtml(actualArrivalLabel)}`
    ];
    if (s.type === "late" && inPunch && inMin > lateAfterMin) {
      lines.push(`Retard : ${escapeHtml(fmtMs((inMin - lateAfterMin) * 60000))}`);
    }
    if (s.type === "work" || s.type === "late") {
      const loc = workLocationLabel(dayLocation);
      if (SHOW_WORK_LOCATION_UI && loc && loc !== "—") lines.push(escapeHtml(loc));
    }
    if (s.type === "work") {
      const status = statusAt(s.from);
      if (status) lines.push(escapeHtml(workStatusDef(status).label));
    }
    return lines.join("<br>");
  };

  const segmentMarkup = merged.map((s) => {
    const left = toPercent(s.from);
    const width = `${((s.to - s.from) / dispRange * 100).toFixed(3)}%`;
    return `<div class="dtl-seg dtl-seg--${s.type}" ${pctProps({ l: left, w: width })}></div>`;
  }).join("");

  const hitMarkup = merged.map((s) => {
    const left = toPercent(s.from);
    const width = `${((s.to - s.from) / dispRange * 100).toFixed(3)}%`;
    const tip = segmentTip(s);
    const aria = escapeHtml(tip.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    return `<div class="dtl-seg dtl-hit" ${pctProps({ l: left, w: width })} aria-label="${aria}"><span class="dtl-tip">${tip}</span></div>`;
  }).join("");

  const markerMarkup = markerMins.map((m) => {
    const h = Math.floor(m / 60);
    const label = `${h}h`;
    return `<div class="dtl-marker" ${pctProps({ l: toPercent(m) })}><span>${label}</span></div>`;
  }).join("");

  const limitMarkup = TIMELINE_LIMITS_MIN.map((min) => {
    const label = `${Math.floor(min / 60)}h`;
    return `<div class="dtl-limit" ${pctProps({ l: toPercent(min) })} data-label="${label}" title="Limite ${label}"></div>`;
  }).join("");
  const liveLunchMs = computeBreakDuration(sorted);
  const lateBlock  = lateMin > 0 ? `<div class="dtl-stat dtl-stat--late">Retard : <strong>${fmtMs(lateMs)}</strong></div>` : "";
  const lunchBlock = (liveLunchMs > 0 || lunchMs > 0)
    ? `<div class="dtl-stat dtl-stat--lunch">Durée pause déjeuner : <strong data-break-duration-live>${formatElapsedHms(liveLunchMs)}</strong></div>`
    : "";
  const workBlock  = workMs > 0  ? `<div class="dtl-stat">Durée de travail <strong>${fmtMs(workMs)}</strong></div>` : "";

  if (compact || variant === "compact") {
    return `
      <div class="topbar-timeline" aria-label="Chronologie du jour" title="Chronologie du jour">
        <div class="dtl-bar">${segmentMarkup}</div>
        <span class="dtl-elapsed" data-elapsed-clock>${formatElapsedHms(workMs)}</span>
      </div>`;
  }

  if (variant === "history") {
    return `
      <div class="day-timeline day-timeline--history" aria-label="Chronologie">
        <div class="dtl-bar-wrap dtl-bar-wrap--history">
          <div class="dtl-bar">${segmentMarkup}</div>
          ${limitMarkup}
          <div class="dtl-hit-row">${hitMarkup}</div>
          ${opts.showMarkers ? `<div class="dtl-markers-row">${markerMarkup}</div>` : ""}
        </div>
      </div>`;
  }

  return `
    <div class="day-timeline" aria-label="Chronologie de la journée">
      <div class="dtl-bar-wrap">
        <div class="dtl-bar">${segmentMarkup}</div>
        ${limitMarkup}
        <div class="dtl-hit-row">${hitMarkup}</div>
        <div class="dtl-markers-row">${markerMarkup}</div>
      </div>
      <div class="dtl-legend">
        <span class="dtl-legend-item dtl-legend--work">En poste</span>
        <span class="dtl-legend-item dtl-legend--lunch">Pause dej</span>
        <span class="dtl-legend-item dtl-legend--off">Hors poste</span>
        ${lateMin > 0 ? `<span class="dtl-legend-item dtl-legend--late">Retard</span>` : ""}
      </div>
      <div class="dtl-stats">
        ${lateBlock}
        ${lunchBlock}
        ${workBlock}
      </div>
    </div>`;
}

function groupPunchesByDay(punches) {
  const groups = new Map();
  [...punches]
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .forEach((punch) => {
      const key = companyDateKey(punch.time);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(punch);
    });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatHistoryDateLabel(dayKey) {
  const [year, month, day] = String(dayKey).split("-");
  if (!year || !month || !day) return String(dayKey);
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

function historyAsOfMin(dayPunches, dayKey, profile) {
  if (dayKey === toDateKey(new Date())) return null;
  if (dayPunches.some((punch) => punch.type === "out")) return null;
  const shift = getActiveShift(profile);
  const endMin = minutesFromHhmm(shift.end || "18:00");
  const lastMin = Math.max(...dayPunches.map((punch) => companyMinutesOfDay(punch.time)));
  return Math.max(endMin, lastMin);
}

function buildPunchHistoryRows(punches = getPunches()) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  return sorted.map((punch, index) => {
    const next = sorted[index + 1];
    const durationMs = next
      ? new Date(next.time) - new Date(punch.time)
      : (punch.type === "out" ? 0 : Date.now() - new Date(punch.time));
    const wsKey = punch.workStatus || punch.work_status || null;
    return [
      formatDate(punch.time),
      punchTypeLabel(punch.type),
      punch.type === "in" ? workLocationLabel(punch.workLocation || punch.work_location) : "—",
      formatTime(punch.time),
      wsKey && punch.type !== "out" ? workStatusDef(wsKey).label : "—",
      punch.type !== "out" && durationMs > 0 ? formatDuration(durationMs) : "—"
    ];
  });
}

function exportPunchHistoryExcel() {
  const rows = buildPunchHistoryRows();
  if (!rows.length) {
    alert("Aucun pointage à extraire.");
    return;
  }
  downloadCsv(
    `historique-pointages_${toDateKey(new Date())}.csv`,
    ["Date", "Type", "Lieu", "Heure", "Activité", "Durée activité"],
    rows
  );
}

function renderHistoryHourScale() {
  const dispStart = 6 * 60;
  const dispEnd = 21 * 60;
  const dispRange = dispEnd - dispStart;
  const toPercent = (min) => `${(((min - dispStart) / dispRange) * 100).toFixed(3)}%`;
  const markers = [];
  for (let m = Math.ceil(dispStart / 60) * 60; m <= dispEnd; m += 60) {
    markers.push(`<div class="dtl-marker" ${pctProps({ l: toPercent(m) })}><span>${Math.floor(m / 60)}h</span></div>`);
  }
  return `
    <div class="dtl-history-scale" aria-hidden="true">
      <div class="dtl-history-date"></div>
      <div class="dtl-markers-row">${markers.join("")}</div>
    </div>`;
}

function renderPunchHistory(punches, profile) {
  const groups = groupPunchesByDay(punches).slice(0, 14);
  if (!groups.length) {
    return `<p class="empty-state">Aucun historique pour le moment.</p>`;
  }
  return `
    <div class="punch-history-body">
    <div class="dtl-history-legend">
      <span class="dtl-legend-item dtl-legend--work">En poste</span>
      <span class="dtl-legend-item dtl-legend--lunch">Pause dej</span>
      <span class="dtl-legend-item dtl-legend--off">Hors poste</span>
      <span class="dtl-legend-item dtl-legend--late">Retard</span>
    </div>
      ${renderHistoryHourScale()}
    <div class="punch-history-list">
        ${groups.map(([dayKey, dayPunches]) => `
        <div class="dtl-history-row">
          <div class="dtl-history-date">
            <strong>${escapeHtml(formatHistoryDateLabel(dayKey))}</strong>
          </div>
          ${renderDayTimeline(dayPunches, profile, {
            variant: "history",
            asOfMin: historyAsOfMin(dayPunches, dayKey, profile)
          })}
        </div>`).join("")}
      </div>
    </div>`;
}

function foldAbsenceText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/justtifier/g, "justifiee")
    .replace(/injustifier/g, "injustifiee")
    .replace(/\s+/g, " ")
    .trim();
}

function getAbsenceDef(type) {
  const needle = foldAbsenceText(type);
  if (!needle) return null;
  const exact = ABSENCE_CODES.find((item) => foldAbsenceText(item.code) === needle || foldAbsenceText(item.label) === needle);
  if (exact) return exact;
  return [...ABSENCE_CODES]
    .sort((a, b) => foldAbsenceText(b.code).length - foldAbsenceText(a.code).length)
    .find((item) => needle.includes(foldAbsenceText(item.code)) || foldAbsenceText(item.code).includes(needle)) || null;
}

function visibleAbsenceCodes() {
  const grade = getLeaveGrade();
  const admin = isAdmin();
  return ABSENCE_CODES.filter((item) => {
    if (item.adminOnly && !admin) return false;
    if (item.grades && !admin && !item.grades.includes(grade)) return false;
    return true;
  });
}

function leaveTypeOptionsHtml() {
  const grouped = new Map();
  visibleAbsenceCodes().forEach((item) => {
    if (!grouped.has(item.group)) grouped.set(item.group, []);
    grouped.get(item.group).push(item);
  });
  return ["cp", "recup", "family", "event", "unpaid", "work", "time", "admin"]
    .filter((group) => grouped.has(group))
    .map((group) => `
      <optgroup label="${ABSENCE_GROUP_LABELS[group]}">
        ${grouped.get(group).map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`).join("")}
      </optgroup>`).join("");
}

function addWorkingDaysKey(start, count, profile = appData.profile) {
  const cursor = parseLocalDate(start);
  if (Number.isNaN(cursor.getTime()) || count < 1) return start;
  let remaining = count;
  while (!isWorkingDayKey(toDateKey(cursor), profile)) {
    cursor.setDate(cursor.getDate() + 1);
  }
  remaining -= 1;
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDayKey(toDateKey(cursor), profile)) remaining -= 1;
  }
  return toDateKey(cursor);
}

function leaveTypeKey(type) {
  const def = getAbsenceDef(type);
  if (def?.key) return def.key;
  const normalized = foldAbsenceText(type);
  if (normalized.includes("rtt")) return "rtt";
  if (normalized.includes("recup")) return "recup";
  if (normalized.includes("special") || normalized.includes("deces") || normalized.includes("mariage") || normalized.includes("circoncision")) return "special";
  if (normalized.includes("maladie") || normalized.includes("justifi")) return "justified";
  if (normalized.includes("retard") || normalized.includes("depart")) return "hours";
  if (normalized.includes("sans solde")) return "unpaid";
  if (normalized.includes("matern")) return "maternity";
  if (normalized.includes("patern")) return "paternity";
  if (normalized.includes("paye") || normalized.includes("conges payes")) return "cp";
  return null;
}

function getLeaveBalances() {
  const requests = getLeaveRequests();
  const profile = appData.profile;
  const accruedCp = accruedLeaveDays(profile);
  const recup = recoveryDaysForYear(new Date().getFullYear(), profile);
  const stored = usesDatabase()
    ? {
        cp: Number(profile?.leave_balance_cp ?? accruedCp),
        recup: Number(profile?.leave_balance_recup ?? recup)
      }
    : loadStore("leaveBalances", { cp: accruedCp, recup });
  const totals = {
    cp: Math.max(Number(stored.cp) || 0, accruedCp),
    recup: Number(stored.recup) || recup
  };

  const used = { cp: 0, recup: 0 };
  const pending = { cp: 0, recup: 0 };

  requests.forEach((request) => {
    const key = leaveTypeKey(request.type);
    if (!key || !["cp", "recup"].includes(key)) return;
    const amount = Number(request.days || request.hours / 8 || 0);
    const status = String(request.status || "").toLowerCase();
    if (status.includes("refus")) return;
    const bucket = status.includes("approuv") ? used : pending;
    if (status.includes("valider") || status.includes("approuv")) bucket[key] += amount;
  });

  const remainingCp = Math.max(0, totals.cp - used.cp - pending.cp);
  return [
    {
      label: "Congés payés",
      total: totals.cp,
      used: used.cp,
      pending: pending.cp,
      remaining: remainingCp,
      hint: `${LEAVE_ACCRUAL[getLeaveGrade(profile)]} j / mois · ${getLeaveGrade(profile)}`
    },
    {
      label: "Récupération",
      total: totals.recup,
      used: used.recup,
      pending: pending.recup,
      remaining: Math.max(0, totals.recup - used.recup - pending.recup),
      hint: getHolidayCalendar(profile) === "ma"
        ? "Jours fériés France non chômés"
        : "Jours fériés Maroc non chômés"
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
      <div class="balance-track"><i ${pctProps({ w: usedPercent })}></i></div>
      <div class="balance-meta">
        <span>Alloué : <b>${balance.total} j</b></span>
        <span>Utilisé : <b>${balance.used} j</b></span>
        <span>En attente : <b>${balance.pending} j</b></span>
      </div>
      ${balance.hint ? `<small class="hierarchy-meta">${escapeHtml(balance.hint)}</small>` : ""}
    </article>`;
}

function hoursCard(label, value, options = {}) {
  const liveBreak = Boolean(options.liveBreak);
  const text = liveBreak ? formatElapsedHms(value) : formatDuration(value);
  const attr = liveBreak ? " data-break-duration-live" : "";
  return `
    <article class="hours-card">
      <span class="hours-label">${label}</span>
      <strong${attr}>${text}</strong>
    </article>`;
}

function getClockState() {
  const punches = punchesObservedUntil(getPunches());
  const last = [...punches].reverse().find((p) => p.type !== "status_change") || punches[punches.length - 1];
  const lastType = last?.type;
  const onBreak = lastType === "break_start";
  const isWorking = lastType === "in" || lastType === "break_end";
  const isDayOpen = lastType === "in" || lastType === "break_start" || lastType === "break_end";
  return {
    punches,
    isIn: isDayOpen,
    isWorking,
    onBreak,
    isOut: !isDayOpen
  };
}

function getTodayPunches(punches = getPunches()) {
  const today = companyDateKey();
  const now = Date.now();
  return punches.filter((punch) => companyDateKey(punch.time) === today && !isFuturePunch(punch, now));
}

const LATE_REMINDER_OFFSET_MIN = 3;
const LATE_REMINDER_STORE_KEY = "humana_late_reminder_shown";
const GTA_NOTIF_STORE_KEY = "humana_gta_notif";
let lateReminderWatcher = null;
let lateReminderPopupOpen = false;
let lateReminderNotificationRequested = false;
let pendingDesktopNotif = null;
let serviceWorkerBound = false;

function gtaNotifStorageKey(kind, extra = "") {
  const dayKey = toDateKey(new Date());
  const userId = session?.user?.id || "self";
  return `${GTA_NOTIF_STORE_KEY}:${kind}:${userId}:${dayKey}${extra ? `:${extra}` : ""}`;
}

function gtaNotifAlreadyShown(key) {
  return sessionStorage.getItem(key) === "shown";
}

function gtaNotifMarkShown(key) {
  sessionStorage.setItem(key, "shown");
}

function formatNotifClock(date = new Date()) {
  const civil = toCompanyCivil(date);
  return `${String(civil.hours).padStart(2, "0")}h${String(civil.minutes).padStart(2, "0")}`;
}

function formatNotifMinutes(totalMin) {
  const minutes = Math.max(0, Math.round(Number(totalMin) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return `${hours}h${String(rest).padStart(2, "0")}`;
  return `${minutes} min`;
}

function desktopNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function getNotificationIcon() {
  try {
    return new URL("/assets/favicon-192.png", window.location.origin).href;
  } catch (_) {
    return undefined;
  }
}

function withTimeout(promise, ms) {
  if (!promise || typeof promise.then !== "function") {
    return Promise.reject(new Error("unavailable"));
  }
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), ms);
    })
  ]);
}

async function requestDesktopNotificationPermission(options = {}) {
  const fromGesture = Boolean(options.userGesture);
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") {
    ensureServiceWorkerAndPush();
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  if (!fromGesture) {
    if (lateReminderNotificationRequested) return Notification.permission;
    lateReminderNotificationRequested = true;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      ensureServiceWorkerAndPush();
      await flushPendingDesktopNotifications();
    }
    return permission;
  } catch (_) {
    return Notification.permission;
  }
}

function requestLateReminderPermission() {
  requestDesktopNotificationPermission({ userGesture: true });
}

async function flushPendingDesktopNotifications() {
  const payload = pendingDesktopNotif;
  if (!payload) return false;
  pendingDesktopNotif = null;
  return fireWindowsNotification(payload);
}

async function fireWindowsNotification({ title, body, tag, page = "pointeuse" }) {
  const payload = { title, body, tag, page };
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") {
    pendingDesktopNotif = payload;
    return false;
  }
  const icon = getNotificationIcon();
  const options = {
    body,
    tag: tag || "humana-gta",
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: "/", page }
  };
  if (icon) {
    options.icon = icon;
    options.badge = icon;
  }

  try {
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      if (page && Object.prototype.hasOwnProperty.call(pages, page)) navigateToPage(page);
      notif.close();
    };
    return true;
  } catch (error) {
    console.warn("[humana] notification failed", error);
  }

  try {
    const registration = await withTimeout(navigator.serviceWorker?.ready, 1200);
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return true;
    }
  } catch (error) {
    console.warn("[humana] sw notification failed", error);
  }
  return false;
}

function shouldTriggerLateReminder() {
  if (portalMode || !session?.user) return null;
  const now = new Date();
  const dayKey = toDateKey(now);
  if (!isWorkingDayKey(dayKey)) return null;

  const shift = getActiveShift();
  const startMin = minutesFromHhmm(shift.start);
  const nowMin = companyMinutesOfDay(now);
  const triggerMin = startMin + LATE_REMINDER_OFFSET_MIN;
  if (nowMin < triggerMin) return null;

  const todayIn = getTodayPunches().some((punch) => punch.type === "in");
  if (todayIn) return null;

  const storeKey = `${LATE_REMINDER_STORE_KEY}:${session.user.id || "self"}:${dayKey}`;
  if (sessionStorage.getItem(storeKey) === "shown") return null;

  return {
    delayMinutes: Math.round(nowMin - startMin),
    shift,
    triggerLabel: `${String(Math.floor(triggerMin / 60)).padStart(2, "0")}:${String(triggerMin % 60).padStart(2, "0")}`,
    storeKey
  };
}

function shouldTriggerOvertimeNotice() {
  if (portalMode || !session?.user) return null;
  const { isWorking, onBreak } = getClockState();
  if (!isWorking && !onBreak) return null;
  const shift = getActiveShift();
  const plannedMs = (Number(shift.plannedHours) || 8) * 3600000;
  const workedMs = computeWorkedHours(getPunches()).today;
  if (workedMs <= plannedMs) return null;
  const extraMin = Math.round((workedMs - plannedMs) / 60000);
  const bucket = Math.floor(extraMin / 30);
  const storeKey = gtaNotifStorageKey("overtime", String(bucket));
  if (gtaNotifAlreadyShown(storeKey)) return null;
  return {
    extraMin,
    plannedHours: shift.plannedHours,
    storeKey
  };
}

function shouldTriggerLongBreakNotice() {
  if (portalMode || !session?.user) return null;
  if (!getClockState().onBreak) return null;
  const shift = getActiveShift();
  const allowedMin = Number(shift.lunchMin) || 60;
  const breakMin = Math.round(computeBreakDuration(getTodayPunches()) / 60000);
  if (breakMin <= allowedMin + 2) return null;
  const bucket = Math.floor(Math.max(0, breakMin - allowedMin) / 15);
  const storeKey = gtaNotifStorageKey("long-break", String(bucket));
  if (gtaNotifAlreadyShown(storeKey)) return null;
  return { breakMin, allowedMin, storeKey };
}

function notifyLateArrivalIfNeeded() {
  const shift = getActiveShift();
  const now = new Date();
  const nowMin = companyMinutesOfDay(now);
  const lateAfterMin = minutesFromHhmm(shift.lateAfter);
  const delayMin = nowMin - lateAfterMin;
  if (delayMin <= 0) return;
  const storeKey = gtaNotifStorageKey("late-arrival");
  if (gtaNotifAlreadyShown(storeKey)) return;
  gtaNotifMarkShown(storeKey);
  fireWindowsNotification({
    title: "Retard enregistré",
    body: `Arrivée ${formatNotifClock(now)} — heure max attendue ${String(shift.lateAfter).replace(":", "h")} (retard ${formatNotifMinutes(delayMin)}).`,
    tag: "humana-late-arrival",
    page: "pointeuse"
  });
}

function notifyOvertimeOnExitIfNeeded() {
  const shift = getActiveShift();
  const plannedMs = (Number(shift.plannedHours) || 8) * 3600000;
  const workedMs = computeWorkedHours(getPunches()).today;
  const extraMin = Math.round((workedMs - plannedMs) / 60000);
  if (extraMin <= 0) return;
  const storeKey = gtaNotifStorageKey("overtime-exit");
  if (gtaNotifAlreadyShown(storeKey)) return;
  gtaNotifMarkShown(storeKey);
  fireWindowsNotification({
    title: "Dépassement d'horaire",
    body: `Journée clôturée avec ${formatNotifMinutes(extraMin)} au-delà des ${shift.plannedHours} h planifiées. Pensez à faire valider vos heures supplémentaires.`,
    tag: "humana-overtime-exit",
    page: "pointeuse"
  });
}

function fireBrowserLateNotification(info) {
  fireWindowsNotification({
    title: "⏰ Pointage oublié",
    body: `Il est ${info.triggerLabel} passé et tu n'as pas encore pointé ton arrivée. Retard : ${formatNotifMinutes(info.delayMinutes)}.`,
      tag: "humana-late-reminder",
    page: "pointeuse"
  });
}

function closeLateReminderPopup() {
  const overlay = document.getElementById("late-reminder-overlay");
  overlay?.remove();
  lateReminderPopupOpen = false;
}

function lateReminderWindowsMarkup() {
  const permission = desktopNotificationPermission();
  if (permission === "granted" || permission === "unsupported") return "";
  if (permission === "denied") {
    return `<p class="late-reminder-hint">Les notifications Windows sont bloquées. Cliquez sur le cadenas dans la barre d'adresse, autorisez ce site, puis rechargez.</p>`;
  }
  return `<button type="button" class="outline-button" id="late-reminder-windows">Activer l'alerte Windows</button>`;
}

function showLateReminderPopup(info) {
  if (lateReminderPopupOpen) return;
  lateReminderPopupOpen = true;
  const existing = document.getElementById("late-reminder-overlay");
  existing?.remove();

  const overlay = document.createElement("div");
  overlay.id = "late-reminder-overlay";
  overlay.className = "late-reminder-overlay";
  overlay.innerHTML = `
    <div class="late-reminder-card" role="alertdialog" aria-live="assertive" aria-labelledby="late-reminder-title">
      <div class="late-reminder-mascot" aria-hidden="true">
        <span class="late-mascot-wing late-mascot-wing-left"></span>
        <span class="late-mascot-wing late-mascot-wing-right"></span>
        <span class="late-mascot-eye late-mascot-eye-left"><i></i></span>
        <span class="late-mascot-eye late-mascot-eye-right"><i></i></span>
        <span class="late-mascot-beak"></span>
        <span class="late-mascot-foot late-mascot-foot-left"></span>
        <span class="late-mascot-foot late-mascot-foot-right"></span>
      </div>
      <h3 id="late-reminder-title">Tu n'as pas encore pointé !</h3>
      <p class="late-reminder-body">
        Il est déjà passé <strong>${info.triggerLabel}</strong>. Ton retard atteint <strong>${info.delayMinutes} min</strong>. Pointe ton arrivée dès maintenant pour éviter un décompte au-delà de l'heure limite (${info.shift.lateAfter}).
      </p>
      <div class="late-reminder-actions">
        <button type="button" class="primary" id="late-reminder-clock">Pointer maintenant</button>
        <button type="button" class="outline-button" id="late-reminder-snooze">Me rappeler dans 5 min</button>
        ${lateReminderWindowsMarkup()}
        <button type="button" class="outline-button" id="late-reminder-close" aria-label="Fermer">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const snoozeUntil = new Date();
  snoozeUntil.setMinutes(snoozeUntil.getMinutes() + 5);

  overlay.querySelector("#late-reminder-clock")?.addEventListener("click", () => {
    closeLateReminderPopup();
    sessionStorage.setItem(info.storeKey, "shown");
    navigateToPage("pointeuse").then(() => {
      try {
        if (getClockState().isOut) document.querySelector("#clock-toggle")?.click();
      } catch (_) { /* ignore */ }
    });
  });

  overlay.querySelector("#late-reminder-snooze")?.addEventListener("click", () => {
    closeLateReminderPopup();
    sessionStorage.setItem(info.storeKey, "shown");
    setTimeout(() => {
      sessionStorage.removeItem(info.storeKey);
    }, 5 * 60 * 1000);
  });

  overlay.querySelector("#late-reminder-close")?.addEventListener("click", () => {
    closeLateReminderPopup();
    sessionStorage.setItem(info.storeKey, "shown");
  });

  overlay.querySelector("#late-reminder-windows")?.addEventListener("click", async () => {
    const permission = await requestDesktopNotificationPermission({ userGesture: true });
    const btn = overlay.querySelector("#late-reminder-windows");
    if (permission === "granted") {
      await fireWindowsNotification({
        title: "⏰ Pointage oublié",
        body: `Il est ${info.triggerLabel} passé et tu n'as pas encore pointé ton arrivée. Retard : ${formatNotifMinutes(info.delayMinutes)}.`,
        tag: "humana-late-reminder",
        page: "pointeuse"
      });
      const hint = document.createElement("p");
      hint.className = "late-reminder-hint";
      hint.textContent = "Alerte Windows activée : regardez aussi la barre de notifications.";
      btn?.replaceWith(hint);
      return;
    }
    if (permission === "denied") {
      const hint = document.createElement("p");
      hint.className = "late-reminder-hint";
      hint.textContent = "Notifications Windows bloquées. Cliquez sur le cadenas dans la barre d'adresse, autorisez ce site, puis rechargez.";
      btn?.replaceWith(hint);
    }
  });
}

function checkLateReminder() {
  const info = shouldTriggerLateReminder();
  if (!info) return;
  showLateReminderPopup(info);
  fireBrowserLateNotification(info);
  sessionStorage.setItem(info.storeKey, "shown");
}

function checkGtaDesktopAlerts() {
  try { checkLateReminder(); } catch (error) {
    console.warn("[humana] late reminder check failed", error);
  }
  try {
    const overtime = shouldTriggerOvertimeNotice();
    if (overtime) {
      gtaNotifMarkShown(overtime.storeKey);
      fireWindowsNotification({
        title: "Dépassement d'horaire",
        body: `Vous avez dépassé les ${overtime.plannedHours} h planifiées (${formatNotifMinutes(overtime.extraMin)}). Pensez à faire valider vos heures supplémentaires.`,
        tag: "humana-overtime",
        page: "pointeuse"
      });
    }
    } catch (error) {
    console.warn("[humana] overtime notice failed", error);
  }
  try {
    const longBreak = shouldTriggerLongBreakNotice();
    if (longBreak) {
      gtaNotifMarkShown(longBreak.storeKey);
      fireWindowsNotification({
        title: "Pause déjeuner dépassée",
        body: `Pause en cours depuis ${formatNotifMinutes(longBreak.breakMin)} (prévu : ${formatNotifMinutes(longBreak.allowedMin)}).`,
        tag: "humana-long-break",
        page: "pointeuse"
      });
    }
  } catch (error) {
    console.warn("[humana] long break notice failed", error);
  }
}

function startLateReminderWatcher() {
  ensureServiceWorkerAndPush();
  if (lateReminderWatcher) return;
  lateReminderWatcher = setInterval(() => {
    checkGtaDesktopAlerts();
  }, 60 * 1000);
  setTimeout(() => {
    checkGtaDesktopAlerts();
  }, 2500);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function ensureServiceWorkerAndPush() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const swUrl = new URL(assetUrl("sw.js"), window.location.href).href;
    const registration = await navigator.serviceWorker.register(swUrl);
    const onWorkerMessage = function (event) {
      if (event.origin !== location.origin) {
        return;
      }
      if (!event.data || event.data.type !== "humana:open-page" || !event.data.page) {
        return;
      }
      const requestedPage = String(event.data.page);
      if (!Object.prototype.hasOwnProperty.call(pages, requestedPage)) {
        return;
      }
      navigateToPage(requestedPage);
    };
    if (!serviceWorkerBound) {
      serviceWorkerBound = true;
      navigator.serviceWorker.addEventListener("message", onWorkerMessage);
      window.addEventListener("message", onWorkerMessage);
    }

    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!session?.user?.id || !usesDatabase() || !supabaseClient) return;
    if (!("PushManager" in window)) return;

    const vapidPublic = (window.HUMANA_CONFIG || {}).VAPID_PUBLIC_KEY || "";
    if (!vapidPublic) return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic)
      });
    }

    const raw = subscription.toJSON();
    if (!raw?.keys?.p256dh || !raw?.keys?.auth) return;

    await supabaseClient.from("push_subscriptions").upsert({
      user_id: session.user.id,
      endpoint: raw.endpoint,
      p256dh: raw.keys.p256dh,
      auth: raw.keys.auth,
      user_agent: "web",
      last_seen_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
  } catch (error) {
    console.warn("[humana] push subscription failed", error);
  }
}

function stopLateReminderWatcher() {
  if (lateReminderWatcher) {
    clearInterval(lateReminderWatcher);
    lateReminderWatcher = null;
  }
  closeLateReminderPopup();
}

function getClockStatusCopy() {
  const { isWorking, onBreak } = getClockState();
  const hasToday = getTodayPunches().length > 0;

  if (onBreak) {
    return {
      title: "Pause déjeuner",
      hint: "Votre pause est enregistrée. Cliquez sur « Reprise après déjeuner » pour continuer.",
      tone: "break",
      homeLine: "En pause déjeuner"
    };
  }

  if (isWorking) {
    const status = workStatusDef(getCurrentWorkStatus());
    const inProduction = status.value === "production";
    return {
      title: inProduction ? "Vous êtes en production" : `Vous êtes en ${status.label.toLowerCase()}`,
      hint: inProduction
        ? "Le statut Production a commencé à l'arrivée. Il s'arrête lorsque vous cliquez sur « Je pars »."
        : "Vous pouvez revenir en Production à tout moment, jusqu'à la fin de service.",
      tone: "in",
      homeLine: inProduction ? "Vous êtes en production" : `En ${status.label.toLowerCase()}`
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

function renderClockActions() {
  const { isWorking, onBreak, isOut } = getClockState();

  if (isOut) {
    return `
      <div class="clock-actions">
        <button type="button" id="clock-toggle" class="clock-button in">J'arrive</button>
        <button type="button" class="clock-button break-start" disabled aria-disabled="true" title="Pointez d'abord votre arrivée">Pause déjeuner</button>
      </div>`;
  }

  if (onBreak) {
    return `
      <div class="clock-actions">
        <button type="button" id="break-toggle" class="clock-button break-end">Reprise après déjeuner</button>
        <button type="button" class="clock-button out clock-button-secondary" disabled aria-disabled="true" title="Terminez d'abord votre pause déjeuner">Je pars</button>
      </div>`;
  }

  return `
    <div class="clock-actions">
      <button type="button" id="break-toggle" class="clock-button break-start">Pause déjeuner</button>
      <button type="button" id="clock-toggle" class="clock-button out">Je pars</button>
    </div>`;
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
  { id: "d1", title: "Règlement intérieur", description: "Version 2026", category: "Politique", file_url: "#", published_at: "2026-01-15" },
  { id: "d2", title: "Charte du télétravail", description: "Politique hybride", category: "Politique", file_url: "#", published_at: "2026-02-01" },
  { id: "d3", title: "Guide des congés", description: "CP, RTT et absences", category: "Congés", file_url: "#", published_at: "2026-02-10" },
  { id: "d4", title: "Note de service Q1", description: "Actualités RH", category: "Communication", file_url: "#", published_at: "2026-03-01" }
];

function canSeeVisibility(visibility) {
  const vis = String(visibility || "all");
  if (vis === "admins") return isAdmin();
  if (vis === "managers") {
    return hasOrgWideAccess() || appData.profile?.role === "manager" || hasDirectReports();
  }
  return true;
}

function canSeeHrDocument(doc) {
  return canSeeVisibility(doc?.visibility);
}

function getHrDocuments() {
  const docs = usesDatabase()
    ? (appData.hrDocuments || [])
    : loadStore("hrDocuments", demoHrDocuments);
  return docs.filter(canSeeHrDocument);
}

function getPrivateStoragePath(fileRecord) {
  const storedPath = String(fileRecord?.storage_path || "").trim();
  if (storedPath) return storedPath;

  const legacyUrl = String(fileRecord?.file_url || "").trim();
  if (!legacyUrl) return "";
  const markers = [
    `/object/public/${HR_DOCUMENTS_BUCKET}/`,
    `/object/sign/${HR_DOCUMENTS_BUCKET}/`
  ];
  const marker = markers.find((candidate) => legacyUrl.includes(candidate));
  if (!marker) return "";

  const encodedPath = legacyUrl.split(marker)[1]?.split("?")[0] || "";
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

async function createPrivateFileUrl(fileRecord) {
  const storagePath = getPrivateStoragePath(fileRecord);
  if (!storagePath) {
    throw new Error("Chemin du fichier introuvable. Renseignez storage_path pour cet ancien document.");
  }
  const { data, error } = await supabaseClient.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, PRIVATE_FILE_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Impossible de générer le lien temporaire.");
  return data.signedUrl;
}

function privateFileLinkAttributes(kind, fileRecord) {
  if (!usesDatabase()) {
    const url = String(fileRecord?.file_url || "#");
    return `href="${escapeHtml(/^https?:\/\//i.test(url) ? url : "#")}"`;
  }
  return `href="#" data-private-file-kind="${kind}" data-private-file-id="${escapeHtml(fileRecord?.id || "")}"`;
}

function sanitizeFileName(name) {
  return String(name || "document")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || "document";
}

async function uploadEventPosterFile(file) {
  if (!EVENT_POSTER_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Format d'affiche non supporté (JPG, PNG, WEBP ou GIF).");
  }
  if (file.size > EVENT_POSTER_MAX_BYTES) {
    throw new Error("L'affiche dépasse 5 Mo. Compressez l'image avant l'upload.");
  }
  const safeName = sanitizeFileName(file.name);
  const storagePath = `posters/${Date.now()}-${safeName}`;
  const { error } = await supabaseClient.storage
    .from(EVENT_POSTERS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg"
    });
  if (error) throw error;
  const { data } = supabaseClient.storage
    .from(EVENT_POSTERS_BUCKET)
    .getPublicUrl(storagePath);
  return { storagePath, publicUrl: data?.publicUrl || "" };
}

async function deleteEventPosterFile(storagePath) {
  if (!storagePath) return;
  try {
    await supabaseClient.storage.from(EVENT_POSTERS_BUCKET).remove([storagePath]);
  } catch (error) {
    console.warn("[humana] event poster cleanup failed", error);
  }
}

const HR_DOCUMENT_ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv"
];
const PAYSLIP_MAX_BYTES = 10 * 1024 * 1024;
const PAYSLIP_ACCEPTED_TYPES = ["application/pdf"];

function assertUploadAllowed(file, { types, maxBytes, label }) {
  if (!file || typeof file.size !== "number") {
    throw new Error(`${label} : fichier invalide.`);
  }
  if (file.size <= 0) {
    throw new Error(`${label} : fichier vide.`);
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new Error(`${label} : fichier trop volumineux (max ${mb} Mo).`);
  }
  if (types && types.length && !types.includes(file.type)) {
    throw new Error(`${label} : format non autorisé.`);
  }
}

async function uploadHrDocumentFile(file) {
  assertUploadAllowed(file, {
    types: HR_DOCUMENT_ACCEPTED_TYPES,
    maxBytes: HR_DOCUMENT_MAX_BYTES,
    label: "Document RH"
  });
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
  return { storagePath };
}

async function uploadPayslipFile(file, userId) {
  assertUploadAllowed(file, {
    types: PAYSLIP_ACCEPTED_TYPES,
    maxBytes: PAYSLIP_MAX_BYTES,
    label: "Bulletin de paie"
  });
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
  return { storagePath };
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
      <div class="balance-track"><i ${pctProps({ w: usedPercent })}></i></div>
      <small>${balance.used} j utilises · ${balance.pending} j en attente</small>
    </div>`;
}

function dayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

/* homePage() moved to pages/home.js */

function renderGtaClockTools() {
  const used = correctionsThisMonth().length;
  const remaining = Math.max(0, PUNCH_CORRECTION_QUOTA - used);
  const today = toDateKey(new Date());
  const stats = analyzeWorkedDay({
    userId: session?.user?.id,
    dayKey: today,
    startTime: getTodayPunches().find((punch) => punch.type === "in")?.time,
    workedMs: computeWorkedHours(getPunches()).today,
    breakDurationMs: computeBreakDuration(getTodayPunches())
  }, appData.profile);
  return `
    <section class="hours-grid gta-hours-grid">
      ${hoursCard("Planifié", stats.plannedMs)}
      ${hoursCard("Manquant", stats.missingMs)}
      ${hoursCard("HS payables", stats.payableOtMs)}
    </section>
    <div class="feature-grid page-spacer">
      <article class="card form-card">
        ${cardHeading("Correction de pointage")}
        <p class="hierarchy-meta">Quota : ${remaining}/${PUNCH_CORRECTION_QUOTA} demandes ce mois. Après validation du manager, l'heure d'entrée, de pause ou de sortie est réellement mise à jour (le retard EDS est recalculé).</p>
        <form id="punch-correction-form" class="feature-form">
          <label>Date <input type="date" name="date" value="${today}" required></label>
          <label>Point a rectifier
            <select name="punch_kind" required>
              ${PUNCH_KIND_OPTIONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("")}
            </select>
          </label>
          <label>Heure demandée <input type="time" name="time" required></label>
          <label>Motif <textarea name="reason" rows="2" required placeholder="Oubli de badge, pause non pointée..."></textarea></label>
          <button type="submit" class="primary" ${remaining ? "" : "disabled"}>Signaler l'anomalie</button>
        </form>
      </article>
      <article class="card form-card">
        ${cardHeading("Heures supplémentaires")}
        <p class="hierarchy-meta">Sans validation préalable, les heures supplémentaires ne sont pas payées.</p>
        <form id="overtime-form" class="feature-form">
          <label>Date <input type="date" name="date" value="${today}" required></label>
          <label>Heures <input type="number" name="hours" min="0.5" step="0.5" value="1" required></label>
          <label>Motif <textarea name="reason" rows="2" required></textarea></label>
          <button type="submit" class="primary">Demander validation</button>
        </form>
      </article>
      <!-- Feuille de temps retirée — statut déplacé dans la topbar -->
    </div>
    ${renderGtaOwnLists()}`;
}

function renderGtaStatusRows(items, emptyLabel, extraCell) {
  const rows = items;
  if (!rows.length) {
    return `<tr><td colspan="5" class="empty-cell">${emptyLabel}</td></tr>`;
  }
  return rows.map((item) => `
    <tr>
      <td>${escapeHtml(profileById(gtaItemUserId(item))?.full_name || getUserName())}</td>
      <td>${formatDate(gtaItemDate(item))}</td>
      <td>${escapeHtml(extraCell(item))}</td>
      <td>${badge(item.status)}</td>
      <td>${canManageGtaItem(item) && String(item.status || "").toLowerCase().includes("valider")
        ? `<button type="button" class="primary gta-approve" data-gta-kind="${item._kind}" data-gta-id="${item.id}">Valider</button>
           <button type="button" class="outline-button gta-reject" data-gta-kind="${item._kind}" data-gta-id="${item.id}">Refuser</button>`
        : ""}</td>
    </tr>`).join("");
}

function withGtaKind(list, kind) {
  return (list || []).map((item) => ({ ...item, _kind: kind }));
}

function renderGtaOwnLists() {
  const mine = (list) => (list || []).filter((item) => gtaItemUserId(item) === session?.user?.id);
  const rows = [
              ...mine(getPunchCorrections()).map((item) => ({ kind: formatPunchKind(item.punch_kind || item.punchKind || "in"), date: gtaItemDate(item), detail: `${item.time || item.requested_time || ""} — ${item.reason || ""}`, status: item.status })),
    ...mine(getOvertimeRequests()).map((item) => ({ kind: "Heures supp.", date: gtaItemDate(item), detail: `${item.hours || 0} h`, status: item.status })),
    ...mine(getActivityEntries()).map((item) => ({ kind: "Activite", date: gtaItemDate(item), detail: item.category || item.comment || "", status: item.status }))
  ];
  const page = paginateList("gta-own", rows);
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Mes demandes GTA</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Date</th><th>Détail</th><th>Statut</th></tr></thead>
          <tbody>
            ${page.items.length
              ? page.items.map((row) => `
                <tr>
                  <td>${escapeHtml(row.kind)}</td>
                  <td>${formatDate(row.date)}</td>
                  <td>${escapeHtml(row.detail)}</td>
                  <td>${badge(row.status)}</td>
                </tr>`).join("")
              : `<tr><td colspan="4" class="empty-cell">Aucune demande de correction, d'heures supplémentaires ou d'activité.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
}

function renderGtaTeamInbox() {
  if (!canViewTeamPunches() && !isAdmin()) return "";
  const pending = [
    ...withGtaKind(pendingGtaItems(getPunchCorrections()), "corrections"),
    ...withGtaKind(pendingGtaItems(getOvertimeRequests()), "overtime"),
    ...withGtaKind(pendingGtaItems(getActivityEntries()), "activity")
  ].filter(canManageGtaItem);
  if (!pending.length) return "";
  const page = paginateList("gta-inbox", pending);
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Validations GTA</h3></div>
      <p class="hierarchy-meta">Corrections de pointage, heures supplémentaires et feuilles de temps.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Date</th><th>Demande</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${renderGtaStatusRows(page.items, "Aucune demande à valider.", (item) => {
              if (item._kind === "corrections") return `${formatPunchKind(item.punch_kind || item.punchKind)} ${item.time || item.requested_time || ""} — ${item.reason || ""}`;
              if (item._kind === "overtime") return `HS ${item.hours || 0} h — ${item.reason || ""}`;
              return `${item.category || "Activite"} · ${item.hours || 0} h`;
            })}
          </tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
}

/* pointeusePage() moved to pages/pointeuse.js */

function canViewJournalTeam() {
  return hasOrgWideAccess() || hasDirectReports();
}

function getJournalProfiles() {
  if (hasOrgWideAccess()) return getTeamPunchProfiles("all");
  if (hasDirectReports()) {
    const self = profileById(session?.user?.id);
    const seen = new Set();
    return [self, ...getDirectReportProfiles()].filter((profile) => {
      if (!profile?.id || seen.has(profile.id)) return false;
      seen.add(profile.id);
      return true;
    });
  }
  const self = appData.profile || profileById(session?.user?.id);
  return self ? [self] : [];
}

function shiftDateKey(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function mapPunchToJournalRow(row, fallbackUserId) {
  const userId = row.user_id || row.userId || fallbackUserId;
  const type = row.punch_type || row.type;
  const time = row.punched_at || row.time;
  const profile = row.profiles || profileById(userId);
  return {
    id: row.id || `local-${userId}-${time}-${type}`,
    user_id: userId,
    punch_type: type,
    punched_at: time,
    work_location: row.work_location || row.workLocation || null,
    connection_method: row.connection_method || row.method || null,
    operating_system: row.operating_system || row.os || null,
    browser_application: row.browser_application || row.browser || null,
    ip_address: row.ip_address || row.ip || null,
    network_type: row.network_type || row.network || null,
    disconnect_reason: row.disconnect_reason || null,
    profiles: profile ? { full_name: profile.full_name, email: profile.email } : row.profiles
  };
}

function buildSeedJournalRows(userId) {
  const profile = profileById(userId) || appData.profile || {};
  const meta = parseClientEnvironment();
  const now = Date.now();
  const rows = [];
  const samples = [
    { daysAgo: 0, inHour: 8, inMin: 42, outHour: null, location: "onsite", statusOpen: true },
    { daysAgo: 1, inHour: 9, inMin: 5, outHour: 18, outMin: 12, location: "onsite" },
    { daysAgo: 2, inHour: 8, inMin: 57, outHour: 17, outMin: 48, location: "remote" },
    { daysAgo: 3, inHour: 9, inMin: 14, outHour: 18, outMin: 3, location: "onsite", autoOut: true }
  ];

  samples.forEach((sample, index) => {
    const day = new Date(now);
    day.setDate(day.getDate() - sample.daysAgo);
    const inTime = new Date(day);
    inTime.setHours(sample.inHour, sample.inMin, 12 + index, 0);
    const inId = `SESDEMO${index}IN`;
    rows.push({
      id: inId,
      user_id: userId,
      punch_type: "in",
      punched_at: inTime.toISOString(),
      work_location: sample.location,
      connection_method: meta.method,
      operating_system: meta.os,
      browser_application: meta.browser,
      ip_address: "90.84.12.4" + index,
      network_type: sample.location === "remote" ? "Wi-Fi" : "LAN",
      profiles: { full_name: profile.full_name || getUserName(), email: profile.email || "" }
    });
    if (sample.statusOpen) return;
    const outTime = new Date(day);
    outTime.setHours(sample.outHour, sample.outMin || 0, 40, 0);
    rows.push({
      id: `SESDEMO${index}OUT`,
      user_id: userId,
      punch_type: "out",
      punched_at: outTime.toISOString(),
      disconnect_reason: sample.autoOut ? "Déconnexion automatique" : "Sortie manuelle",
      profiles: { full_name: profile.full_name || getUserName(), email: profile.email || "" }
    });
  });
  return rows;
}

function getJournalPunchSource() {
  const userId = session?.user?.id || "demo-user";
  if (!usesDatabase()) {
    const local = loadStore("punches", []).map((punch) => mapPunchToJournalRow(punch, userId));
    return local.length ? local : buildSeedJournalRows(userId);
  }
  const source = journalPunchesInitialLoadDone
    ? (appData.journalPunches || [])
    : (appData.punches || []);
  return source.map((row) => mapPunchToJournalRow(row, row.user_id || userId));
}

function makeSessionId(inRow) {
  const raw = String(inRow.id || `${inRow.user_id}-${inRow.punched_at}`).replace(/-/g, "").toUpperCase();
  const token = raw.slice(0, 12) || String(Date.now());
  return token.startsWith("SES") ? token : `SES-${token}`;
}

function displayOrDash(value) {
  const text = String(value ?? "").trim();
  return text ? text : "—";
}

function finalizeJournalSession(open, outRow) {
  const profile = profileById(open.userId) || open.inRow.profiles || appData.profile || {};
  const inTime = open.inRow.punched_at;
  const outTime = outRow?.punched_at || null;
  const durationMs = (outTime ? new Date(outTime).getTime() : Date.now()) - new Date(inTime).getTime();
  const storedReason = outRow?.disconnect_reason || "";
  const autoOut = Boolean(outTime) && (
    storedReason.toLowerCase().includes("automat")
    || Math.abs(durationMs - AUTO_CLOCK_OUT_MS) < 120000
  );
  const status = outTime ? "Déconnecté" : "Connecté";
  const reason = !outTime ? "—" : (autoOut ? "Déconnexion automatique" : (storedReason || "Sortie manuelle"));
  const locationValue = open.inRow.work_location;
  return {
    sessionId: makeSessionId(open.inRow),
    matricule: displayOrDash(getProfileMatricule(open.userId)),
    name: profile.full_name || "Collaborateur",
    department: displayOrDash(profile.department),
    connectedAt: inTime,
    disconnectedAt: outTime,
    dateIn: formatDate(inTime),
    timeIn: formatTimeSeconds(inTime),
    dateOut: outTime ? formatDate(outTime) : "—",
    timeOut: outTime ? formatTimeSeconds(outTime) : "—",
    duration: formatDuration(durationMs),
    durationMs,
    method: displayOrDash(open.inRow.connection_method),
    os: displayOrDash(open.inRow.operating_system),
    browser: displayOrDash(open.inRow.browser_application),
    ip: displayOrDash(open.inRow.ip_address),
    network: displayOrDash(open.inRow.network_type),
    location: locationValue ? workLocationLabel(locationValue) : "—",
    status,
    reason,
    userId: open.userId
  };
}

function buildPunchSessions(punchRows) {
  const byUser = new Map();
  punchRows.forEach((row) => {
    if (!row?.user_id || !row.punched_at) return;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  });

  const sessions = [];
  byUser.forEach((rows, userId) => {
    const sorted = [...rows].sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));
    let open = null;
    sorted.forEach((row) => {
      if (row.punch_type === "in") {
        if (open) sessions.push(finalizeJournalSession(open, null));
        open = { inRow: row, userId };
        return;
      }
      if (row.punch_type === "out" && open) {
        sessions.push(finalizeJournalSession(open, row));
        open = null;
      }
    });
    if (open) sessions.push(finalizeJournalSession(open, null));
  });
  return sessions;
}

function getJournalRange() {
  return journalFilters.start && journalFilters.end
    ? journalFilters
    : getDefaultTeamPunchRange();
}

function getUnfilteredJournalSessions() {
  const range = getJournalRange();
  return buildPunchSessions(getJournalPunchSource()).filter((session) => {
    const dayKey = toDateKey(new Date(session.connectedAt));
    if (dayKey < range.start || dayKey > range.end) return false;
    if (journalFilters.userId && session.userId !== journalFilters.userId) return false;
    return true;
  });
}

function getJournalSessions() {
  const query = (journalFilters.query || "").trim().toLowerCase();
  let sessions = getUnfilteredJournalSessions();

  if (query) {
    sessions = sessions.filter((session) => JOURNAL_COLUMNS.some((column) =>
      String(session[column.key] || "").toLowerCase().includes(query)
    ));
  }

  Object.entries(journalColumnFilters).forEach(([key, value]) => {
    if (!value) return;
    sessions = sessions.filter((session) => String(session[key] || "") === value);
  });

  const dir = journalSort.dir === "asc" ? 1 : -1;
  const key = journalSort.key || "connectedAt";
  sessions.sort((a, b) => {
    if (key === "connectedAt" || key === "disconnectedAt") {
      const aTime = a[key] ? new Date(a[key]).getTime() : 0;
      const bTime = b[key] ? new Date(b[key]).getTime() : 0;
      return (aTime - bTime) * dir;
    }
    if (key === "duration") return ((a.durationMs || 0) - (b.durationMs || 0)) * dir;
    return String(a[key] || "").localeCompare(String(b[key] || ""), "fr", { numeric: true }) * dir;
  });
  return sessions;
}

function uniqueJournalValues(key) {
  return [...new Set(getUnfilteredJournalSessions().map((session) => String(session[key] || "—")))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}

async function loadJournalPunches(filters = journalFilters) {
  if (!canViewJournal() || !usesDatabase()) {
    appData.journalPunches = [];
    return [];
  }

  const range = filters.start && filters.end ? filters : getDefaultTeamPunchRange();
  const profiles = getJournalProfiles();
  const userIds = filters.userId
    ? [filters.userId]
    : profiles.map((profile) => profile.id);

  let query = supabaseClient
    .from("time_punches")
    .select("*, profiles(full_name, email)")
    .gte("punched_at", `${shiftDateKey(range.start, -1)}T00:00:00`)
    .lte("punched_at", `${range.end}T23:59:59`)
    .order("punched_at", { ascending: false })
    .limit(TEAM_PUNCH_LIMIT);

  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  } else if (!isAdmin()) {
    const scopedIds = userIds.length ? userIds : [session.user.id];
    if (!scopedIds.includes(session.user.id)) scopedIds.push(session.user.id);
    query = query.in("user_id", scopedIds);
  }

  const result = await withSupabaseRetry(async () => {
    const response = await query;
    if (response.error) throw response.error;
    return response.data;
  });
  appData.journalPunches = result || [];
  if (appData.journalPunches.length && !Object.prototype.hasOwnProperty.call(appData.journalPunches[0], "connection_method")) {
    appData.journalMetaMissing = true;
  }
  return appData.journalPunches;
}

function getJournalFsRoot() {
  let root = document.getElementById("journal-fs-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "journal-fs-root";
    root.className = "journal-fs-root";
    root.hidden = true;
    document.body.appendChild(root);
  }
  return root;
}

function clearJournalFsRoot() {
  const root = document.getElementById("journal-fs-root");
  if (!root) return;
  root.replaceChildren();
  root.hidden = true;
}

function refreshPageContent() {
  clearJournalFsRoot();
  const content = document.querySelector("#page-content");
  if (!content) return;
  content.innerHTML = pageContent();
  bindPageEvents();
}

function applyJournalFullscreenUi() {
  const root = getJournalFsRoot();
  const host = document.querySelector(".journal-table-host");
  const card = root.querySelector(".journal-card") || document.querySelector(".journal-card");
  const button = card?.querySelector("#journal-fullscreen");
  const active = Boolean(journalFullscreen && card);

  document.body.classList.toggle("journal-expanded-open", active);
  card?.classList.toggle("is-journal-expanded", active);

  if (active) {
    root.hidden = false;
    if (card.parentElement !== root) root.appendChild(card);
  } else {
    root.hidden = true;
    if (card && host && card.parentElement !== host) host.appendChild(card);
  }

  if (button) {
    button.textContent = active ? "Fermer le plein écran" : "Ouvrir en plein écran";
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function closeJournalFullscreen() {
  journalFullscreen = false;
  applyJournalFullscreenUi();
}

function bindJournalFullscreen() {
  const card = document.querySelector(".journal-card");
  const button = document.querySelector("#journal-fullscreen");
  if (!card || !button) {
    if (currentPage !== "journal") closeJournalFullscreen();
    return;
  }

  applyJournalFullscreenUi();

  button.addEventListener("click", () => {
    journalFullscreen = !journalFullscreen;
    applyJournalFullscreenUi();
  });

  if (journalFullscreenListenerBound) return;
  journalFullscreenListenerBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !journalFullscreen) return;
    closeJournalFullscreen();
  });
}

function exportJournalCsv() {
  const sessions = getJournalSessions();
  if (!sessions.length) {
    alert("Aucune session à exporter pour cette période.");
    return;
  }
  const range = getJournalRange();
  downloadCsv(
    `journal_${range.start}_${range.end}.csv`,
    JOURNAL_COLUMNS.map((column) => column.label),
    sessions.map((session) => JOURNAL_COLUMNS.map((column) => session[column.key]))
  );
}

function renderJournalStatus(status) {
  const tone = status === "Connecté" ? "on" : "off";
  return `<span class="journal-status journal-status--${tone}">${escapeHtml(status)}</span>`;
}

function renderJournalColumnMenu(column) {
  if (journalOpenColumn !== column.key) return "";
  const values = uniqueJournalValues(column.key);
  const selected = journalColumnFilters[column.key] || "";
  return `
    <div class="journal-col-menu" role="menu">
      <button type="button" class="journal-col-sort" data-journal-sort="${column.key}" data-journal-dir="asc">Trier A → Z</button>
      <button type="button" class="journal-col-sort" data-journal-sort="${column.key}" data-journal-dir="desc">Trier Z → A</button>
      <div class="journal-col-divider"></div>
      <button type="button" class="journal-col-option${selected ? "" : " is-active"}" data-journal-filter-col="${column.key}" data-journal-filter-value="">Tous</button>
      ${values.slice(0, 40).map((value) => `
        <button type="button" class="journal-col-option${selected === value ? " is-active" : ""}" data-journal-filter-col="${column.key}" data-journal-filter-value="${escapeHtml(value)}">${escapeHtml(value)}</button>
      `).join("")}
    </div>`;
}

/* journalPage() moved to pages/journal.js */

/* teamPunchesPage() moved to pages/team-punches.js */

/* leavePage() moved to pages/leave.js */

function leaveRows(requests) {
  if (!requests.length) {
    return `<tr><td colspan="5" class="empty-cell">Aucune demande de congé pour le moment.</td></tr>`;
  }
  return requests.map((request) => {
    const typeLabel = escapeHtml(request.type || "Congé");
    const motif = request.motif ? `<br><small>${escapeHtml(request.motif)}</small>` : "";
    const quantity = leaveIsHoursUnit(request.type)
      ? `${escapeHtml(String(request.hours || 0))} h`
      : `${escapeHtml(String(request.days ?? 0))} jour${Number(request.days) > 1 ? "s" : ""} ouvré${Number(request.days) > 1 ? "s" : ""}`;
    return `
    <tr>
      <td>${typeLabel}${motif}</td>
      <td>${escapeHtml(formatDate(request.start))} - ${escapeHtml(formatDate(request.end))}</td>
      <td>${quantity}</td>
      <td>${escapeHtml(request.attachment_name || request.attachmentName || "—")}</td>
      <td>${badge(request.status)}</td>
    </tr>`;
  }).join("");
}

function formatCountdown(startsAt) {
  const start = new Date(startsAt).getTime();
  const diff = start - Date.now();
  if (!Number.isFinite(diff)) return "";
  if (diff <= 0) return "En cours";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `Dans ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Dans ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `Dans ${days} jour${days > 1 ? "s" : ""}`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `Dans ${weeks} semaine${weeks > 1 ? "s" : ""}`;
  const months = Math.round(days / 30);
  return `Dans ${months} mois`;
}

function formatEventTimeShort(event) {
  const start = new Date(event.starts_at);
  if (Number.isNaN(start.getTime())) return "";
  if (event.all_day) return "Toute la journée";
  const startTime = start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (!event.ends_at) return startTime;
  const end = new Date(event.ends_at);
  if (Number.isNaN(end.getTime())) return startTime;
  if (start.toDateString() === end.toDateString()) {
    const endTime = end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${startTime} → ${endTime}`;
  }
  return `${startTime} · sur plusieurs jours`;
}

function renderDateBadge(startsAt) {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getDate();
  const month = date.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
  const weekday = date.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
  return `
    <span class="event-date-badge" aria-hidden="true">
      <span class="event-date-badge__weekday">${weekday}</span>
      <span class="event-date-badge__day">${day}</span>
      <span class="event-date-badge__month">${month}</span>
    </span>`;
}

function sanitizeEventPosterUrl(event) {
  return event?.poster_url ? safeExternalUrl(event.poster_url) : "";
}

/* eventsPage() moved to pages/events.js */

function renderEventDetailOverlay(events, admin) {
  const id = appData.eventDetailId || "";
  if (!id) return "";
  const event = events.find((entry) => String(entry.id) === String(id));
  if (!event) return "";
  const meta = eventTypeMeta(event.event_type);
  const author = profileById(event.created_by)?.full_name || "";
  const countdown = formatCountdown(event.starts_at);
  const posterUrl = sanitizeEventPosterUrl(event);

  return `
    <div class="event-detail-overlay" data-event-close role="dialog" aria-modal="true" aria-label="Détail de l'événement">
      <button type="button" class="event-detail-close" data-event-close aria-label="Fermer">×</button>
      <div class="event-detail" role="document">
        ${posterUrl ? `
          <a class="event-detail__poster-wrap" href="${escapeHtml(posterUrl)}" target="_blank" rel="noopener noreferrer" title="Ouvrir l'image originale">
            <img class="event-detail__poster" src="${escapeHtml(posterUrl)}" alt="Affiche ${escapeHtml(event.title)}">
          </a>` : `
          <div class="event-detail__poster-placeholder event-card--${meta.id}"><span>${meta.icon}</span></div>`}
        <div class="event-detail__panel">
          <div class="event-detail__head">
            <span class="event-type-pill event-type--${meta.id}">${meta.icon} ${meta.label}</span>
            ${countdown ? `<span class="event-detail__countdown">${escapeHtml(countdown)}</span>` : ""}
          </div>
          <h2 class="event-detail__title">${escapeHtml(event.title)}</h2>
          <dl class="event-detail__facts">
            <div><dt>Quand</dt><dd>${escapeHtml(formatEventWhen(event))}</dd></div>
            ${event.location ? `<div><dt>Lieu</dt><dd>${escapeHtml(event.location)}</dd></div>` : ""}
            <div><dt>Visibilité</dt><dd>${escapeHtml(eventVisibilityLabel(event.visibility))}</dd></div>
            ${author ? `<div><dt>Publié par</dt><dd>${escapeHtml(author)}</dd></div>` : ""}
          </dl>
          ${event.description ? `<div class="event-detail__desc">${escapeHtml(event.description).replace(/\n/g, "<br>")}</div>` : ""}
          ${admin ? `
            <div class="event-detail__actions">
              <button type="button" class="outline-button" data-event-edit="${event.id}">Modifier</button>
              <button type="button" class="outline-button danger" data-event-delete="${event.id}">Supprimer</button>
            </div>` : ""}
        </div>
      </div>
    </div>`;
}

/* attestationsPage() moved to pages/attestations.js */

function hrRequestDetail(request) {
  if (request.kind === "advance") {
    return `${formatMad(request.amount)}${request.reason ? ` · ${request.reason}` : ""}`;
  }
  const fallback = request.kind === "other" ? "Autre demande" : "Attestation";
  return `${request.type || fallback}${request.reason ? ` · ${request.reason}` : ""}`;
}

function hrRequestRows(requests) {
  if (!requests.length) {
    return `<tr><td colspan="4" class="empty-cell">Aucune demande RH pour le moment.</td></tr>`;
  }
  return requests.map((request) => {
    return `
    <tr>
      <td><strong>${escapeHtml(hrKindLabel(request))}</strong></td>
      <td>${escapeHtml(hrRequestDetail(request))}</td>
      <td>${formatDate(request.created)}</td>
      <td>${hrStatusBadge(request)}${hrShowsProgress(request) ? hrAdvanceProgress(request) : ""}</td>
    </tr>`;
  }).join("");
}

function hrTeamRequestRows(requests) {
  if (!requests.length) {
    return `<tr><td colspan="5" class="empty-cell">Aucune demande RH d'équipe pour le moment.</td></tr>`;
  }
  return requests.map((request) => {
    return `
    <tr>
      <td>${escapeHtml(profileById(request.userId)?.full_name || "Collaborateur")}</td>
      <td><strong>${escapeHtml(hrKindLabel(request))}</strong></td>
      <td>${escapeHtml(hrRequestDetail(request))}</td>
      <td>${formatDate(request.created)}</td>
      <td>${hrStatusBadge(request)}${hrShowsProgress(request) ? hrAdvanceProgress(request) : ""}</td>
    </tr>`;
  }).join("");
}

function renderHrValidationInbox() {
  const pending = pendingHrForValidator();
  if (!pending.length) return "";
  const page = paginateList("hr-inbox", pending);
  return `
    <article class="card table-card page-spacer hr-validation-inbox">
      <div class="toolbar"><h3>Demandes RH à valider</h3></div>
      <p class="hierarchy-meta">Visa RH ou Directeur. Un seul visa suffit. La demande passe en « Prise en charge », puis « Validé » ou « Refusé ».</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Type</th><th>Détail</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${page.items.map((request) => {
              return `
                <tr>
                  <td>${escapeHtml(profileById(request.userId)?.full_name || "Collaborateur")}</td>
                  <td>${escapeHtml(hrKindLabel(request))}</td>
                  <td>${escapeHtml(hrRequestDetail(request))}</td>
                  <td>${hrStatusBadge(request)}</td>
                  <td>
                    <button type="button" class="primary hr-approve" data-hr-kind="${request.kind}" data-hr-id="${request.id}">Valider</button>
                    <button type="button" class="outline-button hr-reject" data-hr-kind="${request.kind}" data-hr-id="${request.id}">Refuser</button>
                  </td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
}

function renderHrTeamFollowup() {
  if (!canFollowTeamHrRequests()) return "";
  const page = paginateList("hr-team", getTeamHrRequests());
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Demandes de l'équipe</h3></div>
      <p class="hierarchy-meta">Suivi des avances et attestations de votre équipe. La validation et le refus sont réservés au RH.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Type</th><th>Détail</th><th>Date</th><th>Statut</th></tr></thead>
          <tbody>${hrTeamRequestRows(page.items)}</tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
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
      <div class="org-node">
        ${renderProfilePyramidCard(node, node.index, {
          isMe,
          hasTeam: hasChildren,
          teamCount: node.children.length,
          toggleId: node.id,
          collapsed: isCollapsed
        })}
      </div>
      ${hasChildren
        ? `<div class="org-children">${node.children.map((child) => renderOrgNode(child, childOptions)).join("")}</div>`
        : ""}
    </div>`;
}

/* hierarchyPage() moved to pages/hierarchy.js */

/* creatorPage() moved to pages/creator.js */

function renderGtaSettingsSection() {
  const timezone = getCompanyTimezoneId();
  const hours = getConfiguredShiftHours();
  return `
    <article class="card form-card page-spacer">
      ${cardHeading("Paramétrage des horaires")}
      <form id="admin-gta-settings-form" class="feature-form">
        <label>
          Fuseau horaire de l'entreprise
          <select name="timezone">
            ${COMPANY_TIMEZONES.map((entry) => `
              <option value="${entry.id}"${timezone === entry.id ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}
          </select>
      </label>
        <p class="hierarchy-meta">Les heures de pointage et la chronologie s'affichent dans ce fuseau, quel que soit le fuseau du navigateur.</p>
        <div class="table-wrap">
          <table class="gta-shift-table">
            <thead>
              <tr>
                <th>Département</th>
                <th>Heure d'entrée</th>
                <th>Heure de sortie</th>
              </tr>
            </thead>
            <tbody>
              ${SHIFT_DEPT_META.map(({ code, name }) => `
                <tr>
                  <td><strong>${escapeHtml(name)}</strong></td>
                  <td><input type="time" name="start_${code}" value="${escapeHtml(hours[code].start)}" required></td>
                  <td><input type="time" name="end_${code}" value="${escapeHtml(hours[code].end)}" required></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <button type="submit" class="primary">Enregistrer les horaires</button>
      </form>
    </article>`;
}

/* adminPage() moved to pages/admin.js */

function getReportProfiles() {
  if (hasOrgWideAccess()) return appData.orgProfiles.filter(Boolean);
  if (hasDirectReports()) {
    const self = profileById(session?.user?.id) || appData.profile;
    const team = getDirectReportProfiles();
    if (!self) return team;
    return [self, ...team.filter((profile) => profile.id !== self.id)];
  }
  return appData.profile ? [appData.profile] : [];
}

function getReportPunches() {
  if (appData.teamPunches?.length) return appData.teamPunches;
  const profile = appData.profile;
  const punches = usesDatabase() ? (appData.punches || []) : getPunches();
  return punches.map((punch) => ({
    user_id: punch.user_id || profile?.id || session?.user?.id,
    punch_type: punch.punch_type || punch.type,
    punched_at: punch.punched_at || punch.time,
    work_location: punch.work_location || punch.workLocation || null,
    profiles: {
      full_name: profile?.full_name || getUserName(),
      email: profile?.email || session?.user?.email || ""
    }
  }));
}

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function edsLeaveOverlaps(item, range) {
  const start = String(item.start || item.start_date || "");
  const end = String(item.end || item.end_date || start);
  if (!start) return false;
  return start <= range.end && end >= range.start;
}

function edsLeaveApproved(item) {
  const status = foldAbsenceText(item.status);
  if (!status || status.includes("refus") || status.includes("rejet")) return false;
  if (status.startsWith("a valider") || status.includes("prise en charge")) return false;
  return status.startsWith("approuv") || status.startsWith("valid");
}

function edsLeaveDays(item) {
  if (Number(item.days)) return Number(item.days);
  return Number(item.hours || 0) / 8;
}

function edsLeaveHours(item) {
  if (Number(item.hours)) return Number(item.hours);
  return Number(item.days || 0) * 8;
}

function edsQty(value) {
  const n = Number(value) || 0;
  if (!n) return 0;
  return Math.round(n * 100) / 100;
}

function edsDescription(items) {
  return items.map((item) => {
    const when = item.start ? formatDate(item.start) : "";
    const motif = String(item.motif || item.comment || item.type || "").trim();
    return [when, motif].filter(Boolean).join(" — ");
  }).filter(Boolean).join(" | ");
}

function countComputedUnjustifiedDays(profile, range, daily, leaves) {
  let qty = 0;
  const labels = [];
  const start = parseLocalDate(range?.start);
  const end = parseLocalDate(range?.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { qty: 0, desc: "" };
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = toDateKey(cursor);
    const dayRow = (daily || []).find((row) => row.userId === profile.id && row.dayKey === key) || null;
    const dayLeaves = (leaves || []).filter((item) => leaveCoversPlanningDay(item, key));
    if (isUnjustifiedAbsenceDay(profile, key, { dayRow, dayLeaves })) {
      qty += 1;
      labels.push(formatDate(key));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { qty, desc: labels.join(" | ") };
}

function edsBucketForLeave(type) {
  const normalized = foldAbsenceText(type);
  if (normalized.includes("accident")) return "accident";
  if (normalized.includes("depart")) return "early";
  if (normalized.includes("retard")) return "late";
  const key = leaveTypeKey(type);
  if (key === "hours") return "late";
  if (key === "justified" || key === "maladie") return "justified";
  if (key === "unjustified") return "unjustified";
  if (key === "paternity") return "special";
  if (key === "suspension") return "unjustified";
  return key;
}

function earlyLeaveMinutes(row, profile) {
  if (!row.endTime) return 0;
  const importedHours = importedPlannedHours(profile?.id || row.userId, row.dayKey);
  if (importedHours === 0) return 0;
  const shift = getActiveShift(profile, row.dayKey);
  const end = new Date(row.endTime);
  const endMin = end.getHours() * 60 + end.getMinutes();
  const expected = minutesFromHhmm(shift.earliestEnd || shift.end);
  return Math.max(0, expected - endMin);
}

function currentUserEmail() {
  return String(session?.user?.email || appData.profile?.email || "").trim().toLowerCase();
}

function payrollEmails() {
  const cfg = window.HUMANA_CONFIG || {};
  const list = Array.isArray(cfg.PAYROLL_EMAILS) ? cfg.PAYROLL_EMAILS : [];
  return list.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
}

function canViewEdsPayrollColumns() {
  if (isAdmin()) return true;
  return payrollEmails().includes(currentUserEmail());
}

function canEditEdsPayroll() {
  if (!canViewReports()) return false;
  return canViewEdsPayrollColumns();
}

function edsPayrollFields() {
  return EDS_COLUMNS.filter((col) => col.payroll);
}

function getEdsCycleKey(range = getEdsRange()) {
  return `${range.start}_${range.end}`;
}

function edsPayrollState() {
  const value = appData.edsPayroll;
  return value && typeof value === "object" ? value : {};
}

function getEdsPayrollEntry(userId, range = getEdsRange()) {
  const cycle = edsPayrollState()[getEdsCycleKey(range)];
  const row = cycle && userId ? cycle[userId] : null;
  return row && typeof row === "object" ? row : {};
}

function sanitizeEdsPayrollValue(raw) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number) || Math.abs(number) > 1e9) return "";
  return String(number);
}

function readEdsPayrollForm(form) {
  const payload = {};
  edsPayrollFields().forEach((field) => {
    const input = form.querySelector(`[name="${field.key}"]`);
    if (!input) return;
    const value = sanitizeEdsPayrollValue(input.value);
    if (value !== "") payload[field.key] = value;
  });
  return payload;
}

async function loadEdsPayroll() {
  if (!usesDatabase()) {
    appData.edsPayroll = loadStore("edsPayroll", {});
    return;
  }
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("value")
    .eq("key", "eds_payroll")
    .maybeSingle();
  if (error) {
    if (String(error.message || "").includes("does not exist") || String(error.message || "").includes("app_settings")) {
      appData.edsPayroll = {};
      return;
    }
    throw error;
  }
  appData.edsPayroll = data?.value && typeof data.value === "object" && !Array.isArray(data.value)
    ? data.value
    : {};
}

async function saveEdsPayroll(next) {
  const value = next && typeof next === "object" ? next : {};
  if (!usesDatabase()) {
    saveStore("edsPayroll", value);
    appData.edsPayroll = value;
    return;
  }
  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: "eds_payroll", value }, { onConflict: "key" });
  if (error) throw error;
  appData.edsPayroll = value;
}

function closeEdsPayrollDialog() {
  document.removeEventListener("keydown", onEdsPayrollKeydown);
  document.getElementById("eds-payroll-overlay")?.remove();
}

function onEdsPayrollKeydown(event) {
  if (event.key === "Escape") closeEdsPayrollDialog();
}

function edsPayrollFilterValues(form) {
  return {
    managerId: String(form?.querySelector('select[name="managerId"]')?.value || ""),
    department: String(form?.querySelector('select[name="department"]')?.value || ""),
    query: String(form?.querySelector('input[name="query"]')?.value || "")
  };
}

function filterEdsPayrollProfiles({ managerId = "", department = "", query = "" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  const dept = String(department || "").trim().toLowerCase();
  return getReportProfiles().filter((profile) => {
    if (managerId && String(profile.manager_id || "") !== managerId) return false;
    if (dept && String(profile.department || "").trim().toLowerCase() !== dept) return false;
    if (!needle) return true;
    const hay = `${profile.full_name || ""} ${profile.email || ""} ${getProfileMatricule(profile.id) || profile.matricule || ""} ${profile.department || ""} ${managerName(profile.manager_id)}`.toLowerCase();
    return hay.includes(needle);
  });
}

function edsPayrollDepartmentOptions(selected = "") {
  const departments = [...new Set(getReportProfiles()
    .map((profile) => String(profile.department || "").trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "fr"));
  return [`<option value="">Tous les départements</option>`]
    .concat(departments.map((name) => `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`))
    .join("");
}

function edsPayrollManagerOptions(selected = "") {
  const managerIds = [...new Set(getReportProfiles().map((profile) => profile.manager_id).filter(Boolean))];
  const managers = managerIds
    .map((id) => profileById(id))
    .filter(Boolean)
    .sort((left, right) => String(left.full_name || "").localeCompare(String(right.full_name || ""), "fr"));
  return [`<option value="">Tous les managers</option>`]
    .concat(managers.map((manager) => `<option value="${escapeHtml(manager.id)}"${manager.id === selected ? " selected" : ""}>${escapeHtml(manager.full_name || manager.email || manager.id)}</option>`))
    .join("");
}

function edsPayrollUserOptions(selectedId, filters) {
  const profiles = filterEdsPayrollProfiles(filters);
  if (!profiles.length) return `<option value="">Aucun collaborateur</option>`;
  const current = profiles.some((profile) => profile.id === selectedId) ? selectedId : profiles[0].id;
  return profiles.map((profile) => {
    const extra = [getProfileMatricule(profile.id), profile.department].filter(Boolean).join(" · ");
    const label = extra
      ? `${profile.full_name || profile.email || profile.id} · ${extra}`
      : (profile.full_name || profile.email || profile.id);
    return `<option value="${escapeHtml(profile.id)}"${profile.id === current ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function edsPayrollPeopleMarkup(selectedIds, filters = {}) {
  const selected = selectedIds instanceof Set
    ? selectedIds
    : new Set(Array.isArray(selectedIds) ? selectedIds : selectedIds ? [selectedIds] : []);
  const profiles = filterEdsPayrollProfiles(filters);
  if (!profiles.length) return `<p class="empty-state">Aucun collaborateur.</p>`;
  return profiles.map((profile) => {
    const extra = [getProfileMatricule(profile.id), profile.department, managerName(profile.manager_id)]
      .filter((item) => item && item !== "—")
      .join(" · ");
    return `
    <label class="eds-payroll-person">
      <input type="checkbox" name="people" value="${escapeHtml(profile.id)}"${selected.has(profile.id) ? " checked" : ""}>
      <span>
        <strong>${escapeHtml(profile.full_name || "Collaborateur")}</strong>
        <small>${escapeHtml(extra || profile.email || "")}</small>
      </span>
    </label>`;
  }).join("");
}

function edsPayrollFieldsMarkup(values) {
  return edsPayrollFields().map((field) => {
    const current = values[field.key] ?? "";
    return `
      <label>
        ${escapeHtml(field.label)}
        <input type="text" inputmode="decimal" name="${escapeHtml(field.key)}" value="${escapeHtml(current)}" autocomplete="off">
      </label>`;
  }).join("");
}

function openEdsPayrollDialog(mode = "one") {
  if (!canEditEdsPayroll()) return;
  closeEdsPayrollDialog();
  const range = getEdsRange();
  const profiles = getReportProfiles();
  const firstId = profiles[0]?.id || "";
  const overlay = document.createElement("div");
  overlay.id = "eds-payroll-overlay";
  overlay.className = "eds-payroll-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "eds-payroll-title");
  overlay.innerHTML = `
    <form id="eds-payroll-form" class="eds-payroll-card">
      <div class="eds-payroll-head">
        <div>
          <h3 id="eds-payroll-title">Éléments de paie</h3>
          <p class="hierarchy-meta">Cycle du ${escapeHtml(formatDate(range.start))} au ${escapeHtml(formatDate(range.end))}. Les heures calculées (retards, HS) restent issues des pointages.</p>
        </div>
        <button type="button" class="outline-button" data-eds-payroll-close>Fermer</button>
      </div>
      <div class="eds-payroll-tabs" role="tablist">
        <button type="button" class="eds-payroll-tab${mode === "one" ? " is-active" : ""}" data-eds-mode="one" aria-pressed="${mode === "one" ? "true" : "false"}">Individuel</button>
        <button type="button" class="eds-payroll-tab${mode === "mass" ? " is-active" : ""}" data-eds-mode="mass" aria-pressed="${mode === "mass" ? "true" : "false"}">En masse</button>
      </div>
      <div class="form-row eds-payroll-org-filters">
        <label>
          Manager
          <select name="managerId">${edsPayrollManagerOptions()}</select>
        </label>
        <label>
          Département
          <select name="department">${edsPayrollDepartmentOptions()}</select>
        </label>
      </div>
      <div class="eds-payroll-pane" data-eds-pane="one"${mode === "one" ? "" : " hidden"}>
        <label>
          Collaborateur
          <select name="userId">${edsPayrollUserOptions(firstId, {})}</select>
        </label>
      </div>
      <div class="eds-payroll-pane" data-eds-pane="mass"${mode === "mass" ? "" : " hidden"}>
        <div class="eds-payroll-mass-tools">
          <input type="search" name="query" placeholder="Filtrer nom, matricule, e-mail..." autocomplete="off">
          <button type="button" class="outline-button" data-eds-select-all>Tout cocher</button>
          <button type="button" class="outline-button" data-eds-select-none>Tout décocher</button>
        </div>
        <p class="data-note">Cochez les personnes, puis saisissez uniquement les champs à appliquer (les cases vides n'écrasent rien).</p>
        <div class="eds-payroll-people" id="eds-payroll-people">${edsPayrollPeopleMarkup("", {})}</div>
      </div>
      <div class="eds-payroll-fields" id="eds-payroll-fields">${edsPayrollFieldsMarkup(mode === "mass" ? {} : (firstId ? getEdsPayrollEntry(firstId, range) : {}))}</div>
      <div class="eds-payroll-actions">
        <button type="button" class="outline-button" data-eds-payroll-close>Annuler</button>
        <button type="submit" class="primary">Enregistrer</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onEdsPayrollKeydown);
  bindEdsPayrollDialog(overlay, range);
}

function bindEdsPayrollDialog(overlay, range) {
  const form = overlay.querySelector("#eds-payroll-form");
  const peopleBox = overlay.querySelector("#eds-payroll-people");
  const selected = new Set();
  overlay.edsSelected = selected;
  const close = () => closeEdsPayrollDialog();
  const refreshFilteredPeople = () => {
    const filters = edsPayrollFilterValues(form);
    const userSelect = form?.querySelector('select[name="userId"]');
    const previous = String(userSelect?.value || "");
    if (userSelect) userSelect.innerHTML = edsPayrollUserOptions(previous, filters);
    if (peopleBox) peopleBox.innerHTML = edsPayrollPeopleMarkup(selected, filters);
    const oneVisible = overlay.querySelector('[data-eds-pane="one"]') && !overlay.querySelector('[data-eds-pane="one"]').hidden;
    if (oneVisible) {
      const userId = String(userSelect?.value || "");
      const fields = overlay.querySelector("#eds-payroll-fields");
      if (fields && userId !== previous) {
        fields.innerHTML = edsPayrollFieldsMarkup(userId ? getEdsPayrollEntry(userId, range) : {});
      }
    }
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelectorAll("[data-eds-payroll-close]").forEach((button) => {
    button.addEventListener("click", close);
  });
  overlay.querySelectorAll("[data-eds-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.edsMode;
      overlay.querySelectorAll("[data-eds-mode]").forEach((tab) => {
        const active = tab.dataset.edsMode === mode;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", active ? "true" : "false");
      });
      overlay.querySelectorAll("[data-eds-pane]").forEach((pane) => {
        pane.hidden = pane.dataset.edsPane !== mode;
      });
      const fields = overlay.querySelector("#eds-payroll-fields");
      if (mode === "one") {
        refreshFilteredPeople();
        const userId = String(form?.querySelector('select[name="userId"]')?.value || "");
        if (fields) fields.innerHTML = edsPayrollFieldsMarkup(userId ? getEdsPayrollEntry(userId, range) : {});
      } else if (mode === "mass" && fields) {
        refreshFilteredPeople();
        fields.innerHTML = edsPayrollFieldsMarkup({});
      }
    });
  });
  form?.querySelector('select[name="userId"]')?.addEventListener("change", (event) => {
    const userId = event.currentTarget.value;
    const fields = overlay.querySelector("#eds-payroll-fields");
    if (fields) fields.innerHTML = edsPayrollFieldsMarkup(userId ? getEdsPayrollEntry(userId, range) : {});
  });
  const queryInput = form?.querySelector('input[name="query"]');
  peopleBox?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== "people") return;
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
  });
  queryInput?.addEventListener("input", refreshFilteredPeople);
  form?.querySelector('select[name="managerId"]')?.addEventListener("change", refreshFilteredPeople);
  form?.querySelector('select[name="department"]')?.addEventListener("change", refreshFilteredPeople);
  overlay.querySelector("[data-eds-select-all]")?.addEventListener("click", () => {
    overlay.querySelectorAll('#eds-payroll-people input[name="people"]').forEach((input) => {
      input.checked = true;
      selected.add(input.value);
    });
  });
  overlay.querySelector("[data-eds-select-none]")?.addEventListener("click", () => {
    selected.clear();
    overlay.querySelectorAll('#eds-payroll-people input[name="people"]').forEach((input) => { input.checked = false; });
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const massVisible = overlay.querySelector('[data-eds-pane="mass"]') && !overlay.querySelector('[data-eds-pane="mass"]').hidden;
    const payload = readEdsPayrollForm(form);
    let userIds = [];
    if (massVisible) {
      userIds = [...selected];
      if (!userIds.length) {
        alert("Cochez au moins un collaborateur.");
        return;
      }
      if (!Object.keys(payload).length) {
        alert("Saisissez au moins un élément de paie à appliquer.");
        return;
      }
    } else {
      const userId = String(form.querySelector('select[name="userId"]')?.value || "");
      if (!userId) {
        alert("Choisissez un collaborateur.");
        return;
      }
      userIds = [userId];
    }
    const allowed = new Set(getReportProfiles().map((profile) => profile.id));
    userIds = userIds.filter((id) => allowed.has(id));
    if (!userIds.length) {
      alert("Aucun collaborateur autorisé.");
      return;
    }
    const cycleKey = getEdsCycleKey(range);
    const next = { ...edsPayrollState() };
    const cycle = { ...(next[cycleKey] || {}) };
    userIds.forEach((userId) => {
      if (massVisible) {
        cycle[userId] = { ...(cycle[userId] || {}), ...payload };
        return;
      }
      const previous = { ...(cycle[userId] || {}) };
      edsPayrollFields().forEach((field) => {
        const input = form.querySelector(`[name="${field.key}"]`);
        if (!input) return;
        const value = sanitizeEdsPayrollValue(input.value);
        if (value === "") delete previous[field.key];
        else previous[field.key] = value;
      });
      cycle[userId] = previous;
    });
    next[cycleKey] = cycle;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    Promise.resolve(saveEdsPayroll(next))
      .then(() => {
        closeEdsPayrollDialog();
        if (currentPage === "reports") refreshPageContent();
      })
      .catch((error) => {
        if (submit) submit.disabled = false;
        alert(formatAppError(error) || "Impossible d'enregistrer les éléments de paie.");
      });
  });
}

const EDS_COLUMNS = [
  { key: "statut", label: "Statut" },
  { key: "nom", label: "Nom" },
  { key: "prenom", label: "Prénom" },
  { key: "matricule", label: "Matricule" },
  { key: "departement", label: "Département" },
  { key: "dateAnciennete", label: "Date d'ancienneté" },
  { key: "profil", label: "Profil" },
  { key: "dateEntree", label: "Date d'entrée" },
  { key: "dateSortie", label: "Date de sortie" },
  { key: "departAnticipe", label: "Départ anticipé" },
  { key: "departAnticipeDesc", label: "Départ anticipé Description" },
  { key: "retard", label: "Retard" },
  { key: "retardDesc", label: "Retard Description" },
  { key: "absInjust", label: "Absence injustifiée" },
  { key: "absInjustDesc", label: "Absence injustifiée Description" },
  { key: "absJust", label: "Absences justifiées" },
  { key: "absJustDesc", label: "Absences justifiées Description" },
  { key: "accident", label: "Accident du travail" },
  { key: "accidentDesc", label: "Accident du travail Description" },
  { key: "cp", label: "Congés payés" },
  { key: "cpDesc", label: "Congés payés Description" },
  { key: "special", label: "Congés spéciaux" },
  { key: "specialDesc", label: "Congés spéciaux Description" },
  { key: "unpaid", label: "Congés sans solde" },
  { key: "unpaidDesc", label: "Congés sans solde Description" },
  { key: "maternity", label: "Maternité" },
  { key: "maternityDesc", label: "Maternité Description" },
  { key: "recup", label: "Récupération" },
  { key: "recupDesc", label: "Récupération Description" },
  { key: "primesExcept", label: "Primes except", payroll: true },
  { key: "primeOutbound", label: "Prime outbound", payroll: true },
  { key: "primeProjet", label: "Prime projet", payroll: true },
  { key: "primeChallenge", label: "Prime challenge", payroll: true },
  { key: "primeEid", label: "Prime Eid - Exonérée", payroll: true },
  { key: "primeParrainage", label: "Prime parrainage", payroll: true },
  { key: "primeLangue", label: "Prime langue", payroll: true },
  { key: "primeProd", label: "Prime productivité", payroll: true },
  { key: "regulM1", label: "Régul M-1", payroll: true },
  { key: "primeAnciennete", label: "Prime ancienneté", payroll: true },
  { key: "hs100", label: "Heures sup 100%", payroll: true },
  { key: "hs125", label: "Heures sup 125% (entre 5h et 20h)", payroll: true },
  { key: "hs150", label: "Heures sup 150% (entre 20h et 5h)", payroll: true },
  { key: "avance", label: "Avance (à déduire)", payroll: true },
  { key: "preavis", label: "Retenues préavis (Jrs)", payroll: true },
  { key: "chifaa", label: "Chifaa Monde", payroll: true },
  { key: "retraiteSal", label: "% Retraite salariale", payroll: true },
  { key: "retraitePat", label: "% Retraite patronale", payroll: true },
  { key: "salaireBrut", label: "Salaire mensuel brut", payroll: true },
  { key: "salaireNet", label: "Salaire mensuel net", payroll: true },
  { key: "soldeConge", label: "Solde de congé" },
  { key: "totalHeuresAbs", label: "Total Heures Absences" },
  { key: "joursTravailles", label: "Jours travaillés" },
  { key: "primesFixesPror", label: "Primes fixes pror.", payroll: true },
  { key: "variablePror", label: "Variable Pror.", payroll: true },
  { key: "salaireEstime", label: "Salaire estimé", payroll: true },
  { key: "commentaires", label: "Commentaires" },
  { key: "absHorsRetard", label: "Absences Hors Retard" },
  { key: "unpaidHours", label: "Congé Sans Solde H" },
  { key: "totalAbsJut", label: "Total ABS JUT" },
  { key: "primeProjet2", label: "Prime Projet", payroll: true },
  { key: "primeOutbound2", label: "Prime Outbound", payroll: true }
];

function visibleEdsColumns() {
  const showPayroll = canViewEdsPayrollColumns();
  return EDS_COLUMNS.filter((col) => !col.payroll || showPayroll);
}

function buildEdsRows() {
  const range = getEdsRange();
  const profiles = getReportProfiles();
  const punches = getReportPunches();
  const daily = summarizeTeamPunchesByDay(punches, range.start, range.end);
  const leaves = [
    ...getLeaveRequests(),
    ...(appData.teamLeaveRequests || []).map((row) => (row.type ? row : normalizeTeamLeaveRequest(row)))
  ];
  return profiles.map((profile) => {
    const days = daily.filter((row) => row.userId === profile.id);
    let planned = 0;
    let realized = 0;
    let delayMin = 0;
    let earlyMin = 0;
    let missing = 0;
    let otMs = 0;
    let workedDays = 0;
    const delayDays = [];
    const earlyDays = [];
    days.forEach((row) => {
      const stats = analyzeWorkedDay(row, profile);
      planned += stats.plannedMs;
      realized += stats.realizedMs;
      delayMin += stats.delayMin;
      missing += stats.missingMs;
      otMs += stats.payableOtMs;
      if (stats.realizedMs > 0) workedDays += 1;
      if (stats.delayMin > 0) delayDays.push(`${formatDate(row.dayKey)} — ${stats.delayMin} min`);
      const early = earlyLeaveMinutes(row, profile);
      if (early > 0) {
        earlyMin += early;
        earlyDays.push(`${formatDate(row.dayKey)} — ${early} min`);
      }
    });

    const mine = leaves.filter((item) => (
      (item.userId || item.user_id || session?.user?.id) === profile.id
      && edsLeaveApproved(item)
      && edsLeaveOverlaps(item, range)
    ));
    const byBucket = (bucket) => mine.filter((item) => edsBucketForLeave(item.type) === bucket);
    const pack = (bucket, unit = "days") => {
      const items = byBucket(bucket);
      const qty = items.reduce((sum, item) => sum + (unit === "hours" ? edsLeaveHours(item) : edsLeaveDays(item)), 0);
      return { qty: edsQty(qty), desc: edsDescription(items) };
    };

    const lateLeave = pack("late", "hours");
    const earlyLeave = pack("early", "hours");
    const unjustLeave = pack("unjustified");
    const computedUnjust = countComputedUnjustifiedDays(profile, range, days, mine);
    const unjust = {
      qty: edsQty(unjustLeave.qty + computedUnjust.qty),
      desc: [unjustLeave.desc, computedUnjust.desc].filter(Boolean).join(" | ")
    };
    const just = pack("justified");
    const accident = pack("accident");
    const cp = pack("cp");
    const special = pack("special");
    const unpaid = pack("unpaid");
    const maternity = pack("maternity");
    const recup = pack("recup");

    const retardHours = edsQty(delayMin / 60 + lateLeave.qty);
    const earlyHours = edsQty(earlyMin / 60 + earlyLeave.qty);
    const names = splitFullName(profile.full_name);
    const hired = getHiredAt(profile);
    const hiredKey = hired ? String(hired).slice(0, 10) : "";
    const statut = hiredKey && hiredKey > range.end ? "Non entré" : "Actif";
    const shift = getProfileShift(profile);
    const cpBalance = accruedLeaveDays(profile);
    const absenceDays = unjust.qty + just.qty + accident.qty + cp.qty + special.qty + unpaid.qty + maternity.qty + recup.qty;
    const totalHeuresAbs = edsQty(absenceDays * 8 + earlyHours + retardHours);
    const absHorsRetard = edsQty(absenceDays * 8 + earlyHours);
    const hsHours = edsQty(otMs / 3600000);
    const showPayroll = canViewEdsPayrollColumns();

    const row = {
      statut,
      nom: names.last,
      prenom: names.first,
      matricule: getProfileMatricule(profile.id),
      departement: profile.department || "",
      dateAnciennete: hired ? formatDate(hired) : "",
      profil: shift.label || profile.job_title || "",
      dateEntree: hired ? formatDate(hired) : "",
      dateSortie: "",
      departAnticipe: earlyHours,
      departAnticipeDesc: [earlyLeave.desc, earlyDays.join(" | ")].filter(Boolean).join(" | "),
      retard: retardHours,
      retardDesc: [lateLeave.desc, delayDays.join(" | ")].filter(Boolean).join(" | "),
      absInjust: unjust.qty,
      absInjustDesc: unjust.desc,
      absJust: just.qty,
      absJustDesc: just.desc,
      accident: accident.qty,
      accidentDesc: accident.desc,
      cp: cp.qty,
      cpDesc: cp.desc,
      special: special.qty,
      specialDesc: special.desc,
      unpaid: unpaid.qty,
      unpaidDesc: unpaid.desc,
      maternity: maternity.qty,
      maternityDesc: maternity.desc,
      recup: recup.qty,
      recupDesc: recup.desc,
      soldeConge: edsQty(cpBalance),
      totalHeuresAbs,
      joursTravailles: workedDays,
      commentaires: "",
      absHorsRetard,
      unpaidHours: edsQty(unpaid.qty * 8),
      totalAbsJut: just.qty,
      planned,
      realized,
      missing,
      range
    };
    if (showPayroll) {
      const saved = getEdsPayrollEntry(profile.id, range);
      Object.assign(row, {
        primesExcept: saved.primesExcept ?? 0,
        primeOutbound: saved.primeOutbound ?? 0,
        primeProjet: saved.primeProjet ?? 0,
        primeChallenge: saved.primeChallenge ?? 0,
        primeEid: saved.primeEid ?? 0,
        primeParrainage: saved.primeParrainage ?? 0,
        primeLangue: saved.primeLangue ?? 0,
        primeProd: saved.primeProd ?? 0,
        regulM1: saved.regulM1 ?? 0,
        primeAnciennete: saved.primeAnciennete ?? 0,
        hs100: saved.hs100 ?? 0,
        hs125: saved.hs125 ?? hsHours,
        hs150: saved.hs150 ?? 0,
        avance: saved.avance ?? 0,
        preavis: saved.preavis ?? 0,
        chifaa: saved.chifaa ?? 0,
        retraiteSal: saved.retraiteSal ?? "",
        retraitePat: saved.retraitePat ?? "",
        salaireBrut: saved.salaireBrut ?? "",
        salaireNet: saved.salaireNet ?? "",
        primesFixesPror: saved.primesFixesPror ?? 0,
        variablePror: saved.variablePror ?? 0,
        salaireEstime: saved.salaireEstime ?? "",
        primeProjet2: saved.primeProjet2 ?? 0,
        primeOutbound2: saved.primeOutbound2 ?? 0
      });
    }
    return row;
  });
}

function edsRowCells(row, columns = visibleEdsColumns()) {
  return columns.map((col) => row[col.key] ?? "");
}

const PLANNING_DEPTS = [
  { id: "all", label: "Tous", hint: "Tous les agents du périmètre, y compris le planning importé." },
  { id: "rnd", label: "R&D", hint: "Objectif : 8h travaillées + 1h de pause déjeuner (horaire souple)." },
  { id: "cs", label: "CS", hint: "Calendrier fixe 08h–17h, pause 1h." },
  { id: "ces", label: "CES", hint: "Calendrier fixe 08h–17h, pause 1h." }
];

const PLANNING_CODES = [
  { code: "PR", label: "Présent sur site" },
  { code: "TT", label: "Télétravail" },
  { code: "RE", label: "Retard" },
  { code: "DP", label: "Départ anticipé" },
  { code: "AJ", label: "Absence justifiée" },
  { code: "AI", label: "Absence injustifiée" },
  { code: "CP", label: "Congés payés" },
  { code: "MA", label: "Maternité" },
  { code: "PA", label: "Paternité" },
  { code: "SS", label: "Sans solde" },
  { code: "RC", label: "Récupération" },
  { code: "DE", label: "Déplacement" },
  { code: "MP", label: "Mise à pied" },
  { code: "SP", label: "Congé spécial" },
  { code: "EC", label: "Écart d'heures (R&D)" },
  { code: "AB", label: "Non pointé" },
  { code: "FER", label: "Jour férié" }
];

const PLANNING_COMPUTED_CODES = new Set(["RE", "DP", "EC", "AB"]);
const PLANNING_ABSENCE_CODES = new Set(["CP", "AJ", "AI", "MA", "PA", "SS", "RC", "MP", "SP", "FER"]);
const PLANNING_EDIT_CODES = PLANNING_CODES.filter((item) => !PLANNING_COMPUTED_CODES.has(item.code));

const PLANNING_KIND_MAP = {
  P: "PR", PRES: "PR", PRESENT: "PR", PRESENCE: "PR", PR: "PR",
  TT: "TT", TELETRAVAIL: "TT", REMOTE: "TT",
  RE: "RE", RETARD: "RE",
  DP: "DP", DEPART: "DP",
  AJ: "AJ", AI: "AI",
  CP: "CP", CONGES: "CP",
  MA: "MA", MATERNITE: "MA",
  PA: "PA", PATERNITE: "PA",
  SS: "SS",
  RC: "RC", RTT: "RC", RECUP: "RC",
  DE: "DE",
  MP: "MP",
  SP: "SP",
  EC: "EC",
  AB: "AB",
  FER: "FER", FERIE: "FER", JF: "FER"
};

const FR_PLANNING_MONTHS = {
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11
};

function foldPlanningToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeMatriculeId(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!text || text === "-" || text === "0") return "";
  if (/^\d+(\.0+)?$/.test(text)) return String(Math.round(Number(text)));
  return text.toUpperCase();
}

function parseFrenchPlanningDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const slash = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }
  const folded = foldPlanningToken(text);
  const named = folded.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (named && Object.prototype.hasOwnProperty.call(FR_PLANNING_MONTHS, named[2])) {
    const month = FR_PLANNING_MONTHS[named[2]] + 1;
    return `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 90000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
    return utc.toISOString().slice(0, 10);
  }
  return "";
}

function parsePlanningHoursValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+([.,]\d+)?$/.test(text)) {
    const n = Number(text.replace(",", "."));
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }
  const clock = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!clock) return null;
  return Math.round((Number(clock[1]) + Number(clock[2]) / 60 + Number(clock[3] || 0) / 3600) * 100) / 100;
}

function mapPlanningHeader(raw) {
  const text = foldPlanningToken(raw);
  if (!text) return "";
  if (text.includes("cegid") || text.includes("matricule") || (text.includes("id") && text.includes("employ"))) return "matricule";
  if (text.includes("nomferie") || text.includes("ferie")) return "holiday";
  if (text.includes("location") || text === "lieu") return "location";
  if ((text.includes("heure") && text.includes("plann")) || text === "heureplanning") return "duration";
  if (text === "heures" || text === "heure") return "hoursCol";
  if (text === "valeur" || text === "code" || text === "type") return "value";
  if (text.includes("departement") || text === "dept") return "department";
  if (text.includes("structure")) return "structure";
  if (text === "nom" || text === "agent" || text.includes("collaborateur") || text === "employe") return "agent";
  if (text === "date" || text.startsWith("jour")) return "date";
  return "";
}

function mapPlanningKind(value, location, holiday) {
  if (String(holiday || "").trim()) return "FER";
  const loc = foldPlanningToken(location);
  if (loc && (loc.includes("teletravail") || loc === "tt" || loc.includes("remote") || loc.includes("domicile"))) return "TT";
  const token = foldPlanningToken(value).replace(/\s+/g, "").toUpperCase();
  return PLANNING_KIND_MAP[token] || (token ? "PR" : "PR");
}

function decodePlanningXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function splitPlanningCsvLine(line, delimiter) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function detectCsvDelimiter(line) {
  const tab = String(line || "").split("\t").length;
  const semi = String(line || "").split(";").length;
  const comma = String(line || "").split(",").length;
  if (tab >= 8 || (tab > semi && tab > comma)) return "\t";
  if (semi > comma) return ";";
  return ",";
}

function parseCsvGrid(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = detectCsvDelimiter(lines[0]);
  return lines.map((line) => splitPlanningCsvLine(line, delimiter));
}

function mapGridToRows(grid, mapHeader) {
  if (!grid.length) return [];
  const headers = (grid[0] || []).map(mapHeader);
  return grid.slice(1).map((cells) => {
    const row = {};
    headers.forEach((key, index) => {
      if (!key) return;
      const value = cells[index] == null ? "" : String(cells[index]).trim();
      if (row[key] && !value) return;
      row[key] = value;
    });
    return row;
  });
}

function parsePlanningCsvText(text) {
  return mapGridToRows(parseCsvGrid(text), mapPlanningHeader)
    .filter((row) => row.date || row.agent || row.matricule);
}

function planningColRow(ref) {
  const match = String(ref || "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of match[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(match[2]) - 1 };
}

function parseZipCentral(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Fichier Excel invalide (ZIP).");
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compSize = view.getUint32(pointer + 20, true);
    const nameLen = view.getUint16(pointer + 28, true);
    const extraLen = view.getUint16(pointer + 30, true);
    const commentLen = view.getUint16(pointer + 32, true);
    const localOff = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtra = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    files[name] = { method, bytes: bytes.subarray(dataStart, dataStart + compSize) };
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflatePlanningZipEntry(entry) {
  if (!entry) return "";
  if (entry.method === 0) return new TextDecoder("utf-8").decode(entry.bytes);
  if (entry.method !== 8) throw new Error("Compression Excel non supportée. Enregistrez le fichier en .xlsx ou .csv.");
  const stream = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder("utf-8").decode(await new Response(stream).arrayBuffer());
}

function parseSharedStringsXml(xml) {
  const out = [];
  const block = /<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g;
  let match;
  while ((match = block.exec(xml))) {
    const texts = [];
    const token = /<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g;
    let inner;
    while ((inner = token.exec(match[1]))) texts.push(decodePlanningXml(inner[1]));
    out.push(texts.join(""));
  }
  return out;
}

function parseSheetRowsXml(xml, shared) {
  const byIndex = new Map();
  const rowRe = /<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g;
  let rowMatch;
  let fallback = 0;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    const rowNum = Number((String(rowMatch[1] || "").match(/\br="(\d+)"/i) || [])[1] || 0);
    const idx = rowNum > 0 ? rowNum - 1 : fallback;
    fallback += 1;
    const cellRe = /<(?:[\w.-]+:)?c\b([^/>]*)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g;
    let cellMatch;
    let seq = 0;
    while ((cellMatch = cellRe.exec(rowMatch[2] || ""))) {
      const attrs = cellMatch[1] || "";
      const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || "";
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
      const parsed = ref ? planningColRow(ref) : { col: seq };
      const col = Number.isFinite(parsed.col) ? parsed.col : seq;
      seq += 1;
      let value = "";
      const inner = cellMatch[2] || "";
      const is = inner.match(/<(?:[\w.-]+:)?is>[\s\S]*?<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/);
      const v = inner.match(/<(?:[\w.-]+:)?v[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/);
      if (is) value = decodePlanningXml(is[1]);
      else if (v) {
        const raw = decodePlanningXml(v[1]);
        value = type === "s" ? (shared[Number(raw)] || "") : raw;
      }
      cells[col] = value;
    }
    byIndex.set(idx, cells);
  }
  const max = byIndex.size ? Math.max(...byIndex.keys()) : -1;
  const rows = [];
  for (let i = 0; i <= max; i += 1) rows.push(byIndex.get(i) || []);
  return rows;
}

function zipFileLookup(files, name) {
  if (files[name]) return files[name];
  const wanted = String(name || "").replace(/\\/g, "/").toLowerCase();
  const key = Object.keys(files || {}).find((item) => item.replace(/\\/g, "/").toLowerCase() === wanted);
  return key ? files[key] : null;
}

function parseWorkbookSheetList(workbook, rels) {
  const out = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/gi;
  let match;
  while ((match = sheetRe.exec(workbook || ""))) {
    const attrs = match[1];
    const name = ((attrs.match(/\bname="([^"]+)"/i) || [])[1] || "").trim();
    const rid = ((attrs.match(/\br:id="([^"]+)"/i) || [])[1] || "").trim();
    const hidden = /state="hidden"/i.test(attrs) || /state="veryHidden"/i.test(attrs);
    let target = "";
    if (rid && rels) {
      const rel = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`, "i"))
        || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`, "i"));
      target = rel ? rel[1].replace(/^\//, "") : "";
    }
    out.push({
      name,
      hidden,
      sheetPath: target ? (target.startsWith("xl/") ? target : `xl/${target}`) : ""
    });
  }
  return out;
}

async function parseXlsxSheets(buffer) {
  const files = parseZipCentral(buffer);
  const sharedXml = await inflatePlanningZipEntry(zipFileLookup(files, "xl/sharedStrings.xml"));
  const shared = sharedXml ? parseSharedStringsXml(sharedXml) : [];
  const workbook = await inflatePlanningZipEntry(zipFileLookup(files, "xl/workbook.xml"));
  const rels = await inflatePlanningZipEntry(zipFileLookup(files, "xl/_rels/workbook.xml.rels"));
  const listed = parseWorkbookSheetList(workbook, rels);
  const sheets = [];
  for (const item of listed) {
    const entry = zipFileLookup(files, item.sheetPath) || zipFileLookup(files, "xl/worksheets/sheet1.xml");
    const xml = await inflatePlanningZipEntry(entry);
    if (!xml) continue;
    sheets.push({ name: item.name || "Feuille", hidden: item.hidden, rows: parseSheetRowsXml(xml, shared) });
  }
  if (!sheets.length) {
    const fallback = await inflatePlanningZipEntry(zipFileLookup(files, "xl/worksheets/sheet1.xml"));
    if (fallback) sheets.push({ name: "sheet1", hidden: false, rows: parseSheetRowsXml(fallback, shared) });
  }
  return sheets;
}

async function parseXlsxGrid(buffer) {
  const sheets = await parseXlsxSheets(buffer);
  if (!sheets.length) throw new Error("Feuille Excel introuvable.");
  return sheets[0].rows;
}

async function parsePlanningXlsx(buffer) {
  const grid = await parseXlsxGrid(buffer);
  return mapGridToRows(grid, mapPlanningHeader)
    .filter((row) => row.date || row.agent || row.matricule);
}

function mapEmployeeHeader(raw) {
  const text = foldPlanningToken(raw);
  if (!text) return "";
  if ((text.includes("matricule") && text.includes("manager")) || text === "matricule manager") return "managerMatricule";
  if (text === "manager" || (text.includes("manager") && !text.includes("matricule"))) return "managerName";
  if (text.includes("statut") || text === "stat" || text === "status") return "status";
  if (text.includes("cegid") || (text.includes("id") && text.includes("employ"))) return "empId";
  if (text.includes("matricule") && (text.includes("rh") || text.includes("hr"))) return "matriculeRh";
  if (text.includes("civil")) return "civility";
  if (text.includes("prenom")) return "firstName";
  if (text === "nom" || text === "name") return "lastName";
  if (text.includes("recrut") || text.includes("embauche") || (text.includes("date") && (text.includes("entree") || text.includes("debut")))) return "hiredAt";
  if (text.includes("nature") && text.includes("depart")) return "leftReason";
  if (text.includes("depart") && text.includes("date")) return "leftAt";
  if (text === "bu" || text === "departement" || text === "department") return "bu";
  if ((text.includes("sub") && text.includes("bu")) || text.includes("sous bu") || text === "sub bu") return "subBu";
  if (text === "job" || text.includes("poste") || text.includes("emploi") || text.includes("intitule")) return "job";
  if (text === "profile" || text === "profil") return "profileLabel";
  if (text.includes("mail") || text === "email") return "email";
  return "";
}

function mapEmployeeHeaders(rawHeaders) {
  let seenEmpId = false;
  return rawHeaders.map((raw) => {
    const key = mapEmployeeHeader(raw);
    if (key !== "empId") return key;
    if (seenEmpId) return "empIdAlt";
    seenEmpId = true;
    return "empId";
  });
}

function parseHrDate(value) {
  const text = String(value || "").trim();
  if (!text || text === "-") return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const slash = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    const y = Number(year);
    if (y < 1990 || y > 2100) return "";
    return `${year}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }
  const serial = Number(text);
  if (Number.isFinite(serial) && serial >= 36526 && serial < 90000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
    return utc.toISOString().slice(0, 10);
  }
  return "";
}

function employeeStatusIsInactive(status) {
  const parts = foldPlanningToken(status).split(" ").filter(Boolean);
  return parts.some((part) => (
    part === "inactif" || part === "inactive" || part === "sorti" || part === "out"
    || part === "licencie" || part === "demissionnaire"
  ));
}

function employeeHasLeft(row) {
  if (employeeStatusIsInactive(row.status)) return true;
  const left = parseHrDate(row.leftAt);
  return Boolean(left && left <= toDateKey(new Date()));
}

function mapCellsToEmployeeRow(cells, keys) {
  const row = {};
  keys.forEach((key, index) => {
    if (!key) return;
    const value = cells[index] == null ? "" : String(cells[index]).trim();
    if (row[key] && !value) return;
    row[key] = value;
  });
  return row;
}

function findEmployeeHeaderIndex(grid) {
  let best = 0;
  let bestScore = -1;
  const max = Math.min(grid.length, 40);
  for (let i = 0; i < max; i += 1) {
    const keys = mapEmployeeHeaders(grid[i] || []);
    const unique = new Set(keys.filter(Boolean));
    let score = unique.size;
    if (keys.includes("empId")) score += 8;
    if (keys.includes("status")) score += 5;
    if (keys.includes("lastName") && keys.includes("firstName")) score += 6;
    if (keys.includes("managerName")) score += 2;
    if (keys.includes("hiredAt")) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 8 ? best : 0;
}

function scoreEmployeeGrid(grid) {
  const headerIdx = findEmployeeHeaderIndex(grid);
  const keys = mapEmployeeHeaders(grid[headerIdx] || []);
  let score = new Set(keys.filter(Boolean)).size;
  if (keys.includes("empId")) score += 8;
  if (keys.includes("status")) score += 5;
  if (keys.includes("lastName") && keys.includes("firstName")) score += 6;
  grid.slice(headerIdx + 1).forEach((cells) => {
    const row = mapCellsToEmployeeRow(cells, keys);
    if (normalizeMatriculeId(row.empId) || normalizeMatriculeId(row.empIdAlt) || String(row.lastName || "").trim()) {
      score += 1;
    }
  });
  return { score, headerIdx, grid };
}

async function parseSpreadsheetGrid(file) {
  const name = String(file?.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (name.endsWith(".xls") && !isZip) {
    throw new Error("Le .xls ancien n'est pas lu. Enregistrez le fichier en .xlsx ou .csv.");
  }
  let grid;
  if (isZip || name.endsWith(".xlsx")) {
    const sheets = await parseXlsxSheets(buffer);
    if (!sheets.length) throw new Error("Feuille Excel introuvable.");
    let best = null;
    sheets.forEach((sheet) => {
      const scored = scoreEmployeeGrid(sheet.rows || []);
      if (!best || scored.score > best.score) best = scored;
    });
    grid = best ? best.grid : sheets[0].rows;
  } else {
    grid = parseCsvGrid(new TextDecoder("utf-8").decode(bytes));
  }
  const headerIdx = findEmployeeHeaderIndex(grid);
  return grid.slice(headerIdx);
}

function planningHoursFromRow(row) {
  const fromHours = parsePlanningHoursValue(row.hoursCol);
  const fromDuration = parsePlanningHoursValue(row.duration);
  if (fromHours > 0) return fromHours;
  if (fromDuration > 0) return fromDuration;
  if (fromHours === 0 || fromDuration === 0) return 0;
  return 0;
}

function planningNameTokens(value) {
  return foldPlanningToken(value).split(" ").filter((token) => token.length >= 2);
}

function planningTokensClose(left, right) {
  if (left === right) return true;
  if (left.length >= 3 && right.startsWith(left)) return true;
  if (right.length >= 3 && left.startsWith(right)) return true;
  return false;
}

function planningTokenSetsMatch(left, right) {
  if (!left.length || !right.length) return false;
  const everyLeft = left.every((token) => right.some((item) => planningTokensClose(token, item)));
  const everyRight = right.every((token) => left.some((item) => planningTokensClose(token, item)));
  return everyLeft && everyRight;
}

function normalizeMatriculeDigits(value) {
  return String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

function matchPlanningProfileByMatricule(row, profiles) {
  const matriculeId = normalizeMatriculeId(row.matricule);
  const digits = normalizeMatriculeDigits(row.matricule);
  if (!matriculeId && !digits) return null;
  const hits = profiles.filter((profile) => {
    const mat = normalizeMatriculeId(profile.matricule);
    if (matriculeId && mat && mat === matriculeId) return true;
    const profileDigits = normalizeMatriculeDigits(profile.matricule);
    return Boolean(digits && profileDigits && profileDigits === digits);
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const named = hits.filter((profile) => foldPlanningToken(profile.full_name) === foldPlanningToken(row.agent));
    return named[0] || hits[0];
  }
  return null;
}

function matchPlanningProfileByName(row, profiles) {
  const tokens = planningNameTokens(row.agent);
  if (!tokens.length) return null;
  const exact = profiles.filter((profile) => foldPlanningToken(profile.full_name) === foldPlanningToken(row.agent));
  if (exact.length === 1) return exact[0];
  const scored = profiles.map((profile) => {
    const other = planningNameTokens(profile.full_name);
    if (!other.length) return null;
    if (planningTokenSetsMatch(tokens, other)) return { profile, score: 90 };
    const lastName = tokens[0];
    const given = tokens.slice(1);
    const hasLast = other.some((token) => token === lastName);
    const hasGiven = given.some((name) => other.some((token) => planningTokensClose(name, token)));
    if (hasLast && hasGiven) return { profile, score: 70 };
    return null;
  }).filter(Boolean);
  scored.sort((left, right) => right.score - left.score);
  if (!scored.length) return null;
  const best = scored.filter((item) => item.score === scored[0].score);
  return best.length === 1 ? best[0].profile : null;
}

function matchPlanningProfile(row, profiles) {
  return matchPlanningProfileByMatricule(row, profiles) || matchPlanningProfileByName(row, profiles);
}

function buildPlanningImportEntries(rawRows, profiles) {
  const unmatched = [];
  const grouped = new Map();
  let skippedEmptyMatricule = 0;
  const fileHasMatricule = rawRows.some((row) => Boolean(normalizeMatriculeId(row.matricule)));
  rawRows.forEach((row) => {
    const workDate = parseFrenchPlanningDate(row.date);
    if (!workDate) return;
    const matriculeId = normalizeMatriculeId(row.matricule);
    let profile = null;
    if (matriculeId) {
      profile = matchPlanningProfileByMatricule(row, profiles);
      if (!profile) profile = matchPlanningProfileByName(row, profiles);
      if (!profile) {
        unmatched.push(`${row.agent || "?"} · ${matriculeId}`);
        return;
      }
    } else if (fileHasMatricule) {
      profile = matchPlanningProfileByName(row, profiles);
      if (!profile) {
        skippedEmptyMatricule += 1;
        return;
      }
    } else {
      profile = matchPlanningProfileByName(row, profiles);
      if (!profile) {
        unmatched.push(row.agent || "?");
        return;
      }
    }
    const hours = planningHoursFromRow(row);
    const kind = mapPlanningKind(row.value, row.location, row.holiday);
    const key = `${profile.id}|${workDate}`;
    const list = grouped.get(key) || [];
    list.push({
      user_id: profile.id,
      work_date: workDate,
      kind: hours <= 0 && kind === "PR" && !String(row.holiday || "").trim() ? "PR" : kind,
      hours,
      department: row.department || "",
      structure: row.structure || "",
      location: row.location || "",
      note: [row.value, row.holiday].filter(Boolean).join(" · "),
      source: "import",
      matricule: matriculeId
    });
    grouped.set(key, list);
  });
  const entries = [];
  grouped.forEach((list) => {
    const slots = list.slice(0, 2);
    slots.forEach((item, index) => {
      entries.push({ ...item, slot: index + 1 });
    });
  });
  entries.sort((a, b) => String(a.work_date).localeCompare(b.work_date) || String(a.user_id).localeCompare(b.user_id) || a.slot - b.slot);
  return { entries, unmatched: [...new Set(unmatched)], skippedEmptyMatricule };
}

function getPlanningEntries() {
  return appData.planningEntries || [];
}

function planningEditorName(userId) {
  const id = String(userId || "");
  if (!id) return "";
  if (id === session?.user?.id) {
    return appData.profile?.full_name || session?.user?.email || "Vous";
  }
  return profileById(id)?.full_name || "";
}

function planningSourceLabel(source) {
  const key = String(source || "").toLowerCase();
  if (key === "manual") return "saisie";
  if (key === "assign") return "affectation";
  if (key === "tt-rotation") return "rotation TT";
  if (key === "import" || key === "cegid") return "import";
  return key;
}

function planningSlotsEditor(slots) {
  const list = Array.isArray(slots) ? slots : [];
  const latest = [...list].sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0];
  if (!latest) return { name: "", at: "", source: "", label: "" };
  const name = planningEditorName(latest.created_by);
  const at = latest.created_at ? formatDateTimeShort(latest.created_at) : "";
  const source = planningSourceLabel(latest.source);
  const parts = [name, at, source].filter(Boolean);
  return {
    name,
    at,
    source,
    label: parts.length ? `Modifié par ${parts.join(" · ")}` : ""
  };
}

function planningDaySlots(userId, dayKey) {
  return planningSlotsByUserDay().get(`${userId}|${dayKey}`) || [];
}

function planningSlotsByUserDay() {
  const list = getPlanningEntries();
  if (planningSlotsByUserDay.cacheRef === list) return planningSlotsByUserDay.cacheMap;
  const map = new Map();
  list.forEach((row) => {
    const userId = row.user_id || row.userId;
    const dayKey = String(row.work_date || row.workDate || "").slice(0, 10);
    if (!userId || !dayKey) return;
    const key = `${userId}|${dayKey}`;
    const slots = map.get(key) || [];
    slots.push({
      slot: Number(row.slot) === 2 ? 2 : 1,
      kind: String(row.kind || "PR").toUpperCase(),
      hours: Number(row.hours || 0),
      location: row.location || "",
      note: row.note || "",
      matricule: row.matricule || "",
      source: row.source || "",
      created_by: row.created_by || row.createdBy || "",
      created_at: row.created_at || row.createdAt || ""
    });
    map.set(key, slots);
  });
  planningSlotsByUserDay.cacheRef = list;
  planningSlotsByUserDay.cacheMap = map;
  return map;
}

function importedPlannedHours(userId, dayKey) {
  const slots = planningSlotsByUserDay().get(`${userId}|${dayKey}`);
  if (!slots) return null;
  return slots.reduce((total, item) => total + Number(item.hours || 0), 0);
}

function planningEntriesRange() {
  const month = planningMonthRange();
  let start = month.start;
  let end = month.end;
  const eds = getEdsRange();
  if (eds.start < start) start = eds.start;
  if (eds.end > end) end = eds.end;
  if (teamPunchFilters?.start && teamPunchFilters.start < start) start = teamPunchFilters.start;
  if (teamPunchFilters?.end && teamPunchFilters.end > end) end = teamPunchFilters.end;
  return { start, end };
}

async function loadPlanningEntries() {
  if (!usesDatabase() || !session?.user) {
    appData.planningEntries = appData.planningEntries || [];
    return appData.planningEntries;
  }
  const range = planningEntriesRange();
  const { data, error } = await supabaseClient
    .from("planning_entries")
    .select("id, user_id, work_date, slot, kind, hours, department, structure, location, note, source, matricule, created_by, created_at")
    .gte("work_date", range.start)
    .lte("work_date", range.end)
    .limit(PLANNING_ENTRY_LIMIT);
  if (error) {
    const message = String(error.message || "");
    if (message.includes("does not exist") || message.includes("planning_entries")) {
      appData.planningEntries = [];
      return [];
    }
    throw error;
  }
  appData.planningEntries = data || [];
  return appData.planningEntries;
}

function chunkPlanningEntries(list, size = 1500) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function parsePlanningFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (name.endsWith(".xls") && !isZip) {
    throw new Error("Le .xls ancien n'est pas lu. Enregistrez le fichier en .xlsx ou .csv.");
  }
  if (isZip || name.endsWith(".xlsx")) return parsePlanningXlsx(buffer);
  const text = new TextDecoder("utf-8").decode(bytes);
  return parsePlanningCsvText(text);
}

async function importPlanningFromFile(file) {
  const profiles = (appData.orgProfiles || []).filter(Boolean);
  const pool = profiles.length ? profiles : getReportProfiles();
  const rawRows = await parsePlanningFile(file);
  if (!rawRows.length) throw new Error("Aucune ligne de planning n'a été lue.");
  const { entries, unmatched, skippedEmptyMatricule } = buildPlanningImportEntries(rawRows, pool);
  if (!entries.length) {
    throw new Error(unmatched.length
      ? `Aucun agent reconnu : les matricules (${unmatched[0].split(" · ").pop() || ""}) ne correspondent pas aux fiches Daylyx, et les noms du fichier ne matchent pas. Ex. : ${unmatched.slice(0, 3).join(" · ")}`
      : "Aucun agent reconnu dans le fichier (les lignes sans matricule sont ignorées).");
  }
  const dates = entries.map((row) => row.work_date).sort();
  const replaceFrom = dates[0];
  const replaceTo = dates[dates.length - 1];
  const userIds = [...new Set(entries.map((row) => row.user_id))];
  await savePlanningEntries(entries, { replaceFrom, replaceTo, userIds });
  planningState.dept = "all";
  const sample = unmatched.slice(0, 4).join(" · ");
  const skipped = skippedEmptyMatricule ? ` · ${skippedEmptyMatricule} ligne${skippedEmptyMatricule > 1 ? "s" : ""} sans matricule ignorée${skippedEmptyMatricule > 1 ? "s" : ""}` : "";
  planningState.importNotice = `${entries.length} créneau${entries.length > 1 ? "x" : ""} importé${entries.length > 1 ? "s" : ""} · ${userIds.length} agent${userIds.length > 1 ? "s" : ""} · identifiant = matricule · heures prévues pour le calcul${skipped}${unmatched.length ? ` · ${unmatched.length} non reconnu${unmatched.length > 1 ? "s" : ""}${sample ? ` (${sample})` : ""}` : ""}.`;
}

function employeeNamesMatch(left, right) {
  const a = [...planningNameTokens(left)].sort();
  const b = [...planningNameTokens(right)].sort();
  if (a.length < 2 || a.length !== b.length) return false;
  return a.every((token, index) => token === b[index]);
}

function isPersonManagerName(value) {
  const tokens = planningNameTokens(value);
  if (tokens.length < 2) return false;
  const folded = foldPlanningToken(value);
  return !/^(oui|non|yes|no|n a|na|aucun|sans|x|manager|responsable)$/.test(folded);
}

function findProfileByEmployeeName(name, profiles) {
  if (!isPersonManagerName(name) && !planningNameTokens(name).length) return null;
  const hits = (profiles || []).filter((profile) => employeeNamesMatch(profile.full_name, name));
  return hits.length === 1 ? hits[0] : null;
}

function mapEmployeeRole(profileLabel, job, bu) {
  const text = foldPlanningToken([profileLabel, job, bu].join(" "));
  if (/(directeur|direction|codir|dirigeant)/.test(text)) return { role: "manager", leave_grade: "codir" };
  if (/(ops manager|operations manager|manager|responsable|chef de|head of)/.test(text)) return { role: "manager", leave_grade: "manager" };
  return { role: "employee", leave_grade: "employee" };
}

function mapEmployeeShift(bu, subBu, job) {
  const text = foldPlanningToken([bu, subBu, job].join(" "));
  if (/(r d|r&d|\brnd\b|recherche)/.test(text)) return "rnd";
  if (/\bces\b/.test(text)) return "ces";
  return "cs";
}

function buildEmployeeImportRows(rawRows) {
  const employees = [];
  let skippedLeft = 0;
  let skippedEmpty = 0;
  rawRows.forEach((row) => {
    const matriculeId = normalizeMatriculeId(row.empId) || normalizeMatriculeId(row.empIdAlt);
    const firstName = String(row.firstName || "").trim();
    const lastName = String(row.lastName || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
      || [lastName, firstName].filter(Boolean).join(" ").trim();
    if (!matriculeId && !fullName) {
      skippedEmpty += 1;
      return;
    }
    if (employeeHasLeft(row)) {
      skippedLeft += 1;
      return;
    }
    const ranks = mapEmployeeRole(row.profileLabel, row.job, row.bu);
    const department = [row.bu, row.subBu].map((item) => String(item || "").trim()).filter(Boolean).join(" / ") || "General";
    const managerName = isPersonManagerName(row.managerName) ? String(row.managerName).trim() : "";
    employees.push({
      matricule: matriculeId,
      full_name: fullName || matriculeId,
      email: String(row.email || "").trim().toLowerCase(),
      job_title: String(row.job || row.profileLabel || "Collaborateur").trim() || "Collaborateur",
      department,
      role: ranks.role,
      leave_grade: ranks.leave_grade,
      shift_code: mapEmployeeShift(row.bu, row.subBu, row.job),
      hired_at: parseHrDate(row.hiredAt) || "",
      manager_matricule: normalizeMatriculeId(row.managerMatricule),
      manager_name: managerName
    });
  });
  const seen = new Set();
  const unique = [];
  employees.forEach((row) => {
    const key = normalizeMatriculeDigits(row.matricule) || foldPlanningToken(row.full_name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  const managerNames = unique.map((row) => row.manager_name).filter(Boolean);
  unique.forEach((row) => {
    if (row.role !== "employee") return;
    if (managerNames.some((name) => employeeNamesMatch(row.full_name, name))) {
      row.role = "manager";
      row.leave_grade = "manager";
    }
  });
  return { employees: unique, skippedLeft, skippedEmpty };
}

async function importEmployeesFromFile(file) {
  if (!isAdmin() && !demoMode) throw new Error("Seul un administrateur peut importer les employés.");
  const grid = await parseSpreadsheetGrid(file);
  if (!grid.length) throw new Error("Aucune ligne n'a été lue.");
  const headerKeys = mapEmployeeHeaders(grid[0] || []);
  const rawRows = grid.slice(1).map((cells) => {
    const row = {};
    headerKeys.forEach((key, index) => {
      if (!key) return;
      const value = cells[index] == null ? "" : String(cells[index]).trim();
      if (row[key] && !value) return;
      row[key] = value;
    });
    return row;
  });
  const { employees, skippedLeft, skippedEmpty } = buildEmployeeImportRows(rawRows);
  if (!employees.length) {
    throw new Error("Aucun employé actif à importer. Vérifiez les colonnes Nom / PRENOM / identifiant, et les dates de départ.");
  }
  let created = 0;
  let updated = 0;
  let managersLinked = 0;
  let total = 0;
  if (demoMode || !usesDatabase()) {
    const byMatricule = new Map((appData.orgProfiles || []).map((profile) => {
      const digits = normalizeMatriculeDigits(profile.matricule);
      return [digits || normalizeMatriculeId(profile.matricule), profile];
    }));
    employees.forEach((row) => {
      const existing = (row.matricule && (byMatricule.get(normalizeMatriculeDigits(row.matricule)) || byMatricule.get(row.matricule)))
        || findProfileByEmployeeName(row.full_name, appData.orgProfiles);
      if (existing) {
        Object.assign(existing, {
          full_name: row.full_name || existing.full_name,
          job_title: row.job_title,
          department: row.department,
          matricule: row.matricule || existing.matricule,
          shift_code: row.shift_code,
          leave_grade: row.leave_grade,
          holiday_calendar: defaultHolidayCalendarForShift(row.shift_code),
          hired_at: row.hired_at || existing.hired_at,
          role: existing.role === "creator" || existing.role === "admin" ? existing.role : row.role
        });
        updated += 1;
      } else {
        const profile = {
          id: `import-${row.matricule || Date.now()}-${created}`,
          email: row.email || "",
          full_name: row.full_name,
          job_title: row.job_title,
          department: row.department,
          role: row.role,
          manager_id: "",
          matricule: row.matricule,
          shift_code: row.shift_code,
          leave_grade: row.leave_grade,
          holiday_calendar: defaultHolidayCalendarForShift(row.shift_code),
          hired_at: row.hired_at
        };
        appData.orgProfiles.push(profile);
        byMatricule.set(normalizeMatriculeDigits(row.matricule) || row.matricule, profile);
        created += 1;
      }
    });
    employees.forEach((row) => {
      if (!row.manager_matricule && !row.manager_name) return;
      const profile = (appData.orgProfiles || []).find((item) => (
        (row.matricule && (normalizeMatriculeDigits(item.matricule) === normalizeMatriculeDigits(row.matricule) || normalizeMatriculeId(item.matricule) === row.matricule))
        || employeeNamesMatch(item.full_name, row.full_name)
      ));
      const manager = (appData.orgProfiles || []).find((item) => (
        (row.manager_matricule && (normalizeMatriculeDigits(item.matricule) === normalizeMatriculeDigits(row.manager_matricule) || normalizeMatriculeId(item.matricule) === row.manager_matricule))
        || (row.manager_name && employeeNamesMatch(item.full_name, row.manager_name))
      ));
      if (profile && manager && manager.id !== profile.id) {
        profile.manager_id = manager.id;
        if (manager.role === "employee") {
          manager.role = "manager";
          manager.leave_grade = manager.leave_grade === "codir" ? "codir" : "manager";
        }
        managersLinked += 1;
      }
    });
  } else {
    const chunks = chunkPlanningEntries(employees, 400);
    for (const chunk of chunks) {
      const { data, error } = await supabaseClient.rpc("import_employees", { employees: chunk });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error.message || "Import employés refusé.");
      created += Number(data?.created || 0);
      updated += Number(data?.updated || 0);
      managersLinked += Number(data?.managersLinked || data?.managers_linked || 0);
      total = Number(data?.total || 0) || total;
    }
    dataStamp.org = 0;
    dataStamp.orgFull = 0;
    await loadOrgProfilesFull();
  }
  const visible = (appData.orgProfiles || []).length;
  appData.employeeImportNotice = `${employees.length} actif${employees.length > 1 ? "s" : ""} importé${employees.length > 1 ? "s" : ""} · ${created} créé${created > 1 ? "s" : ""} · ${updated} mis à jour · ${visible} fiches visibles${total ? ` · ${total} en base` : ""} · identifiant = matricule${skippedLeft ? ` · ${skippedLeft} Inactif/départ ignoré${skippedLeft > 1 ? "s" : ""}` : ""}${skippedEmpty ? ` · ${skippedEmpty} ligne${skippedEmpty > 1 ? "s" : ""} vide${skippedEmpty > 1 ? "s" : ""}` : ""}.`;
}

function getPlanningCursor() {
  if (planningState.cursor instanceof Date && !Number.isNaN(planningState.cursor.getTime())) {
    return new Date(planningState.cursor.getFullYear(), planningState.cursor.getMonth(), 1);
  }
  const now = new Date();
  planningState.cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(planningState.cursor);
}

function planningMonthRange(cursor = getPlanningCursor()) {
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { start: toDateKey(start), end: toDateKey(end), startDate: start, endDate: end };
}

function planningDaysOfMonth(cursor = getPlanningCursor()) {
  const { startDate, endDate } = planningMonthRange(cursor);
  const days = [];
  const cursorDay = new Date(startDate);
  while (cursorDay <= endDate) {
    days.push(toDateKey(cursorDay));
    cursorDay.setDate(cursorDay.getDate() + 1);
  }
  return days;
}

function planningDeptOf(profile) {
  const code = String(profile?.shift_code || "").toLowerCase();
  if (code === "rnd" || code === "ces" || code === "cs") return code;
  const dept = String(profile?.department || profile?.job_title || "").toLowerCase();
  if (dept.includes("r&d") || dept.includes("r et d") || /\brd\b/.test(dept)) return "rnd";
  if (/\bces\b/.test(dept)) return "ces";
  return "cs";
}

function getPlanningProfiles(dept = planningState.dept) {
  return getReportProfiles()
    .filter((profile) => dept === "all" || planningDeptOf(profile) === dept)
    .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "fr"));
}

function planningLeaveCode(type) {
  const text = foldAbsenceText(type);
  if (text.includes("retard")) return "RE";
  if (text.includes("depart")) return "DP";
  const key = leaveTypeKey(type);
  if (key === "maternity") return "MA";
  if (key === "paternity") return "PA";
  if (key === "unjustified") return "AI";
  if (key === "justified") return "AJ";
  if (key === "cp") return "CP";
  if (key === "unpaid") return "SS";
  if (key === "recup" || key === "rtt") return "RC";
  if (key === "travel") return "DE";
  if (key === "suspension") return "MP";
  if (key === "special") return "SP";
  return null;
}

function getPlanningLeaves() {
  return [
    ...getLeaveRequests(),
    ...(appData.teamLeaveRequests || []).map((row) => (row.type ? row : normalizeTeamLeaveRequest(row)))
  ].filter(edsLeaveApproved);
}

function leaveCoversPlanningDay(item, dayKey) {
  const start = String(item.start || item.start_date || "").slice(0, 10);
  const end = String(item.end || item.end_date || start).slice(0, 10);
  return Boolean(start && end && dayKey >= start && dayKey <= end);
}

function isClosedPlanningDay(dayKey) {
  return String(dayKey || "").slice(0, 10) < companyDateKey();
}

function canJustifyAbsence(userId) {
  if (!userId) return false;
  if (userId === session?.user?.id) return isAdmin();
  if (isHr()) return true;
  return getDirectReportProfiles().some((profile) => profile.id === userId);
}

function hasPunchOnPlanningDay(userId, dayKey) {
  const key = String(dayKey || "").slice(0, 10);
  const match = (row) => {
    const normalized = normalizeTeamPunchRow(row);
    return normalized.userId === userId && normalized.punchDate === key;
  };
  if ((appData.teamPunches || []).some(match)) return true;
  return (appData.punches || []).some(match);
}

function isUnjustifiedAbsenceDay(profile, dayKey, options = {}) {
  if (!profile?.id || !isClosedPlanningDay(dayKey)) return false;
  let slots = options.slots;
  if (slots === undefined) {
    const found = planningDaySlots(profile.id, dayKey);
    slots = found.length ? found : null;
  } else if (Array.isArray(slots) && !slots.length) {
    slots = null;
  }
  if (!slots) return false;
  const plannedHours = slots.reduce((total, item) => total + Number(item.hours || 0), 0);
  const plannedAbsence = Boolean(slots.some((item) => PLANNING_ABSENCE_CODES.has(item.kind)));
  if (!(plannedHours > 0) || plannedAbsence) return false;
  const dayLeaves = options.dayLeaves !== undefined
    ? options.dayLeaves
    : getPlanningLeaves().filter((item) => (
      (item.userId || item.user_id) === profile.id && leaveCoversPlanningDay(item, dayKey)
    ));
  if (dayLeaves.length) return false;
  if (Object.prototype.hasOwnProperty.call(options, "dayRow")) {
    if (options.dayRow) return false;
  } else if (hasPunchOnPlanningDay(profile.id, dayKey)) {
    return false;
  }
  return true;
}

function listUnjustifiedAbsencesFromModel(model) {
  const items = [];
  (model?.rows || []).forEach((row) => {
    if (!canJustifyAbsence(row.profile.id)) return;
    (model.days || []).forEach((dayKey) => {
      if (row.cells?.[dayKey]?.unjustifiedPending) {
        items.push({
          userId: row.profile.id,
          name: row.profile.full_name,
          dayKey,
          title: row.cells[dayKey].title || "Absence injustifiée"
        });
      }
    });
  });
  items.sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)) || String(a.name).localeCompare(String(b.name), "fr"));
  return items;
}

function countPendingUnjustifiedAbsences() {
  if (!canViewPlanning()) return 0;
  if (!(isHr() || hasDirectReports())) return 0;
  return listUnjustifiedAbsencesFromModel(buildPlanningModel()).length;
}

function renderUnjustifiedAbsenceInbox(model) {
  if (!(isHr() || hasDirectReports())) return "";
  const pending = listUnjustifiedAbsencesFromModel(model);
  const totalPages = Math.max(1, Math.ceil(pending.length / AI_INBOX_PAGE_SIZE));
  let page = Number(planningState.aiPage) || 1;
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  planningState.aiPage = page;
  const start = (page - 1) * AI_INBOX_PAGE_SIZE;
  const visible = pending.slice(start, start + AI_INBOX_PAGE_SIZE);
  const showPager = pending.length > AI_INBOX_PAGE_SIZE;
  return `
    <article class="card table-card page-spacer ai-inbox">
      <div class="toolbar">
        <h3>Absences injustifiées à justifier</h3>
        <span class="hierarchy-result-count">${pending.length} absence${pending.length > 1 ? "s" : ""}</span>
      </div>
      <p class="hierarchy-meta">Un collaborateur planifié sans pointage reste en <strong>absence injustifiée (AI)</strong> jusqu'à validation par le traffic manager (N+1) ou le RH. La validation passe le jour en <strong>absence justifiée (AJ)</strong>.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Collaborateur</th>
              <th>Date</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visible.length
              ? visible.map((item) => `
                <tr>
                  <td><strong>${escapeHtml(item.name)}</strong></td>
                  <td>${formatDate(item.dayKey)}</td>
                  <td>${badge("Absence injustifiée")}</td>
                  <td class="delay-review-actions">
                    <button type="button" class="primary" data-absence-justify data-user-id="${escapeHtml(item.userId)}" data-day-key="${escapeHtml(item.dayKey)}">Justifier</button>
                  </td>
                </tr>`).join("")
              : `<tr><td colspan="4" class="empty-cell">Aucune absence injustifiée à justifier sur ce mois.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${showPager ? `
      <nav class="ai-pager" aria-label="Pagination des absences injustifiées">
        <button type="button" class="outline-button" data-ai-page="${page - 1}"${page <= 1 ? " disabled" : ""}>Précédent</button>
        <span class="ai-pager__status">Page ${page} / ${totalPages}</span>
        <button type="button" class="outline-button" data-ai-page="${page + 1}"${page >= totalPages ? " disabled" : ""}>Suivant</button>
      </nav>` : ""}
    </article>`;
}

function closeJustifyAbsenceDialog() {
  document.removeEventListener("keydown", onJustifyAbsenceKeydown);
  document.getElementById("justify-absence-overlay")?.remove();
}

function onJustifyAbsenceKeydown(event) {
  if (event.key === "Escape") closeJustifyAbsenceDialog();
}

function openJustifyAbsenceDialog(userId, dayKey) {
  if (!canJustifyAbsence(userId) || !dayKey) return;
  closeJustifyAbsenceDialog();
  closePlanningDayDialog();
  const profile = profileById(userId);
  const overlay = document.createElement("div");
  overlay.id = "justify-absence-overlay";
  overlay.className = "punch-rectify-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "justify-absence-title");
  overlay.innerHTML = `
    <form id="justify-absence-form" class="punch-rectify-card">
      <h3 id="justify-absence-title">Justifier l'absence</h3>
      <p class="hierarchy-meta">${escapeHtml(profile?.full_name || "Collaborateur")} · ${escapeHtml(formatDate(dayKey))}</p>
      <p class="data-note">Le jour passe d'absence injustifiée (AI) à absence justifiée (AJ). Le commentaire est obligatoire ; une pièce jointe peut être jointe si elle est disponible.</p>
      <label class="popup-comment-field">
        Commentaire
        <textarea name="comment" rows="6" required minlength="4" maxlength="400" placeholder="Motif de la justification"></textarea>
      </label>
      <label>Pièce jointe <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"></label>
      <input type="hidden" name="userId" value="${escapeHtml(userId)}">
      <input type="hidden" name="dayKey" value="${escapeHtml(dayKey)}">
      <div class="punch-rectify-actions">
        <button type="button" class="outline-button" data-justify-absence-close>Annuler</button>
        <button type="submit" class="primary">Valider en AJ</button>
      </div>
    </form>`;
  const close = () => closeJustifyAbsenceDialog();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-justify-absence-close]")?.addEventListener("click", close);
  overlay.querySelector("#justify-absence-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    withAction(async () => {
      await submitJustifyAbsence({
        userId: String(data.get("userId") || ""),
        dayKey: String(data.get("dayKey") || ""),
        comment: String(data.get("comment") || ""),
        attachmentName: data.get("file")?.name || ""
      });
      closeJustifyAbsenceDialog();
    });
  });
  document.body.appendChild(overlay);
  overlay.querySelector("[name='comment']")?.focus();
  document.addEventListener("keydown", onJustifyAbsenceKeydown);
}

async function submitJustifyAbsence({ userId, dayKey, comment, attachmentName }) {
  if (!canJustifyAbsence(userId)) {
    throw new Error("Seul le traffic manager ou le RH peut justifier cette absence.");
  }
  const dateKey = String(dayKey || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Journée invalide.");
  if (!isClosedPlanningDay(dateKey)) {
    throw new Error("La justification n'est possible que pour une journée close.");
  }
  const note = sanitizePunchReason(comment);
  if (note.length < 4) throw new Error("Indiquez un commentaire de justification (4 caractères minimum).");
  const profile = profileById(userId);
  const chain = typeof getLeaveValidatorChain === "function" ? getLeaveValidatorChain(userId) : [];
  const payload = {
    userId,
    type: "ABS JUSTTIFIER",
    start: dateKey,
    end: dateKey,
    days: 1,
    hours: null,
    unit: "days",
    halfDay: "",
    motif: "Absence justifiée",
    attachmentName: String(attachmentName || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 180),
    comment: note,
    workflowStep: Math.max(chain.length, 1),
    status: "Approuve",
    name: profile?.full_name || "",
    created: new Date().toISOString()
  };
  if (usesDatabase()) {
    await insertLeaveRequestRow({
      user_id: userId,
      leave_type: payload.type,
      start_date: payload.start,
      end_date: payload.end,
      days: payload.days,
      hours: payload.hours,
      unit: payload.unit,
      half_day: null,
      motif: payload.motif,
      attachment_name: payload.attachmentName || null,
      workflow_step: payload.workflowStep,
      comment: payload.comment,
      status: payload.status
    });
    dataStamp.leave = 0;
    dataStamp.teamLeave = 0;
    await loadOwnLeave();
    if (canViewTeamLeaveCalendar()) {
      await loadTeamLeaveRequests(currentPage === "planning" ? planningMonthRange() : getLeaveCalendarMonth());
    }
    return;
  }
  const requests = loadStore("leaveRequests", []);
  requests.unshift({ id: Date.now(), ...payload });
  saveStore("leaveRequests", requests);
}

function buildPlanningModel() {
  const cursor = getPlanningCursor();
  const range = planningMonthRange(cursor);
  const days = planningDaysOfMonth(cursor);
  const dept = planningState.dept;
  const profiles = getPlanningProfiles(dept);
  const flexible = dept === "rnd";
  const punches = getReportPunches();
  const daily = summarizeTeamPunchesByDay(punches, range.start, range.end);
  const leaves = getPlanningLeaves();
  const logs = [];
  const gapAgents = {
    delay: new Set(),
    early: new Set(),
    missing: new Set(),
    hours: new Set(),
    telework: new Set(),
    unjustified: new Set()
  };

  const imported = planningSlotsByUserDay();
  const rows = profiles.map((profile) => {
    const cells = {};
    days.forEach((dayKey) => {
      const slots = imported.get(`${profile.id}|${dayKey}`);
      const plannedHours = slots
        ? slots.reduce((total, item) => total + Number(item.hours || 0), 0)
        : null;
      const plannedAbsence = Boolean(slots && slots.some((item) => PLANNING_ABSENCE_CODES.has(item.kind)));
      const working = plannedHours == null ? isWorkingDayKey(dayKey, profile) : (plannedHours > 0 || plannedAbsence);
      const dayRow = daily.find((row) => row.userId === profile.id && row.dayKey === dayKey);
      const dayLeaves = leaves.filter((item) => (
        (item.userId || item.user_id) === profile.id && leaveCoversPlanningDay(item, dayKey)
      ));
      const codes = [];
      const notes = [];
      if (!slots && isHolidayKey(dayKey, profile)) {
        codes.push("FER");
        notes.push(`Jour férié ${holidayCalendarLabel(getHolidayCalendar(profile))}`);
      }
      if (slots) {
        slots.forEach((item) => {
          if (!item.kind) return;
          if (plannedHours <= 0 && item.kind === "PR") return;
          codes.push(item.kind);
        });
        notes.push(`Prévu ${plannedHours}h`);
        const importedMatricule = slots.map((item) => item.matricule).find(Boolean);
        if (importedMatricule) notes.push(`Matricule ${importedMatricule}`);
      }
      dayLeaves.forEach((item) => {
        const code = planningLeaveCode(item.type);
        if (code) {
          codes.push(code);
          notes.push(item.type);
          logs.push({ dayKey, name: profile.full_name, kind: code, detail: item.type, source: "demande" });
          if (code === "AI") gapAgents.unjustified.add(profile.id);
        }
      });
      if (dayRow) {
        const stats = analyzeWorkedDay(dayRow, profile);
        const loc = dayRow.workLocation || (dayRow.punches && dayRow.punches[0] && dayRow.punches[0].workLocation);
        if (loc === "remote") {
          codes.push("TT");
          gapAgents.telework.add(profile.id);
        } else if (!dayLeaves.length && !plannedAbsence && !(slots && plannedHours > 0 && slots.some((item) => item.kind === "PR"))) {
          if (working) codes.push("PR");
        }
        if (!flexible && working && stats.delayMin > 0) {
          codes.push("RE");
          notes.push(`Retard ${stats.delayMin} min`);
          logs.push({ dayKey, name: profile.full_name, kind: "RE", detail: `${stats.delayMin} min`, source: "pointage" });
          gapAgents.delay.add(profile.id);
        }
        if (!flexible && working) {
          const early = earlyLeaveMinutes(dayRow, profile);
          if (early > 0) {
            codes.push("DP");
            notes.push(`Départ ${early} min`);
            logs.push({ dayKey, name: profile.full_name, kind: "DP", detail: `${early} min`, source: "pointage" });
            gapAgents.early.add(profile.id);
          }
        }
        const targetMs = stats.plannedMs || 8 * 3600000;
        if (flexible && working && stats.realizedMs > 0 && stats.realizedMs < targetMs) {
          codes.push("EC");
          notes.push(`${formatDuration(stats.realizedMs)} / ${formatDuration(targetMs)}`);
          logs.push({ dayKey, name: profile.full_name, kind: "EC", detail: `${formatDuration(stats.realizedMs)} / ${formatDuration(targetMs)}`, source: "pointage" });
          gapAgents.hours.add(profile.id);
        }
      } else if (isUnjustifiedAbsenceDay(profile, dayKey, { slots, dayRow: dayRow || null, dayLeaves })) {
        codes.length = 0;
        codes.push("AI");
        notes.push("Absence injustifiée — en attente de justification par le manager ou le RH");
        logs.push({ dayKey, name: profile.full_name, kind: "AI", detail: "Jour ouvré sans pointage ni demande validée", source: "écart" });
        gapAgents.unjustified.add(profile.id);
      } else if (working && !dayLeaves.length && !plannedAbsence) {
        notes.push("Non pointé");
        logs.push({ dayKey, name: profile.full_name, kind: "AB", detail: "Jour ouvré sans pointage ni demande", source: "écart" });
        gapAgents.missing.add(profile.id);
        const planned = slots && plannedHours > 0;
        if (!planned) codes.push("AB");
      }
      const unjustifiedPending = isUnjustifiedAbsenceDay(profile, dayKey, { slots, dayRow: dayRow || null, dayLeaves });
      const uniqueCodes = [...new Set(codes)];
      const leaveAbsence = uniqueCodes.some((code) => (
        PLANNING_ABSENCE_CODES.has(code) && code !== "FER" && code !== "DE"
      ));
      const plannedPresence = uniqueCodes.some((code) => code === "PR" || code === "TT" || code === "FER" || code === "DE");
      const editor = planningSlotsEditor(slots);
      if (editor.label) notes.push(editor.label);
      const displayCodes = unjustifiedPending
        ? ["AI"]
        : uniqueCodes.filter((code) => {
          if (leaveAbsence && (code === "PR" || code === "TT")) return false;
          if (plannedPresence && code === "AB") return false;
          return true;
        });
      cells[dayKey] = {
        codes: displayCodes,
        title: notes.join(" · "),
        off: !working,
        edited: Boolean(slots && slots.some((item) => item.source === "manual" || item.source === "assign")),
        unjustifiedPending
      };
    });
    return { profile, cells };
  });

  logs.sort((a, b) => String(b.dayKey).localeCompare(String(a.dayKey)) || String(a.name).localeCompare(String(b.name), "fr"));
  return { cursor, range, days, dept, flexible, profiles, rows, logs, gapAgents };
}

/* planningPage() moved to pages/planning.js */

function planningAssignScopeLists() {
  const profiles = getPlanningProfiles("all");
  const departments = [...new Set(profiles.map((profile) => String(profile.department || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "fr"));
  const reportIds = new Set(profiles.map((profile) => profile.manager_id).filter(Boolean));
  const managers = profiles
    .filter((profile) => reportIds.has(profile.id))
    .sort((left, right) => String(left.full_name || "").localeCompare(String(right.full_name || ""), "fr"));
  const people = [...profiles].sort((left, right) =>
    String(left.full_name || "").localeCompare(String(right.full_name || ""), "fr")
  );
  return { departments, managers, people };
}

function resolvePlanningAssignProfiles(data) {
  const all = getPlanningProfiles("all");
  const scope = String(data.get("scope") || "shift");
  const value = String(data.get("scope_value") || "");
  if (scope === "shift") {
    if (!value || value === "all") return all;
    return all.filter((profile) => planningDeptOf(profile) === value);
  }
  if (scope === "department") {
    return all.filter((profile) => String(profile.department || "") === value);
  }
  if (scope === "manager") {
    return all.filter((profile) => profile.manager_id === value);
  }
  if (scope === "collaborator") {
    if (!value) return [];
    return all.filter((profile) => profile.id === value);
  }
  return all;
}

function planningAssignWorkDates(start, end, mode) {
  const from = parseLocalDate(start);
  const to = parseLocalDate(end);
  const dates = [];
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return dates;
  const cursor = new Date(from);
  while (cursor <= to) {
    const key = toDateKey(cursor);
    const weekday = cursor.getDay();
    if (mode === "all" || (weekday >= 1 && weekday <= 5)) dates.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildMassPlanningEntries(profiles, options) {
  const allowed = Object.fromEntries(PLANNING_CODES.map((item) => [item.code, true]));
  const kind = allowed[String(options.kind || "PR").toUpperCase()] ? String(options.kind).toUpperCase() : "PR";
  const hours = Math.max(0, Math.min(12, Number(options.hours || 0)));
  const split = options.split === "half" && hours > 0;
  const slotHours = split ? Math.round((hours / 2) * 100) / 100 : hours;
  const entries = [];
  profiles.forEach((profile) => {
    options.dates.forEach((workDate) => {
      const base = {
        user_id: profile.id,
        work_date: workDate,
        kind,
        hours: slotHours,
        department: profile.department || "",
        structure: "",
        location: kind === "TT" ? "Télétravail" : "",
        note: "Affectation masse",
        source: "assign",
        matricule: profile.matricule || ""
      };
      if (split) {
        entries.push({ ...base, slot: 1 });
        entries.push({ ...base, slot: 2 });
      } else {
        entries.push({ ...base, slot: 1, hours });
      }
    });
  });
  return entries;
}

async function savePlanningEntries(entries, { replaceFrom, replaceTo, userIds }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (demoMode || !usesDatabase()) {
    appData.planningEntries = [
      ...getPlanningEntries().filter((row) => {
        const day = String(row.work_date || "").slice(0, 10);
        const uid = row.user_id || row.userId;
        return !(ids.includes(uid) && day >= replaceFrom && day <= replaceTo);
      }),
      ...entries.map((row, index) => ({
        ...row,
        id: `local-pl-${Date.now()}-${index}`,
        created_by: session?.user?.id || "",
        created_at: new Date().toISOString()
      }))
    ];
    return { imported: entries.length };
  }
  if (!entries.length) {
    const { data, error } = await supabaseClient.rpc("import_planning_entries", {
      entries: [],
      replace_from: replaceFrom,
      replace_to: replaceTo,
      replace_user_ids: ids
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error.message || "Affectation planning refusée.");
    dataStamp.planningEntries = 0;
    await loadPlanningEntries();
    return { imported: 0 };
  }
  const chunks = chunkPlanningEntries(entries, 1500);
  for (let i = 0; i < chunks.length; i += 1) {
    const { data, error } = await supabaseClient.rpc("import_planning_entries", {
      entries: chunks[i],
      replace_from: replaceFrom,
      replace_to: replaceTo,
      replace_user_ids: i === 0 ? ids : []
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error.message || "Affectation planning refusée.");
  }
  dataStamp.planningEntries = 0;
  await loadPlanningEntries();
  return { imported: entries.length };
}

async function applyMassShiftCode(profiles, shiftCode) {
  if (!shiftCode || !["cs", "ces", "rnd"].includes(shiftCode)) return 0;
  let count = 0;
  const pending = [];
  profiles.forEach((profile) => {
    if (profile.shift_code === shiftCode) return;
    profile.shift_code = shiftCode;
    profile.holiday_calendar = defaultHolidayCalendarForShift(shiftCode);
    count += 1;
    if (!demoMode && usesDatabase()) {
      pending.push(supabaseClient.from("profiles").update({
        shift_code: shiftCode,
        holiday_calendar: profile.holiday_calendar
      }).eq("id", profile.id));
    }
  });
  for (let i = 0; i < pending.length; i += 15) {
    const batch = await Promise.all(pending.slice(i, i + 15));
    const failed = batch.find((item) => item.error);
    if (failed?.error) throw failed.error;
  }
  return count;
}

const TT_QUOTA_BY_DEPT = { rnd: 3, cs: 2, ces: 2 };

function ttQuotaForDept(dept) {
  return TT_QUOTA_BY_DEPT[String(dept || "").toLowerCase()] || 2;
}

function monthRotationOffset(year, monthIndex) {
  return ((Number(year) * 12) + Number(monthIndex)) % 5;
}

function ttWeekdaysForPerson(personIndex, monthOffset, quota) {
  const count = Math.max(0, Math.min(5, Number(quota) || 0));
  const start = ((Number(personIndex) || 0) + (Number(monthOffset) || 0)) % 5;
  const days = [];
  for (let i = 0; i < count; i += 1) days.push(((start + i) % 5) + 1);
  return days;
}

function assignTtRotation(people, workDates, options = {}) {
  const skip = options.skip instanceof Set ? options.skip : new Set();
  const offset = monthRotationOffset(options.year, options.monthIndex);
  const buckets = { rnd: [], cs: [], ces: [] };
  [...people].sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach((person) => {
    const dept = buckets[person.dept] ? person.dept : "cs";
    buckets[dept].push({ ...person, dept });
  });
  const sorted = ["rnd", "cs", "ces"].flatMap((dept) => buckets[dept]);
  const assign = {};
  Object.values(buckets).forEach((members) => {
    members.forEach((person, index) => {
      const ttDays = new Set(ttWeekdaysForPerson(index, offset, ttQuotaForDept(person.dept)));
      workDates.forEach((date) => {
        const key = `${person.id}|${date}`;
        if (skip.has(key)) return;
        const weekday = parseLocalDate(date).getDay();
        assign[key] = ttDays.has(weekday) ? "TT" : "PR";
      });
    });
  });
  const available = (date, dept) => sorted.filter((person) => {
    if (dept && person.dept !== dept) return false;
    return !skip.has(`${person.id}|${date}`);
  });
  const withKind = (date, dept, kind) => available(date, dept).filter((person) => assign[`${person.id}|${date}`] === kind);
  const ttCount = (personId) => workDates.filter((date) => assign[`${personId}|${date}`] === "TT").length;
  const forceOffice = (date, candidates) => {
    const pick = [...candidates].sort((a, b) => {
      const diff = ttCount(b.id) - ttCount(a.id);
      return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
    })[0];
    if (pick) assign[`${pick.id}|${date}`] = "PR";
  };
  workDates.forEach((date) => {
    ["rnd", "cs", "ces"].forEach((dept) => {
      if (available(date, dept).length < 2) return;
      if (!withKind(date, dept, "PR").length) forceOffice(date, withKind(date, dept, "TT"));
    });
    if (available(date).length && !withKind(date, null, "PR").length) {
      forceOffice(date, withKind(date, null, "TT"));
    }
  });
  return assign;
}

function planningTtWorkDates(cursor = getPlanningCursor()) {
  return planningDaysOfMonth(cursor).filter((day) => !isWeekendDate(parseLocalDate(day)));
}

function planningTtBlockingKind(kindOrType) {
  const raw = String(kindOrType || "");
  const code = PLANNING_ABSENCE_CODES.has(raw) || raw === "DE" ? raw : planningLeaveCode(raw);
  if (!code || code === "RE" || code === "DP") return "";
  return PLANNING_ABSENCE_CODES.has(code) || code === "DE" ? code : "";
}

function planningHoursForLeaveDay(profile, item) {
  const dept = planningDeptOf(profile);
  const full = Number(SHIFT_PRESETS[dept]?.plannedHours || 8);
  const unit = String(item?.unit || "").toLowerCase();
  const half = String(item?.halfDay || item?.half_day || "").trim();
  if (unit === "half" || half) return Math.max(1, full / 2);
  if (unit === "hours" && Number(item?.hours) > 0) return Number(item.hours);
  return full;
}

function clonePlanningAbsenceEntry(row) {
  return {
    user_id: row.user_id || row.userId,
    work_date: String(row.work_date).slice(0, 10),
    slot: Number(row.slot || 1),
    kind: row.kind,
    hours: Number(row.hours || 0),
    department: row.department || "",
    structure: row.structure || "",
    location: row.location || "",
    note: row.note || "",
    source: row.source || "manual",
    matricule: row.matricule || ""
  };
}

function planningTtSkipSet(profiles, dates) {
  const skip = new Set();
  const ids = new Set(profiles.map((profile) => profile.id));
  const dateSet = new Set(dates);
  profiles.forEach((profile) => {
    dates.forEach((day) => {
      if (isHolidayKey(day, profile)) skip.add(`${profile.id}|${day}`);
    });
  });
  getPlanningLeaves().forEach((item) => {
    const uid = item.userId || item.user_id;
    if (!ids.has(uid) || !planningTtBlockingKind(item.type)) return;
    dates.forEach((day) => {
      if (leaveCoversPlanningDay(item, day)) skip.add(`${uid}|${day}`);
    });
  });
  getPlanningEntries().forEach((row) => {
    const uid = row.user_id || row.userId;
    const day = String(row.work_date || "").slice(0, 10);
    if (!ids.has(uid) || !dateSet.has(day)) return;
    if (planningTtBlockingKind(row.kind)) skip.add(`${uid}|${day}`);
  });
  return skip;
}

function keptPlanningAbsenceEntries(profiles, start, end) {
  const ids = new Set(profiles.map((profile) => profile.id));
  const profileBy = Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
  const occupied = new Set();
  const kept = [];
  getPlanningEntries().forEach((row) => {
    const uid = row.user_id || row.userId;
    const day = String(row.work_date || "").slice(0, 10);
    if (!ids.has(uid) || day < start || day > end) return;
    if (!planningTtBlockingKind(row.kind)) return;
    occupied.add(`${uid}|${day}`);
    kept.push(clonePlanningAbsenceEntry(row));
  });
  getPlanningLeaves().forEach((item) => {
    const uid = item.userId || item.user_id;
    const profile = profileBy[uid];
    const kind = planningTtBlockingKind(item.type);
    if (!profile || !kind) return;
    const hours = planningHoursForLeaveDay(profile, item);
    const cursor = parseLocalDate(start);
    const last = parseLocalDate(end);
    while (cursor <= last) {
      const day = toDateKey(cursor);
      const key = `${uid}|${day}`;
      cursor.setDate(cursor.getDate() + 1);
      if (!isWorkingDayKey(day, profile) || occupied.has(key) || !leaveCoversPlanningDay(item, day)) continue;
      occupied.add(key);
      kept.push({
        user_id: uid,
        work_date: day,
        slot: 1,
        kind,
        hours,
        department: profile.department || "",
        structure: "",
        location: kind === "DE" ? "Déplacement" : "",
        note: item.type || kind,
        source: "leave",
        matricule: profile.matricule || ""
      });
    }
  });
  return kept;
}

async function applyTtRotationMonth() {
  if (!canImportPlanning()) throw new Error("Seul un manager ou un administrateur peut générer le planning.");
  const profiles = getPlanningProfiles("all");
  if (!profiles.length) throw new Error("Aucun collaborateur sur le planning.");
  const cursor = getPlanningCursor();
  const range = planningMonthRange(cursor);
  const todayKey = companyDateKey();
  const replaceFrom = range.start < todayKey ? todayKey : range.start;
  const dates = planningTtWorkDates(cursor).filter((day) => day >= replaceFrom);
  if (!dates.length) throw new Error("Aucun jour ouvré restant sur ce mois.");
  const people = profiles.map((profile) => ({ id: profile.id, dept: planningDeptOf(profile) }));
  const skip = planningTtSkipSet(profiles, dates);
  const assign = assignTtRotation(people, dates, {
    year: cursor.getFullYear(),
    monthIndex: cursor.getMonth(),
    skip
  });
  const generated = [];
  profiles.forEach((profile) => {
    const dept = planningDeptOf(profile);
    const hours = Number(SHIFT_PRESETS[dept]?.plannedHours || 8);
    dates.forEach((day) => {
      const kind = assign[`${profile.id}|${day}`];
      if (!kind) return;
      generated.push({
        user_id: profile.id,
        work_date: day,
        slot: 1,
        kind,
        hours,
        department: profile.department || "",
        structure: "",
        location: kind === "TT" ? "Télétravail" : "",
        note: "Rotation TT auto",
        source: "tt-rotation",
        matricule: profile.matricule || ""
      });
    });
  });
  const entries = [...keptPlanningAbsenceEntries(profiles, replaceFrom, range.end), ...generated];
  await savePlanningEntries(entries, {
    replaceFrom,
    replaceTo: range.end,
    userIds: profiles.map((profile) => profile.id)
  });
  const ttCount = generated.filter((row) => row.kind === "TT").length;
  const prCount = generated.filter((row) => row.kind === "PR").length;
  const keptCount = entries.length - generated.length;
  const keptNote = keptCount ? ` · ${keptCount} jour${keptCount > 1 ? "s" : ""} d'absence conservé${keptCount > 1 ? "s" : ""}` : "";
  planningState.dept = "all";
  planningState.importNotice = `Rotation TT ${range.start.slice(0, 7)} : ${profiles.length} agent${profiles.length > 1 ? "s" : ""} · ${ttCount} jour${ttCount > 1 ? "s" : ""} TT · ${prCount} sur site · R&D 3j / CS-CES 2j · bureau non vide${keptNote}.`;
}

async function applyMassPlanning(formOrData) {
  if (!canImportPlanning()) throw new Error("Seul un manager ou un administrateur peut affecter un planning.");
  const data = formOrData instanceof FormData ? formOrData : new FormData(formOrData);
  const start = String(data.get("start") || "");
  const end = String(data.get("end") || "");
  const kind = String(data.get("kind") || "PR");
  const daysMode = String(data.get("days") || "week");
  const profiles = resolvePlanningAssignProfiles(data);
  if (!profiles.length) throw new Error("Aucun agent dans ce périmètre.");
  if (!start || !end) throw new Error("Indiquez une période.");
  if (parseLocalDate(end) < parseLocalDate(start)) throw new Error("La date de fin doit être après la date de début.");
  const span = Math.round((parseLocalDate(end) - parseLocalDate(start)) / 86400000) + 1;
  if (span > 62) throw new Error("Période trop longue (max 62 jours).");
  const dates = kind === "clear" ? [] : planningAssignWorkDates(start, end, daysMode);
  if (kind !== "clear" && !dates.length) throw new Error("Aucun jour dans cette période.");
  const userIds = profiles.map((profile) => profile.id);
  const entries = kind === "clear"
    ? []
    : buildMassPlanningEntries(profiles, {
      dates,
      kind,
      hours: data.get("hours"),
      split: data.get("split")
    });
  await savePlanningEntries(entries, { replaceFrom: start, replaceTo: end, userIds });
  const shifted = await applyMassShiftCode(profiles, String(data.get("shift_code") || ""));
  planningState.dept = "all";
  const agents = `${profiles.length} agent${profiles.length > 1 ? "s" : ""}`;
  if (kind === "clear") {
    planningState.importNotice = `Planning effacé pour ${agents} du ${start} au ${end}.`;
    return;
  }
  planningState.importNotice = `${entries.length} créneau${entries.length > 1 ? "x" : ""} affecté${entries.length > 1 ? "s" : ""} · ${agents} · ${dates.length} jour${dates.length > 1 ? "s" : ""} · ${kind}${shifted ? ` · vacation mise à jour (${shifted})` : ""}.`;
}

function planningAssignPreviewText(formOrData) {
  if (!formOrData) return "";
  const data = formOrData instanceof FormData ? formOrData : new FormData(formOrData);
  const profiles = resolvePlanningAssignProfiles(data);
  const start = String(data.get("start") || "");
  const end = String(data.get("end") || "");
  const kind = String(data.get("kind") || "PR");
  if (kind === "clear") {
    return `${profiles.length} agent${profiles.length > 1 ? "s" : ""} · le planning sera effacé sur la période.`;
  }
  const dates = planningAssignWorkDates(start, end, String(data.get("days") || "week"));
  const split = data.get("split") === "half" ? 2 : 1;
  return `${profiles.length} agent${profiles.length > 1 ? "s" : ""} · ${dates.length} jour${dates.length > 1 ? "s" : ""} · ${profiles.length * dates.length * split} créneaux.`;
}

function renderPlanningAssignPanel() {
  if (!canImportPlanning()) return "";
  const month = planningMonthRange();
  const assign = planningState._assignDraft || {};
  const scope = assign.scope || "shift";
  const lists = planningAssignScopeLists();
  const scopeValue = assign.scopeValue || (scope === "shift" ? "cs" : "");
  let valueOptions = "";
  if (scope === "shift") {
    valueOptions = PLANNING_DEPTS.map((item) => `<option value="${item.id}"${item.id === scopeValue ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  } else if (scope === "department") {
    valueOptions = lists.departments.length
      ? lists.departments.map((item) => `<option value="${escapeHtml(item)}"${item === scopeValue ? " selected" : ""}>${escapeHtml(item)}</option>`).join("")
      : `<option value="">Aucune équipe</option>`;
  } else if (scope === "collaborator") {
    const selectedPerson = lists.people.some((item) => item.id === scopeValue)
      ? scopeValue
      : (lists.people[0]?.id || "");
    valueOptions = lists.people.length
      ? lists.people.map((item) => `<option value="${item.id}"${item.id === selectedPerson ? " selected" : ""}>${escapeHtml(item.full_name || "Collaborateur")}</option>`).join("")
      : `<option value="">Aucun collaborateur</option>`;
  } else {
    valueOptions = lists.managers.length
      ? lists.managers.map((item) => `<option value="${item.id}"${item.id === scopeValue ? " selected" : ""}>${escapeHtml(item.full_name)}</option>`).join("")
      : `<option value="">Aucun manager</option>`;
  }
  return `
    <details class="planning-assign"${planningState.assignOpen ? " open" : ""}>
      <summary>Affecter un planning (masse / équipe)</summary>
      <form id="planning-assign-form" class="feature-form planning-assign-form">
        <div class="form-row">
          <label>
            Périmètre
            <select name="scope" id="planning-assign-scope">
              <option value="shift"${scope === "shift" ? " selected" : ""}>Vacation (CS / CES / R&amp;D)</option>
              <option value="department"${scope === "department" ? " selected" : ""}>Équipe (département)</option>
              <option value="manager"${scope === "manager" ? " selected" : ""}>Équipe d'un manager</option>
              <option value="collaborator"${scope === "collaborator" ? " selected" : ""}>Collaborateur</option>
            </select>
          </label>
          <label>
            ${scope === "collaborator" ? "Collaborateur" : "Cible"}
            <select name="scope_value" id="planning-assign-value">${valueOptions}</select>
          </label>
        </div>
        <div class="form-row">
          <label>
            Du
            <input type="date" name="start" value="${escapeHtml(assign.start || month.start)}" required>
          </label>
          <label>
            Au
            <input type="date" name="end" value="${escapeHtml(assign.end || month.end)}" required>
          </label>
        </div>
        <div class="form-row">
          <label>
            Jours
            <select name="days">
              <option value="week"${(assign.days || "week") === "week" ? " selected" : ""}>Lundi → vendredi</option>
              <option value="all"${assign.days === "all" ? " selected" : ""}>Tous les jours</option>
            </select>
          </label>
          <label>
            Type
            <select name="kind">
              ${PLANNING_CODES.map((item) => `<option value="${item.code}"${(assign.kind || "PR") === item.code ? " selected" : ""}>${item.code} · ${escapeHtml(item.label)}</option>`).join("")}
              <option value="clear"${assign.kind === "clear" ? " selected" : ""}>Effacer le planning</option>
            </select>
          </label>
        </div>
        <div class="form-row">
          <label>
            Heures / jour
            <input type="number" name="hours" min="0" max="12" step="0.5" value="${escapeHtml(String(assign.hours ?? 8))}">
          </label>
          <label>
            Découpage
            <select name="split">
              <option value="one"${assign.split === "one" ? " selected" : ""}>Journée (1 créneau)</option>
              <option value="half"${(assign.split || "half") === "half" ? " selected" : ""}>2 × demi-journée</option>
            </select>
          </label>
        </div>
        <label>
          Vacation à appliquer (optionnel)
          <select name="shift_code">
            <option value="">Inchangée</option>
            <option value="cs"${assign.shiftCode === "cs" ? " selected" : ""}>CS · 08h–17h</option>
            <option value="ces"${assign.shiftCode === "ces" ? " selected" : ""}>CES · 08h–17h</option>
            <option value="rnd"${assign.shiftCode === "rnd" ? " selected" : ""}>R&amp;D · horaire souple</option>
          </select>
        </label>
        <p class="hierarchy-meta" id="planning-assign-preview"></p>
        <button type="submit" class="primary">Appliquer à l'équipe</button>
      </form>
    </details>`;
}

function renderPlanningGrid(model) {
  if (!model.profiles.length) {
    return `<article class="card"><p class="empty-state">Aucun collaborateur sur ce planning. Vérifiez la vacation (CS / CES / R&amp;D) dans Administration.</p></article>`;
  }
  const weekday = (dayKey) => parseLocalDate(dayKey).toLocaleDateString("fr-FR", { weekday: "short" });
  const dayNum = (dayKey) => dayKey.slice(8);
  return `
    <article class="card planning-card">
      <div class="planning-legend">
        ${PLANNING_CODES.map((item) => `<span class="pl-legend pl-cell--${item.code}"><b>${item.code}</b> ${escapeHtml(item.label)}</span>`).join("")}
      </div>
      <div class="planning-wrap">
        <table class="planning-grid">
          <thead>
            <tr>
              <th class="planning-name">Agent</th>
              ${model.days.map((day) => `<th class="${isWeekendDate(parseLocalDate(day)) ? "is-off" : ""}"><span>${weekday(day)}</span><strong>${dayNum(day)}</strong></th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${model.rows.map((row) => `
              <tr>
                <th class="planning-name">${escapeHtml(row.profile.full_name)}<small>${escapeHtml(row.profile.matricule || "")}</small></th>
                ${model.days.map((day) => {
                  const cell = row.cells[day];
                  const codes = cell.codes.length ? cell.codes.join("/") : "";
                  const cls = [
                    cell.off ? "is-off" : "",
                    cell.codes[0] ? `pl-cell--${cell.codes[0]}` : "",
                    "is-editable",
                    cell.edited ? "is-edited" : "",
                    cell.unjustifiedPending ? "is-unjustified" : ""
                  ].filter(Boolean).join(" ");
                  const title = [cell.title || codes, "Cliquer pour modifier"].filter(Boolean).join(" · ");
                  return `<td class="${cls}">
                    <button type="button" class="planning-day-btn" data-planning-day="${escapeHtml(day)}" data-planning-user="${escapeHtml(row.profile.id)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(`${row.profile.full_name} · ${formatDate(day)}${codes ? ` · ${codes}` : ""}`)}">${escapeHtml(codes) || "·"}</button>
                  </td>`;
                }).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </article>`;
}

function closePlanningDayDialog() {
  document.removeEventListener("keydown", onPlanningDayKeydown);
  document.getElementById("planning-day-overlay")?.remove();
}

function onPlanningDayKeydown(event) {
  if (event.key === "Escape") closePlanningDayDialog();
}

function planningDayKindDefault(slots, cellCodes) {
  const fromSlot = slots.find((item) => item.kind && !PLANNING_COMPUTED_CODES.has(item.kind));
  if (fromSlot) return fromSlot.kind;
  const fromCell = (cellCodes || []).find((code) => PLANNING_EDIT_CODES.some((item) => item.code === code));
  return fromCell || "PR";
}

function openPlanningDayDialog(userId, dayKey) {
  if (!userId || !dayKey) return;
  closePlanningDayDialog();
  const profile = profileById(userId);
  const slots = planningDaySlots(userId, dayKey);
  const editor = planningSlotsEditor(slots);
  const canEdit = canImportPlanning();
  const kind = planningDayKindDefault(slots, []);
  const hours = slots.length
    ? slots.reduce((total, item) => total + Number(item.hours || 0), 0)
    : (PLANNING_ABSENCE_CODES.has(kind) ? 0 : 8);
  const coverage = slots.length === 1 && Number(slots[0].slot) === 2
    ? "afternoon"
    : (slots.length === 1 && Number(slots[0].hours) > 0 && Number(slots[0].hours) <= 4 ? "morning" : "day");
  const current = slots.length
    ? slots
      .slice()
      .sort((left, right) => left.slot - right.slot)
      .map((item) => `${Number(item.slot) === 2 ? "Après-midi" : (slots.length > 1 ? "Matin" : "Journée")} : ${item.kind} (${item.hours}h)`)
      .join(" · ")
    : "Aucun créneau saisi (la case peut afficher un congé ou un pointage).";
  const overlay = document.createElement("div");
  overlay.id = "planning-day-overlay";
  overlay.className = "punch-rectify-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "planning-day-title");
  const unjustifiedPending = isUnjustifiedAbsenceDay(profile, dayKey);
  const canJustify = canJustifyAbsence(userId) && unjustifiedPending;
  overlay.innerHTML = `
    <form id="planning-day-form" class="punch-rectify-card">
      <h3 id="planning-day-title">Modifier la journée</h3>
      <p class="hierarchy-meta">${escapeHtml(profile?.full_name || "Collaborateur")} · ${escapeHtml(formatDate(dayKey))}</p>
      <p class="data-note">${escapeHtml(current)}</p>
      <p class="data-note">${editor.label ? escapeHtml(editor.label) : "Aucun changement manuel enregistré pour cette journée."}</p>
      ${unjustifiedPending ? `<p class="data-note">Cette journée est une <strong>absence injustifiée (AI)</strong> tant qu'elle n'est pas validée par le traffic manager ou le RH.</p>` : ""}
      ${canJustify ? `
      <div class="punch-rectify-actions">
        <button type="button" class="primary" data-absence-justify data-user-id="${escapeHtml(userId)}" data-day-key="${escapeHtml(dayKey)}">Justifier (AI → AJ)</button>
      </div>` : ""}
      ${canEdit ? `
      <label>
        Type
        <select name="kind">
          ${PLANNING_EDIT_CODES.map((item) => `<option value="${item.code}"${item.code === kind ? " selected" : ""}>${item.code} · ${escapeHtml(item.label)}</option>`).join("")}
        </select>
      </label>
      <div class="form-row">
        <label>
          Période
          <select name="coverage">
            <option value="day"${coverage === "day" ? " selected" : ""}>Journée entière</option>
            <option value="morning"${coverage === "morning" ? " selected" : ""}>Matin</option>
            <option value="afternoon"${coverage === "afternoon" ? " selected" : ""}>Après-midi</option>
          </select>
        </label>
        <label>
          Heures
          <input type="number" name="hours" min="0" max="12" step="0.5" value="${escapeHtml(String(hours))}">
        </label>
      </div>
      <label class="popup-comment-field">
        Commentaire
        <textarea name="note" rows="5" maxlength="240" placeholder="Optionnel">${escapeHtml(slots.map((item) => item.note).find(Boolean) || "")}</textarea>
      </label>
      <input type="hidden" name="userId" value="${escapeHtml(userId)}">
      <input type="hidden" name="dayKey" value="${escapeHtml(dayKey)}">
      <div class="punch-rectify-actions">
        <button type="button" class="outline-button" data-planning-day-clear>Effacer</button>
        <button type="button" class="outline-button" data-planning-day-close>Annuler</button>
        <button type="submit" class="primary">Enregistrer</button>
      </div>` : `
      <p class="data-note">La modification est réservée aux managers et à l’administration RH.</p>
      <div class="punch-rectify-actions">
        <button type="button" class="outline-button" data-planning-day-close>Fermer</button>
      </div>`}
    </form>`;
  const close = () => closePlanningDayDialog();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-planning-day-close]")?.addEventListener("click", close);
  overlay.querySelector("[data-absence-justify]")?.addEventListener("click", () => {
    openJustifyAbsenceDialog(userId, dayKey);
  });
  overlay.querySelector("[name='kind']")?.addEventListener("change", (event) => {
    const hoursInput = overlay.querySelector("[name='hours']");
    if (!hoursInput) return;
    const next = String(event.currentTarget.value || "").toUpperCase();
    if (PLANNING_ABSENCE_CODES.has(next) && Number(hoursInput.value) > 0) hoursInput.value = "0";
    if (!PLANNING_ABSENCE_CODES.has(next) && Number(hoursInput.value) === 0) hoursInput.value = "8";
  });
  overlay.querySelector("[data-planning-day-clear]")?.addEventListener("click", () => {
    if (!window.confirm("Effacer le planning saisi pour cette journée ?")) return;
    withAction(async () => {
      await applyPlanningDayChange({ userId, dayKey, clear: true });
      closePlanningDayDialog();
    });
  });
  overlay.querySelector("#planning-day-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canEdit) return;
    const data = new FormData(event.currentTarget);
    withAction(async () => {
      await applyPlanningDayChange({
        userId: String(data.get("userId") || ""),
        dayKey: String(data.get("dayKey") || ""),
        kind: String(data.get("kind") || "PR"),
        hours: data.get("hours"),
        coverage: String(data.get("coverage") || "day"),
        note: String(data.get("note") || "")
      });
      closePlanningDayDialog();
    });
  });
  document.body.appendChild(overlay);
  overlay.querySelector(canEdit ? "[name='kind']" : "[data-planning-day-close]")?.focus();
  document.addEventListener("keydown", onPlanningDayKeydown);
}

async function applyPlanningDayChange({ userId, dayKey, kind, hours, coverage, note, clear }) {
  if (!canImportPlanning()) throw new Error("Seul un manager ou un administrateur peut modifier une journée.");
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) {
    throw new Error("Journée invalide.");
  }
  const profile = profileById(userId);
  if (!profile) throw new Error("Collaborateur introuvable.");
  const existing = getPlanningEntries().filter((row) => (
    (row.user_id || row.userId) === userId && String(row.work_date || "").slice(0, 10) === dayKey
  ));
  let entries = [];
  if (!clear) {
    const allowed = Object.fromEntries(PLANNING_EDIT_CODES.map((item) => [item.code, true]));
    const nextKind = allowed[String(kind || "PR").toUpperCase()] ? String(kind).toUpperCase() : "PR";
    const nextHours = Math.max(0, Math.min(12, Number(hours)));
    const slotHours = Number.isFinite(nextHours) ? nextHours : 0;
    const keepSlot = coverage === "morning" ? 2 : (coverage === "afternoon" ? 1 : 0);
    const writeSlot = coverage === "afternoon" ? 2 : 1;
    const kept = keepSlot
      ? existing.filter((row) => Number(row.slot) === keepSlot).map((row) => ({
        user_id: userId,
        work_date: dayKey,
        slot: Number(row.slot) === 2 ? 2 : 1,
        kind: String(row.kind || "PR").toUpperCase(),
        hours: Number(row.hours || 0),
        department: row.department || profile.department || "",
        structure: row.structure || "",
        location: row.location || "",
        note: row.note || "",
        source: row.source || "manual",
        matricule: row.matricule || profile.matricule || ""
      }))
      : [];
    entries = [
      ...kept,
      {
        user_id: userId,
        work_date: dayKey,
        slot: writeSlot,
        kind: nextKind,
        hours: slotHours,
        department: profile.department || "",
        structure: "",
        location: nextKind === "TT" ? "Télétravail" : "",
        note: String(note || "").trim().slice(0, 240),
        source: "manual",
        matricule: profile.matricule || ""
      }
    ];
  }
  await savePlanningEntries(entries, { replaceFrom: dayKey, replaceTo: dayKey, userIds: [userId] });
  planningState.importNotice = clear
    ? `Planning effacé pour ${profile.full_name} le ${formatDate(dayKey)}.`
    : `Planning modifié pour ${profile.full_name} le ${formatDate(dayKey)} (${entries[entries.length - 1]?.kind || ""}).`;
}

function renderPlanningLog(model) {
  const page = paginateList("planning-log", model.logs || []);
  return `
    <article class="card table-card">
      <div class="toolbar"><h3>Log du planning ${escapeHtml(PLANNING_DEPTS.find((item) => item.id === model.dept)?.label || "")}</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Agent</th><th>Code</th><th>Détail</th><th>Source</th></tr></thead>
          <tbody>
            ${page.items.length
              ? page.items.map((item) => `
                <tr>
                  <td>${formatDate(item.dayKey)}</td>
                  <td>${escapeHtml(item.name)}</td>
                  <td><span class="pl-legend pl-cell--${item.kind}"><b>${escapeHtml(item.kind)}</b></span></td>
                  <td>${escapeHtml(item.detail)}</td>
                  <td>${escapeHtml(item.source)}</td>
                </tr>`).join("")
              : `<tr><td colspan="5" class="empty-cell">Aucun événement sur ce mois.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${renderTablePager(page)}
    </article>`;
}

function renderPlanningGaps(model) {
  const total = model.profiles.length || 1;
  const bars = [
    { label: "Agents non pointés", count: model.gapAgents.missing.size },
    { label: "Agents en retard", count: model.gapAgents.delay.size },
    { label: "Agents en départ anticipé", count: model.gapAgents.early.size },
    { label: "R&D sous 8h", count: model.gapAgents.hours.size },
    { label: "Absence injustifiée", count: model.gapAgents.unjustified.size },
    { label: "Agents en télétravail", count: model.gapAgents.telework.size }
  ];
  return `
    <section class="balance-grid">
      ${bars.slice(0, 3).map((item) => `
        <article class="card hours-card">
          <span class="hours-label">${escapeHtml(item.label)}</span>
          <strong>${item.count}</strong>
          <small>sur ${model.profiles.length} agent${model.profiles.length > 1 ? "s" : ""}</small>
        </article>`).join("")}
    </section>
    <article class="card page-spacer">
      <div class="toolbar"><h3>Écarts par nombre d'agents</h3></div>
      <div class="planning-gap-bars">
        ${bars.map((item) => `
          <div class="planning-gap-row">
            <span>${escapeHtml(item.label)}</span>
            <div class="planning-gap-track"><span ${pctProps({ w: Math.max(item.count ? 8 : 0, Math.round((item.count / total) * 100)) })}></span></div>
            <strong>${item.count}</strong>
          </div>`).join("")}
      </div>
    </article>`;
}

/* reportsPage() moved to pages/reports.js */

function buildGlobalDashboardData() {
  const range = teamPunchFilters.start && teamPunchFilters.end
    ? teamPunchFilters
    : getDefaultTeamPunchRange();
  const scope = getTeamPunchScope();
  const profiles = getTeamPunchProfiles(scope);
  const dailyRows = summarizeTeamPunchesByDay(appData.teamPunches || [], range.start, range.end);

  const rowsWithStats = dailyRows
    .filter((row) => row.hasStarted)
    .map((row) => {
      const profile = profileById(row.userId) || {};
      const stats = analyzeWorkedDay(row, profile);
      return {
        row,
        profile,
        stats
      };
    });

  const totals = rowsWithStats.reduce((acc, item) => {
    acc.plannedMs += item.stats.plannedMs;
    acc.realizedMs += item.stats.realizedMs;
    acc.payableOtMs += item.stats.payableOtMs;
    acc.delayMin += item.stats.delayMin;
    acc.missingMs += item.stats.missingMs;
    return acc;
  }, { plannedMs: 0, realizedMs: 0, payableOtMs: 0, delayMin: 0, missingMs: 0 });

  const activeUserIds = new Set(rowsWithStats.map((item) => item.row.userId));
  const daysWorking = new Set();
  const startDate = parseLocalDate(range.start);
  const endDate = parseLocalDate(range.end);
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = toDateKey(cursor);
    if (!isWeekendDate(parseLocalDate(key))) daysWorking.add(key);
    cursor.setDate(cursor.getDate() + 1);
  }

  const dailyBuckets = new Map();
  daysWorking.forEach((key) => dailyBuckets.set(key, { workedMs: 0, plannedMs: 0, delayMin: 0, presentUsers: new Set() }));
  rowsWithStats.forEach((item) => {
    const key = item.row.dayKey;
    if (!dailyBuckets.has(key)) dailyBuckets.set(key, { workedMs: 0, plannedMs: 0, delayMin: 0, presentUsers: new Set() });
    const bucket = dailyBuckets.get(key);
    bucket.workedMs += item.stats.realizedMs;
    bucket.plannedMs += item.stats.plannedMs;
    bucket.delayMin += item.stats.delayMin;
    bucket.presentUsers.add(item.row.userId);
  });

  const locationCounts = { onsite: 0, remote: 0, unknown: 0 };
  rowsWithStats.forEach((item) => {
    const loc = resolveDailyRowWorkLocation(item.row);
    if (loc === "onsite") locationCounts.onsite += 1;
    else if (loc === "remote") locationCounts.remote += 1;
    else locationCounts.unknown += 1;
  });

  const byDelay = new Map();
  rowsWithStats.forEach((item) => {
    if (!item.stats.delayMin) return;
    const cur = byDelay.get(item.row.userId) || { userId: item.row.userId, name: item.row.name, totalDelay: 0, occurrences: 0 };
    cur.totalDelay += item.stats.delayMin;
    cur.occurrences += 1;
    byDelay.set(item.row.userId, cur);
  });
  const topDelays = [...byDelay.values()].sort((a, b) => b.totalDelay - a.totalDelay).slice(0, 5);

  const byDept = new Map();
  rowsWithStats.forEach((item) => {
    const dept = item.profile.department || "Sans département";
    const cur = byDept.get(dept) || { department: dept, workedMs: 0, users: new Set() };
    cur.workedMs += item.stats.realizedMs;
    cur.users.add(item.row.userId);
    byDept.set(dept, cur);
  });
  const departmentRows = [...byDept.values()]
    .map((entry) => ({ department: entry.department, workedMs: entry.workedMs, headcount: entry.users.size }))
    .sort((a, b) => b.workedMs - a.workedMs);

  const scopeUserIds = new Set(profiles.map((profile) => profile.id));
  const absenceRate = computeAbsenceRateMetrics(profiles, range);

  const correctionStats = (getPunchCorrections() || []).reduce((acc, item) => {
    const userId = gtaItemUserId(item);
    if (!scopeUserIds.has(userId)) return acc;
    const date = gtaItemDate(item);
    if (date && (date < range.start || date > range.end)) return acc;
    const status = String(item.status || "").toLowerCase();
    acc.total += 1;
    if (status.includes("valider")) acc.pending += 1;
    else if (status.includes("approuv")) acc.approved += 1;
    else if (status.includes("refus")) acc.refused += 1;
    return acc;
  }, { total: 0, pending: 0, approved: 0, refused: 0 });

  return {
    range,
    scope,
    profiles,
    totals,
    activeUsers: activeUserIds.size,
    daysCount: daysWorking.size,
    dailyBuckets,
    locationCounts,
    topDelays,
    departmentRows,
    sampleSize: rowsWithStats.length,
    corrections: correctionStats,
    absenceRate
  };
}

function isFrenchHolidayKey(dayKey) {
  return FR_HOLIDAYS_2026.includes(String(dayKey || "").slice(0, 10));
}

function isAbsenceRateExcludedLeave(type, { excludePaternity = false } = {}) {
  const key = leaveTypeKey(type);
  const folded = foldAbsenceText(type);
  if (key === "cp" || key === "recup" || key === "unpaid" || key === "suspension" || key === "maternity") return true;
  if (key === "paternity") return excludePaternity;
  if (key === "justified" || folded.includes("maladie")) return true;
  if (folded.includes("deces") || folded.includes("circoncision")) return true;
  if (folded.includes("operation conjoint") || folded.includes("operation du conjoint") || folded.includes("operation enfant")) return true;
  return false;
}

function absenceRatePlannedHours(profile, dayKey) {
  const imported = importedPlannedHours(profile?.id, dayKey);
  if (imported != null) return Math.max(0, Number(imported) || 0);
  if (isWeekendDate(parseLocalDate(dayKey))) return 0;
  return Math.max(0, Number(getActiveShift(profile, dayKey).plannedHours || 0));
}

function computeAbsenceRateMetrics(profiles, range) {
  const leaves = [
    ...getLeaveRequests(),
    ...(appData.teamLeaveRequests || []).map((row) => (row.type ? row : normalizeTeamLeaveRequest(row)))
  ].filter(edsLeaveApproved);
  const daily = summarizeTeamPunchesByDay(appData.teamPunches || [], range.start, range.end);
  let absHours = 0;
  let plannedHours = 0;
  const start = parseLocalDate(range.start);
  const end = parseLocalDate(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return { rate: 0, absHours: 0, plannedHours: 0 };
  }

  (profiles || []).forEach((profile) => {
    const cursor = new Date(start);
    while (cursor <= end) {
      const dayKey = toDateKey(cursor);
      cursor.setDate(cursor.getDate() + 1);
      if (isWeekendDate(parseLocalDate(dayKey)) || isFrenchHolidayKey(dayKey)) continue;
      const hours = absenceRatePlannedHours(profile, dayKey);
      if (hours <= 0) continue;

      const dayLeaves = leaves.filter((item) => (
        (item.userId || item.user_id) === profile.id && leaveCoversPlanningDay(item, dayKey)
      ));
      const skipPlanned = dayLeaves.some((item) => isAbsenceRateExcludedLeave(item.type, { excludePaternity: false }));
      if (!skipPlanned) plannedHours += hours;

      const countingLeave = dayLeaves.find((item) => (
        leaveTypeKey(item.type) !== "hours"
        && !isAbsenceRateExcludedLeave(item.type, { excludePaternity: true })
      ));
      if (countingLeave) {
        const unit = String(countingLeave.unit || "").toLowerCase();
        const half = String(countingLeave.halfDay || countingLeave.half_day || "").trim();
        absHours += (unit === "half" || half) ? hours / 2 : hours;
        continue;
      }
      const dayRow = daily.find((row) => row.userId === profile.id && row.dayKey === dayKey) || null;
      if (isUnjustifiedAbsenceDay(profile, dayKey, { dayRow, dayLeaves })) absHours += hours;
    }
  });

  return {
    rate: plannedHours > 0 ? absHours / plannedHours : 0,
    absHours,
    plannedHours
  };
}

function delaySeverityLevel(minutes) {
  if (!minutes) return "ok";
  if (minutes <= 15) return "info";
  if (minutes <= 45) return "warn";
  if (minutes <= 120) return "high";
  return "critical";
}

function delaySeverityLabel(level) {
  switch (level) {
    case "ok": return "Ponctuel";
    case "info": return "Léger";
    case "warn": return "À surveiller";
    case "high": return "Élevé";
    case "critical": return "Critique";
    default: return "";
  }
}

function renderDelayBadge(minutes, occurrences = null) {
  const level = delaySeverityLevel(minutes);
  const label = delaySeverityLabel(level);
  const count = occurrences != null
    ? `<small>${occurrences} occ.</small>`
    : "";
  return `
    <span class="delay-badge delay-badge--${level}" title="${label}">
      <span class="delay-badge-dot" aria-hidden="true"></span>
      <strong>${minutes} min</strong>
      ${count}
      <em>${label}</em>
    </span>`;
}

function renderGlobalKpiCards(data) {
  const workingHours = data.totals.realizedMs / 3600000;
  const plannedHours = data.totals.plannedMs / 3600000;
  const completion = plannedHours ? Math.min(999, Math.round((workingHours / plannedHours) * 100)) : 0;
  const otHours = data.totals.payableOtMs / 3600000;
  const absencePct = Math.round((Number(data.absenceRate?.rate) || 0) * 1000) / 10;
  const delayLevel = delaySeverityLevel(data.totals.delayMin);
  const delayLabel = delaySeverityLabel(delayLevel);
  const delayOccurrences = data.topDelays.reduce((sum, item) => sum + item.occurrences, 0);

  return `
    <section class="global-kpi-grid">
      <article class="global-kpi-card global-kpi-card--primary">
        <span class="global-kpi-label">Heures réalisées</span>
        <strong class="global-kpi-value">${workingHours.toFixed(1)} h</strong>
        <span class="global-kpi-sub">sur ${plannedHours.toFixed(1)} h planifiées · ${completion}%</span>
      </article>
      <article class="global-kpi-card">
        <span class="global-kpi-label">Collaborateurs actifs</span>
        <strong class="global-kpi-value">${data.activeUsers}</strong>
        <span class="global-kpi-sub">sur ${data.profiles.length} dans le périmètre</span>
      </article>
      <article class="global-kpi-card">
        <span class="global-kpi-label">Taux d'absentéisme</span>
        <strong class="global-kpi-value">${absencePct.toFixed(1)} %</strong>
        <span class="global-kpi-sub">${(data.absenceRate?.absHours || 0).toFixed(1)} h d'absence / ${(data.absenceRate?.plannedHours || 0).toFixed(1)} h planifiées · hors CP, maladie, fériés FR</span>
      </article>
      <article class="global-kpi-card global-kpi-card--delay global-kpi-card--delay-${delayLevel}">
        <span class="global-kpi-label">Retards cumulés</span>
        <div class="global-kpi-delay-row">
          <strong class="global-kpi-value">${data.totals.delayMin} min</strong>
          <span class="delay-index delay-index--${delayLevel}" title="Indice retards ${delayLabel.toLowerCase()}">
            <span class="delay-index-dot" aria-hidden="true"></span>
            ${delayLabel}
          </span>
        </div>
        <span class="global-kpi-sub">${delayOccurrences} occurrence${delayOccurrences > 1 ? "s" : ""} · ${data.topDelays.length} collaborateur${data.topDelays.length > 1 ? "s" : ""} concerné${data.topDelays.length > 1 ? "s" : ""}</span>
      </article>
      <article class="global-kpi-card global-kpi-card--accent">
        <span class="global-kpi-label">Heures supp. payables</span>
        <strong class="global-kpi-value">${otHours.toFixed(1)} h</strong>
        <span class="global-kpi-sub">demandes approuvées</span>
      </article>
      <article class="global-kpi-card global-kpi-card--corrections${data.corrections.pending ? " global-kpi-card--warning" : ""}">
        <span class="global-kpi-label">Demandes de rectification</span>
        <div class="global-kpi-corrections-row">
          <strong class="global-kpi-value">${data.corrections.total}</strong>
          ${data.corrections.pending ? `<span class="delay-index delay-index--warn" title="Demandes en attente"><span class="delay-index-dot" aria-hidden="true"></span>${data.corrections.pending} à valider</span>` : ""}
        </div>
        <span class="global-kpi-sub">${data.corrections.approved} approuvée${data.corrections.approved > 1 ? "s" : ""} · ${data.corrections.refused} refusée${data.corrections.refused > 1 ? "s" : ""}</span>
      </article>
    </section>`;
}

function renderGlobalDailyChart(data) {
  const entries = [...data.dailyBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    return `<article class="card global-chart-card"><p class="empty-state">Aucune donnée sur cette période.</p></article>`;
  }
  const maxHours = Math.max(1, ...entries.map(([, b]) => b.workedMs / 3600000), ...entries.map(([, b]) => b.plannedMs / 3600000));
  const width = 100;
  const barGap = 0.6;
  const colWidth = (width - barGap * (entries.length + 1)) / entries.length;

  const bars = entries.map(([key, bucket], index) => {
    const workedHours = bucket.workedMs / 3600000;
    const plannedHours = bucket.plannedMs / 3600000;
    const workedHeight = (workedHours / maxHours) * 100;
    const plannedHeight = (plannedHours / maxHours) * 100;
    const x = barGap + index * (colWidth + barGap);
    const dayShort = new Date(`${key}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    return `
      <g class="global-bar-group" data-day="${key}">
        <rect class="global-bar-planned" x="${x + colWidth * 0.15}" y="${100 - plannedHeight}" width="${colWidth * 0.7}" height="${plannedHeight}" rx="1"></rect>
        <rect class="global-bar-worked" x="${x + colWidth * 0.15}" y="${100 - workedHeight}" width="${colWidth * 0.7}" height="${workedHeight}" rx="1"></rect>
        <title>${dayShort} · réalisé ${workedHours.toFixed(1)} h / planifié ${plannedHours.toFixed(1)} h</title>
      </g>`;
  }).join("");

  const labelStep = Math.max(1, Math.round(entries.length / 12));
  const labels = entries.map(([key], index) => {
    if (index % labelStep !== 0 && index !== entries.length - 1) return "";
    const x = barGap + index * (colWidth + barGap) + colWidth / 2;
    const dayLabel = new Date(`${key}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    return `<text class="global-bar-label" x="${x}" y="105">${dayLabel}</text>`;
  }).join("");

  return `
    <article class="card global-chart-card">
      <div class="global-chart-heading">
        <div>
          <h3>Charge journalière</h3>
          <p>Heures réalisées vs planifiées sur la période.</p>
        </div>
        <div class="global-legend">
          <span class="global-legend-item"><i class="global-swatch global-swatch--planned"></i>Planifié</span>
          <span class="global-legend-item"><i class="global-swatch global-swatch--worked"></i>Réalisé</span>
        </div>
      </div>
      <div class="global-chart-wrap">
        <svg class="global-chart-svg" viewBox="0 0 100 110" preserveAspectRatio="none" role="img" aria-label="Charge journalière">
          ${bars}
          ${labels}
        </svg>
      </div>
    </article>`;
}

function renderGlobalDonut(data) {
  const total = data.locationCounts.onsite + data.locationCounts.remote + data.locationCounts.unknown;
  if (!total) {
    return `<article class="card global-donut-card"><p class="empty-state">Aucun lieu enregistré.</p></article>`;
  }
  const parts = [
    { key: "onsite", label: "Sur site", value: data.locationCounts.onsite, color: "var(--forest-mid)" },
    { key: "remote", label: "Télétravail", value: data.locationCounts.remote, color: "#f59e0b" },
    { key: "unknown", label: "Non renseigné", value: data.locationCounts.unknown, color: "#94a3b8" }
  ];
  const circumference = 2 * Math.PI * 32;
  let offset = 0;
  const segments = parts.filter((part) => part.value > 0).map((part) => {
    const length = (part.value / total) * circumference;
    const segment = `<circle class="global-donut-seg" r="32" cx="60" cy="60" stroke="${part.color}" stroke-width="18" fill="none" stroke-dasharray="${length} ${circumference}" stroke-dashoffset="${-offset}"></circle>`;
    offset += length;
    return segment;
  }).join("");

  const legend = parts.map((part) => `
    <li class="global-legend-row">
      <span class="global-legend-dot global-legend-dot--${part.key}"></span>
      <span>${part.label}</span>
      <strong>${part.value}</strong>
      <small>${Math.round((part.value / total) * 100)} %</small>
    </li>`).join("");

  return `
    <article class="card global-donut-card">
      <h3>Répartition sur site / télétravail</h3>
      <div class="global-donut-body">
        <svg class="global-donut-svg" viewBox="0 0 120 120" role="img" aria-label="Répartition sur site vs télétravail">
          <circle r="32" cx="60" cy="60" stroke="var(--surface-2)" stroke-width="18" fill="none"></circle>
          ${segments}
          <text class="global-donut-total" x="60" y="58" text-anchor="middle">${total}</text>
          <text class="global-donut-caption" x="60" y="74" text-anchor="middle">jours pointés</text>
        </svg>
        <ul class="global-donut-legend">${legend}</ul>
      </div>
    </article>`;
}

function renderGlobalTopDelays(data) {
  if (!data.topDelays.length) {
    return `
      <article class="card global-top-card">
        <h3>Top retards</h3>
        <p class="empty-state">Aucun retard sur la période. Toute l'équipe est ponctuelle.</p>
      </article>`;
  }
  const max = data.topDelays[0].totalDelay || 1;
  const rows = data.topDelays.map((item) => {
    const level = delaySeverityLevel(item.totalDelay);
    return `
    <li class="global-top-row delay-row-${level}">
      <div class="global-top-head">
        <span>${escapeHtml(item.name || profileById(item.userId)?.full_name || "Collaborateur")}</span>
        ${renderDelayBadge(item.totalDelay, item.occurrences)}
      </div>
      <div class="global-top-track">
        <span class="global-top-track-fill global-top-track-fill--${level}" ${pctProps({ w: Math.max(6, Math.round((item.totalDelay / max) * 100)) })}></span>
      </div>
      <small>${item.occurrences} jour${item.occurrences > 1 ? "s" : ""} en retard · moyenne ${Math.round(item.totalDelay / item.occurrences)} min/jour</small>
    </li>`;
  }).join("");
  return `
    <article class="card global-top-card">
      <div class="global-top-heading">
        <h3>Top retards</h3>
        <div class="delay-scale" aria-label="Indice de retard">
          <span class="delay-scale-item delay-scale-item--ok" title="0 min">Ok</span>
          <span class="delay-scale-item delay-scale-item--info" title="1 à 15 min">≤15</span>
          <span class="delay-scale-item delay-scale-item--warn" title="16 à 45 min">≤45</span>
          <span class="delay-scale-item delay-scale-item--high" title="46 à 120 min">≤120</span>
          <span class="delay-scale-item delay-scale-item--critical" title="Plus de 120 min">120+</span>
        </div>
      </div>
      <ul class="global-top-list">${rows}</ul>
    </article>`;
}

function renderGlobalDepartments(data) {
  if (!data.departmentRows.length) {
    return `<article class="card global-dept-card"><h3>Charge par département</h3><p class="empty-state">Aucun département à afficher.</p></article>`;
  }
  const max = data.departmentRows[0].workedMs || 1;
  const rows = data.departmentRows.map((entry) => `
    <li class="global-dept-row">
      <div class="global-dept-head">
        <span>${escapeHtml(entry.department)}</span>
        <strong>${(entry.workedMs / 3600000).toFixed(1)} h</strong>
      </div>
      <div class="global-dept-track">
        <span ${pctProps({ w: Math.max(6, Math.round((entry.workedMs / max) * 100)) })}></span>
      </div>
      <small>${entry.headcount} collaborateur${entry.headcount > 1 ? "s" : ""}</small>
    </li>`).join("");
  return `
    <article class="card global-dept-card">
      <h3>Charge par département</h3>
      <ul class="global-dept-list">${rows}</ul>
    </article>`;
}

/* globalPage() moved to pages/global.js */

function pageContent() {
  if (appData.loading) {
    return `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Chargement des données...</div>`;
  }
  if (appData.error) {
    return `
      <article class="card error-card">
        <p class="error-message">${escapeHtml(appData.error)}</p>
        <button type="button" id="retry-load" class="primary">Réessayer</button>
      </article>`;
  }
  const registry = (window.Humana && window.Humana.pages) || {};
  const renderer = registry[currentPage];
  if (typeof renderer !== "function") {
    const wanted = currentPage;
    if (!pageModulePromises[`${wanted}:render`]) {
      pageModulePromises[`${wanted}:render`] = ensurePageModule(wanted)
        .then(() => {
          if (currentPage !== wanted) return;
          if (typeof window.Humana?.pages?.[wanted] === "function") {
            renderApp();
            return;
          }
          window.location.href = pageHref(wanted);
        })
        .catch(() => {
          window.location.href = pageHref(wanted);
        });
    }
    return `<div class="boot-message"><span class="loader" aria-hidden="true"></span>Chargement de la page...</div>`;
  }
  return renderer();
}

function isJwtClockError(error) {
  const message = (error?.message || error?.details || String(error || "")).toLowerCase();
  return message.includes("jwt issued at future") || message.includes("issued at future");
}

function formatAppError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`.toLowerCase();
  if (isJwtClockError(error)) {
    return "Synchronisation de la session en cours. Cliquez sur Réessayer ou attendez quelques secondes. Vérifiez également que l'heure de votre ordinateur est correcte.";
  }
  if (message.includes("unexpected token") || message.includes("<!doctype") || message.includes("page html")) {
    return "L'enregistrement n'a pas atteint l'API. Sur le VPS : docker compose up -d --build api && docker compose up -d caddy";
  }
  if (message.includes("work_location") || message.includes("work_status") || (message.includes("column") && message.includes("time_punches")) || message.includes("pgrst204")) {
    return "Le pointage n'a pas pu enregistrer un champ optionnel. Rechargez la page (Ctrl+F5) puis réessayez : l'arrivée s'enregistre sans ces colonnes.";
  }
  if (JOURNAL_META_FIELDS.some((field) => message.includes(field))) {
    return "Colonnes du Journal absentes. Redémarrez l'API pour appliquer les migrations, puis refaites un pointage d'entrée.";
  }
  if (message.includes("does not exist") || (message.includes("relation") && message.includes("profiles"))) {
    return "Schéma de base incomplet. Redémarrez l'API pour appliquer les migrations.";
  }
  if (message.includes("bucket") || message.includes("storage")) {
    return "Stockage documents indisponible. Vérifiez le volume Docker storage et redémarrez l'API.";
  }
  if (message.includes("salary_advance_requests")) {
    return "Avances sur salaire indisponibles. Redémarrez l'API pour appliquer les migrations.";
  }
  if (message.includes("punch_corrections") || message.includes("overtime_requests") || message.includes("activity_entries") || message.includes("shift_code") || message.includes("workflow_step")) {
    return "Module de gestion des temps incomplet. Redémarrez l'API pour appliquer les migrations.";
  }
  if (message.includes("permission") || message.includes("policy") || message.includes("row-level")) {
    if (message.includes("leave_requests")) {
      return "Accès au calendrier des congés de l'équipe refusé.";
    }
    if (message.includes("time_punches")) {
      return "Accès refusé aux pointages de l'équipe.";
    }
    return "Accès refusé aux pointages de l'équipe.";
  }
  if (message.includes("hr_alerts") || message.includes("process_auto_clock_outs") || message.includes("notify_auto_clock_out")) {
    return "Alertes RH indisponibles. Redémarrez l'API pour appliquer les migrations.";
  }
  if (message.includes("app_settings")) {
    return "Réglages studio indisponibles. Redémarrez l'API pour appliquer les migrations.";
  }
  if (message.includes("pending_invites") && message.includes("check")) {
    return "Rôle créateur non autorisé dans les invitations.";
  }
  return error?.message || "Impossible de charger les données.";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = "Requête") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} trop longue. Réessayez.`)), ms);
    })
  ]);
}

async function syncSessionAfterLogin() {
  if (!supabaseClient) return;
  if (!window.__pendingAuthSession) return;
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
    const existingRes = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (existingRes.error) throw existingRes.error;
    const existing = existingRes.data;
    if (
      existing
      && existing.email === payload.email
      && existing.full_name === payload.full_name
    ) {
      appData.profile = existing;
    } else {
    const { data, error } = await supabaseClient
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;
    appData.profile = data;
    }
    if (window.__humanaInviteApplied) return;
    const { error: inviteError } = await supabaseClient.rpc("apply_pending_invite", {
      user_id: user.id,
      user_email: user.email || ""
    });
    if (inviteError && !inviteError.message.includes("does not exist")) {
      console.warn("apply_pending_invite:", inviteError.message);
    }
    window.__humanaInviteApplied = true;
  });
}

function mergeOrgProfiles(directoryRows, detailedRows) {
  const byId = new Map();
  (directoryRows || []).forEach((row) => {
    if (!row?.id) return;
    byId.set(row.id, { ...row });
  });
  (detailedRows || []).forEach((row) => {
    if (!row?.id) return;
    byId.set(row.id, { ...(byId.get(row.id) || {}), ...row });
  });
  return [...byId.values()].sort((left, right) =>
    String(left.full_name || "").localeCompare(String(right.full_name || ""), "fr")
  );
}

async function fetchOrgDirectoryRows() {
  const selectFields = PROFILE_DIRECTORY_FIELDS.join(",");
  let directoryRes = await supabaseClient
    .from("profiles_directory")
    .select(selectFields)
    .order("full_name");
  if (directoryRes.error && errorMentionsAny(directoryRes.error, ["holiday_calendar"])) {
    directoryRes = await supabaseClient
      .from("profiles_directory")
      .select(PROFILE_DIRECTORY_FIELDS.filter((field) => field !== "holiday_calendar").join(","))
      .order("full_name");
  }
  if (!directoryRes.error) return directoryRes.data || [];
  if (!isMissingDbObjectError(directoryRes.error)) {
    console.warn("profiles_directory:", directoryRes.error.message);
  }
  return [];
}

const PAGE_COLLECTIONS = {
  home: ["punches", "events", "hrAlerts", "planningEntries"],
  pointeuse: ["punches", "gta", "planningEntries"],
  leave: ["leave", "teamLeave"],
  attestations: ["attestations", "documents"],
  events: ["events"],
  hierarchy: ["org"],
  admin: ["orgFull", "invites"],
  creator: ["settings"],
  journal: ["org", "journal"],
  "team-punches": ["org", "teamPunches", "gta", "planningEntries"],
  reports: ["org", "leave", "teamLeave", "teamPunches", "planningEntries", "edsPayroll"],
  global: ["org", "teamPunches", "planningEntries", "leave", "teamLeave"],
  planning: ["org", "teamPunches", "planningEntries", "leave", "teamLeave"],
  privacy: ["punches", "leave", "attestations", "documents"]
};

function cacheFresh(key, ttl = DATA_TTL_MS) {
  const stamp = dataStamp[key];
  return Boolean(stamp) && (Date.now() - stamp) < ttl;
}

function markLoaded(key) {
  dataStamp[key] = Date.now();
}

async function loadAppSettingsBundle() {
  if (!usesDatabase()) {
    await loadNavVisibility();
    await loadStudioCreators();
    await loadGtaSettings();
    return;
  }
  const fallbackTimezone = "GMT+1";
  const fallbackHours = defaultShiftHours();
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("key, value")
    .in("key", isAdmin() || isCreator()
      ? ["nav_visibility", "studio_creators", "company_timezone", "gta_shifts"]
      : ["nav_visibility", "company_timezone", "gta_shifts"]);
  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("app_settings")) {
      appData.navVisibility = getDefaultNavVisibility();
      appData.studioCreators = [];
      appData.companyTimezone = fallbackTimezone;
      appData.shiftHours = fallbackHours;
      return;
    }
    throw error;
  }
  const rows = data || [];
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  appData.navVisibility = normalizeNavVisibility(byKey.nav_visibility || null);
  appData.studioCreators = normalizeStudioCreators(byKey.studio_creators || []);
  const timezoneValue = typeof byKey.company_timezone === "string"
    ? byKey.company_timezone
    : byKey.company_timezone?.id || byKey.company_timezone?.timezone;
  appData.companyTimezone = timezoneValue === "GMT" ? "GMT" : "GMT+1";
  appData.shiftHours = normalizeShiftHours(byKey.gta_shifts);
}

function isoDaysAgo(days) {
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - Math.max(1, Number(days) || 1));
  return cursor.toISOString();
}

function dateKeyMonthsAgo(months) {
  const cursor = new Date();
  cursor.setMonth(cursor.getMonth() - Math.max(1, Number(months) || 1));
  return toDateKey(cursor);
}

function ownListWindow() {
  return currentPage === "privacy";
}

async function loadOwnPunches() {
  const userId = session.user.id;
  const privacy = ownListWindow();
  const punchesRes = await supabaseClient
    .from("time_punches")
    .select("*")
    .eq("user_id", userId)
    .gte("punched_at", isoDaysAgo(privacy ? PRIVACY_PUNCH_DAYS : OWN_PUNCH_DAYS))
    .order("punched_at", { ascending: false })
    .limit(privacy ? PRIVACY_PUNCH_LIMIT : OWN_PUNCH_LIMIT);
  if (punchesRes.error) throw punchesRes.error;
  appData.punches = punchesRes.data || [];
}

async function loadOwnLeave() {
  const userId = session.user.id;
  const from = ownListWindow() ? dateKeyMonthsAgo(60) : dateKeyMonthsAgo(OWN_LEAVE_MONTHS);
  const leaveRes = await supabaseClient
    .from("leave_requests")
    .select("*")
    .eq("user_id", userId)
    .gte("end_date", from)
    .order("created_at", { ascending: false })
    .limit(OWN_HR_LIMIT);
  if (leaveRes.error) throw leaveRes.error;
  appData.leaveRequests = leaveRes.data || [];
}

async function loadOwnAttestations() {
  const userId = session.user.id;
  const teamIds = [userId, ...getDirectReportProfiles().map((profile) => profile.id)];
  const scopeAll = hasOrgWideAccess() || canApproveHrRequests();
  const scopeTeam = !scopeAll && hasDirectReports();
  let attestationQuery = supabaseClient.from("attestation_requests").select("*").order("created_at", { ascending: false }).limit(OWN_HR_LIMIT);
  let advanceQuery = supabaseClient.from("salary_advance_requests").select("*").order("created_at", { ascending: false }).limit(OWN_HR_LIMIT);
  if (scopeTeam) {
    attestationQuery = attestationQuery.in("user_id", teamIds);
    advanceQuery = advanceQuery.in("user_id", teamIds);
  } else if (!scopeAll) {
    attestationQuery = attestationQuery.eq("user_id", userId);
    advanceQuery = advanceQuery.eq("user_id", userId);
  }
  const attestationRes = await attestationQuery;
  if (attestationRes.error) throw attestationRes.error;
  appData.attestationRequests = attestationRes.data || [];
    const advanceRes = await advanceQuery;
    if (advanceRes.error) {
      const message = `${advanceRes.error.message || ""} ${advanceRes.error.details || ""}`.toLowerCase();
      if (message.includes("salary_advance") || message.includes("does not exist") || message.includes("schema cache") || message.includes("relation")) {
        appData.salaryAdvanceRequests = [];
        appData.salaryAdvanceTableMissing = true;
      } else {
        throw advanceRes.error;
      }
    } else {
      appData.salaryAdvanceRequests = advanceRes.data || [];
      appData.salaryAdvanceTableMissing = false;
  }
  await loadSalaryAdvanceQuota();
}

async function loadSalaryAdvanceQuota() {
  if (!usesDatabase()) {
    appData.salaryAdvanceQuota = computeSalaryAdvanceQuota();
    return;
  }
  try {
    const json = await supabaseClient.rpc("salary_advance_quota", {});
    const data = json?.data;
    if (json?.error || !data) {
      appData.salaryAdvanceQuota = computeSalaryAdvanceQuota();
      return;
    }
    appData.salaryAdvanceQuota = data;
  } catch (_) {
    appData.salaryAdvanceQuota = computeSalaryAdvanceQuota();
  }
}

async function loadOrgDirectory() {
  const directoryRows = await fetchOrgDirectoryRows();
  appData.orgProfiles = mergeOrgProfiles(directoryRows, []);
}

async function loadOrgProfilesFull() {
  const directoryRows = await fetchOrgDirectoryRows();
  let profilesRes = await supabaseClient.from("profiles").select(PROFILE_ADMIN_FIELDS.join(",")).order("full_name");
  if (profilesRes.error && errorMentionsAny(profilesRes.error, ["holiday_calendar"])) {
    profilesRes = await supabaseClient
      .from("profiles")
      .select(PROFILE_ADMIN_FIELDS.filter((field) => field !== "holiday_calendar").join(","))
      .order("full_name");
  }
  if (profilesRes.error) throw profilesRes.error;
  appData.orgProfiles = mergeOrgProfiles(directoryRows, profilesRes.data || []);
}

async function loadPendingInvites() {
  if (!isAdmin()) {
    appData.pendingInvites = [];
    return;
  }
      const invitesRes = await withTimeout(
        supabaseClient.from("pending_invites").select("*").order("created_at", { ascending: false }).limit(OWN_HR_LIMIT),
        8000,
        "Chargement des invitations"
      );
  if (!invitesRes.error) appData.pendingInvites = invitesRes.data || [];
    }

async function loadDocumentsAndPayslips() {
  const userId = session.user.id;
    const [docsRes, payslipsRes] = await Promise.all([
      supabaseClient.from("hr_documents").select("*").order("published_at", { ascending: false }).limit(OWN_DOCS_LIMIT),
      supabaseClient.from("payslips").select("*").eq("user_id", userId)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(OWN_DOCS_LIMIT)
    ]);
    if (!docsRes.error) appData.hrDocuments = docsRes.data || [];
    if (!payslipsRes.error) appData.payslips = payslipsRes.data || [];
}

async function loadCollection(key, { force = false } = {}) {
  if (!force && cacheFresh(key)) return;
  switch (key) {
    case "settings":
      await loadAppSettingsBundle();
      break;
    case "punches":
      await loadOwnPunches();
      break;
    case "leave":
      await loadOwnLeave();
      break;
    case "attestations":
      await loadOwnAttestations();
      break;
    case "org":
      await loadOrgDirectory();
      break;
    case "orgFull":
      await loadOrgProfilesFull();
      break;
    case "invites":
      await loadPendingInvites();
      break;
    case "documents":
    case "payslips":
      await loadDocumentsAndPayslips();
      markLoaded("documents");
      markLoaded("payslips");
      return;
    case "events":
      await loadCompanyEvents();
      break;
    case "hrAlerts":
      if (canViewHrAlerts()) await loadHrAlerts(session.user.id);
      else appData.hrAlerts = [];
      break;
    case "gta":
      try {
        await loadGtaCollections(session.user.id);
      } catch (error) {
        console.warn("GTA collections:", error?.message || error);
      }
      break;
    case "teamLeave":
      if (canViewTeamLeaveCalendar()) {
        await loadTeamLeaveRequests(
          currentPage === "reports"
            ? getEdsRange()
            : currentPage === "planning"
              ? planningMonthRange()
              : currentPage === "global"
                ? (teamPunchFilters.start && teamPunchFilters.end
                  ? { start: teamPunchFilters.start, end: teamPunchFilters.end }
                  : getDefaultTeamPunchRange())
                : getLeaveCalendarMonth()
        );
      } else appData.teamLeaveRequests = [];
      break;
    case "teamPunches":
      if (currentPage === "planning") {
        const range = planningMonthRange();
        teamPunchFilters = {
          ...teamPunchFilters,
          start: range.start,
          end: range.end,
          scope: hasOrgWideAccess() ? (teamPunchFilters.scope || "all") : "team"
        };
      }
      if (currentPage === "reports") {
        const range = getEdsRange();
        teamPunchFilters = {
          ...teamPunchFilters,
          start: range.start,
          end: range.end
        };
      }
      if (canViewTeamPunches()) {
        await loadTeamPunches();
        teamPunchesInitialLoadDone = true;
    } else {
        appData.teamPunches = [];
      }
      break;
    case "journal":
      if (canViewJournal()) {
        await loadJournalPunches();
        journalPunchesInitialLoadDone = true;
    } else {
        appData.journalPunches = [];
      }
      break;
    case "planningEntries":
      await loadPlanningEntries();
      break;
    case "edsPayroll":
      if (canEditEdsPayroll() || canViewEdsPayrollColumns()) await loadEdsPayroll();
      else appData.edsPayroll = {};
      break;
    default:
      return;
  }
  markLoaded(key);
}

async function loadCoreData({ force = false } = {}) {
  await withTimeout(
    Promise.all([
      loadCollection("settings", { force }),
      loadCollection("punches", { force }),
      loadCollection("org", { force })
    ]),
    12000,
    "Chargement des données"
  );
  if (canViewHrAlerts()) await loadCollection("hrAlerts", { force });
}

async function loadPageData(page, { force = false } = {}) {
  if (!usesDatabase() || !session?.user) return;
  const keys = PAGE_COLLECTIONS[page] || [];
  if (!keys.length) return;
  const prelude = keys.filter((key) => key === "org" || key === "orgFull" || key === "settings");
  const rest = keys.filter((key) => !prelude.includes(key));
  if (prelude.length) await Promise.all(prelude.map((key) => loadCollection(key, { force })));
  if (rest.length) await Promise.all(rest.map((key) => loadCollection(key, { force })));
}

async function refreshAppData() {
  if (!usesDatabase()) return;
  await loadCoreData({ force: true });
  await loadPageData(currentPage, { force: true });
}

async function loadGtaCollections(userId) {
  const kinds = Object.values(GTA_KINDS);
  await Promise.all(kinds.map(async ({ table, store }) => {
    try {
      let query = supabaseClient.from(table).select("*").order("created_at", { ascending: false }).limit(200);
      if (!canViewTeamPunches() && !hasOrgWideAccess()) {
        query = query.eq("user_id", userId);
      }
      const { data, error } = await query;
      if (!error) {
        appData[store] = data || [];
        return;
      }
      if (isMissingDbObjectError(error)) {
        appData[store] = [];
        return;
      }
      const own = await supabaseClient.from(table).select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      appData[store] = own.error ? [] : (own.data || []);
    } catch (error) {
      console.warn("GTA", table, error?.message || error);
      appData[store] = [];
    }
  }));
}

async function bootstrapUser(options = {}) {
  const { showSpinner = true } = options;

  if (!usesDatabase()) {
    hideAuthBootScreen();
    renderApp();
    return;
  }

  if (bootstrapInFlight) {
    await bootstrapInFlight;
    return;
  }

  bootstrapInFlight = (async () => {
    appData.loading = true;
    appData.error = "";
    if (showSpinner) showAuthBootScreen();

    try {
      await syncSessionAfterLogin();
      await ensureProfile();
      await loadCoreData();
      await loadPageData(currentPage);
      collectJournalMeta().catch(() => {});
      if (currentPage === "home" || currentPage === "pointeuse") {
        runAutoClockOutChecks().catch(() => {});
      }
      await ensureAnimations();
    } catch (error) {
      appData.error = formatAppError(error);
    } finally {
      appData.loading = false;
      hideAuthBootScreen();
      renderApp();
      maybeShowMicrosoftWelcome();
      startLateReminderWatcher();
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
      // Passe par humanaStartDemo pour bénéficier de la redirection MPA
      // (sinon sur index.html on tenterait un renderApp sans pages/*.js chargés).
      if (typeof window.humanaStartDemo === "function") {
        window.humanaStartDemo();
        return;
      }
      demoMode = true;
      hydrateDemoWorkspace();
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
  hideAuthBootScreen();
  // En MPA, la page de login est index.html. Toute autre page doit rediriger
  // au lieu d'afficher un login local (sinon la sidebar apparaît un instant).
  if (mpaMode) {
    const pathname = String(window.location.pathname || "").toLowerCase();
    const onLoginHost = pathname === "/" || pathname === "" || pathname.endsWith("/index") || pathname.endsWith("/index.html");
    if (!onLoginHost) {
      window.location.href = loginHref();
      return;
    }
  }
  if (!document.querySelector(".login-page")) {
    app.innerHTML = `
      <main class="login-page">
        <section class="login-brand">
          ${daylyxLockupMarkup("is-static")}
          <div class="login-message">
            <span class="eyebrow">Daylyx</span>
            <h1>Gestion RH<br><em>simplifiée</em>.</h1>
            <p>Pointage, congés, documents — un espace fiable pour votre quotidien professionnel.</p>
          </div>
        </section>
        <section class="login-panel">
          <div class="login-theme-wrap">${themeToggleMarkup()}</div>
          <div class="login-card">
            <div class="mobile-brand brand">${daylyxLockupMarkup("is-compact is-static")}</div>
            <h2>Connexion</h2>
            <p>Utilisez votre compte Microsoft professionnel.</p>
            <button id="microsoft-login" type="button" class="microsoft-button" disabled>
              <span class="microsoft-logo"><i></i><i></i><i></i><i></i></span>
              Continuer avec Microsoft
            </button>
            <div id="config-note" class="config-note">Préparation de la connexion en cours...</div>
            <p id="login-error" class="error-message" hidden></p>
            <div class="separator"><span>ou</span></div>
            <button id="demo-login" type="button" class="demo-button">Voir l'aperçu administrateur</button>
            <p class="login-legal">Outil RH professionnel.
              <a href="/confidentialite">Confidentialité</a> ·
              <a href="/mentions-legales">Mentions légales</a> ·
              <a href="/cookies">Cookies</a></p>
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
    setLoginState({ ready: false, error: "Connexion indisponible. Rechargez la page." });
    return;
  }
  const button = document.querySelector("#microsoft-login");
  button.disabled = true;
  markMicrosoftWelcomePending();
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: typeof window.humanaAuthRedirectTo === "function"
        ? window.humanaAuthRedirectTo()
        : window.location.origin,
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
  if (!ensureAccessiblePage()) return;
  clearJournalFsRoot();
  if (session?.user) ensureStatusClockFromShift();
  if (session?.user && !lateReminderWatcher && !portalMode) {
    startLateReminderWatcher();
  }
  const name = getUserName();
  const email = session?.user?.email || "collaborateur@entreprise.fr";
  const initials = profileInitials(name);
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeInitials = escapeHtml(initials);

  app.innerHTML = `
    <div class="app-shell" data-current-page="${currentPage}">
      <aside class="sidebar">
        <button type="button" class="brand brand-home" id="brand-home" aria-label="Retour à l'accueil">
          ${daylyxLockupMarkup("is-compact is-static")}
        </button>
        <button class="close-menu" type="button" aria-label="Fermer"></button>
        <nav>${getNavigationItems().map((item) => `
          <button type="button" data-page="${item[0]}" class="${currentPage === item[0] ? "active" : ""}">
            ${item[1]}${navBadge(item[0])}
          </button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <div class="user-card"><span class="avatar avatar-sidebar-user" aria-hidden="true">${safeInitials}</span><div class="user-card-text"><strong title="${safeName}">${safeName}</strong><span class="user-card-email" title="${safeEmail}">${safeEmail}</span>${renderUserRolePills()}</div><button type="button" id="logout" class="logout-btn" aria-label="Se déconnecter">Sortir</button></div>
        </div>
      </aside>
      <button class="backdrop" type="button" aria-label="Fermer le menu"></button>
      <main class="main-content">
        <header class="topbar">
          <button class="menu-button" type="button" aria-label="Menu"></button>
          <div class="topbar-page">${pages[currentPage][0]}</div>
          <div class="topbar-actions">${demoMode ? `<span class="demo-pill">Mode démo</span>` : ""}${topbarTimelineMarkup()}${workStatusPickerMarkup()}${themeToggleMarkup()}</div>
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
  window.HumanaAnimations?.scan?.(document);
}

function minutesFromHhmm(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function defaultHolidayCalendarForShift(shiftCode) {
  return String(shiftCode || "").toLowerCase() === "rnd" ? "ma" : "fr";
}

function normalizeHolidayCalendar(value, shiftCode) {
  const raw = String(value || "").toLowerCase();
  if (raw === "fr" || raw === "ma") return raw;
  return defaultHolidayCalendarForShift(shiftCode);
}

function getHolidayCalendar(profile = appData.profile) {
  return normalizeHolidayCalendar(profile?.holiday_calendar, profile?.shift_code);
}

function holidaysForCalendar(calendar) {
  return normalizeHolidayCalendar(calendar) === "fr" ? FR_HOLIDAYS_2026 : MA_HOLIDAYS_2026;
}

function holidaySet(profile = appData.profile) {
  return new Set(holidaysForCalendar(getHolidayCalendar(profile)));
}

function isHolidayKey(dayKey, profile = appData.profile) {
  return holidaySet(profile).has(dayKey);
}

function isWorkingDayKey(dayKey, profile = appData.profile) {
  const date = parseLocalDate(dayKey);
  if (!date || Number.isNaN(date.getTime())) return false;
  return !isWeekendDate(date) && !isHolidayKey(dayKey, profile);
}

function countWorkingDays(start, end, profile = appData.profile) {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  if (endDate < startDate) return 0;
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = toDateKey(cursor);
    if (isWorkingDayKey(key, profile)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(count, 0);
}

function roundUpOneDecimal(value) {
  return Math.ceil(Number(value) * 10 - 1e-9) / 10;
}

function getFrMaOffsetHours(date = new Date()) {
  const year = date.getFullYear();
  const lastSunday = (month) => {
    const last = new Date(year, month + 1, 0);
    last.setDate(last.getDate() - last.getDay());
    return last;
  };
  const summerStart = lastSunday(2);
  const summerEnd = lastSunday(9);
  return date >= summerStart && date < summerEnd ? 2 : 1;
}

function isRamadanDay(dayKey) {
  return dayKey >= RAMADAN_2026.start && dayKey <= RAMADAN_2026.end;
}

function getProfileShift(profile = appData.profile) {
  const code = String(profile?.shift_code || "").toLowerCase();
  if (SHIFT_PRESETS[code]) return resolveShiftPreset(code);
  const dept = String(profile?.department || profile?.job_title || "").toLowerCase();
  if (dept.includes("r&d") || dept.includes("r et d") || /\brd\b/.test(dept)) return resolveShiftPreset("rnd");
  if (/\bces\b/.test(dept)) return resolveShiftPreset("ces");
  return resolveShiftPreset("cs");
}

function getActiveShift(profile, dayKey = toDateKey(new Date())) {
  const base = { ...getProfileShift(profile) };
  if (isRamadanDay(dayKey)) {
    base.lunchMin = 30;
    base.label = `${base.label} · Ramadan`;
  }
  return base;
}

function getLeaveGrade(profile = appData.profile) {
  const explicit = String(profile?.leave_grade || "").toLowerCase();
  if (LEAVE_ACCRUAL[explicit]) return explicit;
  const title = String(profile?.job_title || "").toLowerCase();
  if (title.includes("codir") || title.includes("directeur")) return "codir";
  if (profile?.role === "manager" || profile?.role === "admin" || profile?.role === "creator") return "manager";
  return "employee";
}

function monthsBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + (end.getDate() >= start.getDate() ? 0 : -1) + 1;
}

function getHiredAt(profile = appData.profile) {
  return profile?.hired_at || profile?.hiredAt || "";
}

function seniorityMonths(profile = appData.profile, at = new Date()) {
  const hired = getHiredAt(profile);
  if (!hired) return 12;
  return Math.max(0, monthsBetween(hired, at));
}

function accruedLeaveDays(profile = appData.profile, at = new Date()) {
  const rate = LEAVE_ACCRUAL[getLeaveGrade(profile)] || 1.5;
  return roundUpOneDecimal(Math.max(0, seniorityMonths(profile, at)) * rate);
}

function recoveryDaysForYear(year = new Date().getFullYear(), profile = appData.profile) {
  const prefix = String(year);
  const own = new Set(holidaysForCalendar(getHolidayCalendar(profile)).filter((day) => day.startsWith(prefix)));
  const other = holidaysForCalendar(getHolidayCalendar(profile) === "fr" ? "ma" : "fr")
    .filter((day) => day.startsWith(prefix));
  return other.filter((day) => {
    const date = parseLocalDate(day);
    return date && !Number.isNaN(date.getTime()) && !isWeekendDate(date) && !own.has(day);
  }).length;
}

function leaveNeedsAttachment(type) {
  const def = getAbsenceDef(type);
  if (def) return Boolean(def.attachment);
  const normalized = foldAbsenceText(type);
  return !normalized.includes("paye") && !normalized.includes("recup");
}

function leaveIsHoursUnit(type) {
  const def = getAbsenceDef(type);
  if (def?.unit === "hours") return true;
  const normalized = foldAbsenceText(type);
  return normalized.includes("retard") || normalized === "depart" || normalized.includes("depart anticipe");
}

function isDirecteurLike(profile) {
  if (!profile) return false;
  const grade = String(profile.leave_grade || "").toLowerCase();
  const title = foldAbsenceText(profile.job_title || "");
  return grade === "codir" || title.includes("directeur") || title.includes("directrice") || title.includes("codir");
}

function getLineManagers(userId) {
  const managers = [];
  const seen = new Set();
  let current = profileById(userId) || appData.profile;
  for (let index = 0; index < 6; index += 1) {
    const managerId = current?.manager_id;
    if (!managerId || seen.has(managerId)) break;
    const manager = profileById(managerId);
    if (!manager) break;
    seen.add(managerId);
    managers.push(manager);
    current = manager;
  }
  return managers;
}

function getRhProfiles(excludeId = "") {
  return (appData.orgProfiles || []).filter((profile) => (
    isRhRole(profile.role) && profile.id && profile.id !== excludeId
  ));
}

function leaveChainLabel(chain) {
  return (chain || []).map((item) => item.role).join(" → ");
}

function getLeaveValidatorChain(userId) {
  const labels = ["Manager N+1", "OPS manager N+2"];
  const managers = getLineManagers(userId);
  const line = [];
  let director = null;
  managers.forEach((manager, index) => {
    if (director) return;
    const isLast = index === managers.length - 1;
    if (isDirecteurLike(manager) || index >= 2 || (isLast && index >= 1)) {
      director = manager;
      return;
    }
    line.push(manager);
  });

  const chain = line.map((manager, index) => ({
    step: index + 1,
    id: manager.id,
    ids: [manager.id],
    name: manager.full_name,
    role: labels[index] || `Manager N+${index + 1}`,
    sharedFinal: false
  }));

  const finalIds = [...new Set([
    ...(director ? [director.id] : []),
    ...getRhProfiles(userId).map((profile) => profile.id)
  ])].filter(Boolean);

  if (finalIds.length) {
    const hasDirector = Boolean(director) || finalIds.some((id) => isDirecteurLike(profileById(id)));
    const hasRh = finalIds.some((id) => isRhRole(profileById(id)?.role));
    const role = hasDirector && hasRh ? "Directeur / RH" : (hasDirector ? "Directeur" : "RH");
    chain.push({
      step: chain.length + 1,
      id: finalIds[0],
      ids: finalIds,
      name: finalIds.map((id) => profileById(id)?.full_name).filter(Boolean).join(" · ") || role,
      role,
      sharedFinal: true
    });
  } else if (!chain.length) {
    chain.push({
      step: 1,
      id: session?.user?.id,
      ids: [session?.user?.id].filter(Boolean),
      name: "RH",
      role: "RH",
      sharedFinal: true
    });
  } else {
    chain[chain.length - 1].sharedFinal = true;
  }
  return chain;
}

function leaveRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return parseLocalDate(aStart) <= parseLocalDate(bEnd) && parseLocalDate(bStart) <= parseLocalDate(aEnd);
}

function hasOverlappingLeave(start, end, ignoreId = "") {
  return getLeaveRequests().some((request) => {
    if (String(request.id) === String(ignoreId)) return false;
    const status = String(request.status || "").toLowerCase();
    if (status.includes("refus")) return false;
    return leaveRangesOverlap(start, end, request.start, request.end);
  });
}

function getGtaStore(key, fallback = []) {
  if (usesDatabase()) return appData[key] || fallback;
  return loadStore(key, fallback);
}

function saveGtaStore(key, value) {
  saveStore(key, value);
  appData[key] = value;
}

function getPunchCorrections() {
  return getGtaStore("punchCorrections", []);
}

function getOvertimeRequests() {
  return getGtaStore("overtimeRequests", []);
}

function getActivityEntries() {
  return getGtaStore("activityEntries", []);
}

function correctionsThisMonth(userId = session?.user?.id) {
  const monthKey = toDateKey(new Date()).slice(0, 7);
  return getPunchCorrections().filter((item) => (item.userId || item.user_id) === userId && String(item.created || item.created_at || "").slice(0, 7) === monthKey);
}

function approvedOvertimeHours(userId, dayKey) {
  return getOvertimeRequests()
    .filter((item) => (item.userId || item.user_id) === userId && (item.date || item.work_date) === dayKey && String(item.status || "").toLowerCase().includes("approuv"))
    .reduce((total, item) => total + Number(item.hours || 0), 0);
}

function analyzeWorkedDay(row, profile) {
  const dayKey = row.dayKey;
  const shift = getActiveShift(profile, dayKey);
  const importedHours = importedPlannedHours(profile?.id || row.userId, dayKey);
  const plannedHours = importedHours == null
    ? (isWorkingDayKey(dayKey, profile) ? shift.plannedHours : 0)
    : importedHours;
  const plannedMs = plannedHours * 3600000;
  const realizedMs = row.workedMs || 0;
  const startMin = row.startTime ? Math.floor(companyMinutesOfDay(row.startTime)) : null;
  const lateAfter = minutesFromHhmm(shift.lateAfter);
  const delayMin = plannedMs <= 0 || startMin == null ? 0 : Math.max(0, startMin - lateAfter);
  const missingMs = Math.max(0, plannedMs - realizedMs);
  const extraMs = Math.max(0, realizedMs - plannedMs);
  const otApproved = approvedOvertimeHours(row.userId, dayKey) * 3600000;
  const payableOtMs = Math.min(extraMs, otApproved);
  return {
    plannedMs,
    realizedMs,
    delayMin,
    missingMs,
    extraMs,
    payableOtMs,
    shift
  };
}

function edsRangeForPayrollMonth(year, monthIndex) {
  const start = new Date(year, monthIndex - 1, 21);
  const end = new Date(year, monthIndex, 20);
  return { start: toDateKey(start), end: toDateKey(end) };
}

function defaultEdsRange(fromDate = new Date()) {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  // Cycle 21→20 : à partir du 21, on est déjà dans le mois de paie suivant.
  const payrollMonth = fromDate.getDate() >= 21 ? month + 1 : month;
  return edsRangeForPayrollMonth(year, payrollMonth);
}

function ensureEdsFilters() {
  if (!edsFilters.start || !edsFilters.end || edsFilters.end < edsFilters.start) {
    const range = defaultEdsRange();
    edsFilters.start = range.start;
    edsFilters.end = range.end;
  }
  return edsFilters;
}

function getEdsRange() {
  const filters = ensureEdsFilters();
  return { start: filters.start, end: filters.end };
}

function edsPeriodLabel(range = getEdsRange()) {
  return `du ${formatDate(parseLocalDate(range.start))} au ${formatDate(parseLocalDate(range.end))}`;
}

function edsFilterMarkup() {
  const range = getEdsRange();
  const count = getReportProfiles().length;
  return `
    <article class="card form-card page-spacer">
      ${cardHeading("Période du rapport")}
      <p class="data-note">Retards, absences, jours travaillés et heures supplémentaires sont calculés depuis les pointages, congés et plannings de la période.</p>
      <form id="eds-filter" class="feature-form team-punches-filter">
        <div class="form-row">
          <label>
            Du
            <input type="date" name="start" value="${escapeHtml(range.start)}" required>
          </label>
          <label>
            Au
            <input type="date" name="end" value="${escapeHtml(range.end)}" required>
          </label>
        </div>
        <p class="hierarchy-meta" id="eds-cycle-hint">Période ${edsPeriodLabel(range)} · ${count} collaborateur${count > 1 ? "s" : ""}.</p>
        <div class="team-punches-actions">
          <button type="submit" class="primary">Actualiser</button>
        </div>
      </form>
    </article>`;
}

function applyEdsFilterFromForm(form) {
  const data = new FormData(form);
  const start = String(data.get("start") || "");
  const end = String(data.get("end") || "");
  if (!start || !end) {
    alert("Indiquez une date de début et une date de fin.");
    return false;
  }
  if (end < start) {
    alert("La date de fin doit être postérieure à la date de début.");
    return false;
  }
  const span = (parseLocalDate(end) - parseLocalDate(start)) / 86400000;
  if (span > 366) {
    alert("L'intervalle ne peut pas dépasser 12 mois.");
    return false;
  }
  edsFilters = { start, end };
  return true;
}

function canValidateLeave(request) {
  const owner = request.userId || request.user_id;
  const me = session?.user?.id;
  if (owner && me && owner === me) return isAdmin();
  const chain = getLeaveValidatorChain(owner || me);
  const step = Number(request.workflowStep || request.workflow_step || 1);
  const current = chain[Math.max(0, step - 1)];
  if (!current) return false;
  const ids = current.ids || (current.id ? [current.id] : []);
  if (me && ids.includes(me)) return true;
  if (current.sharedFinal && isHr()) return true;
  return isAdmin();
}

function pendingLeaveForValidator() {
  const source = usesDatabase()
    ? [...getLeaveRequests(), ...(appData.teamLeaveRequests || []).map(normalizeTeamLeaveRequest)]
    : getLeaveRequests();
  const seen = new Set();
  return source.filter((request) => {
    if (seen.has(request.id)) return false;
    seen.add(request.id);
    const status = String(request.status || "");
    if (!status.toLowerCase().includes("valider")) return false;
    return canValidateLeave(request);
  });
}

function daysBetween(start, end) {
  return Math.max(countWorkingDays(start, end), 0);
}

function openEventDetail(id) {
  if (!id) return;
  appData.eventDetailId = id;
  renderApp();
}

function closeEventDetail() {
  if (!appData.eventDetailId) return;
  appData.eventDetailId = "";
  renderApp();
}

function bindCompanyEventsPage() {
  document.querySelectorAll("[data-event-open]").forEach((element) => {
    const trigger = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-event-edit], [data-event-delete], a, button[type='submit']")) return;
      const explicitTrigger = target.closest("[data-event-open]");
      if (!explicitTrigger || explicitTrigger !== element) return;
      event.preventDefault();
      openEventDetail(element.dataset.eventOpen);
    };
    element.addEventListener("click", trigger);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openEventDetail(element.dataset.eventOpen);
    });
  });

  document.querySelectorAll("[data-event-close]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target !== element) return;
      closeEventDetail();
    });
  });

  if (appData.eventDetailId) {
    document.body.classList.add("event-detail-open");
    if (!window.__humanaEventEsc) {
      window.__humanaEventEsc = (event) => {
        if (event.key === "Escape") closeEventDetail();
      };
      document.addEventListener("keydown", window.__humanaEventEsc);
    }
  } else {
    document.body.classList.remove("event-detail-open");
    if (window.__humanaEventEsc) {
      document.removeEventListener("keydown", window.__humanaEventEsc);
      window.__humanaEventEsc = null;
    }
  }

  const form = document.querySelector("#event-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isAdmin()) return;
      const data = new FormData(event.currentTarget);
      const editingId = form.dataset.eventId || "";
      const title = String(data.get("title") || "").trim();
      const startsRaw = String(data.get("starts_at") || "");
      if (!title || !startsRaw) {
        alert("Titre et date de début obligatoires.");
        return;
      }
      const endsRaw = String(data.get("ends_at") || "");
      const startsAt = new Date(startsRaw);
      const endsAt = endsRaw ? new Date(endsRaw) : null;
      if (endsAt && endsAt < startsAt) {
        alert("La date de fin doit être postérieure au début.");
        return;
      }
      const payload = {
        title,
        description: String(data.get("description") || "").trim() || null,
        location: String(data.get("location") || "").trim() || null,
        event_type: String(data.get("event_type") || "general"),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : null,
        all_day: data.get("all_day") === "on",
        visibility: String(data.get("visibility") || "all")
      };
      const posterFile = data.get("poster");
      const posterProvided = posterFile instanceof File && posterFile.size > 0;
      const removePoster = data.get("remove_poster") === "on";
      const currentEvent = editingId ? getCompanyEvents().find((entry) => String(entry.id) === String(editingId)) : null;

      withAction(async () => {
        let uploaded = null;
        if (posterProvided) {
          if (!usesDatabase()) {
            throw new Error("Upload d'affiche indisponible en mode démo.");
          }
          uploaded = await uploadEventPosterFile(posterFile);
          payload.poster_url = uploaded.publicUrl;
          payload.poster_path = uploaded.storagePath;
        } else if (removePoster) {
          payload.poster_url = null;
          payload.poster_path = null;
        }

        try {
          if (usesDatabase()) {
            if (editingId) {
              const { error } = await supabaseClient
                .from("company_events")
                .update(payload)
                .eq("id", editingId);
              if (error) throw error;
            } else {
              const { error } = await supabaseClient
                .from("company_events")
                .insert({ ...payload, created_by: session.user.id });
              if (error) throw error;
            }

            const oldPath = currentEvent?.poster_path;
            if (oldPath && (uploaded || removePoster) && oldPath !== payload.poster_path) {
              await deleteEventPosterFile(oldPath);
            }

            await loadCompanyEvents();
          } else {
            const list = getCompanyEvents();
            if (editingId) {
              appData.companyEvents = list.map((entry) => (
                String(entry.id) === String(editingId)
                  ? { ...entry, ...payload, updated_at: new Date().toISOString() }
                  : entry
              ));
            } else {
              appData.companyEvents = [
                { id: `local-${Date.now()}`, created_at: new Date().toISOString(), created_by: session?.user?.id || null, ...payload },
                ...list
              ];
            }
          }
        } catch (error) {
          if (uploaded?.storagePath) {
            await deleteEventPosterFile(uploaded.storagePath);
          }
          throw error;
        }
        appData.eventEditingId = "";
      });
    });
  }

  document.querySelector("#event-cancel")?.addEventListener("click", () => {
    appData.eventEditingId = "";
    renderApp();
  });

  document.querySelectorAll("[data-event-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      appData.eventEditingId = button.dataset.eventEdit || "";
      appData.eventDetailId = "";
      renderApp();
      requestAnimationFrame(() => {
        document.querySelector("#event-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  });

  document.querySelectorAll("[data-event-delete]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!isAdmin()) return;
      const id = button.dataset.eventDelete;
      if (!id) return;
      if (!window.confirm("Supprimer cet événement ? Les collaborateurs ne le verront plus.")) return;
      const target = getCompanyEvents().find((entry) => String(entry.id) === String(id));
      appData.eventDetailId = "";
      withAction(async () => {
        if (usesDatabase()) {
          const { error } = await supabaseClient
            .from("company_events")
            .delete()
            .eq("id", id);
          if (error) throw error;
          if (target?.poster_path) await deleteEventPosterFile(target.poster_path);
          await loadCompanyEvents();
        } else {
          appData.companyEvents = getCompanyEvents().filter((entry) => String(entry.id) !== String(id));
        }
        if (String(appData.eventEditingId) === String(id)) appData.eventEditingId = "";
      });
    });
  });
}

async function withAction(handler) {
  try {
    appData.loading = true;
    renderApp();
    await withTimeout(handler(), 15000, "Action");
    if (usesDatabase()) await loadPageData(currentPage, { force: true });
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

function bindTablePan() {
  document.querySelectorAll(".table-wrap").forEach((wrap) => {
    if (wrap.dataset.humanaPanBound) return;
    wrap.dataset.humanaPanBound = "1";
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    wrap.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest("button, a, input, select, textarea, label")) return;
      dragging = true;
      startX = event.clientX;
      startLeft = wrap.scrollLeft;
      wrap.classList.add("is-panning");
      wrap.setPointerCapture?.(event.pointerId);
    });
    wrap.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      wrap.scrollLeft = startLeft - (event.clientX - startX);
    });
    const stop = () => {
      dragging = false;
      wrap.classList.remove("is-panning");
    };
    wrap.addEventListener("pointerup", stop);
    wrap.addEventListener("pointercancel", stop);
  });
}

function bindHrDropdowns() {
  const syncOtherDetail = (root) => {
    const field = root.closest("form")?.querySelector("[data-other-detail]");
    if (!field) return;
    const hasOther = [...root.querySelectorAll('input[name="types"]:checked')]
      .some((input) => input.value === OTHER_REQUEST_CUSTOM);
    field.hidden = !hasOther;
    const detail = field.querySelector("input, textarea");
    if (detail) detail.required = hasOther;
  };

  document.querySelectorAll("[data-hr-dropdown]").forEach((root) => {
    const toggle = root.querySelector("[data-hr-toggle]");
    const summary = root.querySelector("[data-hr-summary]");
    const form = root.closest("form");
    if (!toggle || !summary) return;
    const placeholder = root.getAttribute("data-placeholder") || "Choisir";

    const selectedTypes = () => [...root.querySelectorAll('input[name="types"]:checked')]
      .map((input) => input.value)
      .filter(Boolean);

    const refreshSummary = () => {
      const selected = selectedTypes();
      summary.textContent = selected.length ? selected.join(", ") : placeholder;
      toggle.classList.toggle("is-placeholder", !selected.length);
      syncOtherDetail(root);
    };

    const setOpen = (open) => {
      root.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(!root.classList.contains("is-open"));
    });
    root.addEventListener("change", refreshSummary);
    form?.addEventListener("reset", () => {
      setOpen(false);
      queueMicrotask(refreshSummary);
    });
    refreshSummary();
  });

  if (!document.documentElement.dataset.hrDropdownBound) {
    document.documentElement.dataset.hrDropdownBound = "1";
    document.addEventListener("click", (event) => {
      document.querySelectorAll("[data-hr-dropdown].is-open").forEach((current) => {
        if (current.contains(event.target)) return;
        current.classList.remove("is-open");
        current.querySelector("[data-hr-toggle]")?.setAttribute("aria-expanded", "false");
      });
    });
  }
}

function bindPageEvents() {
  bindTablePan();
  bindTablePagers();
  bindFilterPanels();
  bindHrDropdowns();
  document.querySelector("#export-punch-history")?.addEventListener("click", exportPunchHistoryExcel);
  document.querySelectorAll("[data-goto-page]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToPage(button.dataset.gotoPage);
    });
  });

  bindCompanyEventsPage();

  document.querySelectorAll("[data-work-location]").forEach((button) => {
    button.addEventListener("click", () => {
      const location = button.dataset.workLocation;
      savePreferredWorkLocation(location);
      document.querySelectorAll("[data-work-location]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.workLocation === location);
      });
    });
  });

  document.querySelector("#clock-toggle")?.addEventListener("click", () => {
    const starting = getClockState().isOut;
    withAction(async () => {
      const punchType = starting ? "in" : "out";
      const meta = await collectJournalMeta();
      if (usesDatabase()) {
        const payload = applyJournalMetaToPayload(buildClockPunchPayload(punchType), meta, punchType);
        await insertTimePunch(payload);
      } else {
        const punches = loadStore("punches", []);
        punches.push(applyJournalMetaToDemoPunch(buildDemoClockPunch(punchType), meta, punchType));
        saveStore("punches", punches);
      }
      if (starting) {
        setCurrentWorkStatus("production");
        switchStatusClock("production");
        notifyLateArrivalIfNeeded();
      } else {
        pauseStatusClock();
        setCurrentWorkStatus("production");
        notifyOvertimeOnExitIfNeeded();
      }
    });
  });

  document.querySelector("#break-toggle")?.addEventListener("click", () => {
    const resuming = getClockState().onBreak;
    withAction(async () => {
      const punchType = resuming ? "break_end" : "break_start";
      const ws = getCurrentWorkStatus();
      if (usesDatabase()) {
        await insertTimePunch({
          user_id: session.user.id,
          punch_type: punchType,
          punched_at: new Date().toISOString(),
          work_status: ws
        });
      } else {
        const punches = loadStore("punches", []);
        punches.push({ type: punchType, time: new Date().toISOString(), workStatus: ws });
        saveStore("punches", punches);
      }
      if (resuming) switchStatusClock(ws);
      else pauseStatusClock();
    });
  });

  const saveLocalGta = (key, payload) => {
    const rows = loadStore(key, []);
    rows.unshift({ id: Date.now(), userId: session?.user?.id, created: new Date().toISOString(), ...payload });
    saveGtaStore(key, rows);
  };

  document.querySelector("#punch-correction-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (correctionsThisMonth().length >= PUNCH_CORRECTION_QUOTA) {
      alert("Quota mensuel de corrections atteint.");
      return;
    }
    const data = new FormData(event.currentTarget);
    withAction(async () => {
      const payload = {
        date: data.get("date"),
        time: data.get("time"),
        punchKind: data.get("punch_kind") || "in",
        reason: data.get("reason"),
        status: "A valider"
      };
      if (usesDatabase()) {
        await insertPunchCorrectionRow({
          user_id: session.user.id,
          punch_date: payload.date,
          requested_time: payload.time,
          punch_kind: payload.punchKind,
          reason: payload.reason,
          status: payload.status
        });
      } else saveLocalGta("punchCorrections", payload);
      currentPage = "pointeuse";
    });
  });

  document.querySelector("#overtime-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    withAction(async () => {
      const payload = { date: data.get("date"), hours: Number(data.get("hours")), reason: data.get("reason"), status: "A valider" };
      if (usesDatabase()) {
        const { error } = await supabaseClient.from("overtime_requests").insert({
          user_id: session.user.id,
          work_date: payload.date,
          hours: payload.hours,
          reason: payload.reason,
          status: payload.status
        });
        if (error) throw error;
      } else saveLocalGta("overtimeRequests", payload);
      currentPage = "pointeuse";
    });
  });

  document.querySelector("#activity-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    withAction(async () => {
      const payload = { date: data.get("date"), hours: Number(data.get("hours")), category: data.get("category"), comment: data.get("comment"), status: "A valider" };
      if (usesDatabase()) {
        const { error } = await supabaseClient.from("activity_entries").insert({
          user_id: session.user.id,
          work_date: payload.date,
          hours: payload.hours,
          category: payload.category,
          comment: payload.comment,
          status: payload.status
        });
        if (error) throw error;
      } else saveLocalGta("activityEntries", payload);
      currentPage = "pointeuse";
    });
  });

  const settleGtaItem = (kind, itemId, refuse) => {
    const meta = GTA_KINDS[kind];
    if (!meta) return;
    withAction(async () => {
      const status = refuse ? "Refuse" : "Approuve";
      const reviewer = {
        reviewed_by: session?.user?.id || null,
        reviewed_at: new Date().toISOString(),
        reviewedBy: session?.user?.id,
        reviewedByName: getUserName()
      };
      if (usesDatabase()) {
        const payload = { status };
        if (kind === "corrections") {
          payload.reviewed_by = reviewer.reviewed_by;
          payload.reviewed_at = reviewer.reviewed_at;
        }
        if (kind === "corrections" && !refuse) {
          const item = getPunchCorrections().find((row) => String(row.id) === String(itemId));
          if (item) await applyApprovedPunchCorrection(item);
        }
        await updateWithOptionalFields(meta.table, payload, "id", itemId, PUNCH_CORRECTION_FIELDS);
      } else {
        if (kind === "corrections" && !refuse) {
          const item = getPunchCorrections().find((row) => String(row.id) === String(itemId));
          if (item) await applyApprovedPunchCorrection(item);
        }
        saveGtaStore(meta.store, loadStore(meta.store, []).map((item) => (
          String(item.id) === String(itemId)
            ? { ...item, status, ...(kind === "corrections" ? reviewer : {}) }
            : item
        )));
      }
      if (currentPage !== "team-punches" && currentPage !== "reports") currentPage = "pointeuse";
    });
  };

  document.querySelectorAll(".gta-approve").forEach((button) => {
    button.addEventListener("click", () => settleGtaItem(button.dataset.gtaKind, button.dataset.gtaId, false));
  });
  document.querySelectorAll(".gta-reject").forEach((button) => {
    button.addEventListener("click", () => settleGtaItem(button.dataset.gtaKind, button.dataset.gtaId, true));
  });

  const advanceLeave = (requestId, refuse) => {
    withAction(async () => {
      const updateOne = (request) => {
        if (String(request.id) !== String(requestId)) return request;
        if (refuse) return { ...request, status: "Refuse" };
        const chain = getLeaveValidatorChain(request.userId || request.user_id || session?.user?.id);
        const step = Number(request.workflowStep || request.workflow_step || 1);
        if (step >= chain.length) return { ...request, status: "Approuve", workflowStep: step };
        const next = chain[step];
        return { ...request, workflowStep: step + 1, status: `A valider — ${next.role}` };
      };
      if (usesDatabase()) {
        const current = [...(appData.leaveRequests || []), ...(appData.teamLeaveRequests || [])].find((item) => String(item.id) === String(requestId));
        const next = updateOne({
          id: requestId,
          userId: current?.user_id,
          workflowStep: current?.workflow_step || 1,
          status: current?.status
        });
        await updateWithOptionalFields("leave_requests", {
          status: next.status,
          workflow_step: next.workflowStep
        }, "id", requestId, ["workflow_step"]);
      } else {
        saveStore("leaveRequests", loadStore("leaveRequests", []).map(updateOne));
      }
      currentPage = "leave";
    });
  };

  document.querySelectorAll(".leave-approve").forEach((button) => {
    button.addEventListener("click", () => advanceLeave(button.dataset.leaveId, false));
  });
  document.querySelectorAll(".leave-reject").forEach((button) => {
    button.addEventListener("click", () => advanceLeave(button.dataset.leaveId, true));
  });

  const edsFilter = document.querySelector("#eds-filter");
  if (edsFilter) {
    edsFilter.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!applyEdsFilterFromForm(edsFilter)) return;
      const range = getEdsRange();
      teamPunchFilters = { ...teamPunchFilters, start: range.start, end: range.end };
      teamPunchesInitialLoadDone = false;
      resetTablePage("eds");
      resetTablePage("gta-inbox");
      withAction(async () => {});
    });
  }

  document.querySelector("#eds-payroll-open")?.addEventListener("click", () => {
    openEdsPayrollDialog("one");
  });
  document.querySelector("#export-eds")?.addEventListener("click", () => {
    const rows = buildEdsRows();
    const range = getEdsRange();
    const columns = visibleEdsColumns();
    downloadCsv(`eds_${range.start}_${range.end}.csv`,
      columns.map((col) => col.label),
      rows.map((row) => edsRowCells(row, columns)));
  });
  document.querySelector("#export-absences")?.addEventListener("click", () => {
    const range = getEdsRange();
    const requests = [...getLeaveRequests(), ...(appData.teamLeaveRequests || [])]
      .map((row) => (row.type ? row : normalizeTeamLeaveRequest(row)))
      .filter((item) => edsLeaveOverlaps(item, range));
    downloadCsv(`absences_${range.start}_${range.end}.csv`, ["Nom", "Type", "Début", "Fin", "Durée", "Statut"],
      requests.map((item) => [item.name || getUserName(), item.type, item.start, item.end, item.days || item.hours, item.status]));
  });
  document.querySelector("#export-retards")?.addEventListener("click", () => {
    const range = getEdsRange();
    const daily = summarizeTeamPunchesByDay(appData.teamPunches || [], range.start, range.end);
    downloadCsv(`retards_${range.start}_${range.end}.csv`, ["Nom", "Date", "Retard_min", "Manquant"],
      daily.map((row) => {
        const stats = analyzeWorkedDay(row, profileById(row.userId) || {});
        return [row.name, row.dayKey, stats.delayMin, formatDuration(stats.missingMs)];
      }).filter((row) => Number(row[2]) > 0 || row[3] !== "0h00"));
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
        : `<p class="empty-state">Aucun collaborateur ne correspond à votre recherche.</p>`;
      bindHierarchyOrgEvents();
    });
  }

  bindHierarchyOrgEvents();

  const teamPunchesFilter = document.querySelector("#team-punches-filter");
  if (teamPunchesFilter) {
    if (!teamPunchFilters.start || !teamPunchFilters.end) {
      teamPunchFilters = {
        ...teamPunchFilters,
        ...getDefaultTeamPunchRange(),
        userId: teamPunchFilters.userId || "",
        scope: teamPunchFilters.scope || "all"
      };
    }
    teamPunchesFilter.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      teamPunchFilters = {
        ...teamPunchFilters,
        start: data.get("start"),
        end: data.get("end"),
        userId: data.get("userId") || "",
        scope: isAdmin() ? (data.get("scope") || "all") : "team"
      };
      if (new Date(teamPunchFilters.end) < new Date(teamPunchFilters.start)) {
        alert("La date de fin doit être postérieure à la date de début.");
        return;
      }
      resetTablePage("team-punches");
      resetTablePage("team-status");
      resetTablePage("delay-inbox");
      withAction(() => loadTeamPunches());
    });
  }

  if (currentPage === "planning") {
    const range = planningMonthRange();
    teamPunchFilters = {
      ...teamPunchFilters,
      start: range.start,
      end: range.end,
      scope: isAdmin() ? (teamPunchFilters.scope || "all") : "team"
    };
  }

  if ((currentPage === "team-punches" || currentPage === "reports" || currentPage === "global" || currentPage === "planning") && canViewTeamPunches() && usesDatabase() && !teamPunchesInitialLoadDone) {
    teamPunchesInitialLoadDone = true;
    loadTeamPunches()
      .then(() => {
        if (currentPage !== "team-punches" && currentPage !== "reports" && currentPage !== "global" && currentPage !== "planning") return;
        const content = document.querySelector("#page-content");
        if (content) {
          content.innerHTML = pageContent();
          bindPageEvents();
        }
      })
      .catch((error) => {
        appData.error = formatAppError(error);
        renderApp();
      });
  }

  const globalFilter = document.querySelector("#global-filter");
  if (globalFilter) {
    globalFilter.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      teamPunchFilters = {
        ...teamPunchFilters,
        start: data.get("start"),
        end: data.get("end"),
        userId: teamPunchFilters.userId || "",
        scope: isAdmin() ? (data.get("scope") || teamPunchFilters.scope || "all") : "team"
      };
      if (new Date(teamPunchFilters.end) < new Date(teamPunchFilters.start)) {
        alert("La date de fin doit être postérieure à la date de début.");
        return;
      }
      if (usesDatabase()) {
        withAction(() => loadTeamPunches());
      } else {
        renderApp();
      }
    });
  }

  document.querySelectorAll("[data-planning-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      planningState.tab = button.dataset.planningTab || "grid";
      renderApp();
    });
  });
  document.querySelector("#planning-dept")?.addEventListener("change", (event) => {
    planningState.dept = event.currentTarget.value || "cs";
    planningState.aiPage = 1;
    resetTablePage("planning-log");
    renderApp();
  });
  document.querySelector("#planning-prev")?.addEventListener("click", () => {
    const cursor = getPlanningCursor();
    planningState.cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    planningState.aiPage = 1;
    resetTablePage("planning-log");
    const range = planningMonthRange();
    teamPunchFilters = { ...teamPunchFilters, start: range.start, end: range.end };
    if (usesDatabase() && canViewTeamPunches()) {
      teamPunchesInitialLoadDone = false;
      withAction(() => loadTeamPunches());
    } else {
      renderApp();
    }
  });
  document.querySelector("#planning-next")?.addEventListener("click", () => {
    const cursor = getPlanningCursor();
    planningState.cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    planningState.aiPage = 1;
    resetTablePage("planning-log");
    const range = planningMonthRange();
    teamPunchFilters = { ...teamPunchFilters, start: range.start, end: range.end };
    if (usesDatabase() && canViewTeamPunches()) {
      teamPunchesInitialLoadDone = false;
      withAction(() => loadTeamPunches());
    } else {
      renderApp();
    }
  });
  document.querySelector("#planning-tt-rotate")?.addEventListener("click", () => {
    (async () => {
      appData.loading = true;
      appData.error = "";
      renderApp();
      try {
        await withTimeout(applyTtRotationMonth(), 180000, "Rotation TT");
        if (usesDatabase()) await loadPageData(currentPage, { force: true });
      } catch (error) {
        appData.error = formatAppError(error);
      } finally {
        appData.loading = false;
        renderApp();
      }
    })();
  });
  const assignForm = document.querySelector("#planning-assign-form");
  const snapshotAssign = () => {
    if (!assignForm) return;
    const data = new FormData(assignForm);
    planningState._assignDraft = {
      scope: String(data.get("scope") || "shift"),
      scopeValue: String(data.get("scope_value") || ""),
      start: String(data.get("start") || ""),
      end: String(data.get("end") || ""),
      kind: String(data.get("kind") || "PR"),
      hours: data.get("hours"),
      split: String(data.get("split") || "half"),
      days: String(data.get("days") || "week"),
      shiftCode: String(data.get("shift_code") || "")
    };
  };
  const refreshAssignPreview = () => {
    const preview = document.querySelector("#planning-assign-preview");
    if (preview && assignForm) preview.textContent = planningAssignPreviewText(assignForm);
  };
  document.querySelector(".planning-assign")?.addEventListener("toggle", (event) => {
    planningState.assignOpen = event.currentTarget.open;
  });
  document.querySelector("#planning-assign-scope")?.addEventListener("change", () => {
    snapshotAssign();
    planningState._assignDraft.scopeValue = "";
    planningState.assignOpen = true;
    renderApp();
  });
  assignForm?.addEventListener("input", refreshAssignPreview);
  assignForm?.addEventListener("change", refreshAssignPreview);
  assignForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    snapshotAssign();
    planningState.assignOpen = true;
    const payload = new FormData(event.currentTarget);
    (async () => {
      appData.loading = true;
      appData.error = "";
      renderApp();
      try {
        await withTimeout(applyMassPlanning(payload), 180000, "Affectation planning");
        if (usesDatabase()) await loadPageData(currentPage, { force: true });
      } catch (error) {
        appData.error = formatAppError(error);
      } finally {
        appData.loading = false;
        renderApp();
      }
    })();
  });
  refreshAssignPreview();

  document.querySelectorAll("[data-planning-day]").forEach((button) => {
    button.addEventListener("click", () => {
      openPlanningDayDialog(button.dataset.planningUser, button.dataset.planningDay);
    });
  });

  document.querySelector("#team-punches-export")?.addEventListener("click", () => {
    exportTeamPunchesCsv();
  });

  document.querySelectorAll("[data-team-detail-view]").forEach((button) => {
    button.addEventListener("click", () => {
      teamPunchFilters.detailView = button.dataset.teamDetailView === "status" ? "status" : "punches";
      renderApp();
    });
  });

  document.querySelectorAll("[data-punch-rectify]").forEach((button) => {
    button.addEventListener("click", () => {
      openPunchRectifyDialog(button.dataset.userId, button.dataset.dayKey);
    });
  });

  document.querySelectorAll("[data-delay-confirm]").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = button.dataset.userId;
      const dayKey = button.dataset.dayKey;
      const delayMin = Number(button.dataset.delayMin) || 0;
      withAction(async () => {
        await upsertDelayReview({ userId, dayKey, delayMin, status: "Confirme" });
        if (usesDatabase()) {
          dataStamp.gta = 0;
          dataStamp.teamPunches = 0;
        }
      });
    });
  });

  document.querySelectorAll("[data-absence-justify]").forEach((button) => {
    button.addEventListener("click", () => {
      openJustifyAbsenceDialog(button.dataset.userId, button.dataset.dayKey);
    });
  });
  document.querySelectorAll("[data-ai-page]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const next = Number(button.dataset.aiPage);
      if (!Number.isFinite(next) || next < 1) return;
      planningState.aiPage = next;
      renderApp();
    });
  });

  const journalFilter = document.querySelector("#journal-filter");
  if (journalFilter) {
    if (!journalFilters.start || !journalFilters.end) {
      journalFilters = { ...getDefaultTeamPunchRange(), userId: journalFilters.userId || "", query: journalFilters.query || "" };
    }
    journalFilter.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      journalFilters = {
        start: data.get("start"),
        end: data.get("end"),
        userId: data.get("userId") || "",
        query: data.get("query") || ""
      };
      if (new Date(journalFilters.end) < new Date(journalFilters.start)) {
        alert("La date de fin doit être postérieure à la date de début.");
        return;
      }
      resetTablePage("journal");
      journalPunchesInitialLoadDone = true;
      if (usesDatabase()) {
        withAction(() => loadJournalPunches());
      } else {
        renderApp();
      }
    });
  }

  if (currentPage === "journal" && canViewJournal() && usesDatabase() && !journalPunchesInitialLoadDone) {
    journalPunchesInitialLoadDone = true;
    loadJournalPunches()
      .then(() => {
        if (currentPage !== "journal") return;
        refreshPageContent();
      })
      .catch((error) => {
        appData.error = formatAppError(error);
        renderApp();
      });
  }

  document.querySelector("#journal-export")?.addEventListener("click", () => {
    exportJournalCsv();
  });

  bindJournalFullscreen();

  document.querySelectorAll("[data-journal-col]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.journalCol;
      journalOpenColumn = journalOpenColumn === key ? "" : key;
      refreshPageContent();
    });
  });

  document.querySelectorAll("[data-journal-sort]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      journalSort = {
        key: button.dataset.journalSort,
        dir: button.dataset.journalDir || (journalSort.key === button.dataset.journalSort && journalSort.dir === "desc" ? "asc" : "desc")
      };
      journalOpenColumn = "";
      refreshPageContent();
    });
  });

  document.querySelectorAll("[data-journal-filter-col]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.journalFilterCol;
      const value = button.dataset.journalFilterValue || "";
      if (value) journalColumnFilters[key] = value;
      else delete journalColumnFilters[key];
      journalOpenColumn = "";
      resetTablePage("journal");
      refreshPageContent();
    });
  });


  document.querySelector(".leave-cal-prev")?.addEventListener("click", () => {
    shiftLeaveCalendarMonth(-1);
  });

  document.querySelector(".leave-cal-next")?.addEventListener("click", () => {
    shiftLeaveCalendarMonth(1);
  });

  document.querySelector(".leave-cal-today")?.addEventListener("click", () => {
    resetLeaveCalendarToToday();
  });

  document.querySelector("#mark-all-alerts-read")?.addEventListener("click", () => {
    withAction(async () => {
      const unreadIds = (appData.hrAlerts || []).filter((alert) => !alert.read_at).map((alert) => alert.id);
      if (!unreadIds.length) return;
      const { error } = await supabaseClient
        .from("hr_alerts")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds)
        .eq("recipient_id", session.user.id);
      if (error) throw error;
    });
  });

  document.querySelectorAll("[data-alert-read]").forEach((button) => {
    button.addEventListener("click", () => {
      const alertId = button.dataset.alertRead;
      withAction(async () => {
        const { error } = await supabaseClient
          .from("hr_alerts")
          .update({ read_at: new Date().toISOString() })
          .eq("id", alertId)
          .eq("recipient_id", session.user.id);
        if (error) throw error;
      });
    });
  });

  document.querySelectorAll("[data-alert-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const alertId = button.dataset.alertDelete;
      withAction(async () => {
        const { error } = await supabaseClient
          .from("hr_alerts")
          .delete()
          .eq("id", alertId)
          .eq("recipient_id", session.user.id);
        if (error) throw error;
      });
    });
  });

  document.querySelector("#delete-all-alerts")?.addEventListener("click", () => {
    const alertIds = (appData.hrAlerts || []).map((alert) => alert.id);
    if (!alertIds.length) return;
    if (!confirm("Supprimer toutes les alertes RH ?")) return;
    withAction(async () => {
      const { error } = await supabaseClient
        .from("hr_alerts")
        .delete()
        .in("id", alertIds)
        .eq("recipient_id", session.user.id);
      if (error) throw error;
    });
  });

  document.querySelector("#creator-nav-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const settings = getDefaultNavVisibility();

    NAV_VISIBILITY_PAGES.forEach((page) => {
      NAV_VISIBILITY_AUDIENCES.forEach((audience) => {
        settings[page.id][audience.id] = data.get(`${page.id}_${audience.id}`) === "on";
      });
    });

    withAction(async () => {
      await saveNavVisibility(settings);
      currentPage = "creator";
    });
  });

  bindUserAccountSection();
  bindCreatorAccountsSection();

  const syncLeaveTypeUi = () => {
    const type = document.querySelector("#leave-type")?.value || "";
    const def = getAbsenceDef(type);
    const fileWrap = document.querySelector("#leave-file-wrap");
    const unitSelect = document.querySelector("[name='unit']");
    const unitLabel = unitSelect?.closest("label");
    const half = document.querySelector("#leave-half-wrap");
    const hours = document.querySelector("#leave-hours-wrap");
    const startInput = document.querySelector("#leave-form [name='start']");
    const endInput = document.querySelector("#leave-form [name='end']");
    const required = leaveNeedsAttachment(type);
    const isHours = Boolean(def?.unit === "hours" || leaveIsHoursUnit(type));
    if (fileWrap) {
      const input = fileWrap.querySelector("input");
      fileWrap.hidden = !required;
      if (input) input.required = required;
    }
    if (unitSelect) {
      unitSelect.value = isHours ? "hours" : (unitSelect.value === "half" && !def?.fixedDays ? "half" : "days");
      if (unitLabel) unitLabel.hidden = Boolean(def?.fixedDays) || isHours;
    }
    if (half) half.hidden = unitSelect?.value !== "half";
    if (hours) hours.hidden = !isHours && unitSelect?.value !== "hours";
    if (def?.fixedDays && startInput?.value && endInput) {
      endInput.value = addWorkingDaysKey(startInput.value, def.fixedDays);
      endInput.readOnly = true;
    } else if (endInput) {
      endInput.readOnly = false;
    }
  };

  document.querySelector("#leave-type")?.addEventListener("change", syncLeaveTypeUi);
  document.querySelector("#leave-form [name='start']")?.addEventListener("change", syncLeaveTypeUi);
  document.querySelector("[name='unit']")?.addEventListener("change", (event) => {
    const unit = event.currentTarget.value;
    const half = document.querySelector("#leave-half-wrap");
    const hours = document.querySelector("#leave-hours-wrap");
    if (half) half.hidden = unit !== "half";
    if (hours) hours.hidden = unit !== "hours";
  });
  syncLeaveTypeUi();

  document.querySelector("#leave-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const start = data.get("start");
    const type = String(data.get("type") || "");
    const def = getAbsenceDef(type);
    const unit = def?.unit === "hours" || leaveIsHoursUnit(type)
      ? "hours"
      : (def?.fixedDays ? "days" : String(data.get("unit") || "days"));
    if (def?.adminOnly && !isAdmin()) {
      alert("Ce code d'absence est réservé aux RH.");
      return;
    }
    if (def?.grades && !isAdmin() && !def.grades.includes(getLeaveGrade())) {
      alert("Ce code de congés payés n'est pas disponible pour votre profil.");
      return;
    }
    let end = data.get("end");
    if (def?.fixedDays && start) {
      end = addWorkingDaysKey(start, def.fixedDays);
    }
    if (new Date(end) < new Date(start)) {
      alert("La date de fin doit être postérieure à la date de début.");
      return;
    }
    if (hasOverlappingLeave(start, end)) {
      alert("Les absences ne peuvent pas se chevaucher.");
      return;
    }
    if (seniorityMonths() < 6 && !hasOrgWideAccess() && leaveTypeKey(type) === "cp") {
      alert("Une ancienneté minimale de 6 mois est requise pour poser des congés payés, sauf dérogation RH.");
      return;
    }
    const days = unit === "hours" ? 0 : (def?.fixedDays || (unit === "half" ? 0.5 : daysBetween(start, end)));
    if (unit !== "hours" && days <= 0) {
      alert("La période ne contient aucun jour ouvré.");
      return;
    }
    if (leaveNeedsAttachment(type) && !data.get("file")?.name) {
      alert("Un justificatif est obligatoire pour ce type d'absence.");
      return;
    }
    const chain = getLeaveValidatorChain(session?.user?.id);
    const first = chain[0];

    withAction(async () => {
      const payload = {
        type,
        start,
        end,
        days,
        hours: unit === "hours" ? Number(data.get("hours") || 0) : null,
        unit,
        halfDay: unit === "half" ? data.get("half_day") : "",
        motif: def?.label || type,
        attachmentName: data.get("file")?.name || "",
        comment: data.get("comment") || "",
        workflowStep: 1,
        status: `A valider — ${first?.role || "Manager N+1"}`,
        userId: session?.user?.id
      };

      if (usesDatabase()) {
        await insertLeaveRequestRow({
          user_id: session.user.id,
          leave_type: payload.type,
          start_date: payload.start,
          end_date: payload.end,
          days: payload.days,
          hours: payload.hours,
          unit: payload.unit,
          half_day: payload.halfDay || null,
          motif: payload.motif || null,
          attachment_name: payload.attachmentName || null,
          workflow_step: 1,
          comment: payload.comment,
          status: payload.status
        });
      } else {
        const requests = loadStore("leaveRequests", []);
        requests.unshift({ id: Date.now(), ...payload, created: new Date().toISOString() });
        saveStore("leaveRequests", requests);
      }

      form.reset();
      currentPage = "leave";
    });
  });

  document.querySelector("#salary-advance-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = Number(data.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Indiquez un montant d'avance supérieur à 0.");
      return;
    }
    const quota = getSalaryAdvanceQuota();
    if (!quota.ok) {
      alert(quota.reason || "Demande d'avance impossible.");
      return;
    }
    if (quota.maxAmount && amount > quota.maxAmount + 0.001) {
      alert(`Le montant ne peut pas dépasser 30 % du salaire net (${formatMad(quota.maxAmount)}).`);
      return;
    }

    withAction(async () => {
      const payload = {
        amount,
        reason: String(data.get("reason") || "").trim(),
        requestedDate: String(data.get("requested_date") || "") || null,
        status: "A valider"
      };

      if (usesDatabase()) {
        const { error } = await supabaseClient.from("salary_advance_requests").insert({
          user_id: session.user.id,
          amount: payload.amount,
          reason: payload.reason,
          requested_date: payload.requestedDate,
          status: payload.status
        });
        if (error) throw error;
      } else {
        const requests = loadStore("salaryAdvanceRequests", []);
        requests.unshift({ id: Date.now(), userId: session?.user?.id, ...payload, created: new Date().toISOString() });
        saveStore("salaryAdvanceRequests", requests);
      }

      form.reset();
      currentPage = "attestations";
    });
  });

  document.querySelector("#attestation-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const types = [...new Set(data.getAll("types"))]
      .map((item) => String(item || "").trim())
      .filter((type) => attestationTypes.includes(type));
    const reason = String(data.get("reason") || "").trim();
    if (!types.length) {
      alert("Sélectionnez au moins un type d'attestation.");
      return;
    }
    if (!reason) {
      alert("Indiquez le motif de la demande.");
      return;
    }

    withAction(async () => {
      if (usesDatabase()) {
        const { error } = await supabaseClient.from("attestation_requests").insert(
          types.map((type) => ({
            user_id: session.user.id,
            document_type: type,
            reason,
            status: "A valider"
          }))
        );
        if (error) throw error;
      } else {
        const requests = loadStore("attestationRequests", []);
        const created = new Date().toISOString();
        types.forEach((type, index) => {
          requests.unshift({
            id: `${Date.now()}-${index}`,
            userId: session?.user?.id,
            kind: "attestation",
            type,
            reason,
            status: "A valider",
            created
          });
        });
        saveStore("attestationRequests", requests);
      }

      form.reset();
      currentPage = "attestations";
    });
  });

  document.querySelector("#other-request-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const types = [...new Set(data.getAll("types"))]
      .map((item) => String(item || "").trim())
      .filter((type) => otherRequestTypes.includes(type));
    const reason = String(data.get("reason") || "").trim();
    const otherDetail = String(data.get("other_detail") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!types.length) {
      alert("Sélectionnez au moins un type de demande.");
      return;
    }
    if (types.includes(OTHER_REQUEST_CUSTOM) && !otherDetail) {
      alert("Précisez le type de demande (Autre).");
      return;
    }
    if (!reason) {
      alert("Indiquez le motif de la demande.");
      return;
    }
    const documentTypes = types.map((type) => (
      type === OTHER_REQUEST_CUSTOM ? `${OTHER_REQUEST_CUSTOM} : ${otherDetail}` : type
    ));

    withAction(async () => {
      if (usesDatabase()) {
        const { error } = await supabaseClient.from("attestation_requests").insert(
          documentTypes.map((type) => ({
            user_id: session.user.id,
            document_type: type,
            reason,
            status: "A valider"
          }))
        );
        if (error) throw error;
      } else {
        const requests = loadStore("attestationRequests", []);
        const created = new Date().toISOString();
        documentTypes.forEach((type, index) => {
          requests.unshift({
            id: `${Date.now()}-${index}`,
            userId: session?.user?.id,
            kind: "other",
            type,
            reason,
            status: "A valider",
            created
          });
        });
        saveStore("attestationRequests", requests);
      }

      form.reset();
      currentPage = "attestations";
    });
  });

  const settleHrItem = (kind, itemId, refuse) => {
    const table = kind === "advance" ? "salary_advance_requests" : "attestation_requests";
    const store = kind === "advance" ? "salaryAdvanceRequests" : "attestationRequests";
    const current = getHrRequests().find((item) => String(item.id) === String(itemId) && item.kind === kind);
    if (!current || !canValidateHrRequest(current)) return;
    withAction(async () => {
      const status = refuse ? "Refuse" : "Approuve";
      if (usesDatabase()) {
        const { error } = await supabaseClient.from(table).update({ status }).eq("id", itemId);
        if (error) throw error;
      } else {
        saveStore(store, loadStore(store, []).map((item) => (
          String(item.id) === String(itemId) ? { ...item, status } : item
        )));
      }
      currentPage = "attestations";
    });
  };

  document.querySelectorAll(".hr-approve").forEach((button) => {
    button.addEventListener("click", () => settleHrItem(button.dataset.hrKind, button.dataset.hrId, false));
  });
  document.querySelectorAll(".hr-reject").forEach((button) => {
    button.addEventListener("click", () => settleHrItem(button.dataset.hrKind, button.dataset.hrId, true));
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
        visibility: String(data.get("visibility") || "all"),
        published_at: new Date().toISOString().slice(0, 10),
        created_by: session.user.id,
        file_url: "",
        storage_path: null
      };

      if (usesDatabase()) {
        if (!fileEntry) throw new Error("Sélectionnez un fichier à téléverser.");
        if (fileEntry.size > HR_DOCUMENT_MAX_BYTES) {
          throw new Error("Fichier trop volumineux. Taille maximum : 10 Mo.");
        }
        const uploaded = await uploadHrDocumentFile(fileEntry);
        payload.storage_path = uploaded.storagePath;
        const { error } = await supabaseClient.from("hr_documents").insert(payload);
        if (error && errorMentionsAny(error, HR_DOCUMENT_OPTIONAL_FIELDS)) {
          const retry = await supabaseClient
            .from("hr_documents")
            .insert(stripFields(payload, HR_DOCUMENT_OPTIONAL_FIELDS));
          if (retry.error) throw retry.error;
        } else if (error) {
          throw error;
        }
      } else {
        if (!fileEntry) throw new Error("Sélectionnez un fichier ou connectez-vous avec Microsoft.");
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
        if (!fileEntry) throw new Error("Sélectionnez un fichier PDF à téléverser.");
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
        payload.storage_path = uploaded.storagePath;
        const { error } = await supabaseClient.from("payslips").upsert(payload, {
          onConflict: "user_id,period_year,period_month"
        });
        if (error) throw error;
        if (existing?.storage_path && existing.storage_path !== uploaded.storagePath) {
          await supabaseClient.storage.from(HR_DOCUMENTS_BUCKET).remove([existing.storage_path]);
        }
      } else if (userId === session?.user?.id || demoMode) {
        if (!fileEntry) throw new Error("Sélectionnez un fichier ou connectez-vous avec Microsoft.");
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

function bindPrivateFileLinks() {
  document.querySelectorAll("[data-private-file-kind][data-private-file-id]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const collection = link.dataset.privateFileKind === "payslip"
        ? getPayslips()
        : getHrDocuments();
      const fileRecord = collection.find((item) =>
        String(item.id) === String(link.dataset.privateFileId)
      );
      if (!fileRecord) {
        alert("Fichier introuvable.");
        return;
      }

      const popup = window.open("about:blank", "_blank");
      if (popup) popup.opener = null;
      try {
        const signedUrl = await createPrivateFileUrl(fileRecord);
        if (popup) popup.location.replace(signedUrl);
        else window.location.assign(signedUrl);
      } catch (error) {
        popup?.close();
        alert(error?.message || "Impossible d'ouvrir le fichier prive.");
      }
    });
  });
}

function bindAppEvents() {
  bindThemeToggle();
  bindWorkStatusPicker();
  bindElapsedClock();
  bindPrivateFileLinks();

  document.querySelector("#brand-home")?.addEventListener("click", () => {
    navigateToPage("home");
  });

  document.querySelectorAll(".sidebar nav [data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToPage(button.dataset.page);
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
    const previousPrefix = storagePrefix();
    if (session && supabaseClient) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        alert(error.message || "Déconnexion incomplète. Réessayez.");
        return;
      }
    }
    stopLateReminderWatcher();
    try {
      const orphans = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(previousPrefix)) orphans.push(key);
      }
      orphans.forEach((key) => localStorage.removeItem(key));
    } catch (_) { /* ignore quota / privacy mode errors */ }
    // Coupe le mode démo (persistant en sessionStorage entre les pages MPA).
    try { sessionStorage.removeItem("humana_demo_mode"); } catch (_) { /* ignore */ }
    session = null;
    demoMode = false;
    currentPage = "home";
    initialAuthHandled = false;
    teamPunchesInitialLoadDone = false;
    journalPunchesInitialLoadDone = false;
    dataStamp = Object.create(null);
    window.__humanaInviteApplied = false;
    journalFullscreen = false;
    journalFilters = { start: "", end: "", userId: "", query: "" };
    journalColumnFilters = {};
    journalOpenColumn = "";
    leaveCalendarMonth = null;
    edsFilters = { start: "", end: "" };
    appData = {
      loading: false,
      error: "",
      profile: null,
      punches: [],
      teamPunches: [],
      journalPunches: [],
      journalMetaMissing: false,
      teamLeaveRequests: [],
      leaveRequests: [],
      attestationRequests: [],
      salaryAdvanceRequests: [],
      salaryAdvanceTableMissing: false,
      salaryAdvanceQuota: null,
      orgProfiles: [],
      pendingInvites: [],
      hrDocuments: [],
      payslips: [],
      hrAlerts: [],
      punchCorrections: [],
      overtimeRequests: [],
      activityEntries: [],
      navVisibility: null,
      studioCreators: [],
      companyEvents: [],
      companyEventsTableMissing: false,
      eventEditingId: "",
      eventDetailId: "",
      adminEditingId: "",
      adminEditingInviteId: "",
      edsPayroll: {},
      delayReviews: []
    };
    if (mpaMode) {
      window.location.href = loginHref();
      return;
    }
    renderLogin();
  });

  document.querySelector("#retry-load")?.addEventListener("click", () => {
    dataStamp = Object.create(null);
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
  const cfg = window.HUMANA_CONFIG || {};
  const url = (cfg.API_URL || window.location.origin || "")
    .replace(/\/$/, "");
  return {
    url,
    key: "local"
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
    if (shouldBootAuthenticatedUi()) showAuthBootScreen();
    bindLoginEvents();
    // Reprise du mode démo après redirection depuis / vers /admin.html.
    // Le flag reste dans sessionStorage tant que l'utilisateur ne se déconnecte
    // pas : chaque navigation MPA (page reload) re-hydrate l'état démo.
    if (mpaMode) {
      let demoFlag = false;
      try { demoFlag = sessionStorage.getItem("humana_demo_mode") === "1"; } catch (_) {}
      if (demoFlag) {
        demoMode = true;
        supabaseClient = getSupabaseClient();
        showAuthBootScreen();
        hydrateDemoWorkspace();
        renderApp();
        hideAuthBootScreen();
        return;
      }
    }
    if (window.__authReady) await window.__authReady;
    supabaseClient = getSupabaseClient();
    if (!shouldBootAuthenticatedUi()) {
      setLoginState({ ready: Boolean(supabaseClient) });
    }

    if (window.__pendingAuthSession) {
      initialAuthHandled = true;
      await window.humanaRender(window.__pendingAuthSession);
      return;
    }

    const portalUser = readPortalUser();
    if (portalUser) {
      portalMode = true;
      initialAuthHandled = true;
      session = {
        user: {
          email: portalUser.email,
          user_metadata: { full_name: portalUser.name }
        }
      };
      hideAuthBootScreen();
      renderApp();
      return;
    }

    if (!supabaseClient) {
      hideAuthBootScreen();
      if (mpaMode) window.location.href = loginHref();
      return;
    }

    supabaseClient.auth.onAuthStateChange(async (event, nextSession) => {
      if (nextSession && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        if (initialAuthHandled) return;
        initialAuthHandled = true;
        session = nextSession;
        demoMode = false;
        showAuthBootScreen();
        // Sur index.html (login), l'app est en mode SPA sans pages/*.js chargées.
        // Toute session valide doit basculer vers la vraie home MPA.
        if (!mpaMode) {
          window.location.href = pageHref("home");
          return;
        }
        await bootstrapUser({ showSpinner: false });
        clearAuthParamsFromUrl();
        return;
      }
      if (event === "SIGNED_OUT") {
        initialAuthHandled = false;
        if (mpaMode) {
          window.location.href = loginHref();
        } else {
        renderLogin();
        }
      }
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session && !initialAuthHandled) {
      initialAuthHandled = true;
      session = data.session;
      demoMode = false;
      showAuthBootScreen();
      if (!mpaMode) {
        window.location.href = pageHref("home");
        return;
      }
      await bootstrapUser({ showSpinner: false });
      clearAuthParamsFromUrl();
    } else if (!data.session) {
      hideAuthBootScreen();
      if (mpaMode) window.location.href = loginHref();
    }
  } catch (error) {
    hideAuthBootScreen();
    setLoginState({ ready: false, error: error.message || "Impossible de demarrer l'application." });
  }
}

window.humanaRender = async function (authSession) {
  session = authSession;
  demoMode = false;
  initialAuthHandled = true;
  ensureAppContainer();
  showAuthBootScreen();
  if (!mpaMode) {
    window.location.href = pageHref("home");
    return;
  }
  await bootstrapUser({ showSpinner: false });
  clearAuthParamsFromUrl();
};

function hydrateDemoWorkspace() {
  const profiles = [
    { id: "u-camille", email: "camille.moreau@humaine.fr", full_name: "Camille Moreau", job_title: "Directrice RH", department: "Ressources humaines", role: "admin", manager_id: "", matricule: "HUM-1001", leave_grade: "codir", shift_code: "cs", holiday_calendar: "fr", hired_at: "2018-03-01", leave_balance_cp: 30, leave_balance_rtt: 8 },
    { id: "u-thomas", email: "thomas.bernard@humaine.fr", full_name: "Thomas Bernard", job_title: "Responsable opérations", department: "Opérations", role: "manager", manager_id: "u-camille", matricule: "HUM-1042", leave_grade: "manager", shift_code: "cs", holiday_calendar: "fr", hired_at: "2020-01-15", leave_balance_cp: 24, leave_balance_rtt: 6 },
    { id: "u-sarah", email: "sarah.nguyen@humaine.fr", full_name: "Sarah Nguyen", job_title: "Responsable commercial", department: "Commercial", role: "manager", manager_id: "u-camille", matricule: "HUM-1088", leave_grade: "manager", shift_code: "cs", holiday_calendar: "fr", hired_at: "2019-09-01", leave_balance_cp: 24, leave_balance_rtt: 8 },
    { id: "u-lea", email: "lea.martin@humaine.fr", full_name: "Léa Martin", job_title: "Chargée de paie", department: "Ressources humaines", role: "rh", manager_id: "u-thomas", matricule: "HUM-1214", leave_grade: "employee", shift_code: "cs", holiday_calendar: "fr", hired_at: "2024-01-08", leave_balance_cp: 18, leave_balance_rtt: 5 },
    { id: "u-hugo", email: "hugo.petit@humaine.fr", full_name: "Hugo Petit", job_title: "Ingénieur R&D", department: "R&D", role: "employee", manager_id: "u-thomas", matricule: "HUM-1307", leave_grade: "employee", shift_code: "rnd", holiday_calendar: "ma", hired_at: "2023-06-12", leave_balance_cp: 18, leave_balance_rtt: 8 },
    { id: "u-nina", email: "nina.rossi@humaine.fr", full_name: "Nina Rossi", job_title: "Commerciale", department: "CES", role: "employee", manager_id: "u-sarah", matricule: "HUM-1420", leave_grade: "employee", shift_code: "ces", holiday_calendar: "fr", hired_at: "2025-11-02", leave_balance_cp: 4, leave_balance_rtt: 2 }
  ];
  const me = profiles.find((profile) => profile.id === "u-camille") || profiles[0];
  session = {
    user: {
      id: me.id,
      email: me.email,
      user_metadata: { full_name: me.full_name, name: me.full_name }
    }
  };
  appData.profile = me;
  appData.orgProfiles = profiles;
  appData.navVisibility = normalizeNavVisibility(loadStore("navVisibility", null));
  appData.studioCreators = normalizeStudioCreators(loadStore("studioCreators", ["camille.moreau@humaine.fr"]));
  teamPunchFilters = { start: "", end: "", userId: "", scope: "team", detailView: "punches" };
  appData.companyTimezone = loadStore("companyTimezone", "GMT+1") === "GMT" ? "GMT" : "GMT+1";
  appData.shiftHours = normalizeShiftHours(loadStore("shiftHours", defaultShiftHours()));
  appData.planningEntries = [];
  appData.edsPayroll = loadStore("edsPayroll", {});
  appData.delayReviews = [];
  saveStore("delayReviews", []);
  let demoNoShowKey = "";
  for (let daysAgo = 1; daysAgo <= 14; daysAgo += 1) {
    const probe = new Date();
    probe.setDate(probe.getDate() - daysAgo);
    const key = toDateKey(probe);
    if (isWorkingDayKey(key)) {
      demoNoShowKey = key;
      break;
    }
  }
  if (demoNoShowKey) {
    appData.planningEntries = [
      { id: "pl-demo-lea", user_id: "u-lea", work_date: demoNoShowKey, slot: 1, hours: 8, kind: "PR", source: "assign", created_by: "u-thomas", created_at: new Date().toISOString() },
      { id: "pl-demo-hugo", user_id: "u-hugo", work_date: demoNoShowKey, slot: 1, hours: 8, kind: "PR", source: "assign", created_by: "u-thomas", created_at: new Date().toISOString() }
    ];
  }
  const punches = [];
  profiles.forEach((profile, index) => {
    for (let daysAgo = 2; daysAgo >= 0; daysAgo -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - daysAgo);
      if ((profile.id === "u-lea" || profile.id === "u-hugo") && demoNoShowKey && toDateKey(day) === demoNoShowKey) continue;
      const stamp = (hour, minute) => {
        const value = new Date(day);
        value.setHours(hour, minute + index, 0, 0);
        return value.toISOString();
      };
      punches.push({ id: `${profile.id}-in-${daysAgo}`, user_id: profile.id, punch_type: "in", punched_at: stamp(profile.shift_code === "rnd" ? 9 : 8, 45), work_location: daysAgo === 1 ? "remote" : "onsite", work_status: "production", profiles: { full_name: profile.full_name, email: profile.email } });
      if (profile.id === "u-lea") {
        punches.push({ id: `${profile.id}-s1-${daysAgo}`, user_id: profile.id, punch_type: "status_change", punched_at: stamp(10, 20), work_status: "reunion", profiles: { full_name: profile.full_name } });
        punches.push({ id: `${profile.id}-s2-${daysAgo}`, user_id: profile.id, punch_type: "status_change", punched_at: stamp(11, 5), work_status: "production", profiles: { full_name: profile.full_name } });
      }
      if (profile.id === "u-hugo") {
        punches.push({ id: `${profile.id}-s1-${daysAgo}`, user_id: profile.id, punch_type: "status_change", punched_at: stamp(14, 10), work_status: "coaching", profiles: { full_name: profile.full_name } });
        punches.push({ id: `${profile.id}-s2-${daysAgo}`, user_id: profile.id, punch_type: "status_change", punched_at: stamp(15, 40), work_status: "production", profiles: { full_name: profile.full_name } });
      }
      if (profile.id === "u-thomas") {
        punches.push({ id: `${profile.id}-s1-${daysAgo}`, user_id: profile.id, punch_type: "status_change", punched_at: stamp(16, 0), work_status: "break", profiles: { full_name: profile.full_name } });
        punches.push({ id: `${profile.id}-s2-${daysAgo}`, user_id: profile.id, punch_type: "status_change", punched_at: stamp(16, 15), work_status: "production", profiles: { full_name: profile.full_name } });
      }
      punches.push({ id: `${profile.id}-b-${daysAgo}`, user_id: profile.id, punch_type: "break_start", punched_at: stamp(12, 10), profiles: { full_name: profile.full_name } });
      punches.push({ id: `${profile.id}-r-${daysAgo}`, user_id: profile.id, punch_type: "break_end", punched_at: stamp(13, 5), work_status: "production", profiles: { full_name: profile.full_name } });
      if (daysAgo !== 0 || profile.id !== me.id) {
        punches.push({ id: `${profile.id}-out-${daysAgo}`, user_id: profile.id, punch_type: "out", punched_at: stamp(18, 5), profiles: { full_name: profile.full_name } });
      }
    }
  });
  const teamIds = new Set([me.id, ...profiles.filter((profile) => profile.manager_id === me.id).map((profile) => profile.id)]);
  appData.teamPunches = punches.filter((row) => teamIds.has(row.user_id));
  appData.journalPunches = appData.teamPunches;
  appData.punches = punches.filter((row) => row.user_id === me.id);
  saveStore("punches", appData.punches.map((row) => ({
    type: row.punch_type,
    time: row.punched_at,
    workLocation: row.work_location || null,
    workStatus: row.work_status || null
  })));
  const nextWork = [];
  const probe = new Date();
  probe.setDate(probe.getDate() + 1);
  while (nextWork.length < 4) {
    const key = toDateKey(probe);
    if (isWorkingDayKey(key)) nextWork.push(key);
    probe.setDate(probe.getDate() + 1);
  }
  saveStore("leaveRequests", [{
    id: "leave-demo-1",
    userId: "u-lea",
    name: "Lea Martin",
    type: "Congés payés",
    start: toDateKey(new Date(Date.now() + 86400000 * 7)),
    end: toDateKey(new Date(Date.now() + 86400000 * 9)),
    days: 3,
    status: "A valider — Manager N+1",
    workflowStep: 1,
    created: new Date().toISOString()
  }, {
    id: "leave-demo-cp",
    userId: "u-hugo",
    name: "Hugo Petit",
    type: "Congés Payés",
    start: nextWork[0],
    end: nextWork[1],
    days: 2,
    status: "Validé",
    workflowStep: 2,
    created: new Date().toISOString()
  }, {
    id: "leave-demo-rc",
    userId: "u-lea",
    name: "Lea Martin",
    type: "Récupération",
    start: nextWork[0],
    end: nextWork[0],
    days: 1,
    status: "Approuve",
    workflowStep: 2,
    created: new Date().toISOString()
  }, {
    id: "leave-demo-de",
    userId: "u-thomas",
    name: "Thomas Bernard",
    type: "Déplacement",
    start: nextWork[2],
    end: nextWork[2],
    days: 1,
    status: "Validé",
    workflowStep: 2,
    created: new Date().toISOString()
  }]);
  const todayKey = toDateKey(new Date());
  saveStore("punchCorrections", [{
    id: "corr-demo-1",
    userId: "u-hugo",
    date: todayKey,
    time: "09:12",
    punchKind: "in",
    reason: "Oubli de badge à l'arrivée",
    status: "Approuve",
    reviewedBy: "u-camille",
    reviewedByName: "Camille Moreau",
    created: new Date().toISOString()
  }, {
    id: "corr-demo-2",
    userId: "u-lea",
    date: todayKey,
    time: "12:40",
    punchKind: "break_start",
    reason: "Pause déjeuner non pointée",
    status: "A valider",
    created: new Date().toISOString()
  }]);
  saveStore("overtimeRequests", [{
    id: "ot-demo-1",
    userId: "u-lea",
    date: todayKey,
    hours: 2,
    reason: "Cloture paie",
    status: "A valider",
    created: new Date().toISOString()
  }]);
  saveStore("activityEntries", [{
    id: "act-demo-1",
    userId: "u-nina",
    date: todayKey,
    hours: 1,
    category: "Formation",
    comment: "Onboarding produit",
    status: "A valider",
    created: new Date().toISOString()
  }]);
  saveStore("attestationRequests", [{
    id: "att-demo-1",
    userId: "u-hugo",
    kind: "attestation",
    type: "Attestation employeur",
    reason: "Dossier de location",
    status: "A valider",
    created: new Date().toISOString()
  }, {
    id: "oth-demo-1",
    userId: "u-lea",
    kind: "other",
    type: "Info assurance",
    reason: "Demande de tableau de garanties",
    status: "A valider",
    created: new Date().toISOString()
  }]);
  saveStore("salaryAdvanceRequests", [{
    id: "adv-demo-1",
    userId: "u-lea",
    kind: "advance",
    amount: 2000,
    reason: "Urgence familiale",
    requestedDate: toDateKey(new Date()),
    status: "A valider",
    created: new Date().toISOString()
  }]);
  teamPunchesInitialLoadDone = true;
  journalPunchesInitialLoadDone = true;
}

window.humanaStartDemo = function () {
  demoMode = true;
  supabaseClient = getSupabaseClient();
  ensureAppContainer();
  try { sessionStorage.setItem("humana_auth_boot", "1"); } catch (_) { /* ignore */ }
  showAuthBootScreen();
  hydrateDemoWorkspace();
  if (!mpaMode) {
    // Le mode démo doit rejoindre la page admin MPA (avec pages/*.js chargés).
    try { sessionStorage.setItem("humana_demo_mode", "1"); } catch (_) { /* ignore */ }
    window.location.href = pageHref("admin");
    return;
  }
  renderApp();
  hideAuthBootScreen();
};







/* HUMANA_PAGE_API_START */
(function publishHumanaPageApi() {
  const api = window.Humana || (window.Humana = {});
  api.pages = api.pages || {};
  Object.assign(api, {
    EVENT_TYPES,
    EVENT_VISIBILITIES,
    JOURNAL_COLUMNS,
    NAV_VISIBILITY_AUDIENCES,
    NAV_VISIBILITY_PAGES,
    PLANNING_DEPTS,
    attestationTypes,
    avatarForProfile,
    badge,
    balanceCard,
    buildEdsRows,
    buildGlobalDashboardData,
    buildOrgTree,
    buildPlanningModel,
    canEditEdsPayroll,
    canImportPlanning,
    canViewGlobal,
    canViewHrAlerts,
    canViewJournal,
    canViewPlanning,
    canViewReports,
    canViewTeamPunches,
    cardHeading,
    computeBreakDuration,
    computeWorkedHours,
    countOrgNodes,
    dayGreeting,
    downloadCsv,
    edsFilterMarkup,
    edsPeriodLabel,
    escapeHtml,
    eventLocalDateTimeValue,
    eventTypeMeta,
    eventVisibilityLabel,
    filterOrgTree,
    formatCountdown,
    formatDate,
    formatDuration,
    formatEventTimeShort,
    formatEventWhen,
    formatTime,
    formatTimeSeconds,
    getClockState,
    getClockStatusCopy,
    getCompanyEvents,
    getDefaultTeamPunchRange,
    getDirectReportProfiles,
    getEdsRange,
    getHrDocuments,
    getJournalProfiles,
    getJournalRange,
    getJournalSessions,
    getLeaveBalances,
    getLeaveRequests,
    getLeaveValidatorChain,
    getManagerChain,
    getNavVisibility,
    getOwnHrRequests,
    getPunches,
    getSalaryAdvanceQuota,
    getTeamPunchProfiles,
    getTeamPunchScope,
    getTodayPunches,
    getUserName,
    hasOrgWideAccess,
    hoursCard,
    hrRequestRows,
    isAdmin,
    isCreator,
    isFilterPanelOpen,
    isNavPageVisible,
    leaveChainLabel,
    leaveIsHoursUnit,
    leaveRows,
    leaveTypeOptionsHtml,
    otherRequestTypes,
    paginateList,
    pendingLeaveForValidator,
    privateFileLinkAttributes,
    profileById,
    punchTypeLabel,
    renderClockActions,
    renderClockStatus,
    renderCreatorAccountsSection,
    renderDateBadge,
    renderDayTimeline,
    renderEventDetailOverlay,
    renderGlobalDailyChart,
    renderGlobalDepartments,
    renderGlobalDonut,
    renderGlobalKpiCards,
    renderGlobalTopDelays,
    renderGtaClockTools,
    renderGtaSettingsSection,
    renderGtaTeamInbox,
    renderHomeEventsCard,
    renderHomeShiftSummary,
    renderHrAlertsCard,
    renderHrTeamFollowup,
    renderHrValidationInbox,
    renderJournalColumnMenu,
    renderJournalStatus,
    renderLeaveCalendar,
    renderOrgNode,
    renderPendingDelayInbox,
    renderPlanningAssignPanel,
    renderPlanningGaps,
    renderPlanningGrid,
    renderPlanningLog,
    renderProfilePyramidCard,
    renderPunchHistory,
    renderTablePager,
    renderTeamPunchDetailCard,
    renderUnjustifiedAbsenceInbox,
    renderUserAccountSection,
    renderWorkLocationBadge,
    renderWorkLocationSelector,
    resolveDailyRowWorkLocation,
    roleLabels,
    sanitizeEventPosterUrl,
    seniorityMonths,
    summarizeTeamPunchesByDay,
    summarizeTeamPunchesByUser,
    usesDatabase,
    visibleEdsColumns
  });
  Object.defineProperties(api, {
    appData: {
      enumerable: true,
      configurable: true,
      get() { return appData; },
      set(v) { appData = v; }
    },
    demoMode: {
      enumerable: true,
      configurable: true,
      get() { return demoMode; },
      set(v) { demoMode = v; }
    },
    hierarchySearch: {
      enumerable: true,
      configurable: true,
      get() { return hierarchySearch; },
      set(v) { hierarchySearch = v; }
    },
    journalColumnFilters: {
      enumerable: true,
      configurable: true,
      get() { return journalColumnFilters; },
      set(v) { journalColumnFilters = v; }
    },
    journalFilters: {
      enumerable: true,
      configurable: true,
      get() { return journalFilters; },
      set(v) { journalFilters = v; }
    },
    journalFullscreen: {
      enumerable: true,
      configurable: true,
      get() { return journalFullscreen; },
      set(v) { journalFullscreen = v; }
    },
    journalOpenColumn: {
      enumerable: true,
      configurable: true,
      get() { return journalOpenColumn; },
      set(v) { journalOpenColumn = v; }
    },
    journalSort: {
      enumerable: true,
      configurable: true,
      get() { return journalSort; },
      set(v) { journalSort = v; }
    },
    planningState: {
      enumerable: true,
      configurable: true,
      get() { return planningState; },
      set(v) { planningState = v; }
    },
    session: {
      enumerable: true,
      configurable: true,
      get() { return session; },
      set(v) { session = v; }
    },
    teamPunchFilters: {
      enumerable: true,
      configurable: true,
      get() { return teamPunchFilters; },
      set(v) { teamPunchFilters = v; }
    }
  });
})();
/* HUMANA_PAGE_API_END */

// Retarde initialize() jusqu'à ce que tous les scripts synchrones du HTML aient
// été exécutés (dont pages/<key>.js). Sans cela, un renderApp() déclenché dans
// initialize (portalMode, demoMode via flag, session Supabase déjà présente…)
// pourrait tirer avant que le registre window.Humana.pages soit peuplé.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
initialize();
}
})();
