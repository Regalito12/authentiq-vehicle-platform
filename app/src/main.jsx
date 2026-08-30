import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App.jsx";
import "./styles.css";
import { initMonitoring } from "./utils/monitoring.js";
import { instalarMensajesDeValidacion } from "./utils/validacion.js";
import { registerSW } from "virtual:pwa-register";

// No bloquea el primer render: si no hay DSN configurado, no hace nada.
initMonitoring();

// El navegador redacta los avisos de validación en el idioma de su interfaz,
// no en el del documento: en un equipo con Windows en inglés el formulario
// respondía "Please fill out this field" en un sitio en español.
instalarMensajesDeValidacion();

// El service worker detecta los assets de un deploy nuevo. La UI decide cuándo
// aplicar la actualización para no interrumpir formularios o ediciones.
const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__zevroaUpdateAvailable = true;
    window.dispatchEvent(new Event("zevroa:update-available"));
  },
});
window.__zevroaApplyUpdate = () => updateServiceWorker(true);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
