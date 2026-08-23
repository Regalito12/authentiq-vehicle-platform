// Monitoreo de errores del backend.
//
// Sin SENTRY_DSN todo esto es un no-op: ni carga el SDK ni envía nada. El
// servidor arranca igual con o sin cuenta de Sentry.
//
// Para activarlo: pon SENTRY_DSN en las variables de entorno de Render.

const dsn = process.env.SENTRY_DSN || "";
let client = null;

export const monitoringEnabled = Boolean(dsn);

export async function initMonitoring() {
  if (!dsn) return null;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.RENDER_GIT_COMMIT || undefined,
      tracesSampleRate: 0.1,
      // Nunca enviamos datos personales de compradores ni vendedores a un tercero.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.data;
          if (event.request.headers) delete event.request.headers.authorization;
          if (event.request.query_string) delete event.request.query_string;
        }
        delete event.user;
        return event;
      },
    });
    client = Sentry;
    console.log("Monitoreo de errores activo");
    return Sentry;
  } catch (error) {
    console.warn("Monitoreo no disponible", error?.message || error);
    return null;
  }
}

// Registra el error con el concesionario y la ruta, que es lo que permite saber
// qué dealer está roto sin guardar quién es la persona afectada.
export function reportServerError(error, { tenant, route, method, role } = {}) {
  if (!client) return;
  try {
    client.withScope((scope) => {
      if (tenant) scope.setTag("tenant", String(tenant));
      if (route) scope.setTag("route", String(route));
      if (method) scope.setTag("method", String(method));
      if (role) scope.setTag("role", String(role));
      client.captureException(error);
    });
  } catch {}
}
