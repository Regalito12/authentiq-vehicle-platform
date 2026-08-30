// Los mensajes de validación nativos ("Please fill out this field", "Please
// include an '@' in the email address") los redacta el navegador en el idioma
// de SU interfaz, no en el del documento. En un sitio en español atendido desde
// equipos con Windows en inglés, el cliente veía el aviso en inglés justo en el
// formulario de contacto. Aquí se sustituyen por texto propio en español.
//
// Se engancha una sola vez a nivel de documento, en fase de captura, para que
// cubra también los formularios que se montan después (modales, pasos, wizard).

function textoPara(campo) {
  const v = campo.validity;
  if (v.valueMissing) {
    if (campo.type === "checkbox") return "Marca esta casilla para continuar.";
    if (campo.tagName === "SELECT") return "Elige una opción.";
    return "Completa este campo.";
  }
  if (v.typeMismatch) {
    if (campo.type === "email") return "Escribe un correo válido, por ejemplo nombre@dominio.com.";
    if (campo.type === "url") return "Escribe una dirección web válida.";
    return "El formato no es válido.";
  }
  if (v.patternMismatch) return "El formato no coincide con el esperado.";
  if (v.tooShort) return `Escribe al menos ${campo.minLength} caracteres.`;
  if (v.tooLong) return `Como máximo ${campo.maxLength} caracteres.`;
  if (v.rangeUnderflow) return `El valor mínimo es ${campo.min}.`;
  if (v.rangeOverflow) return `El valor máximo es ${campo.max}.`;
  if (v.stepMismatch) return "Ese valor no es un incremento permitido.";
  if (v.badInput) return "Revisa el valor introducido.";
  return "";
}

export function instalarMensajesDeValidacion() {
  const alInvalidar = (evento) => {
    const campo = evento.target;
    if (!campo || typeof campo.setCustomValidity !== "function") return;
    campo.setCustomValidity(textoPara(campo));
  };
  // Al escribir hay que limpiar el mensaje propio: si no, el campo queda
  // marcado como inválido para siempre aunque la persona ya lo haya corregido.
  const alEditar = (evento) => {
    const campo = evento.target;
    if (campo && typeof campo.setCustomValidity === "function" && campo.validationMessage) campo.setCustomValidity("");
  };
  document.addEventListener("invalid", alInvalidar, true);
  document.addEventListener("input", alEditar, true);
  document.addEventListener("change", alEditar, true);
  return () => {
    document.removeEventListener("invalid", alInvalidar, true);
    document.removeEventListener("input", alEditar, true);
    document.removeEventListener("change", alEditar, true);
  };
}
