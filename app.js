(function () {
  if (window.__humanaAppLoaded) return;
  window.__humanaAppLoaded = true;

let supabaseClient = null;
let app = null;
let session = null;
let demoMode = false;
let portalMode = false;
let currentPage = "pointeuse";

const pages = {
  pointeuse: ["Pointeuse", "Enregistrez vos arrivees et departs du jour."],
  leave: ["Demandes de conges", "Deposez et suivez vos demandes d'absence."],
  attestations: ["Demandes d'attestations", "Demandez vos documents RH en quelques clics."]
};

const navigation = [
  ["pointeuse", "P", "Pointeuse"],
  ["leave", "C", "Conges"],
  ["attestations", "A", "Attestations"]
];

const leaveTypes = ["Conges payes", "RTT", "Conge maladie", "Conge sans solde"];
const attestationTypes = [
  "Attestation employeur",
  "Certificat de travail",
  "Attestation de salaire",
  "Attestation de conges"
];

const avatar = (initials, color = "violet") =>
  `<span class="avatar ${color}">${initials}</span>`;

function badge(value) {
  const normalized = value.toLowerCase();
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

function storagePrefix() {
  const email = session?.user?.email || "demo";
  return `humana_${email}_`;
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
  return metadata.full_name || metadata.name || session?.user?.email?.split("@")[0] || "Collaborateur";
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

function formatDateTime(value) {
  return `${formatDate(value)} a ${formatTime(value)}`;
}

function countPendingLeave() {
  return loadStore("leaveRequests", []).filter((item) => item.status === "A valider").length;
}

function countPendingAttestations() {
  return loadStore("attestationRequests", []).filter((item) => item.status === "En attente").length;
}

function navBadge(page) {
  if (page === "leave" && countPendingLeave()) return `<i>${countPendingLeave()}</i>`;
  if (page === "attestations" && countPendingAttestations()) return `<i>${countPendingAttestations()}</i>`;
  return "";
}

function getClockState() {
  const punches = loadStore("punches", []);
  const last = punches[punches.length - 1];
  return { punches, isIn: last?.type === "in" };
}

function pointeusePage() {
  const { punches, isIn } = getClockState();
  const today = new Date().toDateString();
  const todayPunches = punches.filter((p) => new Date(p.time).toDateString() === today);

  return `
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
        <div class="punch-list" id="punch-list">
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
    <article class="card table-card" style="margin-top:17px">
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
  const requests = loadStore("leaveRequests", []);

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
            <tbody id="leave-rows">
              ${leaveRows(requests)}
            </tbody>
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
  const requests = loadStore("attestationRequests", []);

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
            <tbody id="attestation-rows">
              ${attestationRows(requests)}
            </tbody>
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

function pageContent() {
  return {
    pointeuse: pointeusePage,
    leave: leavePage,
    attestations: attestationsPage
  }[currentPage]();
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
  const metadata = session?.user?.user_metadata || {};
  const name = metadata.full_name || metadata.name || getUserName();
  const email = session?.user?.email || "collaborateur@entreprise.fr";
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "CO";

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span>H</span> Humana</div>
        <button class="close-menu" type="button" aria-label="Fermer">x</button>
        <nav><p>ESPACE RH</p>${navigation.map((item) => `
          <button type="button" data-page="${item[0]}" class="${currentPage === item[0] ? "active" : ""}">
            <span class="nav-icon">${item[1]}</span>${item[2]}${navBadge(item[0])}
          </button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <div class="user-card">${avatar(initials)}<div><strong>${name}</strong><span>${email}</span></div><button type="button" id="logout" aria-label="Se deconnecter"></button></div>
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
  const diff = endDate - startDate;
  return Math.max(1, Math.floor(diff / (1000 * 60 * 60 * 24)) + 1);
}

function bindPageEvents() {
  document.querySelector("#clock-toggle")?.addEventListener("click", () => {
    const { punches, isIn } = getClockState();
    punches.push({ type: isIn ? "out" : "in", time: new Date().toISOString() });
    saveStore("punches", punches);
    currentPage = "pointeuse";
    renderApp();
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
    const requests = loadStore("leaveRequests", []);
    requests.unshift({
      id: Date.now(),
      type: data.get("type"),
      start,
      end,
      days: daysBetween(start, end),
      comment: data.get("comment") || "",
      status: "A valider",
      created: new Date().toISOString()
    });
    saveStore("leaveRequests", requests);
    form.reset();
    currentPage = "leave";
    renderApp();
  });

  document.querySelector("#attestation-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const requests = loadStore("attestationRequests", []);
    requests.unshift({
      id: Date.now(),
      type: data.get("type"),
      reason: data.get("reason"),
      status: "En attente",
      created: new Date().toISOString()
    });
    saveStore("attestationRequests", requests);
    form.reset();
    currentPage = "attestations";
    renderApp();
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
    renderLogin();
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
      window.humanaRender(window.__pendingAuthSession);
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

    supabaseClient.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession && event !== "SIGNED_OUT") {
        session = nextSession;
        demoMode = false;
        renderApp();
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
      renderApp();
      clearAuthParamsFromUrl();
    }
  } catch (error) {
    setLoginState({ ready: false, error: error.message || "Impossible de demarrer l'application." });
  }
}

window.humanaRender = function (authSession) {
  session = authSession;
  demoMode = false;
  ensureAppContainer();
  renderApp();
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
