self.addEventListener("push", (e) => {
  try {
    const data = e.data ? e.data.json() : { title: "Nicotine Hub", body: "New event" };
    const title = data.title || "Nicotine Hub";
    const body = data.body || "";
    e.waitUntil(self.registration.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png" }));
  } catch {}
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow("/"));
});
