import { useEffect, useRef, useState } from "react";

export default function ConnectionStatusBanner() {
  const [status, setStatus] = useState(() => (navigator.onLine ? "online" : "offline"));
  const timeoutRef = useRef(null);

  useEffect(() => {
    const showOffline = () => {
      window.clearTimeout(timeoutRef.current);
      setStatus("offline");
    };
    const showOnline = () => {
      setStatus("restored");
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setStatus("online"), 4200);
    };
    window.addEventListener("offline", showOffline);
    window.addEventListener("online", showOnline);
    return () => {
      window.removeEventListener("offline", showOffline);
      window.removeEventListener("online", showOnline);
      window.clearTimeout(timeoutRef.current);
    };
  }, []);

  if (status === "online") return null;
  const isOffline = status === "offline";
  return (
    <aside className={`network-status-banner${isOffline ? " is-offline" : " is-restored"}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="network-status-dot" aria-hidden="true" />
      <span>{isOffline ? "Sin conexión. Tus cambios no se enviarán hasta recuperar internet." : "Conexión restablecida. Ya puedes continuar."}</span>
    </aside>
  );
}
