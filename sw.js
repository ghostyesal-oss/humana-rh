/* Humana Service Worker - gère les notifications push (rappel de pointage). */

const SW_VERSION = "humana-sw-2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "⏰ Pointage oublié",
    body: "Pense à pointer ton arrivée sur Humana.",
    url: "/"
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch (error) {
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    tag: payload.tag || "humana-late-reminder",
    renotify: true,
    requireInteraction: true,
    badge: "/favicon.ico",
    icon: "/favicon.ico",
    data: { url: payload.url || "/" }
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clientsList.find((client) => client.url.includes(self.location.origin));
    if (existing) {
      existing.focus();
      existing.postMessage({ type: "humana:open-page", page: "pointeuse" });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "humana:skip-waiting") self.skipWaiting();
});
