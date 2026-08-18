const { SUPABASE_URL = "", SUPABASE_ANON_KEY = "" } = window.HUMANA_CONFIG || {};
const normalizedSupabaseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
let supabase = null;
let app = null;
let session = null;
let demoMode = false;
let portalMode = false;
let currentPage = "dashboard";

const pages = {
  dashboard: ["Bonjour Sophie 👋", "Voici ce qui se passe dans votre entreprise aujourd’hui."],
  employees: ["Collaborateurs", "Gérez les profils, les équipes et les informations RH."],
  leave: ["Congés & absences", "Suivez les demandes et les soldes de congés."],
  documents: ["Documents", "Centralisez et partagez les documents de l’entreprise."],
  recruitment: ["Recrutement", "Pilotez vos offres et votre vivier de candidats."],
  reviews: ["Évaluations", "Préparez et suivez les campagnes d’entretien."]
};

const navigation = [
  ["dashboard", "▦", "Tableau de bord"],
  ["employees", "♙", "Collaborateurs"],
  ["leave", "▣", "Congés & absences"],
  ["documents", "▤", "Documents"],
  ["recruitment", "▱", "Recrutement"],
  ["reviews", "☑", "Évaluations"]
];

const employees = [
  ["Sophie Martin", "Responsable RH", "Ressources humaines", "Actif", "SM", "violet"],
  ["Thomas Bernard", "Lead développeur", "Produit & Tech", "Actif", "TB", "blue"],
  ["Lina Benali", "Product designer", "Produit & Tech", "En congé", "LB", "orange"],
  ["Hugo Leroy", "Commercial grands comptes", "Ventes", "Actif", "HL", "green"],
  ["Emma Petit", "Contrôleuse de gestion", "Finance", "Actif", "EP", "pink"]
];

const leaveRequests = [
  ["Lina Benali", "Congés payés", "19 – 30 août 2026", "10 jours", "Approuvée", "LB"],
  ["Hugo Leroy", "RTT", "21 août 2026", "1 jour", "À valider", "HL"],
  ["Thomas Bernard", "Congés payés", "7 – 11 septembre 2026", "5 jours", "À valider", "TB"]
];

const documents = [
  ["Politique de télétravail", "Politiques RH", "12 août 2026", "PDF"],
  ["Guide d’intégration", "Onboarding", "8 août 2026", "PDF"],
  ["Modèle d’entretien annuel", "Évaluations", "2 août 2026", "DOCX"],
  ["Charte informatique", "Conformité", "28 juillet 2026", "PDF"]
];

const jobs = [
  ["Développeur·se full-stack", "Produit & Tech", 12, "Entretiens", "blue"],
  ["Account executive", "Ventes", 8, "Sélection", "green"],
  ["Office manager", "Opérations", 5, "Publiée", "orange"]
];

const reviews = [
  ["Thomas Bernard", "S1 2026", 100, "Terminée", "4,6 / 5"],
  ["Emma Petit", "S1 2026", 70, "En cours", "—"],
  ["Hugo Leroy", "S1 2026", 30, "À compléter", "—"]
];

const avatar = (initials, color = "violet") =>
  `<span class="avatar ${color}">${initials}</span>`;

function badge(value) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("actif") || normalized.includes("approuv") || normalized.includes("termin")
    ? "success"
    : normalized.includes("valid") || normalized.includes("cours") || normalized.includes("compléter")
      ? "warning"
      : "neutral";
  return `<span class="badge ${tone}">${value}</span>`;
}

function bindLoginEvents() {
  document.querySelector("#demo-login")?.addEventListener("click", () => {
    demoMode = true;
    renderApp();
  });
  document.querySelector("#microsoft-login")?.addEventListener("click", signInWithMicrosoft);
}

function setLoginState({ ready = false, error = "" } = {}) {
  const microsoftButton = document.querySelector("#microsoft-login");
  const configNote = document.querySelector("#config-note");
  const errorMessage = document.querySelector("#login-error");

  if (microsoftButton) microsoftButton.disabled = !ready;
  if (configNote) configNote.hidden = ready;
  if (errorMessage) {
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
            <button id="microsoft-login" class="microsoft-button" disabled>Continuer avec Microsoft</button>
            <div id="config-note" class="config-note">Connexion en cours de preparation...</div>
            <p id="login-error" class="error-message" hidden></p>
            <button id="demo-login" class="demo-button">Voir l'apercu de demonstration</button>
          </div>
        </section>
      </main>`;
  }

  bindLoginEvents();
  setLoginState({ ready: Boolean(supabase), error });
}

async function signInWithMicrosoft() {
  if (!supabase) return;
  const button = document.querySelector("#microsoft-login");
  button.disabled = true;
  button.lastChild.textContent = " Redirection…";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: { redirectTo: window.location.origin, scopes: "email" }
  });
  if (error) renderLogin(error.message);
}

function dashboardPage() {
  return `
    <section class="stats-grid">
      ${statCard("♙", "Collaborateurs", "48", "+3 ce mois", "purple")}
      ${statCard("▣", "Absents aujourd’hui", "4", "Voir le planning", "orange")}
      ${statCard("▱", "Postes ouverts", "3", "25 candidats", "blue")}
      ${statCard("☑", "Entretiens à faire", "7", "Avant le 31 août", "green")}
    </section>
    <section class="dashboard-grid">
      <div class="card">
        ${cardHeading("Demandes à valider", "Tout voir")}
        ${leaveRequests.slice(1).map(request => `
          <div class="request-item">${avatar(request[5])}
            <div><strong>${request[0]}</strong><span>${request[1]} · ${request[2]}</span></div>
            <div class="quick-actions"><button aria-label="Refuser">×</button><button class="approve" aria-label="Approuver">✓</button></div>
          </div>`).join("")}
      </div>
      <div class="card">
        ${cardHeading("Équipe en un coup d’œil", "Organigramme")}
        <div class="team-chart">
          <div class="donut"><div><strong>48</strong><span>personnes</span></div></div>
          <div class="legend">
            <span><i class="dot purple"></i>Produit & Tech <b>18</b></span>
            <span><i class="dot blue"></i>Ventes <b>12</b></span>
            <span><i class="dot orange"></i>Opérations <b>10</b></span>
            <span><i class="dot green"></i>Autres <b>8</b></span>
          </div>
        </div>
      </div>
    </section>`;
}

const statCard = (icon, label, value, detail, tone) => `
  <article class="stat-card"><div class="stat-icon ${tone}">${icon}</div><span>${label}</span><strong>${value}</strong><small>${detail} ↗</small></article>`;

const cardHeading = (title, action) => `
  <div class="card-heading"><h3>${title}</h3><button>${action} ›</button></div>`;

function employeesPage() {
  return `
    <div class="card table-card">
      <div class="toolbar"><label class="search-box">⌕ <input id="employee-search" placeholder="Rechercher un collaborateur…"></label><button class="primary">＋ Ajouter</button></div>
      <div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Équipe</th><th>Statut</th><th></th></tr></thead>
      <tbody id="employee-rows">${employeeRows(employees)}</tbody></table></div>
    </div>`;
}

function employeeRows(list) {
  return list.map(employee => `
    <tr><td><div class="person">${avatar(employee[4], employee[5])}<div><strong>${employee[0]}</strong><span>${employee[1]}</span></div></div></td>
    <td>${employee[2]}</td><td>${badge(employee[3])}</td><td><button class="icon-button">•••</button></td></tr>`).join("");
}

function leavePage() {
  return `
    <div class="card table-card">
      <div class="toolbar"><div class="tabs"><button class="active">Demandes</button><button>Calendrier</button><button>Soldes</button></div><button class="primary">＋ Nouvelle demande</button></div>
      <div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Type</th><th>Dates</th><th>Durée</th><th>Statut</th></tr></thead><tbody>
      ${leaveRequests.map(request => `<tr><td><div class="person">${avatar(request[5])}<strong>${request[0]}</strong></div></td><td>${request[1]}</td><td>${request[2]}</td><td>${request[3]}</td><td>${badge(request[4])}</td></tr>`).join("")}
      </tbody></table></div>
    </div>`;
}

function documentsPage() {
  return `<section class="document-grid">${documents.map(document => `
    <article class="document-card"><div class="file-icon">▤</div><div><strong>${document[0]}</strong><span>${document[1]}</span><small>Mis à jour le ${document[2]}</small></div><span class="file-type">${document[3]}</span></article>`).join("")}</section>`;
}

function recruitmentPage() {
  return `<section class="jobs-grid">${jobs.map(job => `
    <article class="card job-card"><div class="job-icon ${job[4]}">▱</div>${badge(job[3])}<h3>${job[0]}</h3><p>${job[1]}</p><div class="candidate-count">♙ <strong>${job[2]}</strong> candidats</div><button class="outline-button">Voir le poste ›</button></article>`).join("")}</section>`;
}

function reviewsPage() {
  return `<div class="card reviews-card">${cardHeading("Campagne d’entretiens · S1 2026", "Configurer")}
    ${reviews.map(review => `<div class="review-row"><div><strong>${review[0]}</strong><span>${review[1]}</span></div><div class="progress"><i style="width:${review[2]}%"></i></div><b>${review[2]}%</b>${badge(review[3])}<strong>${review[4]}</strong></div>`).join("")}</div>`;
}

function pageContent() {
  return {
    dashboard: dashboardPage,
    employees: employeesPage,
    leave: leavePage,
    documents: documentsPage,
    recruitment: recruitmentPage,
    reviews: reviewsPage
  }[currentPage]();
}

function renderApp() {
  const metadata = session?.user?.user_metadata || {};
  const name = metadata.full_name || metadata.name || "Sophie Martin";
  const email = session?.user?.email || "sophie@entreprise.fr";
  const initials = name.split(" ").map(part => part[0]).slice(0, 2).join("");

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span>H</span> Humana</div>
        <button class="close-menu" aria-label="Fermer">×</button>
        <nav><p>ESPACE RH</p>${navigation.map(item => `
          <button data-page="${item[0]}" class="${currentPage === item[0] ? "active" : ""}"><span class="nav-icon">${item[1]}</span>${item[2]}${item[0] === "leave" ? "<i>2</i>" : ""}</button>`).join("")}</nav>
        <div class="sidebar-bottom">
          <button><span class="nav-icon">⚙</span> Paramètres</button>
          <div class="user-card">${avatar(initials)}<div><strong>${name}</strong><span>${email}</span></div><button id="logout" aria-label="Se déconnecter">↪</button></div>
        </div>
      </aside>
      <button class="backdrop" aria-label="Fermer le menu"></button>
      <main class="main-content">
        <header class="topbar"><button class="menu-button" aria-label="Menu">☰</button><div class="top-search">⌕ <span>Rechercher…</span><kbd>Ctrl K</kbd></div><button class="notification" aria-label="Notifications">♢<i></i></button><button class="primary compact">＋ Action rapide</button></header>
        <div class="page">
          <div class="page-heading"><div><h1>${pages[currentPage][0]}</h1><p>${pages[currentPage][1]}</p></div>${demoMode ? `<span class="demo-pill">Mode démo</span>` : ""}</div>
          <div id="page-content">${pageContent()}</div>
        </div>
      </main>
    </div>`;

  bindAppEvents();
}

function bindAppEvents() {
  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      currentPage = button.dataset.page;
      renderApp();
    });
  });
  const sidebar = document.querySelector(".sidebar");
  const backdrop = document.querySelector(".backdrop");
  document.querySelector(".menu-button").addEventListener("click", () => sidebar.classList.add("open"));
  document.querySelector(".close-menu").addEventListener("click", () => sidebar.classList.remove("open"));
  backdrop.addEventListener("click", () => sidebar.classList.remove("open"));
  document.querySelector("#logout").addEventListener("click", async () => {
    if (portalMode) {
      window.location.href = "/_services/auth/logout";
      return;
    }
    if (session && supabase) await supabase.auth.signOut();
    session = null;
    demoMode = false;
    renderLogin();
  });
  document.querySelector("#employee-search")?.addEventListener("input", event => {
    const query = event.target.value.toLowerCase();
    const filtered = employees.filter(employee => employee.join(" ").toLowerCase().includes(query));
    document.querySelector("#employee-rows").innerHTML = employeeRows(filtered);
  });
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
    ".navbar .user-name, .navbar .username, a[title*='Sign Out'], a[title*='Déconnexion']"
  );
  const visibleName = userElement?.textContent?.trim();
  if (visibleName) return { name: visibleName.replace(/^Signed in as\s*/i, ""), email: "" };

  const pageText = document.body.innerText || "";
  const match = pageText.match(/Signed in as\s+([^\n]+)/i);
  return match ? { name: match[1].trim(), email: "" } : null;
}

function getSupabaseClient() {
  if (!normalizedSupabaseUrl || !SUPABASE_ANON_KEY) return null;
  if (!window.supabase?.createClient) return null;
  return window.supabase.createClient(normalizedSupabaseUrl, SUPABASE_ANON_KEY);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms))
  ]);
}

async function initialize() {
  try {
    ensureAppContainer();
    bindLoginEvents();

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

    supabase = getSupabaseClient();
    if (!supabase) {
      setLoginState({ ready: false, error: "" });
      return;
    }

    setLoginState({ ready: true });

    const result = await withTimeout(supabase.auth.getSession(), 4000);
    session = result?.data?.session ?? null;
    if (session) renderApp();

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      session ? renderApp() : renderLogin();
    });
  } catch (error) {
    setLoginState({ ready: false, error: error.message || "Impossible de demarrer l'application." });
  }
}

initialize();
