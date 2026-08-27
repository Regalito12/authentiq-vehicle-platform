import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App.jsx";
import "./styles.css";
import { initMonitoring } from "./utils/monitoring.js";

// No bloquea el primer render: si no hay DSN configurado, no hace nada.
initMonitoring();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
      <SpeedInsights />
    </MotionConfig>
  </React.StrictMode>,
);
