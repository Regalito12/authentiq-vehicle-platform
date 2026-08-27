import { useEffect, useState } from "react";
import { TurnstileField } from "../utils/turnstile.jsx";
import { apiFetch as fetch } from "./apiClient.js";

// Alta de un concesionario nuevo en la plataforma. Vive fuera de Backoffice.jsx
// porque es un flujo cerrado: se usa una sola vez por dealer, antes de que
// exista sesión, y no comparte estado con ningún módulo de operación.

export default function DealerRegistrationWizard({ onRegisterSuccess, onCancel, apiUrl }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registeredData, setRegisteredData] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Al pasar de paso el formulario cambia por completo pero el navegador conserva
  // el scroll: el dealer se queda mirando el pie de una pantalla que ya no existe.
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);

  const [form, setForm] = useState({
    dealershipName: "",
    slug: "",
    phone: "",
    whatsapp: "",
    address: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    confirmPassword: "",
  });

  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugCheck, setSlugCheck] = useState(null);

  const updateField = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "dealershipName" && !slugManuallyEdited) {
        const autoSlug = value
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50);
        next.slug = autoSlug;
      }
      return next;
    });
  };

  const handleSlugChange = (e) => {
    setSlugManuallyEdited(true);
    const cleaned = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50);
    setForm((prev) => ({ ...prev, slug: cleaned }));
  };

  // Se comprueba mientras escribe, con una pausa, para que sepa si su enlace
  // está libre antes de darnos su correo y su contraseña.
  useEffect(() => {
    const slug = form.slug;
    if (!slug) { setSlugCheck(null); return undefined; }
    setSlugCheck({ state: "checking" });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiUrl}/api/auth/slug-available?slug=${encodeURIComponent(slug)}`);
        const data = await response.json();
        setSlugCheck({ state: data.available ? "free" : "taken", message: data.message || "" });
      } catch { setSlugCheck(null); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [form.slug, apiUrl]);

  const validateStep1 = () => {
    if (!form.dealershipName.trim() || form.dealershipName.trim().length < 2) {
      setError("El nombre del concesionario debe tener al menos 2 caracteres.");
      return false;
    }
    if (!form.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      setError("El nombre del enlace debe usar solo minúsculas, números y guiones.");
      return false;
    }
    if (slugCheck?.state === "taken") {
      setError(slugCheck.message || "Ese nombre de enlace no está disponible.");
      return false;
    }
    setError("");
    return true;
  };

  const handleNextStep = (e) => {
    e.preventDefault();
    if (step === 1 && validateStep1()) {
      setStep(2);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.adminName.trim() || form.adminName.trim().length < 2) {
      setError("Introduce tu nombre completo.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.adminEmail)) {
      setError("Introduce un correo electrónico válido.");
      return;
    }
    if (form.adminPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (form.adminPassword !== form.confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/auth/register-dealer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          dealershipName: form.dealershipName.trim(),
          slug: form.slug.trim(),
          phone: form.phone.trim(),
          whatsapp: form.whatsapp.trim() || form.phone.trim(),
          address: form.address.trim(),
          adminName: form.adminName.trim(),
          adminEmail: form.adminEmail.trim().toLowerCase(),
          adminPassword: form.adminPassword,
          turnstileToken,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "No se pudo registrar el concesionario");
      }
      // El API ya dejó la sesión en una cookie HttpOnly. El padre recibe el payload
      // para continuar en esta pestaña, pero no persistimos credenciales en el navegador.
      setRegisteredData(payload);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const origin = window.location.origin;
  const previewUrl = `${origin}/?preview=1`;
  const platformDomain = (import.meta.env.VITE_PLATFORM_BASE_DOMAIN || "zevroa.com").replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const passwordLongEnough = form.adminPassword.length >= 8;
  const passwordsMatch = Boolean(form.confirmPassword) && form.adminPassword === form.confirmPassword;

  if (step === 3 && registeredData) {
    return (
      <div className="admin-login dealer-register-success">
        <span className="eyebrow">¡ENHORABUENA! · TU SHOWROOM ESTÁ EN REVISIÓN</span>
        <h1>¡Bienvenido a <em>{registeredData.organization?.name || form.dealershipName}!</em></h1>
        <p className="account-welcome">
          Tu showroom fue creado con tu cuenta de administrador y tiene un periodo de prueba activo de 14 días. Todavía no es público: personalízalo con calma y se publicará cuando el equipo de ZEVROA lo apruebe.
        </p>

        <div className="dealer-url-box" style={{ margin: "16px 0" }}>
          <span className="dealer-url-text">{registeredData.dealerUrl || previewUrl}</span>
          <button
            className="dealer-copy-btn"
            type="button"
            onClick={async () => {
              const url = registeredData.dealerUrl || previewUrl;
              try {
                await navigator.clipboard.writeText(url);
                setCopyStatus("Enlace copiado al portapapeles.");
              } catch {
                setCopyStatus("No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.");
              }
            }}
          >
            Copiar Enlace
          </button>
        </div>
        {copyStatus && <p className="form-message" role="status" aria-live="polite">{copyStatus}</p>}

        {registeredData.futurePublicUrl && (
          <p className="account-welcome" style={{ margin: "-8px 0 16px", fontSize: "14px" }}>
            Tu dirección pública, en cuanto se apruebe tu showroom, será <strong>{registeredData.futurePublicUrl.replace(/^https?:\/\//i, "")}</strong> — no tienes que comprar ni configurar nada.
          </p>
        )}

        <div className="register-success-actions" style={{ display: "grid", gap: "10px" }}>
          <button
            className="primary-action"
            type="button"
            onClick={() => onRegisterSuccess(registeredData)}
          >
            Entrar al panel de mi concesionario →
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => window.open(registeredData.dealerUrl || previewUrl, "_blank", "noopener,noreferrer")}
          >
            Vista previa privada ↗
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="admin-login dealer-register-form" onSubmit={step === 1 ? handleNextStep : handleSubmit}>
      <span className="eyebrow">ZEVROA · NUEVO SHOWROOM</span>
      <h1>Crea tu <em>Showroom Digital.</em></h1>
      <p className="account-welcome">
        {step === 1
          ? "Paso 1 de 2 · Los datos de tu concesionario y la dirección de tu showroom."
          : "Paso 2 de 2 · Tu cuenta de administrador. Después entrarás al panel para personalizar el showroom."}
      </p>

      <div className="wizard-step-indicator" style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <div style={{ flex: 1, height: "4px", background: step >= 1 ? "var(--auth-gold, #c8a24b)" : "#ccc", borderRadius: "2px" }} />
        <div style={{ flex: 1, height: "4px", background: step >= 2 ? "var(--auth-gold, #c8a24b)" : "#ccc", borderRadius: "2px" }} />
      </div>

      {step === 1 && (
        <>
          <label>
            Nombre del concesionario
            <input
              type="text"
              placeholder="Ej. Bella Vista Motors, Luxury Cars RD"
              value={form.dealershipName}
              onChange={(e) => updateField("dealershipName", e.target.value)}
              required
            />
          </label>

          <label>
            Nombre del enlace público
            <input
              type="text"
              placeholder="bellavista-motors"
              value={form.slug}
              onChange={handleSlugChange}
              required
            />
            {/* La dirección real, escrita entera y en vivo: "/?dealer=slug" es una ruta
                interna que no le dice nada al dealer sobre qué va a compartir. */}
            <span className="slug-preview" aria-hidden="true">https://<b>{form.slug || "tu-concesionario"}</b>.{platformDomain}</span>
            <small className={`slug-availability${slugCheck?.state === "free" ? " is-free" : slugCheck?.state === "taken" ? " is-taken" : ""}`} aria-live="polite">
              {slugCheck?.state === "checking" && "Comprobando disponibilidad…"}
              {slugCheck?.state === "free" && "Esta dirección está libre y será tuya."}
              {slugCheck?.state === "taken" && slugCheck.message}
              {!slugCheck && "Esta será la dirección de tu showroom. Usa minúsculas, números y guiones; podrás cambiarla antes de publicar."}
            </small>
          </label>

          <label>
            Teléfono de Contacto
            <input
              type="tel"
              placeholder="Ej. +1 (809) 555-0199"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
            />
          </label>

          <label>
            WhatsApp Comercial
            <input
              type="tel"
              placeholder="Ej. +1 (809) 555-0199 (opcional)"
              value={form.whatsapp}
              onChange={(e) => updateField("whatsapp", e.target.value)}
            />
          </label>

          <label>
            Dirección / Ubicación Física
            <input
              type="text"
              placeholder="Ej. Av. Winston Churchill #102, Santo Domingo"
              value={form.address}
              onChange={(e) => updateField("address", e.target.value)}
            />
          </label>

          {error && <p className="state-message error">{error}</p>}

          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button className="primary-action" type="submit" style={{ flex: 1 }}>
              Siguiente: Administrador →
            </button>
            <button className="text-button" type="button" onClick={onCancel}>
              Volver a Iniciar Sesión
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <label>
            Nombre Completo del Titular
            <input
              type="text"
              placeholder="Ej. Carlos Mendoza"
              value={form.adminName}
              onChange={(e) => updateField("adminName", e.target.value)}
              required
            />
          </label>

          <label>
            Correo electrónico (tu acceso al panel)
            <input
              type="email"
              placeholder="carlos@concesionario.com"
              value={form.adminEmail}
              onChange={(e) => updateField("adminEmail", e.target.value)}
              required
            />
          </label>

          <label>
            Contraseña
            {/* Las reglas se enseñan mientras escribe: antes solo aparecían como error
                después de pulsar "Crear mi showroom", ya con el formulario entero lleno. */}
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo 8 caracteres"
                value={form.adminPassword}
                onChange={(e) => updateField("adminPassword", e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </span>
            <small className={`password-rule${passwordLongEnough ? " is-ok" : ""}`} aria-live="polite">
              {passwordLongEnough ? "✓ Tiene 8 caracteres o más." : "Debe tener al menos 8 caracteres."}
            </small>
          </label>

          <label>
            Confirmar Contraseña
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Repite tu contraseña"
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
            {form.confirmPassword.length > 0 && (
              <small className={`password-rule${passwordsMatch ? " is-ok" : " is-bad"}`} aria-live="polite">
                {passwordsMatch ? "✓ Las contraseñas coinciden." : "Todavía no coinciden."}
              </small>
            )}
          </label>

          <TurnstileField onTokenChange={setTurnstileToken} />

          <p className="register-legal-note">Al crear tu showroom aceptas los términos del servicio y la política de privacidad de ZEVROA. La prueba dura 14 días y no pedimos tarjeta.</p>

          {error && <p className="state-message error">{error}</p>}

          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button className="secondary-action" type="button" onClick={() => setStep(1)} disabled={loading}>
              ← Atrás
            </button>
            <button className="primary-action" type="submit" style={{ flex: 1 }} disabled={loading}>
              {loading ? "Creando Showroom…" : "Crear mi Showroom y Entrar →"}
            </button>
          </div>
          <button className="text-button" type="button" onClick={onCancel} disabled={loading}>
            Cancelar
          </button>
        </>
      )}
    </form>
  );
}
