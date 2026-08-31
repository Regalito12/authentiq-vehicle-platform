import { useEffect, useState } from "react";

export default function UpdateBanner() {
  const [visible, setVisible] = useState(() => Boolean(window.__zevroaUpdateAvailable));
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("zevroa:update-available", show);
    return () => window.removeEventListener("zevroa:update-available", show);
  }, []);

  if (!visible) return null;

  const applyUpdate = async () => {
    setUpdating(true);
    try {
      if (typeof window.__zevroaApplyUpdate === "function") {
        await window.__zevroaApplyUpdate();
        return;
      }
    } catch {
      // El fallback mantiene recuperable el aviso si el SW no responde.
    }
    window.location.reload();
  };

  return (
    <aside className="app-update-banner" role="status" aria-live="polite" aria-atomic="true">
      <div className="app-update-banner-copy">
        <span className="app-update-banner-mark" aria-hidden="true">↻</span>
        <div>
          <strong>Hay una nueva versión de ZEVROA.</strong>
          <span>Actualiza cuando estés listo para cargar las mejoras.</span>
        </div>
      </div>
      <div className="app-update-banner-actions">
        <button type="button" className="app-update-dismiss" onClick={() => setVisible(false)} disabled={updating}>
          Ahora no
        </button>
        <button type="button" className="app-update-action" onClick={applyUpdate} disabled={updating}>
          {updating ? "Actualizando…" : "Actualizar ahora"}
        </button>
      </div>
    </aside>
  );
}
