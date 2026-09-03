import { useEffect, useRef, useState } from "react";

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

function dateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-DO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Las acciones se guardan como slugs técnicos ("platform.organization.approval").
// Sin esta traducción, el operador vería el registro crudo en vez de una frase legible.
const actionLabels = {
  "platform.organization.approval": "Decisión de aprobación",
  "platform.organization.branding": "Cambio de marca",
  "platform.organization.custom_css": "CSS personalizado",
  "platform.organization.create": "Dealer creado",
  "platform.organization.impersonate": "Entrada como soporte (impersonación)",
  "platform.organization.status": "Pausado / reactivado",
  "platform.subscription.update": "Plan actualizado",
  "platform.user.update": "Usuario activado / desactivado",
  "platform.user.password_reset": "Contraseña restablecida",
  "organization.update": "Perfil del concesionario editado",
  "settings.update": "Ajustes operativos editados",
  "vehicle.create": "Vehículo creado",
  "vehicle.update": "Vehículo editado",
  "vehicle.status_update": "Estado de vehículo cambiado",
  "vehicle.archive": "Vehículo archivado",
  "user.create": "Usuario creado",
  "user.update": "Usuario editado",
  "user.delete": "Usuario eliminado",
  "user.password_reset": "Contraseña restablecida",
  "quote.create": "Cotización creada",
  "quote.status_update": "Estado de cotización cambiado",
};
function actionLabel(action) {
  return actionLabels[action] || action.replaceAll(".", " · ").replaceAll("_", " ");
}

function PasswordResetResult({ result, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(result.temporaryPassword); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } };
  return <div className="password-reset-result"><span className="eyebrow">CONTRASEÑA TEMPORAL · {result.name}</span><code>{result.temporaryPassword}</code><p>Entrégala en persona o por un canal seguro. No se guarda ni se muestra de nuevo: {result.email} deberá cambiarla en su próximo ingreso.</p><div><button className="secondary-action" type="button" onClick={copy}>{copied ? "Copiada ✓" : "Copiar"}</button><button className="text-button" type="button" onClick={onDismiss}>Cerrar</button></div></div>;
}

const emptyForm = { name: "", slug: "", customDomain: "", logoUrl: "", primaryColor: "#c8a24b", accentColor: "#b28b37", adminName: "", adminEmail: "", adminPassword: "", planCode: "starter" };

function DealerOverridesPanel({ dealer, onSaveBranding, onSaveCss, onImpersonate, saving }) {
  const [form, setForm] = useState({ customDomain: dealer.customDomain || "", logoUrl: dealer.logoUrl || "", primaryColor: dealer.primaryColor || "#c8a24b", accentColor: dealer.accentColor || "#b28b37" });
  const [customCss, setCustomCss] = useState(dealer.customCss || "");
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <div className="platform-overrides-panel">
      <span className="eyebrow">ADMINISTRACIÓN AVANZADA · SOLO PLATAFORMA</span>
      <div className="platform-overrides-grid">
        <label>Dominio<input value={form.customDomain} onChange={(event) => update("customDomain", event.target.value)} placeholder="concesionario.com" inputMode="url" /></label>
        <label>Logo URL<input value={form.logoUrl} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://.../logo.svg" /></label>
        <label>Color principal<input type="color" value={form.primaryColor} onChange={(event) => update("primaryColor", event.target.value)} /></label>
        <label>Color de acento<input type="color" value={form.accentColor} onChange={(event) => update("accentColor", event.target.value)} /></label>
      </div>
      <button className="secondary-action" type="button" onClick={() => onSaveBranding(dealer, form)} disabled={saving}>Guardar marca y dominio</button>
      <label className="platform-overrides-css">CSS personalizado del showroom (avanzado)<textarea rows={5} value={customCss} onChange={(event) => setCustomCss(event.target.value)} placeholder=".hero-content h1 { ... }" /></label>
      <div className="platform-overrides-actions">
        <button className="secondary-action" type="button" onClick={() => onSaveCss(dealer, customCss)} disabled={saving}>Guardar CSS</button>
        <button className="text-button" type="button" onClick={() => onImpersonate(dealer)}>Abrir como este concesionario →</button>
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const loadingRef = useRef(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditOrgFilter, setAuditOrgFilter] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [platformUsers, setPlatformUsers] = useState([]);
  const [userOrgFilter, setUserOrgFilter] = useState("");
  const [passwordResetResult, setPasswordResetResult] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const request = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse");
    return payload;
  };

  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const [overviewResult] = await Promise.all([request("/api/platform/overview"), loadAudit(), loadPlatformUsers()]);
      setOverview(overviewResult.data);
    } catch (requestError) { setError(requestError.message); } finally { loadingRef.current = false; setLoading(false); }
  };

  // Aceptan overrides para que un cambio de filtro pueda recargar sin esperar a
  // que el estado (asíncrono) ya haya cambiado.
  const loadAudit = async (overrides = {}) => {
    const organizationId = overrides.organizationId ?? auditOrgFilter;
    const action = overrides.action ?? auditActionFilter;
    const params = new URLSearchParams({ limit: "150", ...(organizationId ? { organizationId } : {}), ...(action ? { action } : {}) });
    try { setAuditLogs((await request(`/api/platform/audit-logs?${params}`)).data || []); } catch (requestError) { setError(requestError.message); }
  };
  const loadPlatformUsers = async (overrides = {}) => {
    const organizationId = overrides.organizationId ?? userOrgFilter;
    const params = new URLSearchParams(organizationId ? { organizationId } : {});
    try { setPlatformUsers((await request(`/api/platform/users?${params}`)).data || []); } catch (requestError) { setError(requestError.message); }
  };
  const toggleUserActive = async (targetUser) => {
    setError("");
    try { await request(`/api/platform/users/${targetUser.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !targetUser.isActive }) }); await loadPlatformUsers(); await loadAudit(); } catch (requestError) { setError(requestError.message); }
  };
  const resetUserPassword = async (targetUser) => {
    setError(""); setPasswordResetResult(null);
    try { setPasswordResetResult((await request(`/api/platform/users/${targetUser.id}/reset-password`, { method: "POST" })).data); await loadAudit(); } catch (requestError) { setError(requestError.message); }
  };
  const runSearch = async (event) => {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true); setError("");
    try { setSearchResults((await request(`/api/platform/search?q=${encodeURIComponent(trimmed)}`)).data); } catch (requestError) { setError(requestError.message); } finally { setSearchLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filteredOrganizations = (overview?.organizations || []).filter((dealer) => {
    const haystack = `${dealer.name} ${dealer.slug} ${dealer.customDomain || ""} ${dealer.subdomain || ""}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? dealer.isActive : !dealer.isActive);
    return matchesQuery && matchesStatus;
  });

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const createDealer = async (event) => {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const created = await request("/api/platform/organizations", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm); setMessage(`Concesionario creado. ${created.data.customDomain ? `Dominio asignado: ${created.data.customDomain}. ` : ""}Ya puede entrar con la cuenta inicial y terminar su configuración.`); await load();
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
    <header className="platform-header"><div><span className="eyebrow">ZEVROA · PLATFORM</span><h1>Centro de <em>dealers.</em></h1><p>Administra cuentas, planes y el estado de cada showroom desde un solo lugar.</p></div><div className="platform-header-actions"><span>{user?.name || "Platform admin"}</span><button className="secondary-action" type="button" onClick={onBack}>Ver showroom</button><button className="secondary-action" type="button" onClick={onLogout}>Cerrar sesión</button></div></header>
    {error && <p className="state-message error" role="alert">{error}</p>}{message && <p className="form-message" role="status">{message}</p>}
    <section className="platform-panel platform-search-panel"><div className="platform-panel-heading"><div><span className="eyebrow">SOPORTE · TODOS LOS DEALERS</span><h2>Buscar en toda la plataforma.</h2><p>Encuentra un vehículo, un cliente o una cotización de cualquier concesionario sin tener que entrar a su cuenta.</p></div></div><form onSubmit={runSearch} className="platform-search-form"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Marca, modelo, folio, nombre, correo o teléfono…" aria-label="Buscar en toda la plataforma" /><button className="secondary-action" type="submit" disabled={searchLoading}>{searchLoading ? "Buscando…" : "Buscar"}</button></form>{searchResults && <div className="platform-search-results">{!searchResults.vehicles.length && !searchResults.contacts.length && !searchResults.quotes.length ? <p className="empty-state">Sin resultados para "{searchQuery.trim()}".</p> : <>
      {searchResults.vehicles.length > 0 && <div><span className="eyebrow">VEHÍCULOS · {searchResults.vehicles.length}</span><div className="audit-list">{searchResults.vehicles.map((item) => <article className="audit-row" key={item.id}><span className="audit-time">{item.status}</span><div><strong>{item.brand} {item.model}{item.variant ? ` · ${item.variant}` : ""}</strong><span>{item.year} · {item.organizationName}</span></div></article>)}</div></div>}
      {searchResults.contacts.length > 0 && <div><span className="eyebrow">CLIENTES · {searchResults.contacts.length}</span><div className="audit-list">{searchResults.contacts.map((item) => <article className="audit-row" key={item.id}><span className="audit-time">{item.organizationName}</span><div><strong>{item.name}</strong><span>{item.email || "sin correo"} · {item.phone || "sin teléfono"}</span></div></article>)}</div></div>}
      {searchResults.quotes.length > 0 && <div><span className="eyebrow">COTIZACIONES · {searchResults.quotes.length}</span><div className="audit-list">{searchResults.quotes.map((item) => <article className="audit-row" key={item.id}><span className="audit-time">{item.status}</span><div><strong>{item.quoteNumber} · {item.customerName}</strong><span>{money(item.totalUsd)} · {item.organizationName}</span></div></article>)}</div></div>}
    </>}</div>}</section>
    <section className="platform-stats"><article><span>Dealers totales</span><strong>{overview?.summary?.total || 0}</strong><small>Organizaciones registradas</small></article><article><span>Activos</span><strong>{overview?.summary?.active || 0}</strong><small>{overview?.summary?.paused || 0} pausados</small></article><article><span>MRR proyectado</span><strong>{money(overview?.summary?.monthlyRecurring)}</strong><small>Según planes internos</small></article><article><span>Pendientes de aprobación</span><strong>{overview?.summary?.pendingApproval || 0}</strong><small>Esperando revisión</small></article></section>
    {overview?.pendingApproval?.length > 0 && <section className="platform-panel platform-approval-panel"><div className="platform-panel-heading"><div><span className="eyebrow">COLA DE APROBACIÓN</span><h2>Showrooms esperando revisión.</h2><p>Se registraron solos y ya pueden personalizarse en privado. No son públicos hasta que apruebes.</p></div></div><div className="platform-dealer-list">{overview.pendingApproval.map((dealer) => <article className="platform-dealer-card is-pending" key={dealer.id}><div className="platform-dealer-top"><div className="platform-dealer-identity"><span className="platform-dealer-mark">{dealer.logoUrl ? <img src={dealer.logoUrl} alt="" /> : dealer.name.slice(0, 2).toUpperCase()}</span><div><strong>{dealer.name}</strong><small>{dealer.slug} · registrado {date(dealer.createdAt)}</small></div></div><span className="platform-status pending">Pendiente</span></div><div className="platform-approval-readiness"><strong className={dealer.approvalReady ? "is-ready" : "is-blocked"}>{dealer.approvalReady ? "Listo para aprobar" : "Falta completar configuración"}</strong>{dealer.approvalBlockers?.length > 0 && <span>Bloqueos: {dealer.approvalBlockers.join(" · ")}</span>}{dealer.approvalRecommendations?.length > 0 && <small>Recomendado: {dealer.approvalRecommendations.join(" · ")}</small>}</div><div className="platform-dealer-actions"><button className="primary-action" type="button" onClick={() => decideApproval(dealer, "approved")} disabled={!dealer.approvalReady} title={dealer.approvalReady ? "Aprobar dealer" : `Completa: ${dealer.approvalBlockers?.join(", ")}`}>{dealer.approvalReady ? "Aprobar dealer →" : "Completar configuración"}</button><button className="text-button" type="button" onClick={() => decideApproval(dealer, "rejected")}>Rechazar</button></div></article>)}</div></section>}
    <div className="platform-layout"><section className="platform-panel"><div className="platform-panel-heading"><div><span className="eyebrow">PORTAFOLIO</span><h2>Dealers conectados.</h2><p>Cada dealer conserva su inventario, usuarios, marca y showroom aislados.</p></div><button className="secondary-action" type="button" onClick={load}>Actualizar</button></div><div className="platform-list-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar dealer, slug o dominio…" aria-label="Buscar dealers" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar dealers por estado"><option value="all">Todos los estados</option><option value="active">Activos</option><option value="paused">Pausados</option></select><span>{filteredOrganizations.length} de {overview?.organizations?.length || 0}</span></div><div className="platform-dealer-list">{filteredOrganizations.length ? filteredOrganizations.map((dealer) => <article className={`platform-dealer-card${dealer.isActive ? "" : " is-paused"}`} key={dealer.id}><div className="platform-dealer-top"><div className="platform-dealer-identity"><span className="platform-dealer-mark">{dealer.logoUrl ? <img src={dealer.logoUrl} alt={`Logo de ${dealer.name}`} /> : dealer.name.slice(0, 2).toUpperCase()}</span><div><strong>{dealer.name}</strong><small>{dealer.customDomain || dealer.subdomain || `${dealer.slug}.zevroa.local`}</small></div></div><div className="platform-status-group"><span className={`platform-status ${dealer.isActive ? "active" : "paused"}`}>{dealer.isActive ? "Activo" : "Pausado"}</span>{dealer.approvalStatus !== "approved" && <span className={`platform-status ${dealer.approvalStatus}`}>{dealer.approvalStatus === "pending" ? "Pendiente" : "Rechazado"}</span>}</div></div><div className="platform-dealer-metrics"><span><b>{dealer.setupProgress}%</b><small>{setupLabel(dealer.setupProgress)}</small></span><span><b>{dealer.publishedVehicles}</b><small>Vehículos publicados</small></span><span><b>{dealer.recentLeads}</b><small>Leads · 30 días</small></span><span><b>{dealer.activeUsers}</b><small>Usuarios activos</small></span></div><div className="platform-dealer-actions"><label><span>Plan</span><select value={dealer.planCode} onChange={(event) => updatePlan(dealer, event.target.value)}>{(overview?.plans || []).map((plan) => <option value={plan.code} key={plan.code}>{plan.name} · {money(plan.monthlyAmount)}</option>)}</select></label><span className="platform-subscription-status">{dealer.subscriptionStatus} · {money(dealer.monthlyAmount)} / mes</span><button className="text-button" type="button" onClick={() => toggleDealer(dealer)}>{dealer.isActive ? "Pausar dealer" : "Reactivar dealer"}</button><button className="text-button" type="button" onClick={() => setExpandedId((current) => current === dealer.id ? null : dealer.id)}>{expandedId === dealer.id ? "Cerrar superpoderes" : "Superpoderes ⚙"}</button></div>{expandedId === dealer.id && <DealerOverridesPanel dealer={dealer} onSaveBranding={saveBranding} onSaveCss={saveCss} onImpersonate={impersonateDealer} saving={overrideSaving} />}</article>) : <p className="empty-state">{query || statusFilter !== "all" ? "No hay dealers que coincidan con este filtro." : "Todavía no hay dealers registrados."}</p>}</div></section>
      <aside className="platform-create-panel"><span className="eyebrow">NUEVO DEALER</span><h2>Abre un nuevo showroom.</h2><p>Crea el espacio, su marca inicial, el plan y la primera cuenta. El dealer entra después a completar inventario, contactos y agenda.</p><form onSubmit={createDealer}><label>Nombre comercial<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Ej. Autohaus Caribe" required /></label><label>Slug<input value={form.slug} onChange={(event) => updateForm("slug", event.target.value)} placeholder="autohaus-caribe" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /><small>Identidad interna del showroom; no se muestra al comprador.</small></label><label>Dominio del dealer <span>Opcional</span><input value={form.customDomain} onChange={(event) => updateForm("customDomain", event.target.value)} placeholder="autoscaribe.com" inputMode="url" /><small>Se activa cuando el DNS apunte al hosting.</small></label><label>Logo URL <span>Opcional</span><input type="url" value={form.logoUrl} onChange={(event) => updateForm("logoUrl", event.target.value)} placeholder="https://.../logo.svg" /><small>También puede subirlo desde su onboarding.</small></label><div className="platform-brand-colors"><label>Color principal<input type="color" value={form.primaryColor} onChange={(event) => updateForm("primaryColor", event.target.value)} aria-label="Color principal" /></label><label>Color de acento<input type="color" value={form.accentColor} onChange={(event) => updateForm("accentColor", event.target.value)} aria-label="Color de acento" /></label></div><label>Administrador inicial<input value={form.adminName} onChange={(event) => updateForm("adminName", event.target.value)} placeholder="Nombre completo" required /></label><label>Correo del administrador<input type="email" value={form.adminEmail} onChange={(event) => updateForm("adminEmail", event.target.value)} placeholder="admin@dealer.com" required /></label><label>Contraseña temporal<input type="password" value={form.adminPassword} onChange={(event) => updateForm("adminPassword", event.target.value)} minLength="8" placeholder="Mínimo 8 caracteres" required /></label><label>Plan inicial<select value={form.planCode} onChange={(event) => updateForm("planCode", event.target.value)}>{(overview?.plans || []).map((plan) => <option value={plan.code} key={plan.code}>{plan.name} · {money(plan.monthlyAmount)}</option>)}</select></label><button className="primary-action" type="submit" disabled={saving}>{saving ? "Creando…" : "Crear dealer →"}</button></form><div className="platform-plan-note"><strong>Alta guiada</strong><span>El estado de plan, agenda, redes y cobro quedan preparados. El proveedor de pago se conecta después, sin fingir que ya está activo.</span></div></aside></div>
    <section className="platform-panel"><div className="platform-panel-heading"><div><span className="eyebrow">CUENTAS · TODOS LOS DEALERS</span><h2>Usuarios de la plataforma.</h2><p>Desactiva o restablece la contraseña de cualquier cuenta sin tener que impersonar al dealer.</p></div><button className="secondary-action" type="button" onClick={() => loadPlatformUsers()}>Actualizar</button></div>
      <div className="platform-list-filters is-compact"><select value={userOrgFilter} onChange={(event) => { const value = event.target.value; setUserOrgFilter(value); loadPlatformUsers({ organizationId: value }); }} aria-label="Filtrar usuarios por dealer"><option value="">Todos los dealers</option>{(overview?.organizations || []).map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}</select><span>{platformUsers.length} cuenta{platformUsers.length === 1 ? "" : "s"}</span></div>
      {passwordResetResult && <PasswordResetResult result={passwordResetResult} onDismiss={() => setPasswordResetResult(null)} />}
      {platformUsers.length ? <div className="platform-user-list">{platformUsers.map((platformUser) => <article className="platform-user-row" key={platformUser.id}><div className="platform-user-identity"><strong>{platformUser.name}</strong><small>{platformUser.email} · {platformUser.role} · {platformUser.organizationName}</small></div><span className={`platform-status ${platformUser.isActive ? "active" : "paused"}`}>{platformUser.isActive ? "Activo" : "Desactivado"}</span><div className="platform-user-actions"><button className="text-button" type="button" onClick={() => resetUserPassword(platformUser)}>Restablecer contraseña</button><button className="text-button" type="button" onClick={() => toggleUserActive(platformUser)}>{platformUser.isActive ? "Desactivar" : "Reactivar"}</button></div></article>)}</div> : <p className="empty-state">No hay cuentas para este filtro.</p>}
    </section>
    <section className="platform-panel"><div className="platform-panel-heading"><div><span className="eyebrow">AUDITORÍA · TODA LA PLATAFORMA</span><h2>Qué ha pasado, y quién lo hizo.</h2><p>Cada aprobación, cambio de marca, creación de dealer o impersonación queda aquí, sin importar en qué showroom haya ocurrido.</p></div><button className="secondary-action" type="button" onClick={() => loadAudit()}>Actualizar</button></div>
      <div className="platform-list-filters"><select value={auditOrgFilter} onChange={(event) => { const value = event.target.value; setAuditOrgFilter(value); loadAudit({ organizationId: value }); }} aria-label="Filtrar auditoría por dealer"><option value="">Todos los dealers</option>{(overview?.organizations || []).map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}</select><select value={auditActionFilter} onChange={(event) => { const value = event.target.value; setAuditActionFilter(value); loadAudit({ action: value }); }} aria-label="Filtrar auditoría por tipo de acción"><option value="">Todas las acciones</option>{Object.keys(actionLabels).map((key) => <option value={key} key={key}>{actionLabels[key]}</option>)}</select><span>{auditLogs.length} registro{auditLogs.length === 1 ? "" : "s"}</span></div>
      {auditLogs.length ? <div className="audit-list">{auditLogs.map((log) => <article className="audit-row" key={log.id}><span className="audit-time">{dateTime(log.createdAt)}</span><div><strong>{actionLabel(log.action)}</strong><span>{log.organizationName || "Plataforma"} · {log.actorName || log.actorEmail || "Sistema"}</span></div><code>{JSON.stringify(log.metadata || {})}</code></article>)}</div> : <p className="empty-state">Sin registros para este filtro.</p>}
    </section>
    <footer className="platform-footer"><span>Centro central · {overview?.plans?.length || 0} planes disponibles</span><span>Los cambios quedan registrados en auditoría.</span></footer>
  </main>;
}
