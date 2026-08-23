// Monitoreo de errores del frontend.
//
// Sin VITE_SENTRY_DSN todo esto es un no-op: en local y en cualquier despliegue
// sin la clave configurada no se envía nada ni se carga el SDK. Así el sistema
// funciona igual con o sin cuenta de Sentry, y no obliga a tener una para
// desarrollar.
//
// Para activarlo: crea el proyecto en sentry.io, copia el DSN y ponlo como
// VITE_SENTRY_DSN en las variables de entorno del despliegue (Render/Vercel).

const dsn = import.meta.env.VITE_SENTRY_DSN || "";
let client = null;

export const monitoringEnabled = Boolean(dsn);

export async function initMonitoring() {
  if (!dsn) return null;
  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_RELEASE || undefined,
      // Muestreo bajo: interesa saber que algo falla, no medir cada visita.
      tracesSampleRate: 0.1,
      // Nunca enviamos datos del comprador ni del vendedor a un tercero.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request?.url) event.request.url = event.request.url.split("?")[0];
        delete event.user;
        return event;
      },
    });
    client = Sentry;
    return Sentry;
  } catch (error) {
    console.warn("[AUTHENTIQ] Monitoreo no disponible", error);
    return null;
  }
}

// Identifica al concesionario, no a la persona: permite saber qué dealer está
// fallando sin guardar datos personales.
export function setMonitoringTenant(tenant) {
  if (!client || !tenant) return;
  try { client.setTag("tenant", String(tenant)); } catch {}
}

export function reportError(error, context = {}) {
  if (!client) return;
  try { client.captureException(error, { extra: context }); } catch {}
}
