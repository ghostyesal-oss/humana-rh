/* Humana boot: initialise Supabase et le flow OAuth Microsoft.
   Chargé après supabase-js et avant app.js. Partagé par tous les HTML (SPA + MPA). */
(function bootSupabase() {
  var config = window.HUMANA_CONFIG || {};
  var url = (config.API_URL || config.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  var key = config.SUPABASE_ANON_KEY || "local";
  var loginButton = document.getElementById("microsoft-login");
  var configNote = document.getElementById("config-note");

  if (!window.supabase || !window.supabase.createClient) {
    if (configNote) configNote.hidden = false;
    return;
  }

  window.__humanaSupabase = window.supabase.createClient(url, key, {
    auth: {
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
      appendPkceFlowIdToRedirects: true
    }
  });
  if (loginButton) loginButton.disabled = false;
  if (configNote) configNote.hidden = true;

  function getAuthRedirectTo() {
    try {
      var origin = window.location.origin || "";
      if (/^https?:$/i.test(window.location.protocol) && origin && origin !== "null") {
        return origin;
      }
    } catch (e) {}
    return config.REDIRECT_URL || "https://humana-rh.vercel.app";
  }
  window.humanaAuthRedirectTo = getAuthRedirectTo;

  function formatOAuthError(message) {
    if (!message) return "Impossible de finaliser la connexion Microsoft.";
    if (message.indexOf("code verifier") !== -1 || message.indexOf("PKCE") !== -1) {
      return "Connexion Microsoft interrompue : reconnectez-vous depuis l'adresse de production " + getAuthRedirectTo() + ".";
    }
    if (message.indexOf("Unable to exchange external code") !== -1) {
      return "Configuration Microsoft incorrecte. Vérifiez le secret Azure, l'URI de redirection Web https://votre-domaine/api/auth/microsoft/callback, et ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET sur le serveur.";
    }
    if (message.indexOf("Error getting user email") !== -1 || message.indexOf("n'a pas transmis") !== -1) {
      return "Microsoft n'a pas transmis l'e-mail. Ajoutez les autorisations email/openid et User.Read dans Entra.";
    }
    return message;
  }

  function showLoginError(message) {
    var errorBox = document.getElementById("login-error");
    if (!errorBox) return;
    errorBox.hidden = false;
    errorBox.textContent = formatOAuthError(message);
  }

  window.__pendingAuthSession = null;

  window.__authReady = (async function () {
    var params = new URLSearchParams(window.location.search);
    var oauthError = params.get("error");
    var oauthErrorDescription = params.get("error_description");
    if (oauthError || oauthErrorDescription) {
      showLoginError(decodeURIComponent((oauthErrorDescription || oauthError).replace(/\+/g, " ")));
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    var code = params.get("code");
    if (!code) return;

    try { sessionStorage.setItem("humana_auth_boot", "1"); } catch (e) {}
    document.documentElement.classList.add("auth-booting");

    var flowId = params.get("sb_flow_id") || undefined;
    try {
      var exchanged = await window.__humanaSupabase.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId: flowId } : undefined
      );
      window.history.replaceState({}, document.title, window.location.pathname);
      if (exchanged.error) throw exchanged.error;
      if (exchanged.data.session) {
        window.__pendingAuthSession = exchanged.data.session;
        try { sessionStorage.setItem("humana_ms_welcome", "1"); } catch (e) {}
      }
    } catch (err) {
      showLoginError(err.message || "Impossible de finaliser la connexion Microsoft.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  })();

  window.humanaOnSession = function (authSession) {
    window.__pendingAuthSession = authSession;
    window.__oauthHandled = true;

    function tryRender() {
      if (typeof window.humanaRender === "function") {
        window.humanaRender(authSession);
        return true;
      }
      return false;
    }

    if (!tryRender()) {
      var tries = 0;
      var timer = setInterval(function () {
        if (tryRender() || ++tries > 150) clearInterval(timer);
      }, 100);
    }
  };

  window.humanaApplyPendingSession = function () {
    if (window.__pendingAuthSession && typeof window.humanaRender === "function") {
      window.humanaRender(window.__pendingAuthSession);
    }
  };

  window.humanaSignIn = async function () {
    if (window.__oauthStarting) return;
    var errorBox = document.getElementById("login-error");
    var client = window.__humanaSupabase;
    if (!client) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = "Connexion indisponible. Rechargez la page.";
      }
      return;
    }
    try {
      window.__oauthStarting = true;
      if (loginButton) loginButton.disabled = true;
      try { sessionStorage.setItem("humana_ms_welcome", "1"); } catch (e) {}
      try { sessionStorage.setItem("humana_auth_boot", "1"); } catch (e) {}
      document.documentElement.classList.add("auth-booting");
      var result = await client.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: getAuthRedirectTo(),
          scopes: "openid email profile"
        }
      });
      if (result.error) {
        window.__oauthStarting = false;
        if (errorBox) {
          errorBox.hidden = false;
          errorBox.textContent = result.error.message;
        }
        if (loginButton) loginButton.disabled = false;
      }
    } catch (err) {
      window.__oauthStarting = false;
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = err.message || "Erreur de connexion.";
      }
      if (loginButton) loginButton.disabled = false;
    }
  };

  if (loginButton) {
    loginButton.addEventListener("click", window.humanaSignIn);
    loginButton.dataset.humanaBound = "1";
  }
  var demoButton = document.getElementById("demo-login");
  if (demoButton) {
    demoButton.addEventListener("click", function () {
      function tryDemo() {
        if (typeof window.humanaStartDemo === "function") {
          window.humanaStartDemo();
          return true;
        }
        return false;
      }
      if (!tryDemo()) {
        var tries = 0;
        var timer = setInterval(function () {
          if (tryDemo() || ++tries > 150) {
            clearInterval(timer);
            if (tries > 150) {
              showLoginError("Application non chargée. Videz le cache (Ctrl+Shift+R) et rechargez.");
            }
          }
        }, 100);
      }
    });
    demoButton.dataset.humanaBound = "1";
  }
})();

window.addEventListener("error", function (event) {
  if (event.filename && event.filename.indexOf("app.js") !== -1) {
    var errorBox = document.getElementById("login-error");
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = "Erreur application : " + event.message;
    }
  }
}, true);
