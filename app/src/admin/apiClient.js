// Cliente HTTP compartido del backoffice.
//
// En local conserva dealer-demo.localhost / velocity-demo.localhost en vez de
// volver siempre a localhost; esto permite comprobar el aislamiento por dealer
// sin montar subdominios reales.
//
// Los módulos lo importan como `apiFetch as fetch` para no tener que reescribir
// las llamadas: el nombre local sigue siendo `fetch` y el comportamiento por
// defecto es idéntico al del navegador cuando no hay dealer de prueba.

const localApiOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;

export const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? localApiOrigin : window.location.origin);

const localDemoTenant = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("dealer")?.trim().toLowerCase() : "";
const nativeFetch = window.fetch.bind(window);

export function apiFetch(input, options = {}) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(localDemoTenant || "")) return nativeFetch(input, options);
  const headers = new Headers(options.headers || {});
  headers.set("X-Authentiq-Tenant", localDemoTenant);
  return nativeFetch(input, { ...options, headers });
}
