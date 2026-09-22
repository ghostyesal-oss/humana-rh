/* Humana pre-boot: exécuté avant tout le reste (thème, anti-clickjacking, splash).
   Chargé de manière synchrone en tête de <head> pour éviter les FOUC. */
(function () {
  try {
    if (window.top !== window.self) {
      window.top.location = window.self.location;
    }
  } catch (e) {
    document.documentElement.style.display = "none";
  }
})();

(function () {
  var stored = localStorage.getItem("humana-theme");
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = stored === "dark" || stored === "light" ? stored : (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0b1220" : "#022341";
})();

(function () {
  var params = new URLSearchParams(window.location.search);
  var booting = params.has("code");
  if (!booting) {
    try { booting = sessionStorage.getItem("humana_auth_boot") === "1"; } catch (e) {}
  }
  if (!booting) {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf("-auth-token") !== -1) {
          var val = localStorage.getItem(key);
          if (val && val.indexOf("access_token") !== -1) { booting = true; break; }
        }
      }
    } catch (e) {}
  }
  if (booting) document.documentElement.classList.add("auth-booting");
})();
