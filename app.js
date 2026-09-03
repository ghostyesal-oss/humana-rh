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
let teamPunchFilters = { start: "", end: "", userId: "", scope: "all" };
let teamPunchesInitialLoadDone = false;
let journalFilters = { start: "", end: "", userId: "", query: "" };
let journalSort = { key: "connectedAt", dir: "desc" };
let journalColumnFilters = {};
let journalOpenColumn = "";
let journalPunchesInitialLoadDone = false;
let journalMetaColumnsEnabled = true;
let leaveCalendarMonth = null;
let initialAuthHandled = false;

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
  adminEditingId: "",
  adminEditingInviteId: ""
};

const roleLabels = {
  admin: "Administrateur",
  manager: "Manager",
  employee: "Collaborateur",
  creator: "Createur"
};

const NAV_VISIBILITY_PAGES = [
  { id: "leave", label: "Conges" },
  { id: "attestations", label: "Attestations" },
  { id: "hierarchy", label: "Hierarchie" },
  { id: "reports", label: "Rapports" },
  { id: "journal", label: "Journal" }
];

const NAV_VISIBILITY_AUDIENCES = [
  { id: "admin", label: "Administrateurs" },
  { id: "manager", label: "Managers" },
  { id: "employee", label: "Collaborateurs" }
];

function getDefaultNavVisibility() {
  return {
    leave: { admin: true, manager: true, employee: true },
    attestations: { admin: true, manager: true, employee: true },
    hierarchy: { admin: true, manager: true, employee: true },
    reports: { admin: true, manager: true, employee: true },
    journal: { admin: true, manager: false, employee: false }
  };
}

const pages = {
  home: ["Accueil", "Tout ce dont vous avez besoin, au meme endroit."],
  pointeuse: ["Pointeuse", "Enregistrez vos arrivees et vos departs."],
  journal: ["Journal", "Consultez l'historique des connexions et les details techniques."],
  leave: ["Conges", "Demandes, soldes, validations et justificatifs."],
  attestations: ["Attestations", "Demandez vos documents en quelques clics."],
  hierarchy: ["Hierarchie", "Votre manager, votre equipe, l'organigramme."],
  "team-punches": ["Pointages equipe", "Admin : tous les collaborateurs. Manager : son equipe directe."],
  reports: ["Rapports EDS", "Temps, absences, retards et extract paie du 21 au 20."],
  admin: ["Administration", "Gestion des comptes et des acces."],
  creator: ["Studio createur", "Controlez la visibilite des onglets par profil."]
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

function showAuthBootScreen() {
  document.documentElement.classList.add("auth-booting");
  const bootScreen = document.getElementById("auth-boot-screen");
  if (bootScreen) bootScreen.hidden = false;
}

function hideAuthBootScreen() {
  document.documentElement.classList.remove("auth-booting");
  const bootScreen = document.getElementById("auth-boot-screen");
  if (bootScreen) bootScreen.hidden = true;
  try {
    sessionStorage.removeItem("humana_auth_boot");
  } catch (_) {
    /* ignore */
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
  { key: "department", label: "Departement" },
  { key: "dateIn", label: "Date_Connexion" },
  { key: "timeIn", label: "Heure_Connexion" },
  { key: "dateOut", label: "Date_Deconnexion" },
  { key: "timeOut", label: "Heure_Deconnexion" },
  { key: "duration", label: "Duree_Session" },
  { key: "method", label: "Moyen_Connexion" },
  { key: "os", label: "Systeme_Exploitation" },
  { key: "browser", label: "Navigateur_Application" },
  { key: "ip", label: "Adresse_IP" },
  { key: "network", label: "Type_Reseau" },
  { key: "location", label: "Localisation" },
  { key: "status", label: "Statut_Connexion" },
  { key: "reason", label: "Raison_Deconnexion" }
];
const WORK_LOCATION_STORE_KEY = "workLocation";
const WORK_LOCATIONS = {
  onsite: "Sur site",
  remote: "Teletravail"
};

const ABSENCE_CODES = [
  { code: "Congés Payés", label: "Conges payes", key: "cp", group: "cp", attachment: false, grades: ["employee", "manager", "codir"] },
  { code: "Congés Payés Responsable Département", label: "Conges payes responsable departement", key: "cp", group: "cp", attachment: false, grades: ["manager", "codir"] },
  { code: "Congés Payés Management", label: "Conges payes management", key: "cp", group: "cp", attachment: false, grades: ["codir"] },
  { code: "Récupération", label: "Recuperation", key: "recup", group: "recup", attachment: false },
  { code: "Conge Maternite", label: "Conge maternite", key: "maternity", group: "family", attachment: true },
  { code: "Conges Paternite", label: "Conge paternite", key: "paternity", group: "family", attachment: true },
  { code: "Circoncision", label: "Circoncision", key: "special", group: "event", attachment: true },
  { code: "Décès 2 Jours", label: "Deces 2 jours", key: "special", group: "event", attachment: true, fixedDays: 2 },
  { code: "Décès 3 Jours", label: "Deces 3 jours", key: "special", group: "event", attachment: true, fixedDays: 3 },
  { code: "Mariage salarié", label: "Mariage salarie", key: "special", group: "event", attachment: true },
  { code: "Opération conjoint / Enfant", label: "Operation conjoint / enfant", key: "special", group: "event", attachment: true },
  { code: "Congé Sans Solde", label: "Conge sans solde", key: "unpaid", group: "unpaid", attachment: true },
  { code: "ABS JUSTTIFIER", label: "Absence justifiee", key: "justified", group: "admin", attachment: true },
  { code: "ABS INJUSTIFIER", label: "Absence injustifiee", key: "unjustified", group: "admin", attachment: false, adminOnly: true },
  { code: "Déplacement", label: "Deplacement", key: "travel", group: "work", attachment: false },
  { code: "RETARD", label: "Retard", key: "hours", group: "time", attachment: false, unit: "hours" },
  { code: "DEPART", label: "Depart anticipe", key: "hours", group: "time", attachment: false, unit: "hours" },
  { code: "MISE A PIED", label: "Mise a pied", key: "suspension", group: "admin", attachment: false, adminOnly: true }
];
const ABSENCE_GROUP_LABELS = {
  cp: "Conges payes",
  recup: "Recuperation",
  family: "Familial",
  event: "Evenements",
  unpaid: "Sans solde",
  admin: "Absences / mesures RH",
  work: "Deplacement",
  time: "Retard / depart"
};
const activityCategories = ["Production", "Reunion", "Formation", "Coaching", "Pause payee"];
const PUNCH_CORRECTION_QUOTA = 3;
const PUNCH_KIND_OPTIONS = [
  { value: "in", label: "Debut de shift (entree)" },
  { value: "break_start", label: "Pause in (debut pause)" },
  { value: "break_end", label: "Pause out (reprise)" },
  { value: "out", label: "Delogue du shift (sortie)" }
];
const PUNCH_CORRECTION_FIELDS = ["punch_kind", "reviewed_by", "reviewed_at"];
const SHIFT_PRESETS = {
  cs: {
    code: "cs",
    label: "CS / CES",
    start: "09:00",
    end: "18:00",
    lunchMin: 60,
    lunchFrom: "13:00",
    lunchTo: "15:00",
    plannedHours: 8,
    lateAfter: "09:30",
    earliestEnd: "18:00"
  },
  rnd: {
    code: "rnd",
    label: "R&D",
    start: "10:00",
    end: "19:00",
    lunchMin: 60,
    lunchFrom: "13:00",
    lunchTo: "15:00",
    plannedHours: 8,
    lateAfter: "10:00",
    earliestEnd: "18:00"
  }
};
const FR_HOLIDAYS_2026 = ["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"];
const MA_HOLIDAYS_2026 = ["2026-01-01", "2026-01-11", "2026-05-01", "2026-07-30", "2026-08-14", "2026-08-20", "2026-08-21", "2026-11-06", "2026-11-18"];
const RAMADAN_2026 = { start: "2026-02-18", end: "2026-03-19" };
const LEAVE_ACCRUAL = { employee: 1.5, manager: 2, codir: 2.5 };
const attestationTypes = [
  "Attestation employeur",
  "Certificat de travail",
  "Attestation de salaire",
  "Attestation de conges"
];

const avatarColors = ["violet", "blue", "orange", "green", "pink"];

function avatar(initials, color = "violet", extraClass = "") {
  const classes = ["avatar", color, extraClass].filter(Boolean).join(" ");
  return `<span class="${classes}">${initials}</span>`;
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
  if (profile.role === "creator") parts.push("Createur");
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
    ? `<button type="button" class="org-expand" data-org-toggle="${toggleId}" aria-expanded="${!collapsed}" aria-label="Afficher ou masquer l'equipe de ${escapeHtml(profile.full_name || "ce manager")}">
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

function isCreator() {
  if (demoMode) return true;
  if (appData.profile?.role === "creator") return true;
  const email = session?.user?.email?.toLowerCase();
  return Boolean(email && getStudioCreatorEmails().includes(email));
}

function isAdmin() {
  if (demoMode) return true;
  const role = appData.profile?.role;
  return role === "admin" || role === "creator";
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
  if (isAdmin()) pills.push(`<span class="admin-pill">Admin</span>`);
  if (isCreator()) pills.push(`<span class="creator-pill">Createur</span>`);
  return pills.join("");
}

function getNavAudienceRole() {
  const role = appData.profile?.role || "employee";
  if (role === "admin" || role === "creator") return "admin";
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

function ensureAccessiblePage() {
  if (currentPage === "creator" && !isCreator()) {
    currentPage = "home";
    return;
  }
  if (currentPage === "admin" && !isAdmin()) {
    currentPage = "home";
    return;
  }
  if (currentPage === "reports" && !canViewReports()) {
    currentPage = "home";
    return;
  }
  if (currentPage === "journal" && !canViewJournal()) {
    currentPage = "home";
    return;
  }
  if (!isNavPageVisible(currentPage)) {
    currentPage = "home";
  }
}

function hasDirectReports() {
  return appData.orgProfiles.some((profile) => profile.manager_id === session?.user?.id);
}

function canViewJournal() {
  return Boolean(session?.user) && isNavPageVisible("journal");
}

function canViewTeamPunches() {
  return demoMode || (usesDatabase() && (isAdmin() || hasDirectReports()));
}

function canViewReports() {
  return Boolean(session?.user) && isNavPageVisible("reports");
}

function canViewTeamLeaveCalendar() {
  return usesDatabase() && (isAdmin() || hasDirectReports());
}

function getDirectReportProfiles() {
  return appData.orgProfiles.filter((profile) => profile.manager_id === session?.user?.id);
}

function getTeamPunchScope() {
  if (!isAdmin()) return "team";
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
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
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

function isMissingWorkLocationColumnError(error) {
  const message = (error?.message || "").toLowerCase();
  return message.includes("work_location") && (
    message.includes("does not exist")
    || message.includes("column")
    || message.includes("schema cache")
  );
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

async function insertTimePunch(payload) {
  const attempt = journalMetaColumnsEnabled ? { ...payload } : stripJournalMetaFields(payload);
  const { error } = await supabaseClient.from("time_punches").insert(attempt);
  if (!error) return;

  if (payload.work_location && isMissingWorkLocationColumnError(error)) {
    const migrationError = new Error("work_location column missing");
    migrationError.details = error.message;
    throw migrationError;
  }

  if (journalMetaColumnsEnabled && isMissingJournalColumnError(error)) {
    journalMetaColumnsEnabled = false;
    appData.journalMetaMissing = true;
    const retry = await supabaseClient.from("time_punches").insert(stripJournalMetaFields(attempt));
    if (!retry.error) return;
    throw retry.error;
  }

  throw error;
}

const LEAVE_GTA_FIELDS = ["unit", "half_day", "hours", "motif", "attachment_name", "workflow_step"];
const PROFILE_GTA_FIELDS = ["hired_at", "shift_code", "leave_grade"];
const GTA_KINDS = {
  corrections: { store: "punchCorrections", table: "punch_corrections" },
  overtime: { store: "overtimeRequests", table: "overtime_requests" },
  activity: { store: "activityEntries", table: "activity_entries" }
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
  if (isAdmin()) return true;
  return getDirectReportProfiles().some((profile) => profile.id === userId);
}

function pendingGtaItems(list) {
  return (list || []).filter((item) => String(item.status || "").toLowerCase().includes("valider"));
}

function normalizeTeamPunchRow(row) {
  const profile = row.profiles || profileById(row.user_id);
  return {
    id: row.id,
    userId: row.user_id,
    type: row.punch_type,
    time: row.punched_at,
    workLocation: row.work_location || null,
    name: profile?.full_name || "Collaborateur",
    email: profile?.email || ""
  };
}

function computeWorkedMsInRange(punches, startStr, endStr) {
  const rangeStart = new Date(`${startStr}T00:00:00`).getTime();
  const rangeEnd = new Date(`${endStr}T23:59:59`).getTime();
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  let total = 0;
  let workStart = null;

  sorted.forEach((punch) => {
    const time = new Date(punch.time).getTime();
    if (punch.type === "in" || punch.type === "break_end") {
      workStart = time;
      return;
    }
    if (punch.type === "break_start" && workStart !== null) {
      const sessionStart = Math.max(workStart, rangeStart);
      const sessionEnd = Math.min(time, rangeEnd);
      if (sessionEnd > sessionStart) total += sessionEnd - sessionStart;
      workStart = null;
      return;
    }
    if (punch.type === "out" && workStart !== null) {
      const sessionStart = Math.max(workStart, rangeStart);
      const sessionEnd = Math.min(time, rangeEnd);
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
    const dayKey = toDateKey(new Date(normalized.time));
    if (dayKey < startStr || dayKey > endStr) return;

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
      type: normalized.type,
      time: normalized.time,
      workLocation: normalized.workLocation
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
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
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
    alert("Aucun pointage a exporter pour cette periode.");
    return;
  }

  downloadCsv(
    `pointages-equipe_${range.start}_${range.end}.csv`,
    ["Matricule", "Nom", "Email", "Manager", "Date", "Lieu", "Debut", "Fin", "Pause dej", "Planifie", "Realise", "Retard min", "Manquant", "HS payables", "Log shift", "Heure rectifiee", "Modifie par", "Motif"],
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

  let query = supabaseClient
    .from("time_punches")
    .select("*, profiles(full_name, email)")
    .order("punched_at", { ascending: false });

  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  } else if (!isAdmin() || scope === "team") {
    query = query.in("user_id", userIds);
  }

  if (filters.start) query = query.gte("punched_at", `${filters.start}T00:00:00`);
  if (filters.end) query = query.lte("punched_at", `${filters.end}T23:59:59`);

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
    motif: row.motif,
    attachmentName: row.attachment_name || row.attachmentName,
    workflowStep: row.workflow_step || row.workflowStep || 1,
    comment: row.comment || "",
    status: row.status,
    created: row.created_at || row.created,
    name: row.profiles?.full_name || row.name || profileById(row.user_id || row.userId)?.full_name || "Collaborateur"
  };
}

async function loadTeamLeaveRequests(monthRef = getLeaveCalendarMonth()) {
  if (!canViewTeamLeaveCalendar()) {
    appData.teamLeaveRequests = [];
    return [];
  }

  const { year, month } = monthRef;
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const userIds = isAdmin()
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
      .order("start_date", { ascending: true });
    if (response.error && errorMentionsAny(response.error, LEAVE_GTA_FIELDS)) {
      response = await supabaseClient
        .from("leave_requests")
        .select(baseSelect)
        .lte("start_date", monthEnd)
        .gte("end_date", monthStart)
        .in("user_id", userIds)
        .order("start_date", { ascending: true });
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
  const teamLabel = isAdmin() ? "toute l'organisation" : "votre equipe";

  const dayCells = cells.map((date) => {
    if (!date) return `<div class="leave-cal-cell leave-cal-cell--empty" aria-hidden="true"></div>`;

    const key = toDateKey(date);
    const events = getLeaveEventsForDay(key, requests);
    const hasConflict = teamScope && events.length >= 2;
    const isToday = key === todayKey;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    return `
      <div class="leave-cal-cell${isToday ? " is-today" : ""}${hasConflict ? " has-conflict" : ""}${isWeekend ? " is-weekend" : ""}" data-date="${key}">
        <span class="leave-cal-day">${date.getDate()}</span>
        <div class="leave-cal-events">
          ${events.slice(0, 3).map((event) => `
            <span class="leave-cal-event ${leaveTypeColorClass(event.type)}${event.status === "A valider" ? " is-pending" : ""}"
              title="${escapeHtml(event.name)} · ${escapeHtml(event.type)} · ${formatDate(event.start)} - ${formatDate(event.end)}">
              ${escapeHtml((event.name || "Conge").split(" ")[0])}
            </span>`).join("")}
          ${events.length > 3 ? `<span class="leave-cal-more">+${events.length - 3}</span>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <article class="card leave-calendar-card page-spacer">
      <div class="card-heading leave-cal-heading">
        <h3>${teamScope ? `Calendrier des conges — ${teamLabel}` : "Calendrier des conges"}</h3>
        <div class="leave-cal-nav">
          <button type="button" class="outline-button leave-cal-prev" aria-label="Mois precedent">‹</button>
          <strong class="leave-cal-month">${monthLabel}</strong>
          <button type="button" class="outline-button leave-cal-next" aria-label="Mois suivant">›</button>
          <button type="button" class="outline-button leave-cal-today">Aujourd'hui</button>
        </div>
      </div>
      ${teamScope
        ? `<p class="leave-cal-note">Les jours en surbrillance signalent plusieurs absences simultanees pour anticiper les conflits.</p>`
        : ""}
      <div class="leave-cal-grid" role="grid" aria-label="Calendrier des conges">
        ${weekdays.map((weekday) => `<div class="leave-cal-weekday" role="columnheader">${weekday}</div>`).join("")}
        ${dayCells}
      </div>
      <div class="leave-cal-legend">
        <span class="leave-cal-legend-item"><i class="leave-type-cp"></i> Conges payes</span>
        <span class="leave-cal-legend-item"><i class="leave-type-special"></i> Evenements</span>
        <span class="leave-cal-legend-item"><i class="leave-type-rtt"></i> Recuperation</span>
        <span class="leave-cal-legend-item"><i class="leave-type-sick"></i> Justifiee / familial</span>
        <span class="leave-cal-legend-item"><i class="leave-type-unpaid"></i> Sans solde / mise a pied</span>
        <span class="leave-cal-legend-item"><i class="leave-type-unjustified"></i> Injustifiee</span>
        <span class="leave-cal-legend-item leave-cal-legend-pending"><i></i> En attente</span>
        ${teamScope ? `<span class="leave-cal-legend-item leave-cal-legend-conflict"><i></i> Conflit equipe</span>` : ""}
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
  return usesDatabase() && (isAdmin() || hasDirectReports());
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

  const punchesRes = await supabaseClient
    .from("time_punches")
    .select("*")
    .eq("user_id", session.user.id)
    .order("punched_at", { ascending: true });
  if (!punchesRes.error) appData.punches = punchesRes.data || [];
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
    .replace(/"/g, "&quot;");
}

function getNavigationItems() {
  const items = navigation.filter(([pageId]) => isNavPageVisible(pageId));
  const pointeuseIndex = items.findIndex(([pageId]) => pageId === "pointeuse");
  if (canViewTeamPunches()) {
    items.splice(pointeuseIndex + 1, 0, ["team-punches", "Pointages equipe"]);
  }
  if (canViewReports()) {
    const teamIndex = items.findIndex(([pageId]) => pageId === "team-punches");
    const after = teamIndex >= 0 ? teamIndex : items.findIndex(([pageId]) => pageId === "pointeuse");
    items.splice((after >= 0 ? after : items.length - 1) + 1, 0, ["reports", "Rapports EDS"]);
  }
  if (canViewJournal()) {
    items.push(["journal", "Journal"]);
  }
  if (isAdmin()) {
    items.push(["admin", "Administration"]);
  }
  if (isCreator()) items.push(["creator", "Studio createur"]);
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

function getUserAccountEditing() {
  return {
    editingId: appData.adminEditingId || "",
    editingInviteId: appData.adminEditingInviteId || ""
  };
}

function clearUserAccountEditing() {
  appData.adminEditingId = "";
  appData.adminEditingInviteId = "";
}

function setUserAccountEditing({ profileId = "", inviteId = "" }) {
  appData.adminEditingId = profileId;
  appData.adminEditingInviteId = inviteId;
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
      throw new Error("Cette personne est deja createur.");
    }
    if (!usesDatabase()) {
      existing.role = "admin";
    } else {
      const { error } = await supabaseClient.from("profiles").update(payload).eq("id", existing.id);
      if (error) throw error;
    }
  } else if (!usesDatabase()) {
    if (getPendingCreatorInvites().some((invite) => invite.email?.toLowerCase() === normalizedEmail)) {
      throw new Error("Une invitation createur existe deja pour cette adresse e-mail.");
    }
    appData.pendingInvites.push({
      email: normalizedEmail,
      ...payload,
      created_by: session.user.id
    });
  } else {
    if (getPendingCreatorInvites().some((invite) => invite.email?.toLowerCase() === normalizedEmail)) {
      throw new Error("Une invitation createur existe deja pour cette adresse e-mail.");
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
      ${cardHeading("Comptes createur")}
      <p class="creator-intro">Votre compte createur reste actif. Ajoutez ici un second acces createur : la personne aura le role <strong>Administrateur</strong> et l'acces Studio createur.</p>
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
              ? `<tr><td colspan="3" class="empty-cell">Aucun compte createur pour le moment.</td></tr>`
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
            <input type="text" name="full_name" required placeholder="Prenom Nom">
          </label>
        </div>
        <button type="submit" class="primary">Ajouter un compte createur</button>
      </form>
      <p class="hierarchy-meta">Si la personne n'a jamais connecte Humana, elle sera pre-enregistree comme administrateur createur. Sinon, son profil existant sera promu administrateur createur.</p>
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
      alert("Votre compte est deja createur.");
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
  return {
    email: String(data.get("email") || "").trim().toLowerCase(),
    profileId: String(data.get("profile_id") || ""),
    inviteId: String(data.get("invite_id") || ""),
    payload: {
      full_name: String(data.get("full_name") || "").trim(),
      job_title: String(data.get("job_title") || "Collaborateur").trim(),
      department: String(data.get("department") || "General").trim(),
      role: String(data.get("role") || "employee"),
      manager_id: String(data.get("manager_id") || "") || null,
      leave_balance_cp: Number(data.get("leave_balance_cp") || 25),
      leave_balance_rtt: Number(data.get("leave_balance_rtt") || 0),
      hired_at: String(data.get("hired_at") || "") || null,
      shift_code: String(data.get("shift_code") || "cs"),
      leave_grade: String(data.get("leave_grade") || "employee")
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
  if (profileId) {
    if (profileId === session.user.id && payload.role !== "admin" && appData.profile?.role === "admin") {
      const adminCount = appData.orgProfiles.filter((profile) => profile.role === "admin").length;
      if (adminCount <= 1) {
        throw new Error("Vous etes le dernier administrateur. Ajoutez un autre admin avant de modifier votre role.");
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

function renderUserAccountSection() {
  const { editingId, editingInviteId } = getUserAccountEditing();
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
          </div>
          <div class="form-row">
            <label>
              Date d'entree
              <input type="date" name="hired_at" value="${escapeHtml(editing?.hired_at || "")}">
            </label>
            <label>
              Vacation
              <select name="shift_code">
                <option value="cs"${(editing?.shift_code || "cs") === "cs" ? " selected" : ""}>CS / CES 09h-18h</option>
                <option value="rnd"${editing?.shift_code === "rnd" ? " selected" : ""}>R&amp;D 10h FR</option>
              </select>
            </label>
          </div>
          <label>
            Grade conges
            <select name="leave_grade">
              <option value="employee"${(editing?.leave_grade || "employee") === "employee" ? " selected" : ""}>Collaborateur — 1,5 j/mois</option>
              <option value="manager"${editing?.leave_grade === "manager" ? " selected" : ""}>Responsable — 2 j/mois</option>
              <option value="codir"${editing?.leave_grade === "codir" ? " selected" : ""}>CODIR — 2,5 j/mois</option>
            </select>
          </label>
          <div class="admin-form-actions">
            <button type="submit" class="primary">${editing ? "Enregistrer" : "Ajouter"}</button>
            ${editing ? `<button type="button" id="admin-cancel-edit" class="outline-button">Annuler</button>` : ""}
          </div>
        </form>
        <p class="hierarchy-meta">Si la personne n'a jamais connecte Humana, elle sera pre-enregistree. A la premiere connexion Microsoft, son compte sera cree automatiquement.</p>
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

function bindUserAccountSection() {
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

function formatTimeSeconds(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getPunches() {
  if (usesDatabase()) {
    return appData.punches.map((punch) => ({
      type: punch.punch_type,
      time: punch.punched_at,
      workLocation: punch.work_location || null
    }));
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
      type: request.document_type,
      reason: request.reason,
      status: request.status,
      created: request.created_at
    }));
  }
  return loadStore("attestationRequests", []);
}

function countPendingLeave() {
  return getLeaveRequests().filter((item) => String(item.status || "").toLowerCase().includes("valider")).length;
}

function countPendingAttestations() {
  return getAttestationRequests().filter((item) => item.status === "En attente").length;
}

function navBadge(page) {
  if (page === "home" && canViewHrAlerts() && countUnreadHrAlerts()) {
    return `<span class="nav-badge">${countUnreadHrAlerts()}</span>`;
  }
  if (page === "leave" && countPendingLeave()) return `<span class="nav-badge">${countPendingLeave()}</span>`;
  if (page === "attestations" && countPendingAttestations()) return `<span class="nav-badge">${countPendingAttestations()}</span>`;
  return "";
}

function parseClientEnvironment() {
  const uaData = navigator.userAgentData;
  const ua = navigator.userAgent || "";
  let os = uaData?.platform || "Inconnu";
  if (!uaData?.platform) {
    if (/Windows NT 10/i.test(ua)) os = "Windows 10/11";
    else if (/Windows/i.test(ua)) os = "Windows";
    else if (/Mac OS X/i.test(ua)) os = "macOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Linux/i.test(ua)) os = "Linux";
  } else if (/Win/i.test(os)) os = "Windows";
  else if (/Mac/i.test(os)) os = "macOS";

  let browser = "Navigateur";
  const brands = uaData?.brands || [];
  const brand = brands.find((item) => item.brand && !/not.?a.?brand/i.test(item.brand) && !/chromium/i.test(item.brand));
  if (brand?.brand) browser = brand.brand;
  else if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Google Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Mozilla Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";

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

async function getPublicIpAddress() {
  try {
    const cached = sessionStorage.getItem("humana_public_ip");
    if (cached) return cached;
  } catch {
    /* ignore */
  }

  const withTimeout = async (factory, ms = 1500) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await factory(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  const sources = [
    async (signal) => {
      const response = await fetch("https://api.ipify.org?format=json", { signal });
      const data = await response.json();
      return data?.ip || "";
    },
    async (signal) => {
      const response = await fetch("https://ipv4.icanhazip.com", { signal });
      return (await response.text()).trim();
    },
    async (signal) => {
      const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal });
      const text = await response.text();
      const match = text.match(/^ip=([^\s]+)$/m);
      return match ? match[1] : "";
    }
  ];

  for (const source of sources) {
    try {
      const ip = (await withTimeout(source)).replace(/[^0-9a-fA-F:.]/g, "");
      if (ip) {
        try { sessionStorage.setItem("humana_public_ip", ip); } catch { /* ignore */ }
        return ip;
      }
    } catch {
      /* essayer la source suivante */
    }
  }
  return "";
}

async function collectJournalMeta() {
  const env = parseClientEnvironment();
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const high = await navigator.userAgentData.getHighEntropyValues(["platformVersion"]);
      if (/Windows/i.test(env.os) && high?.platformVersion) {
        const major = parseInt(String(high.platformVersion).split(".")[0], 10);
        if (!Number.isNaN(major)) env.os = major >= 13 ? "Windows 11" : "Windows 10";
      }
    }
  } catch {
    /* hints optionnels */
  }
  const ip = await getPublicIpAddress();
  return { ...env, ip };
}

function applyJournalMetaToPayload(payload, meta, punchType) {
  if (!meta || !journalMetaColumnsEnabled) return payload;
  if (punchType === "in") {
    payload.connection_method = meta.method;
    payload.operating_system = meta.os;
    payload.browser_application = meta.browser;
    if (meta.ip) payload.ip_address = meta.ip;
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
    punch.ip_address = meta.ip || "";
    punch.network_type = meta.network;
    punch.method = meta.method;
    punch.os = meta.os;
    punch.browser = meta.browser;
    punch.ip = meta.ip || "";
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

function punchTypeLabel(type) {
  switch (type) {
    case "in": return "Debut de shift";
    case "out": return "Delogue du shift";
    case "break_start": return "Pause in";
    case "break_end": return "Pause out";
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
    ["Debut", pick("in")],
    ["Pause in", pick("break_start")],
    ["Pause out", pick("break_end")],
    ["Delogue", lastOut]
  ];
  return `<div class="punch-log">${lines.map(([label, punch]) => (
    `<span><b>${label}</b> ${punch ? formatTime(punch.time) : (label === "Delogue" && row.hasStarted && !row.isDayClosed ? "en cours" : "—")}</span>`
  )).join("")}</div>`;
}

function formatDayPunchLogText(row) {
  const punches = [...(row.punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
  const pick = (type) => punches.find((punch) => punch.type === type);
  const lastOut = [...punches].reverse().find((punch) => punch.type === "out");
  return [
    `Debut ${pick("in") ? formatTime(pick("in").time) : "—"}`,
    `Pause in ${pick("break_start") ? formatTime(pick("break_start").time) : "—"}`,
    `Pause out ${pick("break_end") ? formatTime(pick("break_end").time) : "—"}`,
    `Delogue ${lastOut ? formatTime(lastOut.time) : (row.hasStarted && !row.isDayClosed ? "en cours" : "—")}`
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
        <button type="button" class="work-location-option${selected === "remote" ? " is-active" : ""}" data-work-location="remote">Teletravail</button>
      </div>
    </div>`;
}

function buildClockPunchPayload(punchType) {
  const payload = {
    user_id: session.user.id,
    punch_type: punchType,
    punched_at: new Date().toISOString()
  };
  if (punchType === "in") payload.work_location = getPreferredWorkLocation();
  return payload;
}

function buildDemoClockPunch(punchType) {
  const punch = { type: punchType, time: new Date().toISOString() };
  if (punchType === "in") punch.workLocation = getPreferredWorkLocation();
  return punch;
}

function computeWorkedHours(punches) {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const now = Date.now();
  const sessions = [];
  let workStart = null;

  sorted.forEach((punch) => {
    const time = new Date(punch.time).getTime();
    if (punch.type === "in" || punch.type === "break_end") {
      workStart = time;
      return;
    }
    if (punch.type === "break_start" && workStart !== null) {
      sessions.push({ start: workStart, end: time });
      workStart = null;
      return;
    }
    if (punch.type === "out" && workStart !== null) {
      sessions.push({ start: workStart, end: time });
      workStart = null;
    }
  });

  if (workStart !== null) {
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
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const now = Date.now();
  let breakStart = null;
  let total = 0;

  sorted.forEach((punch) => {
    const time = new Date(punch.time).getTime();
    if (fromTime && time < fromTime.getTime()) return;

    if (punch.type === "break_start") {
      breakStart = time;
      return;
    }

    if ((punch.type === "break_end" || punch.type === "out") && breakStart !== null) {
      total += time - breakStart;
      breakStart = null;
    }
  });

  if (breakStart !== null) total += now - breakStart;
  return total;
}

function getTodayShiftSummary(punches = getPunches()) {
  const todayPunches = getTodayPunches(punches);
  const sorted = [...todayPunches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const startPunch = sorted.find((punch) => punch.type === "in");
  const breakStartPunch = sorted.find((punch) => punch.type === "break_start");
  const breakEndPunch = sorted.find((punch) => punch.type === "break_end");
  const endPunch = [...sorted].reverse().find((punch) => punch.type === "out");
  const lastToday = sorted[sorted.length - 1];

  return {
    startTime: startPunch?.time || null,
    breakStart: breakStartPunch?.time || null,
    breakEnd: breakEndPunch?.time || null,
    endTime: endPunch?.time || null,
    breakDurationMs: computeBreakDuration(todayPunches),
    onBreak: lastToday?.type === "break_start",
    isWorking: lastToday?.type === "in" || lastToday?.type === "break_end",
    isDayClosed: lastToday?.type === "out",
    hasStarted: Boolean(startPunch)
  };
}

function formatShiftTime(value) {
  return value ? formatTime(value) : "—";
}

function formatBreakSummary(summary) {
  if (!summary.breakStart) return "—";
  if (summary.onBreak) return `${formatTime(summary.breakStart)} - en cours`;
  if (summary.breakEnd) return `${formatTime(summary.breakStart)} - ${formatTime(summary.breakEnd)}`;
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
    <div class="home-shift-summary" aria-label="Resume de la journee">
      <div class="home-shift-item">
        <span>Debut</span>
        <strong>${formatShiftTime(summary.startTime)}</strong>
      </div>
      <div class="home-shift-item">
        <span>Pause dej</span>
        <strong>${formatBreakSummary(summary)}</strong>
      </div>
      <div class="home-shift-item">
        <span>Fin de shift</span>
        <strong>${formatEndShiftSummary(summary)}</strong>
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

function addWorkingDaysKey(start, count) {
  const cursor = parseLocalDate(start);
  if (Number.isNaN(cursor.getTime()) || count < 1) return start;
  let remaining = count;
  while (!isWorkingDayKey(toDateKey(cursor))) {
    cursor.setDate(cursor.getDate() + 1);
  }
  remaining -= 1;
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDayKey(toDateKey(cursor))) remaining -= 1;
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
  const recup = recoveryDaysForYear();
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
      label: "Conges payes",
      total: totals.cp,
      used: used.cp,
      pending: pending.cp,
      remaining: remainingCp,
      hint: `${LEAVE_ACCRUAL[getLeaveGrade(profile)]} j / mois · ${getLeaveGrade(profile)}`
    },
    {
      label: "Recuperation",
      total: totals.recup,
      used: used.recup,
      pending: pending.recup,
      remaining: Math.max(0, totals.recup - used.recup - pending.recup),
      hint: "Ecart fériés FR vs MA"
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
      ${balance.hint ? `<small class="hierarchy-meta">${escapeHtml(balance.hint)}</small>` : ""}
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
  const today = new Date().toDateString();
  return punches.filter((punch) => new Date(punch.time).toDateString() === today);
}

function getClockStatusCopy() {
  const { isWorking, onBreak } = getClockState();
  const hasToday = getTodayPunches().length > 0;

  if (onBreak) {
    return {
      title: "Pause dejeuner",
      hint: "Votre pause est enregistree. Cliquez sur Reprise dej pour continuer.",
      tone: "break",
      homeLine: "En pause dejeuner"
    };
  }

  if (isWorking) {
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

function renderClockActions() {
  const { isWorking, onBreak, isOut } = getClockState();

  if (isOut) {
    return `<button type="button" id="clock-toggle" class="clock-button in">J'arrive</button>`;
  }

  if (onBreak) {
    return `
      <div class="clock-actions">
        <button type="button" id="break-toggle" class="clock-button break-end">Reprise dej</button>
        <button type="button" id="clock-toggle" class="clock-button out clock-button-secondary">Je pars</button>
      </div>`;
  }

  return `
    <div class="clock-actions">
      <button type="button" id="break-toggle" class="clock-button break-start">Pause dej</button>
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
      ${canViewHrAlerts() ? renderHrAlertsCard() : ""}
      <article class="card home-widget">
        <div class="card-heading">
          <h3>Ma journee</h3>
          <button type="button" class="home-link" data-goto-page="pointeuse">Historique</button>
        </div>
        <div class="home-clock">
          ${renderClockStatus(clockStatus, "home-clock-status")}
          ${renderHomeShiftSummary()}
          <p class="home-hours-today">Temps aujourd'hui : <b>${formatDuration(hours.today)}</b></p>
          ${renderWorkLocationSelector()}
          ${renderClockActions()}
        </div>
      </article>

      ${isNavPageVisible("leave") ? `
      <article class="card home-widget">
        <div class="card-heading">
          <h3>Conges</h3>
          <button type="button" class="home-link" data-goto-page="leave">Faire une demande</button>
        </div>
        <div class="home-balance-list">
          ${balances.map((balance) => homeBalanceSummary(balance)).join("")}
        </div>
      </article>` : ""}

      ${canViewReports() ? `
      <article class="card home-widget">
        <div class="card-heading">
          <h3>Rapports EDS</h3>
          <button type="button" class="home-link" data-goto-page="reports">Ouvrir</button>
        </div>
        <p class="hierarchy-meta">Cycle paie du 21 au 20 : temps planifie, realise, retards, absences. Export CSV pour la paie.</p>
      </article>` : ""}

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

function renderGtaClockTools() {
  const shift = getActiveShift();
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
    <p class="data-note">Vacation ${escapeHtml(shift.label)} · arrivee toleree jusqu'a ${shift.lateAfter} · ${shift.plannedHours} h planifiees · decalage FR/MA ${getFrMaOffsetHours()} h</p>
    <section class="hours-grid">
      ${hoursCard("Planifie", stats.plannedMs)}
      ${hoursCard("Manquant", stats.missingMs)}
      ${hoursCard("HS payables", stats.payableOtMs)}
    </section>
    <div class="feature-grid page-spacer">
      <article class="card form-card">
        ${cardHeading("Correction de pointage")}
        <p class="hierarchy-meta">Quota : ${remaining}/${PUNCH_CORRECTION_QUOTA} demandes ce mois. Le manager confirme, le Traffic Manager applique.</p>
        <form id="punch-correction-form" class="feature-form">
          <label>Date <input type="date" name="date" value="${today}" required></label>
          <label>Point a rectifier
            <select name="punch_kind" required>
              ${PUNCH_KIND_OPTIONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("")}
            </select>
          </label>
          <label>Heure demandee <input type="time" name="time" required></label>
          <label>Motif <textarea name="reason" rows="2" required placeholder="Oubli de badge, pause non pointee..."></textarea></label>
          <button type="submit" class="primary" ${remaining ? "" : "disabled"}>Signaler l'anomalie</button>
        </form>
      </article>
      <article class="card form-card">
        ${cardHeading("Heures supplementaires")}
        <p class="hierarchy-meta">Sans validation prealable, les heures extra ne sont pas payees.</p>
        <form id="overtime-form" class="feature-form">
          <label>Date <input type="date" name="date" value="${today}" required></label>
          <label>Heures <input type="number" name="hours" min="0.5" step="0.5" value="1" required></label>
          <label>Motif <textarea name="reason" rows="2" required></textarea></label>
          <button type="submit" class="primary">Demander validation</button>
        </form>
      </article>
      <article class="card form-card">
        ${cardHeading("Feuille de temps / statuts")}
        <form id="activity-form" class="feature-form">
          <label>Date <input type="date" name="date" value="${today}" required></label>
          <label>Categorie
            <select name="category">${activityCategories.map((item) => `<option>${item}</option>`).join("")}</select>
          </label>
          <label>Heures <input type="number" name="hours" min="0.5" step="0.5" value="1" required></label>
          <label>Commentaire <input type="text" name="comment" placeholder="Reunion, formation..."></label>
          <button type="submit" class="primary">Declarer</button>
        </form>
      </article>
    </div>
    ${renderGtaOwnLists()}`;
}

function renderGtaStatusRows(items, emptyLabel, extraCell) {
  const rows = items.slice(0, 8);
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
  ].slice(0, 10);
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Mes demandes GTA</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Type</th><th>Date</th><th>Detail</th><th>Statut</th></tr></thead>
          <tbody>
            ${rows.length
              ? rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.kind)}</td>
                  <td>${formatDate(row.date)}</td>
                  <td>${escapeHtml(row.detail)}</td>
                  <td>${badge(row.status)}</td>
                </tr>`).join("")
              : `<tr><td colspan="4" class="empty-cell">Aucune demande de correction, HS ou activite.</td></tr>`}
          </tbody>
        </table>
      </div>
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
  return `
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Validations GTA</h3></div>
      <p class="hierarchy-meta">Corrections de pointage, heures supplementaires et feuilles de temps. M-Work n'est pas connecte.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Date</th><th>Demande</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${renderGtaStatusRows(pending, "Aucune demande a valider.", (item) => {
              if (item._kind === "corrections") return `${formatPunchKind(item.punch_kind || item.punchKind)} ${item.time || item.requested_time || ""} — ${item.reason || ""}`;
              if (item._kind === "overtime") return `HS ${item.hours || 0} h — ${item.reason || ""}`;
              return `${item.category || "Activite"} · ${item.hours || 0} h`;
            })}
          </tbody>
        </table>
      </div>
    </article>`;
}

function pointeusePage() {
  const { punches } = getClockState();
  const clockStatus = getClockStatusCopy();
  const hours = computeWorkedHours(punches);
  const todayPunches = getTodayPunches(punches);
  const breakDuration = computeBreakDuration(todayPunches);
  const dbNote = usesDatabase()
    ? ""
    : `<p class="data-note demo">Mode demo : donnees locales uniquement. Connectez-vous avec Microsoft pour sauvegarder.</p>`;

  return `
    ${dbNote}
    <section class="hours-grid">
      ${hoursCard("Aujourd'hui", hours.today)}
      ${hoursCard("Pause dej", breakDuration)}
      ${hoursCard("Cette semaine", hours.week)}
    </section>
    <section class="clock-grid page-spacer">
      <article class="card clock-card">
        ${renderClockStatus(clockStatus)}
        ${renderWorkLocationSelector(punches)}
        ${renderClockActions()}
        <p class="clock-hint">${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </article>
      <article class="card">
        ${cardHeading("Pointages du jour")}
        <div class="punch-list">
          ${todayPunches.length
            ? todayPunches.map((punch) => `
              <div class="punch-item">
                <div class="punch-item-main">
                  <span class="punch-type ${punch.type}">${punchTypeLabel(punch.type)}</span>
                  ${punch.type === "in" ? renderWorkLocationBadge(punch.workLocation) : ""}
                </div>
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
          <thead><tr><th>Date</th><th>Type</th><th>Lieu</th><th>Heure</th></tr></thead>
          <tbody>
            ${punches.length
              ? [...punches].reverse().slice(0, 10).map((punch) => `
                <tr>
                  <td>${formatDate(punch.time)}</td>
                  <td>${punchTypeLabel(punch.type)}</td>
                  <td>${punch.type === "in" ? workLocationLabel(punch.workLocation) : "—"}</td>
                  <td>${formatTime(punch.time)}</td>
                </tr>`).join("")
              : `<tr><td colspan="4" class="empty-cell">Aucun historique pour le moment.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
    ${renderGtaClockTools()}`;
}

function canViewJournalTeam() {
  return isAdmin() || hasDirectReports();
}

function getJournalProfiles() {
  if (isAdmin()) return getTeamPunchProfiles("all");
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
      disconnect_reason: sample.autoOut ? "Deconnexion automatique" : "Sortie manuelle",
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
  const status = outTime ? "Deconnecte" : "Connecte";
  const reason = !outTime ? "—" : (autoOut ? "Deconnexion automatique" : (storedReason || "Sortie manuelle"));
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
    .order("punched_at", { ascending: false });

  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  } else if (!isAdmin()) {
    const scopedIds = userIds.length ? userIds : [session.user.id];
    if (!scopedIds.includes(session.user.id)) scopedIds.push(session.user.id);
    query = query.in("user_id", scopedIds);
  }

  query = query.gte("punched_at", `${shiftDateKey(range.start, -1)}T00:00:00`);
  query = query.lte("punched_at", `${range.end}T23:59:59`);

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

function exportJournalCsv() {
  const sessions = getJournalSessions();
  if (!sessions.length) {
    alert("Aucune session a exporter pour cette periode.");
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
  const tone = status === "Connecte" ? "on" : "off";
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

function journalPage() {
  if (!canViewJournal()) {
    return `<article class="card"><p class="empty-state">Acces au journal non autorise pour votre profil.</p></article>`;
  }
  if (!journalFilters.start || !journalFilters.end) {
    journalFilters = { ...journalFilters, ...getDefaultTeamPunchRange() };
  }

  const range = getJournalRange();
  const sessions = getJournalSessions();
  const profiles = getJournalProfiles();
  const openCount = sessions.filter((session) => session.status === "Connecte").length;
  const canFilterPeople = usesDatabase();
  let dbNote = "";
  if (!usesDatabase()) {
    dbNote = `<p class="data-note demo">Mode demo : journal local. Connectez-vous avec Microsoft pour voir les sessions reelles.</p>`;
  } else if (appData.journalMetaMissing) {
    dbNote = `<p class="data-note">Colonnes techniques absentes en base. Executez <code>supabase/time-punches-journal.sql</code> dans Supabase SQL Editor, puis refaites un pointage d'entree.</p>`;
  } else if (sessions.length && sessions.every((session) => session.method === "—" && session.os === "—" && session.browser === "—" && session.ip === "—")) {
    dbNote = `<p class="data-note">Les sessions deja enregistrees n'ont pas IP / OS / navigateur. Ces details apparaitront au prochain pointage d'entree.</p>`;
  }

  return `
    ${dbNote}
    <article class="card form-card page-spacer">
      ${cardHeading("Filtres")}
      <form id="journal-filter" class="feature-form team-punches-filter">
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
        ${canFilterPeople ? `
        <label>
          Collaborateur
          <select name="userId">
            <option value="">Tous</option>
            ${profiles.map((profile) => `
              <option value="${profile.id}"${journalFilters.userId === profile.id ? " selected" : ""}>
                ${escapeHtml(profile.full_name)}
              </option>`).join("")}
          </select>
        </label>` : ""}
        <label>
          Recherche
          <input type="search" name="query" value="${escapeHtml(journalFilters.query || "")}" placeholder="Nom, matricule, IP, statut...">
        </label>
        <div class="team-punches-actions">
          <button type="submit" class="primary">Actualiser</button>
          <button type="button" id="journal-export" class="outline-button"${sessions.length ? "" : " disabled"}>Exporter CSV</button>
        </div>
      </form>
    </article>
    <section class="team-punches-summary page-spacer">
      <article class="hours-card team-punch-summary-card">
        <span>Sessions</span>
        <strong>${sessions.length}</strong>
        <small>sur la periode</small>
      </article>
      <article class="hours-card team-punch-summary-card">
        <span>En cours</span>
        <strong>${openCount}</strong>
        <small>connexion active</small>
      </article>
      <article class="hours-card team-punch-summary-card">
        <span>Deconnectees</span>
        <strong>${sessions.length - openCount}</strong>
        <small>sessions closes</small>
      </article>
    </section>
    <article class="card table-card page-spacer journal-card">
      <div class="toolbar">
        <h3>Journal</h3>
        <span class="hierarchy-result-count">${sessions.length} ligne${sessions.length > 1 ? "s" : ""}</span>
      </div>
      <div class="table-wrap journal-table-wrap">
        <table class="journal-table">
          <thead>
            <tr>
              ${JOURNAL_COLUMNS.map((column) => `
                <th class="journal-th${journalSort.key === column.key ? " is-sorted" : ""}${journalColumnFilters[column.key] ? " is-filtered" : ""}">
                  <button type="button" class="journal-th-btn" data-journal-col="${column.key}" aria-haspopup="true" aria-expanded="${journalOpenColumn === column.key}">
                    <span>${column.label}</span>
                    <span class="journal-th-arrow" aria-hidden="true"></span>
                  </button>
                  ${renderJournalColumnMenu(column)}
                </th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${sessions.length
              ? sessions.map((session) => `
                <tr>
                  <td><code class="journal-id">${escapeHtml(session.sessionId)}</code></td>
                  <td>${escapeHtml(session.matricule)}</td>
                  <td><strong>${escapeHtml(session.name)}</strong></td>
                  <td>${escapeHtml(session.department)}</td>
                  <td>${escapeHtml(session.dateIn)}</td>
                  <td>${escapeHtml(session.timeIn)}</td>
                  <td>${escapeHtml(session.dateOut)}</td>
                  <td>${escapeHtml(session.timeOut)}</td>
                  <td><strong>${escapeHtml(session.duration)}</strong></td>
                  <td>${escapeHtml(session.method)}</td>
                  <td>${escapeHtml(session.os)}</td>
                  <td>${escapeHtml(session.browser)}</td>
                  <td><code class="journal-id">${escapeHtml(session.ip)}</code></td>
                  <td>${escapeHtml(session.network)}</td>
                  <td>${escapeHtml(session.location)}</td>
                  <td>${renderJournalStatus(session.status)}</td>
                  <td>${escapeHtml(session.reason)}</td>
                </tr>`).join("")
              : `<tr><td colspan="${JOURNAL_COLUMNS.length}" class="empty-cell">Aucune session pour cette periode. Ajustez les filtres ou pointez une entree.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>`;
}

function teamPunchesPage() {
  if (!usesDatabase() && !demoMode) {
    return `<article class="card"><p class="empty-state">Connectez-vous avec Microsoft pour consulter les pointages de votre equipe.</p></article>`;
  }

  if (!canViewTeamPunches()) {
    return `<article class="card"><p class="empty-state">Acces reserve aux managers et administrateurs.</p></article>`;
  }

  const range = teamPunchFilters.start && teamPunchFilters.end
    ? teamPunchFilters
    : getDefaultTeamPunchRange();
  const scope = getTeamPunchScope();
  const profiles = getTeamPunchProfiles(scope);
  const scopedProfiles = teamPunchFilters.userId
    ? profiles.filter((profile) => profile.id === teamPunchFilters.userId)
    : profiles;
  const summary = summarizeTeamPunchesByUser(appData.teamPunches, scopedProfiles, range.start, range.end);
  const dailyRows = summarizeTeamPunchesByDay(appData.teamPunches, range.start, range.end);
  const showLocationHint = dailyRows.some((row) => row.hasStarted)
    && !dailyRows.some((row) => resolveDailyRowWorkLocation(row));
  const scopeLabel = isAdmin()
    ? (scope === "team" ? "mon equipe directe" : "tous les collaborateurs")
    : "votre equipe directe";
  const directReports = getDirectReportProfiles();

  return `
    <p class="data-note">Perimetre : ${scopeLabel} · ${profiles.length} collaborateur${profiles.length > 1 ? "s" : ""}</p>
    <article class="card form-card page-spacer">
      ${cardHeading("Filtres")}
      <form id="team-punches-filter" class="feature-form team-punches-filter">
        ${isAdmin() ? `
        <label>
          Perimetre
          <select name="scope">
            <option value="all"${scope === "all" ? " selected" : ""}>Tous les collaborateurs</option>
            <option value="team"${scope === "team" ? " selected" : ""}>Mon equipe directe${directReports.length ? ` (${directReports.length})` : ""}</option>
          </select>
        </label>` : ""}
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
        <label>
          Collaborateur
          <select name="userId">
            <option value="">Tous</option>
            ${profiles.map((profile) => `
              <option value="${profile.id}"${teamPunchFilters.userId === profile.id ? " selected" : ""}>
                ${escapeHtml(profile.full_name)}
              </option>`).join("")}
          </select>
        </label>
        <div class="team-punches-actions">
          <button type="submit" class="primary">Actualiser</button>
          <button type="button" id="team-punches-export" class="outline-button"${dailyRows.length ? "" : " disabled"}>Exporter CSV</button>
        </div>
      </form>
    </article>
    <section class="team-punches-summary page-spacer">
      ${summary.length
        ? summary.map((item, index) => `
          <article class="hours-card team-punch-summary-card">
            <span>${escapeHtml(item.profile.full_name || "Collaborateur")}</span>
            <strong>${formatDuration(item.workedMs)}</strong>
            <small>${item.punchCount} pointage${item.punchCount > 1 ? "s" : ""}</small>
          </article>`).join("")
        : `<article class="card"><p class="empty-state">Aucun collaborateur dans votre perimetre.</p></article>`}
    </section>
    <article class="card table-card page-spacer">
      <div class="toolbar">
        <h3>Detail des pointages</h3>
        <span class="hierarchy-result-count">${dailyRows.length} jour${dailyRows.length > 1 ? "s" : ""}</span>
      </div>
      ${showLocationHint ? `<p class="data-note">Le lieu n'est renseigne que sur les pointages d'entree. Si la colonne est vide, executez <code>supabase/time-punches-location.sql</code> puis refaites un pointage d'entree.</p>` : ""}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Collaborateur</th>
              <th>Date</th>
              <th>Lieu</th>
              <th>Debut</th>
              <th>Fin</th>
              <th>Pause dej</th>
              <th>Heures planifiees</th>
              <th>Heures realisees</th>
              <th>Retard</th>
              <th>Heures manquantes</th>
              <th>HS payables</th>
              <th>Log shift</th>
              <th>Heure rectifiee</th>
              <th>Modifie par</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            ${dailyRows.length
              ? dailyRows.map((row) => {
                  const profile = profileById(row.userId) || { full_name: row.name, id: row.userId };
                  const stats = analyzeWorkedDay(row, profile);
                  const correction = formatDayCorrectionSummary(row.userId, row.dayKey);
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
                  <td>${stats.delayMin ? `${stats.delayMin} min` : "—"}</td>
                  <td>${stats.missingMs ? formatDuration(stats.missingMs) : "—"}</td>
                  <td>${stats.payableOtMs ? formatDuration(stats.payableOtMs) : "—"}</td>
                  <td>${formatDayPunchLog(row)}</td>
                  <td>${correction.rectified === "Oui" ? badge("Oui") : escapeHtml(correction.rectified)}</td>
                  <td>${escapeHtml(correction.who)}</td>
                  <td>${escapeHtml(correction.motif)}</td>
                </tr>`;
                }).join("")
              : `<tr><td colspan="15" class="empty-cell">Aucun pointage pour cette periode. Ajustez les filtres puis actualisez.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>`;
}

function leavePage() {
  if (!isNavPageVisible("leave")) {
    return `<article class="card"><p class="empty-state">L'onglet Conges n'est pas disponible pour votre profil.</p></article>`;
  }

  const requests = getLeaveRequests();
  const balances = getLeaveBalances();
  const pending = pendingLeaveForValidator();
  const months = seniorityMonths();
  const carryFlag = balances[0] && balances[0].remaining > 3 && new Date().getMonth() === 11;
  const chain = getLeaveValidatorChain(session?.user?.id);
  const shift = getActiveShift();

  return `
    ${carryFlag ? `<p class="data-note">Alerte report : plus de 3 jours de CP restants au 31/12. Le solde non consomme est reportable une seule annee.</p>` : ""}
    ${months < 6 && !isAdmin() ? `<p class="data-note">Anciennete : ${months} mois. Le legal demande 6 mois, sauf derogation RH.</p>` : ""}
    <p class="data-note">Horaire ${escapeHtml(shift.label)} · ${shift.start}–${shift.end} · pause ${shift.lunchMin} min (${shift.lunchFrom}–${shift.lunchTo}) · decalage FR/MA ${getFrMaOffsetHours()} h${isRamadanDay(toDateKey(new Date())) ? " · periode Ramadan" : ""}</p>
    <p class="data-note">18 codes d'absence (paie) : CP selon le profil, recuperation, familial, deces, mariage, absences justifiee/injustifiee, retard, depart, deplacement, mise a pied.</p>
    <section class="balance-grid">
      ${balances.map((balance) => balanceCard(balance)).join("")}
    </section>
    ${renderLeaveCalendar()}
    ${pending.length ? `
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Demandes a valider</h3></div>
      <p class="hierarchy-meta">Circuit : ${chain.map((item) => item.role).join(" → ")}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Type</th><th>Periode</th><th>Statut</th><th></th></tr></thead>
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
              Date de debut
              <input type="date" name="start" required>
            </label>
            <label>
              Date de fin
              <input type="date" name="end" required>
            </label>
          </div>
          <label>
            Duree
            <select name="unit">
              <option value="days">Jours ouvres</option>
              <option value="half">Demi-journee</option>
              <option value="hours">Heures (retard / depart)</option>
            </select>
          </label>
          <label id="leave-half-wrap" hidden>
            Demi-journee
            <select name="half_day">
              <option value="morning">Matin</option>
              <option value="afternoon">Apres-midi</option>
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
            <thead><tr><th>Type</th><th>Periode</th><th>Duree</th><th>Justificatif</th><th>Statut</th></tr></thead>
            <tbody>${leaveRows(requests)}</tbody>
          </table>
        </div>
      </article>
    </div>`;
}

function leaveRows(requests) {
  if (!requests.length) {
    return `<tr><td colspan="5" class="empty-cell">Aucune demande de conge pour le moment.</td></tr>`;
  }
  return requests.map((request) => `
    <tr>
      <td>${request.type}${request.motif ? `<br><small>${escapeHtml(request.motif)}</small>` : ""}</td>
      <td>${formatDate(request.start)} - ${formatDate(request.end)}</td>
      <td>${leaveIsHoursUnit(request.type) ? `${request.hours || 0} h` : `${request.days} jour${Number(request.days) > 1 ? "s" : ""} ouvres`}</td>
      <td>${escapeHtml(request.attachment_name || request.attachmentName || "—")}</td>
      <td>${badge(request.status)}</td>
    </tr>`).join("");
}

function attestationsPage() {
  if (!isNavPageVisible("attestations")) {
    return `<article class="card"><p class="empty-state">L'onglet Attestations n'est pas disponible pour votre profil.</p></article>`;
  }

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

function hierarchyPage() {
  if (!isNavPageVisible("hierarchy")) {
    return `<article class="card"><p class="empty-state">L'onglet Hierarchie n'est pas disponible pour votre profil.</p></article>`;
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
        ${cardHeading("Mon equipe directe")}
        <div class="team-grid">
          ${directReports.length
            ? directReports.map((profile, index) => `
              <div class="team-card-wrap">
                ${renderProfilePyramidCard(profile, index, { isMe: profile.id === session.user.id })}
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

function creatorPage() {
  if (!isCreator()) {
    return `<article class="card"><p class="empty-state">Acces reserve au createur de l'application.</p></article>`;
  }

  const visibility = getNavVisibility();

  return `
    <article class="card form-card">
      ${cardHeading("Visibilite des onglets")}
      <p class="creator-intro">Activez ou masquez les onglets <strong>Conges</strong>, <strong>Attestations</strong>, <strong>Hierarchie</strong>, <strong>Rapports</strong> et <strong>Journal</strong> pour chaque type de profil.</p>
      <form id="creator-nav-form" class="feature-form creator-nav-form">
        <div class="table-wrap">
          <table class="creator-nav-table">
            <thead>
              <tr>
                <th>Onglet</th>
                ${NAV_VISIBILITY_AUDIENCES.map((audience) => `<th>${audience.label}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${NAV_VISIBILITY_PAGES.map((page) => `
                <tr>
                  <td><strong>${page.label}</strong></td>
                  ${NAV_VISIBILITY_AUDIENCES.map((audience) => `
                    <td>
                      <label class="creator-toggle">
                        <input
                          type="checkbox"
                          name="${page.id}_${audience.id}"
                          ${visibility[page.id]?.[audience.id] !== false ? "checked" : ""}
                        >
                        <span>Visible</span>
                      </label>
                    </td>`).join("")}
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <button type="submit" class="primary">Enregistrer les reglages</button>
      </form>
    </article>
    ${renderCreatorAccountsSection()}`;
}

function adminPage() {
  if (!isAdmin()) {
    return `<article class="card"><p class="empty-state">Acces reserve aux administrateurs.</p></article>`;
  }

  return `
    ${renderUserAccountSection()}
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

function getReportProfiles() {
  if (isAdmin()) return appData.orgProfiles.filter(Boolean);
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

function buildEdsRows() {
  const range = getEdsRange();
  const profiles = getReportProfiles();
  const punches = getReportPunches();
  const daily = summarizeTeamPunchesByDay(punches, range.start, range.end);
  const leaves = [...getLeaveRequests(), ...(appData.teamLeaveRequests || [])];
  return profiles.map((profile) => {
    const days = daily.filter((row) => row.userId === profile.id);
    let planned = 0;
    let realized = 0;
    let delay = 0;
    let missing = 0;
    let ot = 0;
    days.forEach((row) => {
      const stats = analyzeWorkedDay(row, profile);
      planned += stats.plannedMs;
      realized += stats.realizedMs;
      delay += stats.delayMin;
      missing += stats.missingMs;
      ot += stats.payableOtMs;
    });
    const ofType = (key) => leaves.filter((item) => (item.userId || item.user_id || session?.user?.id) === profile.id && leaveTypeKey(item.type) === key && String(item.status || "").toLowerCase().includes("approuv")).reduce((sum, item) => sum + Number(item.days || item.hours || 0), 0);
    return {
      name: profile.full_name,
      matricule: getProfileMatricule(profile.id),
      planned,
      realized,
      delay,
      missing,
      ot,
      cp: ofType("cp"),
      unpaid: ofType("unpaid"),
      sick: ofType("justified") + ofType("maladie"),
      range
    };
  });
}

function reportsPage() {
  if (!canViewReports()) {
    return `<article class="card"><p class="empty-state">Acces aux rapports non autorise pour votre profil.</p></article>`;
  }
  const range = getEdsRange();
  const rows = buildEdsRows();
  const teamScope = canViewTeamPunches() || isAdmin();
  return `
    <p class="data-note">Cycle paie EDS : du ${formatDate(range.start)} au ${formatDate(range.end)} (21 du mois precedent → 20 du mois en cours). ${teamScope ? "Vue equipe." : "Votre temps uniquement."} M-Work n'est pas connecte, volontairement.</p>
    ${renderGtaTeamInbox()}
    <article class="card form-card page-spacer">
      ${cardHeading("Exports")}
      <div class="team-punches-actions">
        <button type="button" id="export-eds" class="primary">Export EDS consolide</button>
        <button type="button" id="export-absences" class="outline-button">Absences / conges</button>
        <button type="button" id="export-retards" class="outline-button">Retards et heures manquantes</button>
      </div>
    </article>
    <article class="card table-card page-spacer">
      <div class="toolbar"><h3>Apercu EDS</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Planifie</th><th>Realise</th><th>Retard</th><th>Manquant</th><th>HS</th><th>CP</th><th>Sans solde</th><th>Maladie</th></tr></thead>
          <tbody>
            ${rows.length
              ? rows.map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.name)}</strong></td>
                  <td>${formatDuration(row.planned)}</td>
                  <td>${formatDuration(row.realized)}</td>
                  <td>${row.delay} min</td>
                  <td>${formatDuration(row.missing)}</td>
                  <td>${formatDuration(row.ot)}</td>
                  <td>${row.cp}</td>
                  <td>${row.unpaid}</td>
                  <td>${row.sick}</td>
                </tr>`).join("")
              : `<tr><td colspan="9" class="empty-cell">Aucune donnee sur le cycle.</td></tr>`}
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
    journal: journalPage,
    "team-punches": teamPunchesPage,
    reports: reportsPage,
    leave: leavePage,
    attestations: attestationsPage,
    hierarchy: hierarchyPage,
    admin: adminPage,
    creator: creatorPage
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
  if (message.includes("punch_corrections") || message.includes("overtime_requests") || message.includes("activity_entries") || message.includes("shift_code") || message.includes("workflow_step")) {
    return "Module Cegid GTA non configure. Executez supabase/cegid-gta.sql dans SQL Editor.";
  }
  if (JOURNAL_META_FIELDS.some((field) => message.includes(field))) {
    return "Colonnes du Journal non configurees. Executez supabase/time-punches-journal.sql dans SQL Editor, puis refaites un pointage d'entree.";
  }
  if (message.includes("work_location") || (message.includes("column") && message.includes("time_punches"))) {
    return "Lieu de travail non configure. Executez supabase/time-punches-location.sql dans SQL Editor, puis refaites un pointage d'entree.";
  }
  if (message.includes("permission") || message.includes("policy") || message.includes("row-level")) {
    if (message.includes("leave_requests")) {
      return "Acces au calendrier des conges equipe refuse. Executez supabase/leave-requests-access.sql dans SQL Editor.";
    }
    if (message.includes("time_punches")) {
      return "Acces refuse aux pointages equipe. Executez supabase/time-punches-access.sql dans SQL Editor.";
    }
    return "Acces refuse aux pointages equipe. Executez supabase/time-punches-access.sql dans SQL Editor.";
  }
  if (message.includes("hr_alerts") || message.includes("process_auto_clock_outs") || message.includes("notify_auto_clock_out")) {
    return "Alertes RH non configurees. Executez supabase/auto-clock-out.sql puis supabase/hr-alerts-delete.sql dans SQL Editor.";
  }
  if (message.includes("app_settings")) {
    return "Studio createur non configure. Executez supabase/creator-nav-settings.sql dans SQL Editor.";
  }
  if (message.includes("pending_invites") && message.includes("check")) {
    return "Role createur non autorise dans les invitations. Executez supabase/creator-accounts.sql dans SQL Editor.";
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

    if (isAdmin()) {
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

    await runAutoClockOutChecks();

    if (canViewHrAlerts()) {
      await loadHrAlerts(userId);
    } else {
      appData.hrAlerts = [];
    }

    if (canViewTeamLeaveCalendar()) {
      await loadTeamLeaveRequests(getLeaveCalendarMonth());
    } else {
      appData.teamLeaveRequests = [];
    }

    await loadNavVisibility();
    await loadStudioCreators();

    if (canViewTeamPunches()) {
      await loadTeamPunches(teamPunchFilters);
    }

    try {
      await loadGtaCollections(userId);
    } catch (error) {
      console.warn("GTA collections:", error?.message || error);
    }
  });
}

async function loadGtaCollections(userId) {
  const kinds = Object.values(GTA_KINDS);
  await Promise.all(kinds.map(async ({ table, store }) => {
    try {
      let query = supabaseClient.from(table).select("*").order("created_at", { ascending: false }).limit(200);
      if (!canViewTeamPunches() && !isAdmin()) {
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
      await refreshAppData();
      collectJournalMeta().catch(() => {});
    } catch (error) {
      appData.error = formatAppError(error);
    } finally {
      appData.loading = false;
      hideAuthBootScreen();
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
  ensureAccessiblePage();
  const name = getUserName();
  const email = session?.user?.email || "collaborateur@entreprise.fr";
  const initials = profileInitials(name);

  app.innerHTML = `
    <div class="app-shell" data-current-page="${currentPage}">
      <aside class="sidebar">
        <button type="button" class="brand brand-home" id="brand-home" aria-label="Retour a l'accueil">
          <span>H</span> Humana
        </button>
        <button class="close-menu" type="button" aria-label="Fermer"></button>
        <nav>${getNavigationItems().map((item) => `
          <button type="button" data-page="${item[0]}" class="${currentPage === item[0] ? "active" : ""}">
            ${item[1]}${navBadge(item[0])}
          </button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <div class="user-card"><span class="avatar avatar-sidebar-user" aria-hidden="true">${initials}</span><div class="user-card-text"><strong title="${name}">${name}</strong><span class="user-card-email" title="${email}">${email}</span>${renderUserRolePills()}</div><button type="button" id="logout" class="logout-btn" aria-label="Se deconnecter">Sortir</button></div>
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

function minutesFromHhmm(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function isWeekendDate(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function holidaySet() {
  return new Set([...FR_HOLIDAYS_2026, ...MA_HOLIDAYS_2026]);
}

function isHolidayKey(dayKey) {
  return holidaySet().has(dayKey);
}

function isWorkingDayKey(dayKey) {
  const date = parseLocalDate(dayKey);
  return !isWeekendDate(date) && !isHolidayKey(dayKey);
}

function countWorkingDays(start, end) {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  if (endDate < startDate) return 0;
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = toDateKey(cursor);
    if (isWorkingDayKey(key)) count += 1;
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
  if (SHIFT_PRESETS[code]) return SHIFT_PRESETS[code];
  const dept = String(profile?.department || profile?.job_title || "").toLowerCase();
  if (dept.includes("r&d") || dept.includes("r et d") || /\brd\b/.test(dept)) return SHIFT_PRESETS.rnd;
  return SHIFT_PRESETS.cs;
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

function recoveryDaysForYear(year = new Date().getFullYear()) {
  const fr = FR_HOLIDAYS_2026.filter((day) => day.startsWith(String(year)) && isWorkingDayKey(day));
  const ma = new Set(MA_HOLIDAYS_2026.filter((day) => day.startsWith(String(year))));
  return fr.filter((day) => !ma.has(day)).length;
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

function getLeaveValidatorChain(userId) {
  const labels = ["Manager N+1", "OPS manager N+2", "Directeur N+3"];
  const chain = [];
  let current = profileById(userId) || appData.profile;
  const seen = new Set();
  for (let index = 0; index < 3; index += 1) {
    const managerId = current?.manager_id;
    if (!managerId || seen.has(managerId)) break;
    const manager = profileById(managerId);
    if (!manager) break;
    seen.add(managerId);
    chain.push({ step: chain.length + 1, id: manager.id, name: manager.full_name, role: labels[index] });
    current = manager;
  }
  const rh = appData.orgProfiles.find((profile) => profile.role === "admin" || profile.role === "creator")
    || appData.profile;
  if (rh && !chain.some((item) => item.id === rh.id)) {
    chain.push({ step: chain.length + 1, id: rh.id, name: rh.full_name || "RH", role: "RH" });
  } else if (!chain.length) {
    chain.push({ step: 1, id: session?.user?.id, name: "RH", role: "RH" });
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
  const plannedMs = shift.plannedHours * 3600000;
  const realizedMs = row.workedMs || 0;
  const startMin = row.startTime ? new Date(row.startTime).getHours() * 60 + new Date(row.startTime).getMinutes() : null;
  const lateAfter = minutesFromHhmm(shift.lateAfter);
  const delayMin = startMin == null ? 0 : Math.max(0, startMin - lateAfter);
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

function getEdsRange(fromDate = new Date()) {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const start = new Date(year, month - 1, 21);
  const end = new Date(year, month, 20);
  return { start: toDateKey(start), end: toDateKey(end) };
}

function canValidateLeave(request) {
  if (isAdmin()) return true;
  const chain = getLeaveValidatorChain(request.userId || request.user_id || session?.user?.id);
  const step = Number(request.workflowStep || request.workflow_step || 1);
  const current = chain[Math.max(0, step - 1)];
  return current?.id === session?.user?.id;
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

function bindPageEvents() {
  bindTablePan();
  document.querySelectorAll("[data-goto-page]").forEach((button) => {
    button.addEventListener("click", () => {
      currentPage = button.dataset.gotoPage;
      renderApp();
    });
  });

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
    withAction(async () => {
      const { isOut } = getClockState();
      const punchType = isOut ? "in" : "out";
      const meta = await collectJournalMeta();
      if (usesDatabase()) {
        const payload = applyJournalMetaToPayload(buildClockPunchPayload(punchType), meta, punchType);
        await insertTimePunch(payload);
      } else {
        const punches = loadStore("punches", []);
        punches.push(applyJournalMetaToDemoPunch(buildDemoClockPunch(punchType), meta, punchType));
        saveStore("punches", punches);
      }
    });
  });

  document.querySelector("#break-toggle")?.addEventListener("click", () => {
    withAction(async () => {
      const { onBreak } = getClockState();
      const punchType = onBreak ? "break_end" : "break_start";
      if (usesDatabase()) {
        const { error } = await supabaseClient.from("time_punches").insert({
          user_id: session.user.id,
          punch_type: punchType,
          punched_at: new Date().toISOString()
        });
        if (error) throw error;
      } else {
        const punches = loadStore("punches", []);
        punches.push({ type: punchType, time: new Date().toISOString() });
        saveStore("punches", punches);
      }
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
        await updateWithOptionalFields(meta.table, payload, "id", itemId, PUNCH_CORRECTION_FIELDS);
      } else {
        saveGtaStore(meta.store, loadStore(meta.store, []).map((item) => (
          String(item.id) === String(itemId)
            ? { ...item, status, ...(kind === "corrections" ? reviewer : {}) }
            : item
        )));
      }
      currentPage = currentPage === "reports" ? "reports" : "pointeuse";
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

  document.querySelector("#export-eds")?.addEventListener("click", () => {
    const rows = buildEdsRows();
    const range = getEdsRange();
    downloadCsv(`eds_${range.start}_${range.end}.csv`,
      ["Matricule", "Nom", "Planifie", "Realise", "Retard_min", "Manquant", "HS", "CP", "Sans_solde", "Maladie"],
      rows.map((row) => [row.matricule, row.name, formatDuration(row.planned), formatDuration(row.realized), row.delay, formatDuration(row.missing), formatDuration(row.ot), row.cp, row.unpaid, row.sick]));
  });
  document.querySelector("#export-absences")?.addEventListener("click", () => {
    const requests = [...getLeaveRequests(), ...(appData.teamLeaveRequests || [])];
    downloadCsv("absences.csv", ["Nom", "Type", "Debut", "Fin", "Duree", "Statut"],
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
        : `<p class="empty-state">Aucun collaborateur ne correspond a votre recherche.</p>`;
      bindHierarchyOrgEvents();
    });
  }

  bindHierarchyOrgEvents();

  const teamPunchesFilter = document.querySelector("#team-punches-filter");
  if (teamPunchesFilter) {
    if (!teamPunchFilters.start || !teamPunchFilters.end) {
      teamPunchFilters = {
        ...getDefaultTeamPunchRange(),
        userId: teamPunchFilters.userId || "",
        scope: teamPunchFilters.scope || "all"
      };
    }
    teamPunchesFilter.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      teamPunchFilters = {
        start: data.get("start"),
        end: data.get("end"),
        userId: data.get("userId") || "",
        scope: isAdmin() ? (data.get("scope") || "all") : "team"
      };
      if (new Date(teamPunchFilters.end) < new Date(teamPunchFilters.start)) {
        alert("La date de fin doit etre apres la date de debut.");
        return;
      }
      withAction(() => loadTeamPunches());
    });
  }

  if ((currentPage === "team-punches" || currentPage === "reports") && canViewTeamPunches() && usesDatabase() && !teamPunchesInitialLoadDone) {
    teamPunchesInitialLoadDone = true;
    loadTeamPunches()
      .then(() => {
        if (currentPage !== "team-punches" && currentPage !== "reports") return;
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

  document.querySelector("#team-punches-export")?.addEventListener("click", () => {
    exportTeamPunchesCsv();
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
        alert("La date de fin doit etre apres la date de debut.");
        return;
      }
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

  document.querySelector("#journal-export")?.addEventListener("click", () => {
    exportJournalCsv();
  });

  document.querySelectorAll("[data-journal-col]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.journalCol;
      journalOpenColumn = journalOpenColumn === key ? "" : key;
      const content = document.querySelector("#page-content");
      if (content) {
        content.innerHTML = pageContent();
        bindPageEvents();
      }
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
      const content = document.querySelector("#page-content");
      if (content) {
        content.innerHTML = pageContent();
        bindPageEvents();
      }
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
      const content = document.querySelector("#page-content");
      if (content) {
        content.innerHTML = pageContent();
        bindPageEvents();
      }
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
      alert("Ce code d'absence est reserve aux RH.");
      return;
    }
    if (def?.grades && !isAdmin() && !def.grades.includes(getLeaveGrade())) {
      alert("Ce code de conges payes n'est pas disponible pour votre profil.");
      return;
    }
    let end = data.get("end");
    if (def?.fixedDays && start) {
      end = addWorkingDaysKey(start, def.fixedDays);
    }
    if (new Date(end) < new Date(start)) {
      alert("La date de fin doit etre apres la date de debut.");
      return;
    }
    if (hasOverlappingLeave(start, end)) {
      alert("Les absences ne peuvent pas se chevaucher.");
      return;
    }
    if (seniorityMonths() < 6 && !isAdmin() && leaveTypeKey(type) === "cp") {
      alert("Anciennete minimale de 6 mois pour poser des conges payes, sauf derogation RH.");
      return;
    }
    const days = unit === "hours" ? 0 : (def?.fixedDays || (unit === "half" ? 0.5 : daysBetween(start, end)));
    if (unit !== "hours" && days <= 0) {
      alert("La periode ne contient aucun jour ouvré.");
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

  document.querySelector("#brand-home")?.addEventListener("click", () => {
    currentPage = "home";
    document.querySelector(".sidebar")?.classList.remove("open");
    renderApp();
  });

  document.querySelectorAll(".sidebar nav [data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPage = button.dataset.page;
      if (nextPage === "team-punches") {
        teamPunchesInitialLoadDone = false;
      }
      if (nextPage === "journal") {
        journalPunchesInitialLoadDone = false;
      }
      currentPage = nextPage;
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
    initialAuthHandled = false;
    teamPunchesInitialLoadDone = false;
    journalPunchesInitialLoadDone = false;
    journalFilters = { start: "", end: "", userId: "", query: "" };
    journalColumnFilters = {};
    journalOpenColumn = "";
    leaveCalendarMonth = null;
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
    if (shouldBootAuthenticatedUi()) showAuthBootScreen();
    bindLoginEvents();
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
      return;
    }

    supabaseClient.auth.onAuthStateChange(async (event, nextSession) => {
      if (nextSession && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        if (initialAuthHandled) return;
        initialAuthHandled = true;
        session = nextSession;
        demoMode = false;
        showAuthBootScreen();
        await bootstrapUser({ showSpinner: false });
        clearAuthParamsFromUrl();
        return;
      }
      if (event === "SIGNED_OUT") {
        initialAuthHandled = false;
        renderLogin();
      }
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session && !initialAuthHandled) {
      initialAuthHandled = true;
      session = data.session;
      demoMode = false;
      showAuthBootScreen();
      await bootstrapUser({ showSpinner: false });
      clearAuthParamsFromUrl();
    } else if (!data.session) {
      hideAuthBootScreen();
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
  await bootstrapUser({ showSpinner: false });
  clearAuthParamsFromUrl();
};

function hydrateDemoWorkspace() {
  const profiles = [
    { id: "u-camille", email: "camille.moreau@humaine.fr", full_name: "Camille Moreau", job_title: "Directrice RH", department: "Ressources humaines", role: "creator", manager_id: "", matricule: "HUM-1001", leave_grade: "codir", shift_code: "cs", hired_at: "2018-03-01", leave_balance_cp: 30, leave_balance_rtt: 8 },
    { id: "u-thomas", email: "thomas.bernard@humaine.fr", full_name: "Thomas Bernard", job_title: "Responsable operations", department: "Operations", role: "manager", manager_id: "u-camille", matricule: "HUM-1042", leave_grade: "manager", shift_code: "cs", hired_at: "2020-01-15", leave_balance_cp: 24, leave_balance_rtt: 6 },
    { id: "u-sarah", email: "sarah.nguyen@humaine.fr", full_name: "Sarah Nguyen", job_title: "Responsable commercial", department: "Commercial", role: "manager", manager_id: "u-camille", matricule: "HUM-1088", leave_grade: "manager", shift_code: "cs", hired_at: "2019-09-01", leave_balance_cp: 24, leave_balance_rtt: 8 },
    { id: "u-lea", email: "lea.martin@humaine.fr", full_name: "Lea Martin", job_title: "Chargee de paie", department: "Ressources humaines", role: "employee", manager_id: "u-thomas", matricule: "HUM-1214", leave_grade: "employee", shift_code: "cs", hired_at: "2024-01-08", leave_balance_cp: 18, leave_balance_rtt: 5 },
    { id: "u-hugo", email: "hugo.petit@humaine.fr", full_name: "Hugo Petit", job_title: "Ingenieur R&D", department: "R&D", role: "employee", manager_id: "u-thomas", matricule: "HUM-1307", leave_grade: "employee", shift_code: "rnd", hired_at: "2023-06-12", leave_balance_cp: 18, leave_balance_rtt: 8 },
    { id: "u-nina", email: "nina.rossi@humaine.fr", full_name: "Nina Rossi", job_title: "Commerciale", department: "Commercial", role: "employee", manager_id: "u-sarah", matricule: "HUM-1420", leave_grade: "employee", shift_code: "cs", hired_at: "2025-11-02", leave_balance_cp: 4, leave_balance_rtt: 2 }
  ];
  session = {
    user: {
      id: "u-camille",
      email: "camille.moreau@humaine.fr",
      user_metadata: { full_name: "Camille Moreau", name: "Camille Moreau" }
    }
  };
  appData.profile = profiles[0];
  appData.orgProfiles = profiles;
  appData.navVisibility = normalizeNavVisibility(loadStore("navVisibility", null));
  appData.studioCreators = normalizeStudioCreators(loadStore("studioCreators", [session.user.email]));
  const punches = [];
  profiles.forEach((profile, index) => {
    for (let daysAgo = 2; daysAgo >= 0; daysAgo -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - daysAgo);
      const stamp = (hour, minute) => {
        const value = new Date(day);
        value.setHours(hour, minute + index, 0, 0);
        return value.toISOString();
      };
      punches.push({ id: `${profile.id}-in-${daysAgo}`, user_id: profile.id, punch_type: "in", punched_at: stamp(profile.shift_code === "rnd" ? 9 : 8, 45), work_location: daysAgo === 1 ? "remote" : "onsite", profiles: { full_name: profile.full_name, email: profile.email } });
      punches.push({ id: `${profile.id}-b-${daysAgo}`, user_id: profile.id, punch_type: "break_start", punched_at: stamp(12, 10), profiles: { full_name: profile.full_name } });
      punches.push({ id: `${profile.id}-r-${daysAgo}`, user_id: profile.id, punch_type: "break_end", punched_at: stamp(13, 5), profiles: { full_name: profile.full_name } });
      if (daysAgo !== 0 || profile.id !== "u-camille") {
        punches.push({ id: `${profile.id}-out-${daysAgo}`, user_id: profile.id, punch_type: "out", punched_at: stamp(18, 5), profiles: { full_name: profile.full_name } });
      }
    }
  });
  appData.teamPunches = punches;
  appData.journalPunches = punches;
  saveStore("leaveRequests", [{
    id: "leave-demo-1",
    userId: "u-lea",
    name: "Lea Martin",
    type: "Conges payes",
    start: toDateKey(new Date(Date.now() + 86400000 * 7)),
    end: toDateKey(new Date(Date.now() + 86400000 * 9)),
    days: 3,
    status: "A valider — Manager N+1",
    workflowStep: 1,
    created: new Date().toISOString()
  }]);
  const todayKey = toDateKey(new Date());
  saveStore("punchCorrections", [{
    id: "corr-demo-1",
    userId: "u-hugo",
    date: todayKey,
    time: "09:12",
    punchKind: "in",
    reason: "Oubli de badge a l'arrivee",
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
    reason: "Pause dej non pointee",
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
  teamPunchesInitialLoadDone = true;
  journalPunchesInitialLoadDone = true;
}

window.humanaStartDemo = function () {
  demoMode = true;
  supabaseClient = getSupabaseClient();
  ensureAppContainer();
  hideAuthBootScreen();
  hydrateDemoWorkspace();
  renderApp();
};

initialize();
})();
