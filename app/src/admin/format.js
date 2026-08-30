// Formateadores compartidos del backoffice.
//
// Estaban dentro de Backoffice.jsx, pero los usan varios módulos y ninguno
// depende de React ni del estado: sacarlos permite reutilizarlos sin arrastrar
// el archivo entero.

function defaultCurrency() {
  try { return localStorage.getItem("authentiq_currency") || "USD"; } catch { return "USD"; }
}

export function formatPrice(value, currency = defaultCurrency()) {
  const safeCurrency = /^[A-Z]{3,8}$/.test(String(currency || "")) ? String(currency).toUpperCase() : "USD";
  return new Intl.NumberFormat(safeCurrency === "DOP" ? "es-DO" : "en-US", { style: "currency", currency: safeCurrency, currencyDisplay: "symbol", maximumFractionDigits: 0 }).format(Number(value || 0));
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-DO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const statusLabels = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Calificado",
  closed: "Cerrado",
  lost: "Perdido",
  pending: "Pendiente",
  accepted: "Aceptada",
  rejected: "Rechazada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  draft: "Borrador",
  sent: "Enviada",
  expired: "Vencida",
  archived: "Archivado",
  published: "Publicado",
  pending_review: "En revisión",
  reserved: "Reservado",
  sold: "Vendido",
  inactive: "Inactivo",
  trialing: "En prueba",
  connected: "Conectado",
  local_export_ready: "Exportación manual lista",
  drafts_ready: "Borradores listos",
  not_configured: "Falta configurar",
  oauth_ready: "Listo para conectar",
};

export function formatStatus(value) {
  const key = String(value || "").trim().toLowerCase();
  return statusLabels[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Sin estado";
}

export function formatPriority(value) {
  const priority = Number(value) || 2;
  return priority === 1 ? "Alta" : priority === 3 ? "Baja" : "Media";
}

export function formatRole(value) {
  return { admin: "Administrador", editor: "Operación", seller: "Ventas", content_editor: "Contenido" }[String(value || "").toLowerCase()] || formatStatus(value);
}

export function formatPlatform(value) {
  return { both: "Instagram + Facebook", instagram: "Instagram", facebook: "Facebook" }[String(value || "").toLowerCase()] || formatStatus(value);
}

export function formatLeadSource(value) {
  return { direct: "Directo", website: "Sitio web", contact: "Contacto", appointment: "Cita", offer: "Oferta", quote: "Cotización", import: "Importado" }[String(value || "").toLowerCase()] || String(value || "Directo");
}

export function slugify(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function publicVehiclePath(vehicle) {
  const base = slugify(`${vehicle.brand}-${vehicle.model}${vehicle.variant ? `-${vehicle.variant}` : ""}`);
  const suffix = String(vehicle.id || "").replace(/-/g, "").slice(0, 8);
  return `/vehiculos/${suffix ? `${base}-${suffix}` : base}`;
}
