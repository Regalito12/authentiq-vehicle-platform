// Los fallos de red no producen un mensaje presentable: `fetch` lanza
// "Failed to fetch" (Chrome), "NetworkError when attempting to fetch resource"
// (Firefox) o "Load failed" (Safari), siempre en inglés y en términos técnicos.
// Ese texto llegaba tal cual al formulario de captación, delante del cliente.
//
// Los errores que sí vienen del servidor ya están redactados en español y son
// accionables ("Ese correo ya está registrado"), así que se respetan intactos:
// esto solo sustituye los que el navegador genera por su cuenta.

const FALLOS_DE_RED = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "fetch failed",
  "err_internet_disconnected",
];

const SIN_CONEXION = "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
const TIEMPO_AGOTADO = "La solicitud tardó demasiado. Inténtalo de nuevo en un momento.";

/**
 * Convierte un error capturado en un mensaje que se le puede enseñar a una
 * persona. `respaldo` se usa cuando el error no trae texto utilizable.
 */
export function mensajeDeError(error, respaldo = "No pudimos completar la operación. Inténtalo de nuevo.") {
  if (!error) return respaldo;
  if (error.name === "AbortError" || error.name === "TimeoutError") return TIEMPO_AGOTADO;
  const texto = String(error.message || "").trim();
  if (!texto) return respaldo;
  const normalizado = texto.toLowerCase();
  if (FALLOS_DE_RED.some((patron) => normalizado.includes(patron))) return SIN_CONEXION;
  // Un mensaje sin espacios y con guiones bajos suele ser un código interno
  // (p. ej. "ERR_BAD_REQUEST"), no algo que se le pueda enseñar a nadie.
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(texto)) return respaldo;
  return texto;
}
