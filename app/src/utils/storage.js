// El almacenamiento del navegador puede estar bloqueado (modo privado,
// políticas corporativas o cuota agotada). La interfaz debe seguir funcionando
// aunque no pueda recordar preferencias.
export function getStoredValue(key, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // La persistencia es opcional; nunca debe bloquear una acción del usuario.
  }
}

export function removeStoredValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // La persistencia es opcional; nunca debe bloquear una acción del usuario.
  }
}
