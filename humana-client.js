/* Client Humana : même surface que supabase-js, appelle /api (Postgres + Microsoft). */
(function () {
  function apiBase() {
    var config = window.HUMANA_CONFIG || {};
    var url = (config.API_URL || "").replace(/\/$/, "");
    return url;
  }

  var csrfToken = "";

  function loadCsrf() {
    return fetch(apiBase() + "/api/auth/csrf", {
      credentials: "include",
      headers: { "Accept": "application/json" }
    }).then(function (res) { return res.json(); }).then(function (json) {
      csrfToken = json.csrfToken || "";
      return csrfToken;
    });
  }

  function request(path, options) {
    var opts = options || {};
    var method = opts.method || "GET";
    var headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    var needsCsrf = method !== "GET" && method !== "HEAD";
    var send = function () {
      if (needsCsrf && csrfToken) headers["X-CSRF-Token"] = csrfToken;
      return fetch(apiBase() + path, {
        method: method,
        credentials: "include",
        headers: headers,
        body: opts.body
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok && !json.error) json.error = { message: "Erreur " + res.status };
          json.__status = res.status;
          return json;
        });
      });
    };
    var run = needsCsrf && !csrfToken ? loadCsrf().then(send) : send();
    return run.then(function (json) {
      if (needsCsrf && json.__status === 403 && String(json.error && json.error.message || "").toLowerCase().indexOf("csrf") !== -1) {
        csrfToken = "";
        return loadCsrf().then(send);
      }
      return json;
    });
  }

  function createBuilder(table) {
    var state = {
      table: table,
      op: "select",
      select: "*",
      filters: [],
      order: null,
      limit: null,
      payload: null,
      onConflict: null,
      maybeSingle: false,
      single: false
    };

    function add(op, column, value) {
      state.filters.push({ op: op, column: column, value: value });
      return api;
    }

    function execute() {
      return request("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
    }

    var api = {
      select: function (cols) { state.select = cols || "*"; return api; },
      eq: function (column, value) { return add("eq", column, value); },
      neq: function (column, value) { return add("neq", column, value); },
      gte: function (column, value) { return add("gte", column, value); },
      lte: function (column, value) { return add("lte", column, value); },
      gt: function (column, value) { return add("gt", column, value); },
      lt: function (column, value) { return add("lt", column, value); },
      in: function (column, value) { return add("in", column, value); },
      is: function (column, value) { return add("is", column, value); },
      order: function (column, opts) {
        state.order = { column: column, ascending: !opts || opts.ascending !== false };
        return api;
      },
      limit: function (n) { state.limit = n; return api; },
      maybeSingle: function () { state.maybeSingle = true; return execute(); },
      single: function () { state.single = true; return execute(); },
      insert: function (payload) { state.op = "insert"; state.payload = payload; return api; },
      update: function (payload) { state.op = "update"; state.payload = payload; return api; },
      delete: function () { state.op = "delete"; return api; },
      upsert: function (payload, opts) {
        state.op = "upsert";
        state.payload = payload;
        state.onConflict = opts && opts.onConflict;
        return api;
      },
      then: function (resolve, reject) { return execute().then(resolve, reject); }
    };
    return api;
  }

  function createStorage(bucket) {
    return {
      upload: function (path, file) {
        var body = new FormData();
        body.append("path", path);
        body.append("file", file);
        return request("/api/storage/" + encodeURIComponent(bucket), { method: "POST", body: body });
      },
      createSignedUrl: function (path) {
        return request("/api/storage/" + encodeURIComponent(bucket) + "/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path })
        });
      },
      getPublicUrl: function (path) {
        return { data: { publicUrl: apiBase() + "/api/storage/" + encodeURIComponent(bucket) + "?path=" + encodeURIComponent(path) } };
      },
      remove: function (paths) {
        return request("/api/storage/" + encodeURIComponent(bucket) + "/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: paths })
        });
      }
    };
  }

  var authListeners = [];

  function notify(event, session) {
    authListeners.forEach(function (cb) { try { cb(event, session); } catch (e) {} });
  }

  function createClient() {
    return {
      from: createBuilder,
      rpc: function (name, args) {
        return request("/api/rpc/" + encodeURIComponent(name), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args || {})
        });
      },
      storage: { from: createStorage },
      auth: {
        signInWithOAuth: function () {
          window.location.href = apiBase() + "/api/auth/microsoft";
          return Promise.resolve({ data: {}, error: null });
        },
        getSession: function () {
          return request("/api/auth/session").then(function (json) {
            return { data: { session: json.data && json.data.session }, error: json.error };
          });
        },
        refreshSession: function () {
          return request("/api/auth/refresh", { method: "POST" }).then(function (json) {
            if (json.data && json.data.session) notify("TOKEN_REFRESHED", json.data.session);
            return { data: { session: json.data && json.data.session }, error: json.error };
          });
        },
        signOut: function () {
          return request("/api/auth/logout", { method: "POST" }).then(function () {
            notify("SIGNED_OUT", null);
            return { error: null };
          });
        },
        onAuthStateChange: function (cb) {
          authListeners.push(cb);
          request("/api/auth/session").then(function (json) {
            var session = json.data && json.data.session;
            cb(session ? "INITIAL_SESSION" : "SIGNED_OUT", session || null);
          });
          return { data: { subscription: { unsubscribe: function () {
            authListeners = authListeners.filter(function (item) { return item !== cb; });
          } } } };
        },
        exchangeCodeForSession: function () {
          return request("/api/auth/session").then(function (json) {
            return { data: { session: json.data && json.data.session }, error: json.error };
          });
        }
      }
    };
  }

  window.supabase = { createClient: createClient };
})();
