// Service worker mínimo: permite instalar la PWA sin cachear inventario,
// formularios ni información sensible del concesionario.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
