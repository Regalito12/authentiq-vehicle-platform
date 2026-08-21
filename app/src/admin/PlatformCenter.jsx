import { useEffect, useState } from "react";

const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US")} USD`;
}

function date(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

function setupLabel(progress) {
  if (progress >= 100) return "Listo para presentar";
  if (progress >= 75) return "Casi listo";
  if (progress >= 40) return "En configuración";
  return "Primeros pasos";
}

const emptyForm = { name: "", slug: "", customDomain: "", logoUrl: "", primaryColor: "#c8a24b", accentColor: "#b28b37", adminName: "", adminEmail: "", adminPassword: "", planCode: "starter" };

function DealerOverridesPanel({ dealer, onSaveBranding, onSaveCss, onImpersonate, saving }) {
  const [form, setForm] = useState({ customDomain: dealer.customDomain || "", logoUrl: dealer.logoUrl || "", primaryColor: dealer.primaryColor || "#c8a24b", accentColor: dealer.accentColor || "#b28b37" });
  const [customCss, setCustomCss] = useState(dealer.customCss || "");
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <div className="platform-overrides-panel">
      <span className="eyebrow">SUPERPODERES · SOLO ADMIN DE PLATAFORMA</span>
      <div className="platform-overrides-grid">
        <label>Dominio<input value={form.customDomain} onChange={(event) => update("customDomain", event.target.value)} placeholder="dealer.com" inputMode="url" /></label>
        <label>Logo URL<input value={form.logoUrl} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://.../logo.svg" /></label>
        <label>Color principal<input type="color" value={form.primaryColor} onChange={(event) => update("primaryColor", event.target.value)} /></label>
        <label>Color de acento<input type="color" value={form.accentColor} onChange={(event) => update("accentColor", event.target.value)} /></label>
      </div>
      <button className="secondary-action" type="button" onClick={() => onSaveBranding(dealer, form)} disabled={saving}>Guardar marca y dominio</button>
      <label className="platform-overrides-css">CSS personalizado del showroom (avanzado)<textarea rows={5} value={customCss} onChange={(event) => setCustomCss(event.target.value)} placeholder=".hero-content h1 { ... }" /></label>
      <div className="platform-overrides-actions">
        <button className="secondary-action" type="button" onClick={() => onSaveCss(dealer, customCss)} disabled={saving}>Guardar CSS</button>
        <button className="text-button" type="button" onClick={() => onImpersonate(dealer)}>Entrar como este dealer →</button>
      </div>
    </div>
  );
}

export default function PlatformCenter({ token, user, onLogout, onBack }) {
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [overrideSaving, setOverrideSaving] = useState(false);

  const request = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse");
    return payload;
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try { setOverview((await request("/api/platform/overview")).data); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const createDealer = async (event) => {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const created = await request("/api/platform/organizations", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm); setMessage(`Dealer creado. ${created.data.customDomain ? `Dominio asignado: ${created.data.customDomain}. ` : ""}Ya puede entrar con la cuenta inicial y terminar su onboarding.`); await load();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };
  const toggleDealer = async (dealer) => {
    setError("");
    try { await request(`/api/platform/organizations/${dealer.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !dealer.isActive }) }); await load(); } catch (requestError) { setError(requestError.message); }
  };
  const decideApproval = async (dealer, decision) => {
    setError(""); setMessage("");
    try {
      await request(`/api/platform/organizations/${dealer.id}/approval`, { method: "PATCH", body: JSON.stringify({ decision }) });
      setMessage(decision === "approved" ? `${dealer.name} fue aprobado y puede publicarse en su dominio.` : `${dealer.name} fue rechazado.`);
      await load();
    } catch (requestError) { setError(requestError.message); }
  };
  const updatePlan = async (dealer, planCode) => {
    setError("");
    try { await request(`/api/platform/organizations/${dealer.id}/subscription`, { method: "PATCH", body: JSON.stringify({ planCode, status: dealer.subscriptionStatus }) }); setMessage("Plan actualizado en modo interno."); await load(); } catch (requestError) { setError(requestError.message); }
  };
  const saveBranding = async (dealer, form) => {
    setOverrideSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/platform/organizations/${dealer.id}/branding`, { method: "PATCH", body: JSON.stringify(form) });
      setMessage(`Marca y dominio de ${dealer.name} actualizados.`);
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setOverrideSaving(false); }
  };
  const saveCss = async (dealer, customCss) => {
    setOverrideSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/platform/organizations/${dealer.id}/custom-css`, { method: "PATCH", body: JSON.stringify({ customCss }) });
      setMessage(`CSS de ${dealer.name} actualizado.`);
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setOverrideSaving(false); }
  };
  const impersonateDealer = async (dealer) => {
    setError("");
    try {
      const { data } = await request(`/api/platform/organizations/${dealer.id}/impersonate`, { method: "POST" });
      const url = `${window.location.origin}/?impersonate=${encodeURIComponent(JSON.stringify(data))}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (requestError) { setError(requestError.message); }
  };

  if (loading && !overview) return <main className="platform-page"><p className="state-message">Cargando centro de dealers…</p></main>;
  return <main className="platform-page">
    <header className="platform-header"><div><span className="eyebrow">AUTHENTIQ · PLATFORM</span><h1>Centro de <em>dealers.</em></h1><p>Administra cuentas, planes y el estado de cada showroom desde un solo lugar.</p></div><div className="platform-header-actions"><span>{user?.name || "Platform admin"}</span><button className="secondary-action" type="button" onClick={onBack}>Ver showroom</button><button className="secondary-action" type="button" onClick={onLogout}>Cerrar sesión</button></div></header>
    {error && <p className="state-message error">{error}</p>}{message && <p className="form-message">{message}</p>}
    <section className="platform-stats"><article><span>Dealers totales</span><strong>{overview?.summary?.total || 0}</strong><small>Organizaciones registradas</small></article><article><span>Activos</span><strong>{overview?.summary?.active || 0}</strong><small>{overview?.summary?.paused || 0} pausados</small></article><article><span>MRR proyectado</span><strong>{money(overview?.summary?.monthlyRecurring)}</strong><small>Según planes internos</small></article><article><span>Pendientes de aprobación</span><strong>{overview?.summary?.pendingApproval || 0}</strong><small>Esperando revisión</small></article></section>
    {overview?.pendingApproval?.length > 0 && <section className="platform-panel platform-approval-panel"><div className="platform-panel-heading"><div><span className="eyebrow">COLA DE APROBACIÓN</span><h2>Showrooms esperando revisión.</h2><p>Se registraron solos y ya pueden personalizarse en privado. No son públicos hasta que apruebes.</p></div></div><div className="platform-dealer-list">{overview.pendingApproval.map((dealer) => <article className="platform-dealer-card is-pending" key={dealer.id}><div className="platform-dealer-top"><div className="platform-dealer-identity"><span className="platform-dealer-mark">{dealer.logoUrl ? <img src={dealer.logoUrl} alt="" /> : dealer.name.slice(0, 2).toUpperCase()}</span><div><strong>{dealer.name}</strong><small>{dealer.slug} · registrado {date(dealer.createdAt)}</small></div></div><span className="platform-status pending">Pendiente</span></div><div className="platform-approval-readiness"><strong className={dealer.approvalReady ? "is-ready" : "is-blocked"}>{dealer.approvalReady ? "Listo para aprobar" : "Falta completar configuración"}</strong>{dealer.approvalBlockers?.length > 0 && <span>Bloqueos: {dealer.approvalBlockers.join(" · ")}</span>}{dealer.approvalRecommendations?.length > 0 && <small>Recomendado: {dealer.approvalRecommendations.join(" · ")}</small>}</div><div className="platform-dealer-actions"><button className="primary-action" type="button" onClick={() => decideApproval(dealer, "approved")} disabled={!dealer.approvalReady} title={dealer.approvalReady ? "Aprobar dealer" : `Completa: ${dealer.approvalBlockers?.join(", ")}`}>{dealer.approvalReady ? "Aprobar dealer →" : "Completar configuración"}</button><button className="text-button" type="button" onClick={() => decideApproval(dealer, "rejected")}>Rechazar</button></div></article>)}</div></section>}
    <div className="platform-layout"><section className="platform-panel"><div className="platform-panel-heading"><div><span className="eyebrow">PORTAFOLIO</span><h2>Dealers conectados.</h2><p>Cada dealer conserva su inventario, usuarios, marca y showroom aislados.</p></div><button className="secondary-action" type="button" onClick={load}>Actualizar</button></div><div className="platform-dealer-list">{overview?.organizations?.length ? overview.organizations.map((dealer) => <article className={`platform-dealer-card${dealer.isActive ? "" : " is-paused"}`} key={dealer.id}><div className="platform-dealer-top"><div className="platform-dealer-identity"><span className="platform-dealer-mark">{dealer.logoUrl ? <img src={dealer.logoUrl} alt="" /> : dealer.name.slice(0, 2).toUpperCase()}</span><div><strong>{dealer.name}</strong><small>{dealer.customDomain || dealer.subdomain || `${dealer.slug}.authentiq.local`}</small></div></div><div className="platform-status-group"><span className={`platform-status ${dealer.isActive ? "active" : "paused"}`}>{dealer.isActive ? "Activo" : "Pausado"}</span>{dealer.approvalStatus !== "approved" && <span className={`platform-status ${dealer.approvalStatus}`}>{dealer.approvalStatus === "pending" ? "Pendiente" : "Rechazado"}</span>}</div></div><div className="platform-dealer-metrics"><span><b>{dealer.setupProgress}%</b><small>{setupLabel(dealer.setupProgress)}</small></span><span><b>{dealer.publishedVehicles}</b><small>Vehículos publicados</small></span><span><b>{dealer.recentLeads}</b><small>Leads · 30 días</small></span><span><b>{dealer.activeUsers}</b><small>Usuarios activos</small></span></div><div className="platform-dealer-actions"><label><span>Plan</span><select value={dealer.planCode} onChange={(event) => updatePlan(dealer, event.target.value)}>{(overview?.plans || []).map((plan) => <option value={plan.code} key={plan.code}>{plan.name} · {money(plan.monthlyAmount)}</option>)}</select></label><span className="platform-subscription-status">{dealer.subscriptionStatus} · {money(dealer.monthlyAmount)} / mes</span><button className="text-button" type="button" onClick={() => toggleDealer(dealer)}>{dealer.isActive ? "Pausar dealer" : "Reactivar dealer"}</button><button className="text-button" type="button" onClick={() => setExpandedId((current) => current === dealer.id ? null : dealer.id)}>{expandedId === dealer.id ? "Cerrar superpoderes" : "Superpoderes ⚙"}</button></div>{expandedId === dealer.id && <DealerOverridesPanel dealer={dealer} onSaveBranding={saveBranding} onSaveCss={saveCss} onImpersonate={impersonateDealer} saving={overrideSaving} />}</article>) : <p className="empty-state">Todavía no hay dealers registrados.</p>}</div></section>
      <aside className="platform-create-panel"><span className="eyebrow">NUEVO DEALER</span><h2>Abre un nuevo showroom.</h2><p>Crea el espacio, su marca inicial, el plan y la primera cuenta. El dealer entra después a completar inventario, contactos y agenda.</p><form onSubmit={createDealer}><label>Nombre comercial<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Ej. Autohaus Caribe" required /></label><label>Slug<input value={form.slug} onChange={(event) => updateForm("slug", event.target.value)} placeholder="autohaus-caribe" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /><small>Identidad interna del showroom; no se muestra al comprador.</small></label><label>Dominio del dealer <span>Opcional</span><input value={form.customDomain} onChange={(event) => updateForm("customDomain", event.target.value)} placeholder="autoscaribe.com" inputMode="url" /><small>Se activa cuando el DNS apunte al hosting.</small></label><label>Logo URL <span>Opcional</span><input type="url" value={form.logoUrl} onChange={(event) => updateForm("logoUrl", event.target.value)} placeholder="https://.../logo.svg" /><small>También puede subirlo desde su onboarding.</small></label><div className="platform-brand-colors"><label>Color principal<input type="color" value={form.primaryColor} onChange={(event) => updateForm("primaryColor", event.target.value)} aria-label="Color principal" /></label><label>Color de acento<input type="color" value={form.accentColor} onChange={(event) => updateForm("accentColor", event.target.value)} aria-label="Color de acento" /></label></div><label>Administrador inicial<input value={form.adminName} onChange={(event) => updateForm("adminName", event.target.value)} placeholder="Nombre completo" required /></label><label>Correo del administrador<input type="email" value={form.adminEmail} onChange={(event) => updateForm("adminEmail", event.target.value)} placeholder="admin@dealer.com" required /></label><label>Contraseña temporal<input type="password" value={form.adminPassword} onChange={(event) => updateForm("adminPassword", event.target.value)} minLength="8" placeholder="Mínimo 8 caracteres" required /></label><label>Plan inicial<select value={form.planCode} onChange={(event) => updateForm("planCode", event.target.value)}>{(overview?.plans || []).map((plan) => <option value={plan.code} key={plan.code}>{plan.name} · {money(plan.monthlyAmount)}</option>)}</select></label><button className="primary-action" type="submit" disabled={saving}>{saving ? "Creando…" : "Crear dealer →"}</button></form><div className="platform-plan-note"><strong>Alta guiada</strong><span>El estado de plan, agenda, redes y cobro quedan preparados. El proveedor de pago se conecta después, sin fingir que ya está activo.</span></div></aside></div>
    <footer className="platform-footer"><span>Centro central · {overview?.plans?.length || 0} planes disponibles</span><span>Los cambios quedan registrados en auditoría.</span></footer>
  </main>;
}
