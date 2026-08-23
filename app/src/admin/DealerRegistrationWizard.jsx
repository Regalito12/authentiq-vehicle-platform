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
      // Se guarda de inmediato: el botón "Vista previa privada" de esta misma pantalla
      // abre una pestaña nueva que necesita el token en localStorage para autenticar
      // su vista previa, y eso todavía no pasa hasta que se entra al backoffice.
      localStorage.setItem("authentiq_admin_token", payload.token);
      localStorage.setItem("authentiq_admin_user", JSON.stringify(payload.user));
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

  if (step === 3 && registeredData) {
    return (
      <div className="admin-login dealer-register-success">
        <span className="eyebrow">¡ENHORABUENA! · TU SHOWROOM ESTÁ EN REVISIÓN</span>
        <h1>¡Bienvenido a <em>{registeredData.organization?.name || form.dealershipName}!</em></h1>
        <p className="account-welcome">
          Tu showroom fue creado con tu cuenta de administrador y tiene un periodo de prueba activo de 14 días. Todavía no es público: personalízalo con calma y se publicará cuando el equipo de AUTHENTIQ lo apruebe.
        </p>

        <div className="dealer-url-box" style={{ margin: "16px 0" }}>
          <span className="dealer-url-text">{registeredData.dealerUrl || previewUrl}</span>
          <button
            className="dealer-copy-btn"
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(registeredData.dealerUrl || previewUrl);
              alert("¡Enlace copiado al portapapeles!");
            }}
          >
            Copiar Enlace
          </button>
        </div>

        {registeredData.futurePublicUrl && (
          <p className="account-welcome" style={{ margin: "-8px 0 16px", fontSize: "13px" }}>
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
      <span className="eyebrow">AUTHENTIQ · NUEVO SHOWROOM</span>
      <h1>Crea tu <em>Showroom Digital.</em></h1>
      <p className="account-welcome">
        {step === 1
          ? "Paso 1 de 2: Datos de tu Concesionario e Identificador Único."
          : "Paso 2 de 2: Crea tu cuenta de Administrador."}
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
            <small className={`slug-availability${slugCheck?.state === "free" ? " is-free" : slugCheck?.state === "taken" ? " is-taken" : ""}`} aria-live="polite">
              {slugCheck?.state === "checking" && "Comprobando disponibilidad…"}
              {slugCheck?.state === "free" && `Disponible. Tu showroom vivirá en /?dealer=${form.slug}`}
              {slugCheck?.state === "taken" && slugCheck.message}
              {!slugCheck && "Será parte de la dirección de tu showroom. Usa minúsculas, números y guiones; podrás cambiarlo antes de publicar."}
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
            <input
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={form.adminPassword}
              onChange={(e) => updateField("adminPassword", e.target.value)}
              minLength={8}
              required
            />
          </label>

          <label>
            Confirmar Contraseña
            <input
              type="password"
              placeholder="Repite tu contraseña"
              value={form.confirmPassword}
              onChange={(e) => updateField("confirmPassword", e.target.value)}
              minLength={8}
              required
            />
          </label>

          <TurnstileField onTokenChange={setTurnstileToken} />

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
