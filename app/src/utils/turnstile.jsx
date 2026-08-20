import { useEffect, useRef, useState } from "react";

export const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();

let turnstileLoader;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-authentiq-turnstile]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile no pudo cargar")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.authentiqTurnstile = "true";
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error("Turnstile no pudo cargar"));
    document.head.appendChild(script);
  });
  return turnstileLoader;
}

export function TurnstileField({ onTokenChange }) {
  const containerRef = useRef(null);
  const [state, setState] = useState("loading");
  useEffect(() => {
    onTokenChange("");
    if (!turnstileSiteKey) return undefined;
    let active = true;
    let widgetId = null;
    loadTurnstile().then((turnstile) => {
      if (!active || !turnstile || !containerRef.current) return;
      widgetId = turnstile.render(containerRef.current, {
        sitekey: turnstileSiteKey,
        theme: "auto",
        callback: (token) => { if (active) { onTokenChange(token); setState("ready"); } },
        "expired-callback": () => { if (active) { onTokenChange(""); setState("expired"); } },
        "error-callback": () => { if (active) { onTokenChange(""); setState("error"); } },
      });
    }).catch(() => { if (active) setState("error"); });
    return () => {
      active = false;
      if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onTokenChange]);
  if (!turnstileSiteKey) return null;
  return <div className="turnstile-field"><div ref={containerRef} />{state === "error" && <p className="state-message error">No pudimos cargar la verificación de seguridad. Revisa tu conexión e intenta nuevamente.</p>}{state === "expired" && <p className="state-message error">La verificación venció. Complétala otra vez para continuar.</p>}</div>;
}
