import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { flexRender, getCoreRowModel, getFilteredRowModel, useReactTable } from "@tanstack/react-table";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
const chartColors = ["#c8a24b", "#5f6f6b", "#2f3b39", "#a33b2b", "#8d7a55"];

function formatPrice(value) {
  return `$${Number(value || 0).toLocaleString("en-US")} USD`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

function slugify(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function publicVehiclePath(vehicle) {
  const base = slugify(`${vehicle.brand}-${vehicle.model}${vehicle.variant ? `-${vehicle.variant}` : ""}`);
  const suffix = String(vehicle.id || "").replace(/-/g, "").slice(0, 8);
  return `/vehiculos/${suffix ? `${base}-${suffix}` : base}`;
}

function navItemsForRole(role) {
  const salesItem = ["quotes", "Cotizaciones"];
  if (role === "admin") return [["dashboard", "Resumen"], ["inventory", "Inventario"], ["leads", "Leads"], salesItem, ["blog", "Blog"], ["offers", "Ofertas"], ["reports", "Reportes"], ["audit", "Actividad"], ["users", "Usuarios"], ["settings", "Configuración"]];
  if (role === "editor") return [["dashboard", "Resumen"], ["inventory", "Inventario"], ["leads", "Leads"], salesItem, ["blog", "Blog"], ["offers", "Ofertas"], ["reports", "Reportes"]];
  if (role === "content_editor") return [["dashboard", "Resumen"], ["blog", "Blog"]];
  return [["dashboard", "Resumen"], ["leads", "Leads"], salesItem, ["offers", "Ofertas"], ["reports", "Reportes"]];
}

const importHeaderAliases = { marca: "brand", brand: "brand", fabricante: "brand", modelo: "model", model: "model", version: "variant", variante: "variant", variant: "variant", año: "year", ano: "year", year: "year", precio: "priceUsd", "precio usd": "priceUsd", price: "priceUsd", priceusd: "priceUsd", categoria: "category", categoría: "category", category: "category", estado: "status", status: "status", condicion: "condition", condición: "condition", inventario: "stockNumber", "numero de inventario": "stockNumber", stocknumber: "stockNumber", motor: "engine", potencia: "power", transmision: "transmission", transmisión: "transmission", traccion: "drive", tracción: "drive", combustible: "fuelType", "color exterior": "exteriorColor", "color interior": "interiorColor", kilometraje: "mileageKm", "kilometraje km": "mileageKm", mileage: "mileageKm", ubicacion: "location", ubicación: "location", garantia: "warranty", garantía: "warranty", equipamiento: "features", features: "features", descripcion: "description", descripción: "description", stock: "stock", fotos: "images", imagenes: "images", imágenes: "images", images: "images" };
function normalizeImportRow(row) { return Object.entries(row).reduce((result, [key, value]) => { const normalized = String(key || "").trim().toLowerCase(); const field = importHeaderAliases[normalized] || normalized.replaceAll(" ", ""); if (field) result[field] = value; return result; }, {}); }

function InventoryImportModal({ open, onClose, vehicles = [] }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const vehicleKey = (vehicle) => [vehicle.brand, vehicle.model, vehicle.variant, vehicle.year].map((value) => String(value || "").trim().toLowerCase()).join("|");
  const existingVehicleKeys = useMemo(() => new Set(vehicles.map(vehicleKey)), [vehicles]);
  if (!open) return null;
  const parseFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setStatus(""); setFileName(file.name); setRows([]);
    try {
      let parsed;
      if (/\.(csv|tsv)$/i.test(file.name)) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
        const splitLine = (line) => line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, "").replaceAll('""', '"'));
        const headers = splitLine(lines.shift() || "");
        parsed = lines.map((line) => Object.fromEntries(headers.map((header, index) => [header, splitLine(line)[index] || ""]))).map(normalizeImportRow);
      } else {
        const { readSheet } = await import("read-excel-file/browser");
        const matrix = await readSheet(file);
        const headers = matrix.shift() || [];
        parsed = matrix.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))).map(normalizeImportRow);
      }
      parsed = parsed.filter((row) => Object.values(row).some(Boolean));
      if (!parsed.length) throw new Error("El archivo no tiene filas con datos.");
      const importKeys = parsed.map((row) => [row.brand, row.model, row.variant, row.year].map((value) => String(value || "").trim().toLowerCase()).join("|"));
      const duplicateCount = importKeys.length - new Set(importKeys).size;
      if (duplicateCount > 0) setError(`${duplicateCount} fila${duplicateCount === 1 ? " duplicada" : "s duplicadas"} detectada${duplicateCount === 1 ? "" : "s"}. Se excluirán al importar.`);
      setRows(parsed);
    } catch (parseError) { setError(parseError.message || "No se pudo leer el archivo."); }
  };
  const rowError = (row) => !String(row.brand || "").trim() ? "Falta marca" : !String(row.model || "").trim() ? "Falta modelo" : !(Number(row.year) > 1900) ? "Año inválido" : !(Number(row.priceUsd) > 0) ? "Precio inválido" : "";
  const duplicateImportError = (row) => {
    const key = [row.brand, row.model, row.variant, row.year].map((value) => String(value || "").trim().toLowerCase()).join("|");
    if (!key.replaceAll("|", "")) return "";
    if (existingVehicleKeys.has(key)) return "Ya existe en el inventario";
    const occurrences = rows.filter((candidate) => [candidate.brand, candidate.model, candidate.variant, candidate.year].map((value) => String(value || "").trim().toLowerCase()).join("|") === key);
    return occurrences.length > 1 ? "Duplicado en el archivo" : "";
  };
  const validRows = rows.filter((row) => !rowError(row) && !duplicateImportError(row));
  const submit = async () => {
    if (!validRows.length) { setError("Corrige las filas inválidas antes de importar."); return; }
    setBusy(true); setError(""); setStatus("Importando vehículos como borradores…");
    const token = localStorage.getItem("authentiq_admin_token"); let created = 0; const failures = [];
    for (const row of validRows) {
      const images = String(row.images || "").split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
      const body = { ...emptyVehicle, ...row, brandLogoUrl: getAdminBrandLogoUrl(row.brand), year: Number(row.year), priceUsd: Number(row.priceUsd), mileageKm: Number(row.mileageKm || 0), stock: Number(row.stock || 1), status: "draft", condition: row.condition || "used", features: String(row.features || "").split(",").map((item) => item.trim()).filter(Boolean), images, imageAltTexts: images.map(() => `${row.brand} ${row.model}`), media: [] };
      try { const response = await fetch(`${apiUrl}/api/admin/vehicles`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo crear"); created += 1; } catch (submitError) { failures.push(`${row.brand} ${row.model}: ${submitError.message}`); }
    }
    setBusy(false); setStatus(`${created} vehículo${created === 1 ? " creado" : "s creados"} como borrador.`); window.dispatchEvent(new CustomEvent("authentiq:inventory-refresh"));
    if (failures.length) setError(`No se importaron ${failures.length}: ${failures.slice(0, 2).join(" · ")}`);
    if (!failures.length) window.setTimeout(onClose, 900);
  };
  return <div className="wizard-backdrop import-backdrop"><section className="inventory-import-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-import-title"><div className="wizard-header"><div><span className="eyebrow">ALIMENTACIÓN MASIVA</span><h2 id="inventory-import-title">Importar inventario.</h2><p>Sube un Excel o CSV, revisa las filas y créalas como borradores.</p></div><button type="button" className="wizard-close" onClick={onClose} aria-label="Cerrar importación">×</button></div><div className="import-dropzone"><input type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={parseFile} disabled={busy} /><strong>{fileName || "Selecciona tu archivo de inventario"}</strong><span>Excel .xlsx, .xls o CSV · La primera fila debe contener los encabezados.</span></div>{rows.length > 0 && <><div className="import-summary"><span>{rows.length} filas leídas</span><strong>{validRows.length} listas</strong><span>{rows.length - validRows.length} con errores</span></div><div className="import-preview"><table><thead><tr><th>Fila</th><th>Marca</th><th>Modelo</th><th>Año</th><th>Precio</th><th>Validación</th></tr></thead><tbody>{rows.slice(0, 12).map((row, index) => <tr key={`${row.brand}-${row.model}-${index}`}><td>{index + 2}</td><td>{row.brand || "—"}</td><td>{row.model || "—"}</td><td>{row.year || "—"}</td><td>{row.priceUsd || "—"}</td><td className={rowError(row) ? "import-row-error" : "import-row-ready"}>{rowError(row) || "Lista"}</td></tr>)}</tbody></table>{rows.length > 12 && <small>Mostrando las primeras 12 filas.</small>}</div></>}{error && <p className="state-message error">{error}</p>}{status && <p className="form-message">{status}</p>}<div className="wizard-footer"><button className="secondary-action" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary-action" type="button" onClick={submit} disabled={busy || !validRows.length}>{busy ? "Importando…" : `Importar ${validRows.length || "vehículos"}`}</button></div></section></div>;
}

function AdminNav({ activeModule, onChange, onBack, onLogout, role, unreadNotifications, notifications, onReadNotifications, onPreview, theme, onToggleTheme, vehicles = [] }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const visibleItems = navItemsForRole(role);
  return (
    <>
      <header className="admin-header">
        {/* El nombre del módulo lo titula cada módulo con su propio contexto:
            repetirlo aquí duplicaba el encabezado y comía media pantalla en móvil. */}
        <div className="admin-title-row"><h1 className="admin-app-title">AUTHENTIQ <span>Backoffice</span></h1><span className="role-chip">{role === "admin" ? "ADMIN" : role === "content_editor" ? "CONTENIDO" : role === "editor" ? "EDITOR" : "VENTAS"}</span></div>
        <div className="admin-header-actions"><div className="notification-wrap"><button className="notification-button" type="button" onClick={() => setShowNotifications((current) => !current)} aria-expanded={showNotifications} aria-label="Abrir notificaciones">Notificaciones {unreadNotifications > 0 && <span>{unreadNotifications}</span>}</button>{showNotifications && <div className="notification-popover"><div className="notification-popover-head"><strong>Actividad reciente</strong>{unreadNotifications > 0 && <button className="text-button" type="button" onClick={onReadNotifications}>Marcar leídas</button>}</div>{notifications?.length ? notifications.slice(0, 8).map((notification) => <article className={notification.readAt ? "notification-item" : "notification-item unread"} key={notification.id}><strong>{notification.title}</strong><span>{notification.body}</span><small>{formatDate(notification.createdAt)}</small></article>) : <p className="empty-state">No hay notificaciones nuevas.</p>}</div>}</div><button className="secondary-action theme-toggle" type="button" onClick={onToggleTheme} aria-label="Cambiar tema">{theme === "dark" ? "Modo claro" : "Modo oscuro"}</button><button className="secondary-action" type="button" onClick={onPreview}>Vista previa</button><button className="secondary-action" onClick={onBack}>Ver catálogo</button><button className="secondary-action" onClick={onLogout}>Cerrar sesión</button></div>
      </header>
      <div className="admin-presentation-launch"><span>Para mostrar el producto sin ruido operativo</span><button className="secondary-action" type="button" onClick={() => window.open("/presentacion", "_blank", "noopener,noreferrer")}>Abrir modo presentación →</button></div>
      <nav className="admin-nav" aria-label="Módulos administrativos">
        {visibleItems.map(([key, label]) => <button key={key} className={activeModule === key ? "admin-nav-item active" : "admin-nav-item"} aria-current={activeModule === key ? "page" : undefined} onClick={() => onChange(key)}>{label}</button>)}
      </nav>
      {activeModule === "inventory" && <button className="secondary-action inventory-import-trigger" type="button" onClick={() => setImportOpen(true)}>Importar Excel / CSV</button>}
      {activeModule === "inventory" && <InventoryImportModal open={importOpen} onClose={() => setImportOpen(false)} vehicles={vehicles} />}
    </>
  );
}

function StatCard({ label, value, note }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function AdminToast({ message }) {
  if (!message) return null;
  // La salida es más rápida que la entrada (~75%): confirma sin demorar al usuario.
  return <motion.div className="admin-toast" role="status" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: .22, ease: [0.22, 1, 0.36, 1] } }} exit={{ opacity: 0, y: 8, transition: { duration: .15 } }}><span className="admin-toast-mark">✓</span><span>{message}</span></motion.div>;
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton" aria-label="Cargando resumen"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton-block" key={item} />)}</div></div>;
}

function DashboardPulse({ data, leads, offers, onNavigate }) {
  const priorityLeads = (leads || []).filter((lead) => ["new", "contacted", "qualified"].includes(lead.status)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  const actions = [
    ["leads", "Leads prioritarios", priorityLeads.length, "Responder y asignar"],
    ["offers", "Ofertas pendientes", (offers || []).filter((item) => item.status === "pending").length, "Revisar propuesta"],
    ["reports", "Actividad comercial", (leads || []).length + (offers || []).length, "Ver reportes"],
    ["inventory", "Inventario visible", data?.summary?.publishedVehicles || 0, "Cuidar la vitrina"],
  ];
  return <section className="dashboard-pulse">
    <article className="priority-panel">
      <div className="panel-heading"><div><span className="eyebrow">PRIORIDAD HOY</span><h3>Lo que merece atencion.</h3></div><button className="text-button" type="button" onClick={() => onNavigate("leads")}>Abrir leads</button></div>
      {priorityLeads.length ? <div className="priority-list">{priorityLeads.map((lead, index) => <button className="priority-item" type="button" key={lead.id} onClick={() => onNavigate("leads")}><span className="priority-index">{String(index + 1).padStart(2, "0")}</span><span className="priority-copy"><strong>{lead.name}</strong><small>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"} · {formatDate(lead.createdAt)}</small></span><span className={`status-pill ${lead.status}`}>{lead.status}</span><span className="priority-arrow">→</span></button>)}</div> : <p className="empty-state">No hay leads pendientes de seguimiento.</p>}
    </article>
    <div className="quick-action-grid">{actions.map(([key, label, count, hint], index) => <button className="quick-action" type="button" key={key} onClick={() => onNavigate(key)}><span className="quick-action-top"><span className="eyebrow">{String(index + 1).padStart(2, "0")}</span><strong>{count}</strong></span><span className="quick-action-label">{label}</span><small>{hint} <span>→</span></small></button>)}</div>
  </section>;
}

function DashboardView({ data, leads, offers, loading, onNavigate }) {
  if (loading || !data) return <DashboardSkeleton />;
  const summary = data.summary || {};
  const statusData = (data.byStatus || []).map((item) => ({ ...item, label: item.status === "published" ? "Publicados" : item.status === "pending_review" ? "En revisión" : item.status === "draft" ? "Borradores" : item.status === "sold" ? "Vendidos" : "Inactivos" }));
  return (
    <section className="dashboard-content">
      <div className="dashboard-intro"><div><span className="eyebrow">OPERACIÓN · EN TIEMPO REAL</span><h2>Una vista clara del negocio.</h2></div><p>Datos consultados directamente desde PostgreSQL.</p></div>
      <div className="stats-grid">
        <StatCard label="Vehículos" value={summary.totalVehicles || 0} note={`${summary.publishedVehicles || 0} publicados`} />
        <StatCard label="Stock disponible" value={summary.availableStock || 0} note="Unidades publicadas" />
        <StatCard label="Valor inventario" value={formatPrice(summary.inventoryValue)} note="Precio × stock" />
        <StatCard label="Leads activos" value={summary.pendingLeads || 0} note={`${summary.pendingOffers || 0} ofertas pendientes`} />
      </div>
      <DashboardPulse data={data} leads={leads} offers={offers} onNavigate={onNavigate} />
      <div className="charts-grid">
        <article className="chart-panel"><div className="panel-heading"><div><span className="eyebrow">INVENTARIO</span><h3>Stock por marca</h3></div></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.byBrand || []} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`${value} unidades`, "Stock"]} /><Bar dataKey="stock" fill="#c8a24b" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
        <article className="chart-panel"><div className="panel-heading"><div><span className="eyebrow">ESTADO</span><h3>Distribución del inventario</h3></div></div><div className="chart-box status-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} dataKey="count" nameKey="label" innerRadius={52} outerRadius={78} paddingAngle={3}>{statusData.map((item, index) => <Cell key={item.status} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${value} vehículos`, item.payload.label]} /></PieChart></ResponsiveContainer><div className="chart-legend">{statusData.map((item, index) => <span key={item.status}><i style={{ background: chartColors[index % chartColors.length] }} />{item.label} · {item.count}</span>)}</div></div></article>
      </div>
      <div className="dashboard-lower"><article className="activity-panel"><div className="panel-heading"><div><span className="eyebrow">OFERTAS</span><h3>Actividad reciente</h3></div></div>{data.recentOffers?.length ? data.recentOffers.map((offer) => <div className="activity-row" key={offer.id}><div><strong>{offer.buyerName}</strong><span>{offer.brand} {offer.model} · {formatPrice(offer.amountUsd)}</span></div><span className={`status-pill ${offer.status}`}>{offer.status}</span></div>) : <p className="empty-state">Todavía no hay ofertas registradas.</p>}</article><article className="activity-panel"><div className="panel-heading"><div><span className="eyebrow">OPERACIÓN</span><h3>Próximo enfoque</h3></div></div><p className="empty-state">Revisa leads, ofertas e inventario para mantener la vitrina activa.</p></article></div>
    </section>
  );
}

function PhotoEditor({ value, altValue, onChange, onAltChange, onUpload }) {
  const [draftUrl, setDraftUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const images = String(value || "").split(",").map((url) => url.trim()).filter(Boolean);
  // Los textos alternativos son posicionales: NO se filtran los vacíos, porque eso
  // desplazaría los siguientes y los asignaría a la imagen equivocada.
  const altTexts = String(altValue || "").split(/\r?\n/).map((item) => item.trim());
  const alignedAlts = images.map((_item, index) => altTexts[index] || "");

  const update = (nextImages, nextAlts) => {
    onChange(nextImages.join(", "));
    onAltChange?.(nextAlts.join("\n"));
  };
  const add = () => {
    const url = draftUrl.trim();
    if (!url || images.includes(url)) return;
    update([...images, url], [...alignedAlts, ""]);
    setDraftUrl("");
  };
  // Al reordenar, el alt viaja con su imagen.
  const move = (from, to) => {
    if (to < 0 || to >= images.length) return;
    const nextImages = [...images];
    const nextAlts = [...alignedAlts];
    const [image] = nextImages.splice(from, 1);
    const [alt] = nextAlts.splice(from, 1);
    nextImages.splice(to, 0, image);
    nextAlts.splice(to, 0, alt);
    update(nextImages, nextAlts);
  };
  const remove = (index) => update(images.filter((_item, i) => i !== index), alignedAlts.filter((_item, i) => i !== index));
  const setAlt = (index, text) => update(images, alignedAlts.map((item, i) => i === index ? text : item));
  const handleUpload = async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length || !onUpload) return;
    setUploading(true);
    try {
      const urls = (await Promise.all(files.map((file) => onUpload(file)))).filter(Boolean);
      update([...images, ...urls], [...alignedAlts, ...urls.map(() => "")]);
    } finally { setUploading(false); event.target.value = ""; }
  };

  const described = alignedAlts.filter(Boolean).length;
  return <div className="photo-editor">
    <div className="photo-editor-head"><div><span className="eyebrow">GALERÍA</span><h3>{images.length} {images.length === 1 ? "imagen" : "imágenes"}</h3></div><span>La primera es la portada · arrastra para reordenar{images.length ? ` · ${described}/${images.length} con texto alternativo` : ""}</span></div>
    <div className="photo-grid">{images.map((url, index) => <article className="photo-item" key={`${url}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData("text/plain")); if (Number.isInteger(from)) move(from, index); }}>
      <img src={url} alt={alignedAlts[index] || `Imagen ${index + 1}`} onError={(event) => { event.currentTarget.style.opacity = "0.2"; }} />
      <span className="photo-order">{index === 0 ? "PORTADA" : String(index + 1).padStart(2, "0")}</span>
      <div className="photo-actions"><button type="button" className="photo-action" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label="Mover a la izquierda">←</button><button type="button" className="photo-action" onClick={() => move(index, index + 1)} disabled={index === images.length - 1} aria-label="Mover a la derecha">→</button><button type="button" className="photo-action remove" onClick={() => remove(index)} aria-label="Eliminar imagen">×</button></div>
      <input className="photo-alt-input" value={alignedAlts[index]} onChange={(event) => setAlt(index, event.target.value)} placeholder="Texto alternativo (accesibilidad y SEO)" aria-label={`Texto alternativo de la imagen ${index + 1}`} maxLength={180} />
    </article>)}</div>
    <div className="photo-add"><input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="/assets/mi-vehiculo.jpg o URL externa" aria-label="URL de nueva imagen" /><button className="secondary-action" type="button" onClick={add}>Agregar URL</button><label className="upload-image-button">{uploading ? "Subiendo imágenes…" : "Subir imágenes"}<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={handleUpload} disabled={uploading} /></label></div>
  </div>;
}

function MediaOps({ form, onChange, onUpload, onPackageUpload }) {
  const [uploadingField, setUploadingField] = useState("");
  const [uploadError, setUploadError] = useState("");
  const modelUrl = String(form.media3dUrl || "").trim();
  const modelStatus = !modelUrl ? "Profundidad automática disponible" : modelUrl.includes("/uploads/packages/") ? "3D real validado" : /\.glb(?:$|[?#])/i.test(modelUrl) ? "3D real conectado" : "GLTF requiere carpeta completa";
  const imageCount = String(form.images || "").split(",").map((item) => item.trim()).filter(Boolean).length;
  const mediaItems = [
    { field: "media3dUrl", label: "Modelo 3D", detail: "GLB o carpeta GLTF · hasta 120 MB", accept: ".glb,.gltf,model/gltf-binary,model/gltf+json", icon: "◇" },
    { field: "videoUrl", label: "Video del vehículo", detail: "MP4, WebM o MOV", accept: "video/mp4,video/webm,video/quicktime", icon: "▶" },
    { field: "videoPosterUrl", label: "Portada del video", detail: "JPG, PNG o WebP · opcional", accept: "image/jpeg,image/png,image/webp,image/avif", icon: "▧" },
    { field: "panorama360Url", label: "Vista 360", detail: "Panorama JPG, PNG o WebP", accept: "image/jpeg,image/png,image/webp,image/avif", icon: "◎" },
  ];
  const upload = async (event, field) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUpload) return;
    setUploadingField(field);
    setUploadError("");
    try { onChange(field, await onUpload(file)); } catch (error) { setUploadError(error.message || "No se pudo cargar el archivo"); } finally { setUploadingField(""); }
  };
  const uploadPackage = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length || !onPackageUpload) return;
    setUploadingField("media3dPackage");
    setUploadError("");
    try { onChange("media3dUrl", await onPackageUpload(files)); } catch (error) { setUploadError(error.message || "No se pudo cargar la carpeta 3D"); } finally { setUploadingField(""); }
  };
  return <section className="media-studio-panel" aria-label="Estudio multimedia del vehículo">
    <div className="media-studio-head"><div><span className="eyebrow">MEDIA STUDIO / 04</span><h3>Haz que el vehículo se sienta real.</h3><p>Sube tus archivos directamente. AUTHENTIQ prepara la portada, el movimiento y la experiencia visual sin obligarte a pegar rutas técnicas.</p></div><div className="media-studio-score"><strong>{String(Math.min(imageCount, 99)).padStart(2, "0")}</strong><span>{imageCount === 1 ? "foto conectada" : "fotos conectadas"}</span></div></div>
    <div className="media-studio-status"><span><i className={imageCount ? "is-ready" : ""}>●</i> {imageCount ? `${imageCount} foto${imageCount === 1 ? "" : "s"} conectada${imageCount === 1 ? "" : "s"}` : "Sin galería todavía"}</span><span><i className={modelUrl && !modelStatus.includes("requiere") ? "is-ready" : ""}>●</i> {modelStatus}</span><span><i className={form.videoUrl ? "is-ready" : ""}>●</i> {form.videoUrl ? "Video listo" : "Video opcional"}</span></div>
    <div className="media-studio-grid">{mediaItems.map((item) => <article className="media-upload-card" key={item.field}><div className="media-upload-card-head"><span className="media-upload-icon">{item.icon}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div>{form[item.field] && <span className="media-connected">{item.field === "media3dUrl" && modelStatus.includes("requiere") ? "REVISAR" : "LISTO"}</span>}</div><label className="media-dropzone"><input type="file" accept={item.accept} onChange={(event) => upload(event, item.field)} disabled={Boolean(uploadingField)} /><span>{uploadingField === item.field ? "Subiendo archivo…" : form[item.field] ? "Reemplazar archivo" : "Cargar archivo"}</span><small>Seleccionar desde tu computadora</small></label>{item.field === "media3dUrl" && <label className="media-dropzone media-folder-dropzone"><input type="file" multiple webkitdirectory="" directory="" onChange={uploadPackage} disabled={Boolean(uploadingField)} /><span>{uploadingField === "media3dPackage" ? "Preparando carpeta…" : "Cargar carpeta GLTF completa"}</span><small>Selecciona la carpeta con scene.gltf, .bin y texturas</small></label>}</article>)}</div>
    {uploadError && <p className="media-upload-error">{uploadError}</p>}
    <details className="media-advanced"><summary>Fuentes avanzadas <span>URL externa opcional</span></summary><div className="media-advanced-grid"><label>URL del modelo 3D<input type="url" value={modelUrl} onChange={(event) => onChange("media3dUrl", event.target.value)} placeholder="https://.../vehiculo.glb" /></label><label>URL del video<input type="url" value={form.videoUrl || ""} onChange={(event) => onChange("videoUrl", event.target.value)} placeholder="https://.../walkaround.mp4" /></label><label>URL de portada<input type="url" value={form.videoPosterUrl || ""} onChange={(event) => onChange("videoPosterUrl", event.target.value)} placeholder="https://.../poster.jpg" /></label><label>URL de vista 360<input type="url" value={form.panorama360Url || ""} onChange={(event) => onChange("panorama360Url", event.target.value)} placeholder="https://.../panorama.jpg" /></label></div></details>
  </section>;
}



function VehicleReadiness({ form }) {
  const images = String(form.images || "").split(",").map((item) => item.trim()).filter(Boolean);
  const checks = [
    ["Identidad y precio", Boolean(form.brand && form.model && form.year && Number(form.priceUsd) > 0)],
    ["Galería de portada", images.length > 0],
    ["Descripción comercial", String(form.description || "").trim().length >= 40],
    ["Estudio visual", images.length > 0],
    ["SEO preparado", Boolean(String(form.seoTitle || "").trim() || String(form.brand || "").trim())],
  ];
  const completed = checks.filter(([, done]) => done).length;
  const recommended = images.length >= 3 && String(form.description || "").trim().length >= 80;
  return <section className={`vehicle-readiness ${completed === checks.length ? "is-complete" : ""}`} aria-label="Preparación del vehículo"><div className="vehicle-readiness-head"><div><span className="eyebrow">PUBLICACIÓN INTELIGENTE</span><h3>{completed === checks.length ? "Ficha lista para revisar." : "Construye la ficha sin perderte."}</h3></div><strong>{completed}/{checks.length}</strong></div><div className="vehicle-readiness-list">{checks.map(([label, done]) => <span key={label} className={done ? "is-done" : ""}><i>{done ? "✓" : "○"}</i>{label}</span>)}</div><p>{recommended ? "La galería tiene el mínimo recomendado para una presentación premium." : "Mínimo operativo: una foto y 40 caracteres de descripción. Recomendado: 3 fotos para una presentación más rica."}</p></section>;
}

const adminBrandLogoSlugs = { Acura: "acura", "Alfa Romeo": "https://cdn.freebiesupply.com/logos/large/2x/alfa-romeo-logo-png-transparent.png", Audi: "https://cdn.freebiesupply.com/logos/large/2x/audi-14-logo-png-transparent.png", Bentley: "bentley", BMW: "https://cdn.freebiesupply.com/logos/large/2x/bmw-logo-png-transparent.png", Buick: "https://cdn.freebiesupply.com/logos/large/2x/buick-logo-png-transparent.png", BYD: "https://commons.wikimedia.org/wiki/Special:FilePath/BYD_Company%2C_Ltd._-_Logo.svg", Cadillac: "cadillac", Changan: "https://commons.wikimedia.org/wiki/Special:FilePath/Changan_icon.svg", Chevrolet: "chevrolet", Chrysler: "chrysler", Citroen: "citroen", Daihatsu: "https://cdn.freebiesupply.com/logos/large/2x/daihatsu-logo-png-transparent.png", Dodge: "https://cdn.freebiesupply.com/logos/large/2x/dodge-logo-png-transparent.png", Ferrari: "ferrari", Fiat: "fiat", Ford: "ford", GMC: "https://cdn.freebiesupply.com/logos/large/2x/gmc-logo-png-transparent.png", Honda: "honda", Hyundai: "hyundai", Infiniti: "infiniti", Jaguar: "https://cdn.freebiesupply.com/logos/large/2x/jaguar-logo-png-transparent.png", Jeep: "jeep", Kia: "kia", Lamborghini: "lamborghini", "Land Rover": "https://cdn.freebiesupply.com/logos/large/2x/land-rover-logo-png-transparent.png", Lexus: "https://cdn.freebiesupply.com/logos/large/2x/lexus-logo-png-transparent.png", Lotus: "https://cdn.freebiesupply.com/logos/large/2x/lotus-logo-png-transparent.png", Maserati: "maserati", Mazda: "mazda", McLaren: "mclaren", MINI: "mini", Mitsubishi: "mitsubishi", Nissan: "nissan", Peugeot: "peugeot", Polestar: "polestar", Porsche: "https://cdn.freebiesupply.com/logos/large/2x/porsche-logo-png-transparent.png", RAM: "ram", Renault: "renault", "Rolls-Royce": "rollsroyce", SEAT: "seat", Skoda: "skoda", Subaru: "subaru", Suzuki: "suzuki", Tesla: "tesla", Toyota: "toyota", Volkswagen: "volkswagen", Volvo: "volvo", "Mercedes-AMG": "https://cdn.freebiesupply.com/logos/large/2x/mercedes-benz-logo-png-transparent.png", "Mercedes-Benz": "https://cdn.freebiesupply.com/logos/large/2x/mercedes-benz-logo-png-transparent.png" };
const adminBrandDirectory = Object.keys(adminBrandLogoSlugs).sort((a, b) => a.localeCompare(b));
function getAdminBrandLogoUrl(brand) { const slug = adminBrandLogoSlugs[brand]; return slug?.startsWith("http") ? slug : slug ? `https://cdn.simpleicons.org/${slug}` : ""; }
function AdminBrandLogo({ brand, size = "normal" }) { const src = getAdminBrandLogoUrl(brand); return <span className={`admin-brand-logo ${size}`}><img src={src} alt={`${brand} logo`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.add("has-fallback"); }} /><b aria-hidden="true">{brand?.slice(0, 2).toUpperCase()}</b></span>; }

function BrandPickerBase({ vehicles, form, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return undefined; const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [open]);
  const brands = adminBrandDirectory;
  const visible = brands.filter((brand) => brand.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (brand) => { onChange("brand", brand); onChange("brandLogoUrl", getAdminBrandLogoUrl(brand)); setOpen(false); };
  return <section className="brand-picker"><div className="brand-picker-head"><div><span className="eyebrow">IDENTIDAD DE MARCA</span><h3>{form.brand || "Selecciona una marca"}</h3><p>Elige una marca disponible para alimentar tu catálogo.</p></div><button type="button" className="secondary-action" onClick={() => setOpen(true)}>Elegir marca</button></div>{form.brand && <div className="brand-picker-selected"><AdminBrandLogo brand={form.brand} size="wizard" /><div><strong>{form.brand}</strong><small>Logo conectado a esta ficha</small></div></div>}{open && <div className="brand-picker-dialog" role="dialog" aria-modal="true" aria-label="Seleccionar marca"><div className="brand-picker-dialog-head"><h3>Selecciona la marca</h3><button type="button" className="wizard-close" onClick={() => setOpen(false)} aria-label="Cerrar marcas">×</button></div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar marca..." aria-label="Buscar marca" /><div className="brand-picker-grid">{visible.map((brand) => <button type="button" key={brand} className={form.brand === brand ? "is-selected" : ""} onClick={() => choose(brand)}><AdminBrandLogo brand={brand} size="picker" /><strong>{brand}</strong><small>{vehicles.filter((vehicle) => vehicle.brand === brand).length} modelos</small></button>)}</div>{!visible.length && <p className="empty-state">No hay marcas disponibles que coincidan.</p>}</div>}</section>;
}

function LegacyInventoryModule({ vehicles, form, editingId, loading, message, onChange, onSave, onEdit, onCancel, onDeactivate, onDuplicate, onRefresh, onUpload }) {
  const fields = ["brand", "brandLogoUrl", "category", "model", "variant", "year", "priceUsd", "stockNumber", "engine", "power", "transmission", "drive", "fuelType", "exteriorColor", "interiorColor", "doors", "seats", "mileageKm", "location", "warranty", "features", "description", "seoTitle", "seoDescription", "stock", "maxDiscountPercent"];
  const fieldLabels = { brand: "Marca", category: "Categoría", model: "Modelo", variant: "Versión / variante", year: "Año", priceUsd: "Precio USD", stockNumber: "Número de inventario", engine: "Motor", power: "Potencia", transmission: "Transmisión", drive: "Tracción", fuelType: "Combustible", exteriorColor: "Color exterior", interiorColor: "Color interior", doors: "Puertas", seats: "Asientos", mileageKm: "Kilometraje (km)", location: "Ubicación", warranty: "Garantía", features: "Equipamiento (separado por comas)", description: "Descripción comercial", stock: "Unidades", maxDiscountPercent: "Descuento máximo %" };
  const columns = useMemo(() => [{ accessorKey: "brand", header: "Marca" }, { accessorKey: "model", header: "Modelo" }, { accessorKey: "year", header: "Año" }, { accessorKey: "status", header: "Estado" }, { accessorKey: "priceUsd", header: "Precio", cell: ({ getValue }) => formatPrice(getValue()) }, { id: "actions", header: "", cell: ({ row }) => <div className="table-actions"><button className="text-button" onClick={() => onEdit(row.original)}>Editar</button><button className="text-button" onClick={() => onDuplicate(row.original.id)}>Duplicar</button><button className="text-button danger-text" onClick={() => onDeactivate(row.original.id)}>Desactivar</button></div> }], [onDeactivate, onDuplicate, onEdit]);
  const [globalFilter, setGlobalFilter] = useState("");
  const table = useReactTable({ data: vehicles, columns, state: { globalFilter }, onGlobalFilterChange: setGlobalFilter, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel() });
  return <div className="inventory-content"><div className="admin-layout"><form className="admin-form" onSubmit={onSave}><div className="admin-form-head"><h2>{editingId ? "Editar vehículo" : "Nuevo vehículo"}</h2>{editingId && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}</div><div className="form-grid">{fields.map((field) => <label key={field}>{fieldLabels[field] || field}<input type={(["year", "priceUsd", "doors", "seats", "mileageKm", "stock", "maxDiscountPercent"].includes(field) ? "number" : "text")} value={form[field] ?? ""} onChange={(event) => onChange(field, event.target.value)} required={field === "brand" || field === "model" || field === "year" || field === "priceUsd"} /></label>)}<label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value)}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="reserved">Reservado</option><option value="sold">Vendido</option><option value="inactive">Inactivo</option></select></label><label>Condición<select value={form.condition} onChange={(event) => onChange("condition", event.target.value)}><option value="new">Nuevo</option><option value="used">Usado</option></select></label></div><PhotoEditor value={form.images} altValue={form.imageAltTexts} onChange={(value) => onChange("images", value)} onAltChange={(value) => onChange("imageAltTexts", value)} onUpload={onUpload} />{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">{editingId ? "Guardar cambios" : "Crear vehículo"}</button></form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")}</span><h3>Vehículos registrados</h3></div><button className="text-button" onClick={onRefresh}>Actualizar</button></div><input className="table-search" placeholder="Buscar por marca o modelo…" value={globalFilter ?? ""} onChange={(event) => setGlobalFilter(event.target.value)} />{loading ? <p className="empty-state">Cargando inventario…</p> : <div className="table-scroll"><table><thead>{table.getHeaderGroups().map((headerGroup) => <tr key={headerGroup.id}>{headerGroup.headers.map((header) => <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>{!table.getRowModel().rows.length && <p className="empty-state">No hay vehículos que coincidan.</p>}</div>}</section></div></div>;
}

function BrandPicker({ vehicles, form, onChange }) {
  return <><BrandPickerBase vehicles={vehicles} form={form} onChange={onChange} /><WizardIdentityFields form={form} onChange={onChange} /></>;
}

function WizardIdentityFields({ form, onChange }) {
  const fields = [
    ["category", "Categoría", "text"],
    ["model", "Modelo", "text"],
    ["variant", "Versión / variante", "text"],
    ["year", "Año", "number"],
    ["priceUsd", "Precio USD", "number"],
  ];
  return <section className="inventory-field-section wizard-identity-fields"><summary><span><strong>Identidad y precio</strong><small>La información principal de la ficha.</small></span><b>5 campos</b></summary><div className="form-grid">{fields.map(([field, label, type]) => <label key={field}>{label}<input type={type} value={form[field] ?? ""} onChange={(event) => onChange(field, event.target.value)} required={field === "model" || field === "year" || field === "priceUsd"} /></label>)}</div></section>;
}

function InventoryFieldSections({ fields, fieldLabels, numericFields, form, onChange, activeStep = null }) {
  const groups = [
    { id: "identity", title: "Identidad y precio", note: "La información principal de la ficha.", fields: ["brand", "brandLogoUrl", "category", "model", "variant", "year", "priceUsd"] },
    { id: "availability", title: "Disponibilidad", note: "Estado comercial, stock y ubicación.", fields: ["stockNumber", "stock", "location", "maxDiscountPercent"] },
    { id: "technical", title: "Ficha técnica", note: "Lo que ayuda a comparar el vehículo.", fields: ["engine", "power", "transmission", "drive", "fuelType", "doors", "seats", "mileageKm"] },
    { id: "presentation", title: "Presentación", note: "Color, garantía y argumento de venta.", fields: ["exteriorColor", "interiorColor", "warranty", "features", "description"] },
    { id: "discoverability", title: "Visibilidad digital", note: "Contenido para buscadores y compartir.", fields: ["seoTitle", "seoDescription"] },
  ];
  const visibleGroups = Number.isInteger(activeStep) ? groups.slice(activeStep, activeStep + 1) : groups;
  const renderField = (field) => <label key={field}>{fieldLabels[field] || field}<input type={numericFields.includes(field) ? "number" : "text"} value={form[field] ?? ""} onChange={(event) => onChange(field, event.target.value)} required={field === "model" || field === "year" || field === "priceUsd"} /></label>;
  return <div className="inventory-field-sections">{visibleGroups.map((group, index) => <details className="inventory-field-section" key={group.id} open><summary><span><strong>{group.title}</strong><small>{group.note}</small></span><b>{group.fields.length + (group.id === "availability" ? 2 : 0)} campos</b></summary><div className="form-grid">{group.fields.map(renderField)}{group.id === "availability" && <><label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value)}><option value="draft">Borrador</option><option value="pending_review">En revisión</option><option value="published">Publicado</option><option value="reserved">Reservado</option><option value="sold">Vendido</option><option value="inactive">Inactivo</option></select></label><label>Condición<select value={form.condition} onChange={(event) => onChange("condition", event.target.value)}><option value="new">Nuevo</option><option value="used">Usado</option></select></label></>}</div></details>)}</div>;
}

const vehicleStatusLabels = { draft: "Borrador", pending_review: "En revisión", published: "Publicado", reserved: "Reservado", sold: "Vendido", inactive: "Inactivo" };

function model3dState(url) {
  const value = String(url || "").trim();
  if (!value) return { code: "none", label: "—", title: "Sin modelo 3D" };
  if (value.startsWith("procedural://")) return { code: "invalid", label: "3D ✕", title: "Marcador procedural antiguo: no se muestra al comprador. Sube un GLB o una carpeta GLTF." };
  if (value.includes("/uploads/packages/")) return { code: "ok", label: "3D ✓", title: "Carpeta GLTF validada con todas sus dependencias" };
  if (/\.glb(?:$|[?#])/i.test(value)) return { code: "ok", label: "3D ✓", title: "GLB autónomo" };
  if (/\.gltf(?:$|[?#])/i.test(value)) return { code: "warn", label: "3D !", title: "GLTF suelto: probablemente le faltan el .bin y las texturas. Vuelve a subir la carpeta completa." };
  return { code: "warn", label: "3D ?", title: "Fuente externa sin verificar" };
}

function publishBlockers(vehicle) {
  const blockers = [];
  if (!vehicle.images?.length) blockers.push("sin fotos");
  if (!String(vehicle.description || "").trim()) blockers.push("sin descripción");
  if (!(Number(vehicle.priceUsd) > 0)) blockers.push("sin precio");
  return blockers;
}

function VehicleWizard({ vehicles, form, editingId, message, onChange, onSave, onCancel, onUpload, onPackageUpload }) {
  const [step, setStep] = useState(0);
  const steps = ["Identidad", "Disponibilidad", "Ficha técnica", "Presentación", "Visibilidad", "Imágenes", "3D y medios"];
  const fields = ["brand", "category", "model", "variant", "year", "priceUsd", "stockNumber", "engine", "power", "transmission", "drive", "fuelType", "exteriorColor", "interiorColor", "doors", "seats", "mileageKm", "location", "warranty", "features", "description", "seoTitle", "seoDescription", "stock", "maxDiscountPercent"];
  const numericFields = ["year", "priceUsd", "doors", "seats", "mileageKm", "stock", "maxDiscountPercent"];
  const fieldLabels = { brand: "Marca", brandLogoUrl: "Logo real de la marca (URL SVG)", category: "Categoría", model: "Modelo", variant: "Versión / variante", year: "Año", priceUsd: "Precio USD", stockNumber: "Número de inventario", engine: "Motor", power: "Potencia", transmission: "Transmisión", drive: "Tracción", fuelType: "Combustible", exteriorColor: "Color exterior", interiorColor: "Color interior", doors: "Puertas", seats: "Asientos", mileageKm: "Kilometraje (km)", location: "Ubicación", warranty: "Garantía", features: "Equipamiento (separado por comas)", description: "Descripción comercial", seoTitle: "Título SEO", seoDescription: "Descripción SEO", stock: "Unidades", maxDiscountPercent: "Descuento máximo %" };
  return <div className="wizard-backdrop"><form className="admin-form inventory-wizard" onSubmit={onSave}><div className="wizard-header"><div><span className="eyebrow">FICHA {editingId ? "· EDICIÓN" : "· NUEVA"}</span><h2>{editingId ? "Editar vehículo" : "Nuevo vehículo"}</h2><p>Completa cada etapa. Puedes volver a cualquiera sin perder los datos.</p></div><button type="button" className="wizard-close" onClick={onCancel} aria-label="Cerrar ventana">×</button></div><nav className="wizard-steps" aria-label="Etapas de la ficha">{steps.map((label, index) => <button type="button" key={label} className={index === step ? "active" : index < step ? "is-done" : ""} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav><div className="wizard-stage"><VehicleReadiness form={form} />{step === 0 && <BrandPicker vehicles={vehicles} form={form} onChange={onChange} />}{step > 0 && step < 5 && <InventoryFieldSections fields={fields} fieldLabels={fieldLabels} numericFields={numericFields} form={form} onChange={onChange} activeStep={step} />}{step === 5 && <PhotoEditor value={form.images} altValue={form.imageAltTexts} onChange={(value) => onChange("images", value)} onAltChange={(value) => onChange("imageAltTexts", value)} onUpload={onUpload} />}{step === 6 && <MediaOps form={form} onChange={onChange} onUpload={onUpload} onPackageUpload={onPackageUpload} />}</div>{message && <p className="form-message">{message}</p>}<div className="wizard-footer"><button className="secondary-action" type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>← Atrás</button>{step < steps.length - 1 ? <button className="primary-action" type="button" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>Siguiente →</button> : <button className="primary-action" type="submit">{editingId ? "Guardar cambios" : "Crear vehículo"}</button>}</div></form></div>;
}

function InventoryTableModule({ vehicles, form, editingId, loading, message, onChange, onSave, onEdit, onCancel, onDeactivate, onDuplicate, onRefresh, onUpload, onPackageUpload, onReview, onStatusChange }) {
  const fields = ["brand", "category", "model", "variant", "year", "priceUsd", "stockNumber", "engine", "power", "transmission", "drive", "fuelType", "exteriorColor", "interiorColor", "doors", "seats", "mileageKm", "location", "warranty", "features", "description", "seoTitle", "seoDescription", "stock", "maxDiscountPercent"];
  const fieldLabels = { brand: "Marca", brandLogoUrl: "Logo real de la marca (URL SVG)", category: "Categoría", model: "Modelo", variant: "Versión / variante", year: "Año", priceUsd: "Precio USD", stockNumber: "Número de inventario", engine: "Motor", power: "Potencia", transmission: "Transmisión", drive: "Tracción", fuelType: "Combustible", exteriorColor: "Color exterior", interiorColor: "Color interior", doors: "Puertas", seats: "Asientos", mileageKm: "Kilometraje (km)", location: "Ubicación", warranty: "Garantía", features: "Equipamiento (separado por comas)", description: "Descripción comercial", seoTitle: "Título SEO", seoDescription: "Descripción SEO", stock: "Unidades", maxDiscountPercent: "Descuento máximo %" };
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => { const refresh = () => onRefresh?.(); window.addEventListener("authentiq:inventory-refresh", refresh); return () => window.removeEventListener("authentiq:inventory-refresh", refresh); }, [onRefresh]);
  const filteredVehicles = vehicles.filter((vehicle) => (statusFilter === "all" || vehicle.status === statusFilter)
    && `${vehicle.brand} ${vehicle.model} ${vehicle.year} ${vehicleStatusLabels[vehicle.status] || vehicle.status} ${vehicle.stockNumber || ""}`.toLowerCase().includes(globalFilter.toLowerCase()));
  const numericFields = ["year", "priceUsd", "doors", "seats", "mileageKm", "stock", "maxDiscountPercent"];
  const wizardSteps = ["Identidad", "Disponibilidad", "Ficha técnica", "Presentación", "Visibilidad", "Imágenes", "3D y medios"];
  const [wizardOpen, setWizardOpen] = useState(false);
  useEffect(() => { if (editingId) setWizardOpen(true); }, [editingId]);
  const closeWizard = () => { setWizardOpen(false); if (editingId) onCancel?.(); };
  const saveWizard = async (event) => { await onSave(event); setWizardOpen(false); };
  if (wizardOpen) return <VehicleWizard vehicles={vehicles} form={form} editingId={editingId} message={message} onChange={onChange} onSave={saveWizard} onCancel={closeWizard} onUpload={onUpload} onPackageUpload={onPackageUpload} />;
  return <div className="inventory-content"><div className="admin-layout"><form className="admin-form" onSubmit={onSave}><div className="admin-form-head"><h2>{editingId ? "Editar vehículo" : "Nuevo vehículo"}</h2>{editingId && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}</div><VehicleReadiness form={form} /><InventoryFieldSections fields={fields} fieldLabels={fieldLabels} numericFields={numericFields} form={form} onChange={onChange} /><MediaOps form={form} onChange={onChange} onUpload={onUpload} onPackageUpload={onPackageUpload} /><PhotoEditor value={form.images} altValue={form.imageAltTexts} onChange={(value) => onChange("images", value)} onAltChange={(value) => onChange("imageAltTexts", value)} onUpload={onUpload} />{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">{editingId ? "Guardar cambios" : "Crear vehículo"}</button></form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")}</span><h3>Vehículos registrados</h3></div><button className="text-button" type="button" onClick={onRefresh}>Actualizar</button></div><div className="inventory-table-filters"><input className="table-search" placeholder="Buscar por marca, modelo o número de inventario…" value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar inventario por estado"><option value="all">Todos los estados</option>{Object.entries(vehicleStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span>{filteredVehicles.length} de {vehicles.length}</span></div>{loading ? <p className="empty-state">Cargando inventario…</p> : <div className="table-scroll"><table className="inventory-table"><thead><tr><th>Vehículo</th><th>Año</th><th>Estado</th><th>Medios</th><th>SEO</th><th>Precio</th><th /></tr></thead><tbody>{filteredVehicles.map((vehicle) => {
      const model3d = model3dState(vehicle.media?.find((item) => item.type === "model_3d")?.url);
      const hasVideo = vehicle.media?.some((item) => item.type === "video");
      const seoReady = Boolean(String(vehicle.seoTitle || "").trim() && String(vehicle.seoDescription || "").trim());
      const blockers = publishBlockers(vehicle);
      const isPublic = ["published", "reserved"].includes(vehicle.status);
      return <tr key={vehicle.id}>
        <td><div className="inventory-cell-main"><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.stockNumber ? `#${vehicle.stockNumber}` : "Sin número de inventario"}{vehicle.variant ? ` · ${vehicle.variant}` : ""}</small></div></td>
        <td>{vehicle.year}</td>
        <td><div className="inventory-cell-main"><span className={`status-pill ${vehicle.status}`}>{vehicleStatusLabels[vehicle.status] || vehicle.status}</span>{!isPublic && <small>No visible en el catálogo</small>}{isPublic && !!blockers.length && <small className="inventory-warning">Publicado sin {blockers.join(" y ")}</small>}{!isPublic && !!blockers.length && <small className="inventory-warning">Falta: {blockers.join(", ")}</small>}</div></td>
        <td><div className="inventory-badges"><span className={vehicle.images?.length ? "media-badge is-ready" : "media-badge is-missing"} title={`${vehicle.images?.length || 0} imágenes`}>{vehicle.images?.length || 0} ◫</span><span className={`media-badge is-${model3d.code}`} title={model3d.title}>{model3d.label}</span><span className={hasVideo ? "media-badge is-ready" : "media-badge"} title={hasVideo ? "Video conectado" : "Sin video"}>▶</span></div></td>
        <td><span className={seoReady ? "media-badge is-ready" : "media-badge is-warn"} title={seoReady ? "Título y descripción SEO definidos" : "Faltan metadatos SEO"}>{seoReady ? "SEO ✓" : "SEO !"}</span></td>
        <td>{formatPrice(vehicle.priceUsd)}</td>
        <td><div className="table-actions">{isPublic && <PublicVehicleActions vehicle={vehicle} />}<button className="text-button" type="button" onClick={() => onEdit(vehicle)}>Editar</button><button className="text-button" type="button" onClick={() => onDuplicate(vehicle.id)}>Duplicar</button>{vehicle.status === "pending_review" && <><button className="text-button review-action" type="button" onClick={() => onReview(vehicle.id, "approve")}>Aprobar</button><button className="text-button danger-text" type="button" onClick={() => onReview(vehicle.id, "reject")}>Devolver</button></>}<select className="status-quick-action" value="" onChange={(event) => { if (event.target.value) onStatusChange(vehicle.id, event.target.value); event.target.value = ""; }} aria-label={`Cambiar estado de ${vehicle.brand} ${vehicle.model}`}><option value="">Estado…</option>{["draft", "published", "reserved", "sold", "inactive"].filter((option) => option !== vehicle.status).map((option) => <option key={option} value={option}>{vehicleStatusLabels[option]}</option>)}</select></div></td>
      </tr>;
    })}</tbody></table>{!filteredVehicles.length && <p className="empty-state">No hay vehículos que coincidan.</p>}</div>}</section></div></div>;
}

function InventoryModule(props) {
  const { vehicles = [], form, editingId, message, onChange, onSave, onCancel, onUpload, onPackageUpload } = props;
  const [wizardOpen, setWizardOpen] = useState(false);
  useEffect(() => { if (editingId) setWizardOpen(true); }, [editingId]);
  const closeWizard = () => { setWizardOpen(false); if (editingId) onCancel?.(); };
  if (wizardOpen) return <VehicleWizard vehicles={vehicles} form={form} editingId={editingId} message={message} onChange={onChange} onSave={onSave} onCancel={closeWizard} onUpload={onUpload} onPackageUpload={onPackageUpload} />;
  const published = vehicles.filter((vehicle) => vehicle.status === "published").length;
  const review = vehicles.filter((vehicle) => vehicle.status === "pending_review").length;
  const missingPhotos = vehicles.filter((vehicle) => !vehicle.images?.length).length;
  return <div className="inventory-hub"><div className="inventory-overview-head"><div><span className="eyebrow">CENTRO DE INVENTARIO</span><h2>Todo tu inventario, en un solo lugar.</h2><p>Busca, revisa el estado y abre el asistente solo cuando quieras crear o editar un vehículo.</p></div><button className="primary-action inventory-new-button" type="button" onClick={() => setWizardOpen(true)}>+ Nuevo vehículo</button></div><div className="inventory-overview-stats"><article><span>Vehículos registrados</span><strong>{vehicles.length}</strong><small>En tu inventario</small></article><article><span>Publicados</span><strong>{published}</strong><small>Visibles en catálogo</small></article><article><span>En revisión</span><strong>{review}</strong><small>Requieren atención</small></article><article className={missingPhotos ? "is-warning" : ""}><span>Medios pendientes</span><strong>{missingPhotos}</strong><small>{missingPhotos ? "Sin fotografía principal" : "Inventario completo"}</small></article></div><InventoryTableModule {...props} /></div>;
}

function RecordsModule({ kind, records, loading, onRefresh, onStatusChange }) {
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>Ofertas recibidas.</h2></div><button className="secondary-action" onClick={onRefresh}>Actualizar</button></div>{loading ? <p className="empty-state">Cargando registros…</p> : records.length ? <div className="records-list">{records.map((record) => <article className="record-row" key={record.id}><div><strong>{record.buyerName}</strong><span>{record.brand} {record.model} · {formatPrice(record.amountUsd)}</span>{record.message && <p>{record.message}</p>}</div><div className="record-actions"><span className={`status-pill ${record.status}`}>{record.status}</span><select value={record.status} onChange={(event) => onStatusChange(record.id, event.target.value)}><option value="pending">Pendiente</option><option value="accepted">Aceptada</option><option value="rejected">Rechazada</option></select></div></article>)}</div> : <p className="empty-state">No hay ofertas registradas todavía.</p>}</section>;
}


function ReportsModule({ dashboard, vehicles, leads, offers, loading, analytics }) {
  const [period, setPeriod] = useState("all");
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
  const recent = (records) => records.filter((record) => !cutoff || new Date(record.createdAt).getTime() >= cutoff);
  const periodOffers = recent(offers);
  const periodLeads = recent(leads);
  const funnel = [{ name: "Leads", value: periodLeads.length, fill: "#c8a24b" }, { name: "Ofertas", value: periodOffers.length, fill: "#5f6f6b" }, { name: "Cerrados", value: periodLeads.filter((lead) => lead.status === "closed").length, fill: "#2f3b39" }];
  const acceptedOffers = periodOffers.filter((offer) => offer.status === "accepted");
  const conversion = periodLeads.length ? Math.round((periodLeads.filter((lead) => ["qualified", "closed"].includes(lead.status)).length / periodLeads.length) * 100) : 0;
  const exportReport = () => { const rows = [["Métrica", "Valor"], ["Periodo", period === "all" ? "Histórico" : `Últimos ${period} días`], ["Vehículos publicados", dashboard?.summary?.publishedVehicles || 0], ["Stock disponible", dashboard?.summary?.availableStock || 0], ["Leads", periodLeads.length], ["Ofertas", periodOffers.length], ["Ofertas aceptadas", acceptedOffers.length], ["Conversión calificados/cerrados", `${conversion}%`]]; const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = `authentiq-reporte-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); };
  return <section className="reports-content"><div className="panel-heading"><div><span className="eyebrow">INTELIGENCIA COMERCIAL</span><h2>Reportes.</h2></div><div className="panel-actions"><select className="report-period" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Periodo del reporte"><option value="all">Todo el histórico</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select><button className="secondary-action" onClick={exportReport}>Exportar CSV</button></div></div>{loading ? <p className="empty-state">Preparando reporte…</p> : <><div className="report-kpis"><AnalyticsEventsPanel analytics={analytics} /><StatCard label="Conversión comercial" value={`${conversion}%`} note="Leads calificados o cerrados" /><StatCard label="Ofertas aceptadas" value={acceptedOffers.length} note={`${periodOffers.length} ofertas en el periodo`} /><StatCard label="Inventario publicado" value={dashboard?.summary?.publishedVehicles || 0} note={`${vehicles.filter((vehicle) => vehicle.status === "published").length} registros`} /></div><div className="report-grid"><article className="chart-panel report-chart"><div className="panel-heading"><div><span className="eyebrow">EMBUDO</span><h3>Interés que se convierte en acción</h3></div></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 20, left: 18, bottom: 0 }}><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={70} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => [`${value}`, "Registros"]} /><Bar dataKey="value" radius={[0, 3, 3, 0]}>{funnel.map((item) => <Cell key={item.name} fill={item.fill} />)}</Bar></BarChart></ResponsiveContainer></div></article><article className="report-insight"><span className="eyebrow">LECTURA RÁPIDA</span><h3>{conversion >= 30 ? "El interés está avanzando." : "Hay oportunidad en el seguimiento."}</h3><p>{conversion >= 30 ? "La operación está convirtiendo una parte saludable de sus leads en conversaciones calificadas." : "Prioriza los leads nuevos y contactados para aumentar el paso hacia ofertas."}</p><div className="insight-line"><span>Valor de inventario</span><strong>{formatPrice(dashboard?.summary?.inventoryValue)}</strong></div><div className="insight-line"><span>Stock disponible</span><strong>{dashboard?.summary?.availableStock || 0} unidades</strong></div></article></div></>}</section>;
}



const analyticsEventLabels = {
  page_view: "Vistas de página",
  catalog_view: "Vistas de catálogo",
  vehicle_view: "Fichas abiertas",
  vehicle_share: "Vehículos compartidos",
  filter_used: "Filtros aplicados",
  compare_used: "Comparaciones",
  whatsapp_click: "Clics a WhatsApp",
  offer_submitted: "Ofertas enviadas",
  contact_submitted: "Contactos enviados",
};

function AnalyticsEventsPanel({ analytics }) {
  const events = Array.isArray(analytics) ? analytics : [];
  const total = events.reduce((sum, item) => sum + Number(item.count || 0), 0);
  return (
    <article className="chart-panel analytics-events-panel">
      <span className="eyebrow">COMPORTAMIENTO · ÚLTIMOS 30 DÍAS</span>
      <h3>{total ? `${total.toLocaleString("en-US")} eventos registrados` : "Sin eventos todavía"}</h3>
      {events.length ? (
        <div className="analytics-event-list">
          {events.map((item) => (
            <div className="insight-line" key={item.eventName}>
              <span>{analyticsEventLabels[item.eventName] || item.eventName.replaceAll("_", " ")}</span>
              <strong>{Number(item.count || 0).toLocaleString("en-US")}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p>Todavía no hay actividad medida. Los eventos se registran cuando un comprador navega el catálogo, abre una ficha, comparte o envía una solicitud.</p>
      )}
    </article>
  );
}

function CopyAction({ value, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); } };
  return <button className="copy-action" type="button" onClick={copy} aria-label={`Copiar ${label}`}>{copied ? "Copiado" : `Copiar ${label}`}</button>;
}

function PublicVehicleActions({ vehicle }) {
  const path = publicVehiclePath(vehicle);
  const url = `${window.location.origin}${path}`;
  return <div className="public-vehicle-actions"><a className="text-button" href={path} target="_blank" rel="noreferrer">Abrir ficha</a><CopyAction value={url} label="URL pública" /></div>;
}

function LeadContactActions({ lead, onLoadHistory }) {
  const [events, setEvents] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = async () => { const next = !historyOpen; setHistoryOpen(next); if (next && !events) setEvents(await onLoadHistory(lead.id)); };
  return <div className="lead-history"><div className="lead-history-actions"><CopyAction value={lead.phone} label="teléfono" /><CopyAction value={lead.email} label="correo" /><button className="text-button" type="button" onClick={toggleHistory}>{historyOpen ? "Ocultar historial" : "Ver historial"}</button></div>{historyOpen && <div className="lead-events">{events?.length ? events.map((event) => <div className="lead-event" key={event.id}><strong>{event.eventType}</strong><span>{event.note || "Sin detalle"}</span><small>{formatDate(event.createdAt)} · {event.actorName || "Sistema"}</small></div>) : <span>{events ? "Aún no hay eventos registrados." : "Cargando historial…"}</span>}</div>}</div>;
}



function QuotesModule({ quotes, leads, vehicles, loading, onRefresh, onCreate, onStatusChange }) {
  const initial = { leadId: "", vehicleId: "", customerName: "", customerEmail: "", customerPhone: "", basePriceUsd: "", discountUsd: 0, validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), notes: "" };
  const [form, setForm] = useState(initial);
  const selectedLead = leads.find((lead) => lead.id === form.leadId);
  const total = Math.max(0, Number(form.basePriceUsd || 0) - Number(form.discountUsd || 0));
  const selectLead = (leadId) => { const lead = leads.find((item) => item.id === leadId); const vehicle = vehicles.find((item) => item.id === lead?.vehicleId); setForm((current) => ({ ...current, leadId, vehicleId: lead?.vehicleId || current.vehicleId, customerName: lead?.name || current.customerName, customerEmail: lead?.email || current.customerEmail, customerPhone: lead?.phone || current.customerPhone, basePriceUsd: vehicle?.priceUsd ?? current.basePriceUsd })); };
  const selectVehicle = (vehicleId) => { const vehicle = vehicles.find((item) => item.id === vehicleId); setForm((current) => ({ ...current, vehicleId, basePriceUsd: vehicle?.priceUsd ?? current.basePriceUsd })); };
  const submit = async (event) => { event.preventDefault(); await onCreate(form); setForm(initial); };
  return <section className="records-content quotes-content"><div className="panel-heading"><div><span className="eyebrow">DOCUMENTOS COMERCIALES</span><h2>Cotizaciones.</h2></div><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar</button></div><div className="quotes-layout"><form className="admin-form quote-form" onSubmit={submit}><div className="admin-form-head"><h2>Nueva cotización</h2><span className="quote-total-preview">{formatPrice(total)}</span></div><label>Lead relacionado<select value={form.leadId} onChange={(event) => selectLead(event.target.value)}><option value="">Seleccionar lead (opcional)</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}{lead.brand ? ` · ${lead.brand} ${lead.model}` : ""}</option>)}</select></label><label>Vehículo<select value={form.vehicleId} onChange={(event) => selectVehicle(event.target.value)}><option value="">Seleccionar vehículo</option>{vehicles.filter((vehicle) => ["published", "reserved"].includes(vehicle.status)).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.year}</option>)}</select></label><div className="form-grid"><label>Cliente<input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} required /></label><label>Correo<input type="email" value={form.customerEmail} onChange={(event) => setForm({ ...form, customerEmail: event.target.value })} /></label><label>Teléfono<input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></label><label>Vigente hasta<input type="date" value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} /></label><label>Precio base USD<input type="number" min="0" step="0.01" value={form.basePriceUsd} onChange={(event) => setForm({ ...form, basePriceUsd: event.target.value })} required /></label><label>Descuento USD<input type="number" min="0" step="0.01" value={form.discountUsd} onChange={(event) => setForm({ ...form, discountUsd: event.target.value })} /></label></div><label>Notas para el cliente<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Garantía, condiciones, entrega…" /></label><button className="primary-action" type="submit">Guardar cotización</button>{selectedLead && <small>Se creará vinculada al seguimiento de {selectedLead.name}.</small>}</form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">HISTORIAL · {quotes.length.toString().padStart(2, "0")}</span><h3>Propuestas emitidas</h3></div></div>{loading ? <p className="empty-state">Cargando cotizaciones…</p> : quotes.length ? <div className="quotes-list">{quotes.map((quote) => <article className="quote-admin-row" key={quote.id}><div className="quote-admin-main"><span className="eyebrow">{quote.quoteNumber}</span><strong>{quote.customerName}</strong><span>{quote.brand ? `${quote.brand} ${quote.model} · ${quote.year}` : "Sin vehículo"}</span><small>{quote.customerEmail || quote.customerPhone || "Sin contacto"} · Vigente {formatDate(quote.validUntil)}</small></div><div className="quote-admin-total"><strong>{formatPrice(quote.totalUsd)}</strong><span>Base {formatPrice(quote.basePriceUsd)}{Number(quote.discountUsd) ? ` · -${formatPrice(quote.discountUsd)}` : ""}</span></div><div className="quote-admin-actions"><select value={quote.status} onChange={(event) => onStatusChange(quote.id, event.target.value)} aria-label={`Estado de ${quote.quoteNumber}`}><option value="draft">Borrador</option><option value="sent">Enviada</option><option value="accepted">Aceptada</option><option value="expired">Vencida</option><option value="cancelled">Cancelada</option></select><button className="text-button" type="button" onClick={() => window.print()}>Imprimir</button></div></article>)}</div> : <p className="empty-state">Aún no hay cotizaciones guardadas.</p>}</section></div></section>;
}

function LeadsModule({ records, users, loading, onRefresh, onUpdate, onLoadHistory }) {
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const draftFor = (lead) => drafts[lead.id] || { status: lead.status, notes: lead.notes || "", assignedTo: lead.assignedToId || "", priority: lead.priority || 2, nextAction: lead.nextAction || "", nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt).toISOString().slice(0, 16) : "", lostReason: lead.lostReason || "" };
  const setDraft = (lead, field, value) => setDrafts((current) => ({ ...current, [lead.id]: { ...draftFor(lead), [field]: value } }));
  const visibleRecords = records.filter((lead) => { const haystack = `${lead.name} ${lead.email || ""} ${lead.phone || ""} ${lead.brand || ""} ${lead.model || ""}`.toLowerCase(); return (statusFilter === "all" || lead.status === statusFilter) && haystack.includes(query.toLowerCase()); });
  const exportLeads = () => { const csv = ["Nombre,Correo,Telefono,Estado,Origen,Vehiculo,Recibido", ...visibleRecords.map((lead) => [lead.name, lead.email, lead.phone, lead.status, lead.source, `${lead.brand || ""} ${lead.model || ""}`, formatDate(lead.createdAt)].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(","))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = `authentiq-leads-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); };
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>Leads.</h2></div><div className="panel-actions"><button className="secondary-action" onClick={exportLeads}>Exportar CSV</button><button className="secondary-action" onClick={onRefresh}>Actualizar</button></div></div><div className="lead-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, correo o vehículo…" aria-label="Buscar leads" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar leads por estado"><option value="all">Todos los estados</option><option value="new">Nuevos</option><option value="contacted">Contactados</option><option value="qualified">Calificados</option><option value="closed">Cerrados</option><option value="lost">Perdidos</option></select><span>{visibleRecords.length} de {records.length} leads</span></div>{loading ? <p className="empty-state">Cargando leads…</p> : visibleRecords.length ? <div className="leads-list">{visibleRecords.map((lead) => { const draft = draftFor(lead); return <article className="lead-row" key={lead.id}><div className="lead-main"><div className="lead-heading"><strong>{lead.name}</strong><span className={`status-pill ${draft.status}`}>{draft.status}</span><span className={`priority-mark p${draft.priority}`}>P{draft.priority}</span></div><span>{lead.email || "Sin correo"} · {lead.phone || "Sin teléfono"}</span><span>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"} · {lead.source || "directo"}</span><LeadContactActions lead={lead} onLoadHistory={onLoadHistory} />{lead.nextAction && <p className="lead-next-action">Próxima acción: {lead.nextAction}{lead.nextActionAt ? ` · ${formatDate(lead.nextActionAt)}` : ""}</p>}{lead.message && <p>{lead.message}</p>}</div><div className="lead-management"><label>Estado<select value={draft.status} onChange={(event) => setDraft(lead, "status", event.target.value)}><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="lost">Perdido</option></select></label><label>Prioridad<select value={draft.priority} onChange={(event) => setDraft(lead, "priority", Number(event.target.value))}><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option></select></label><label>Asignar a<select value={draft.assignedTo} onChange={(event) => setDraft(lead, "assignedTo", event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></label><label>Próxima acción<input value={draft.nextAction} onChange={(event) => setDraft(lead, "nextAction", event.target.value)} placeholder="Llamar y confirmar presupuesto" /></label><label>Vencimiento<input type="datetime-local" value={draft.nextActionAt} onChange={(event) => setDraft(lead, "nextActionAt", event.target.value)} /></label>{draft.status === "lost" && <label>Motivo de pérdida<input value={draft.lostReason} onChange={(event) => setDraft(lead, "lostReason", event.target.value)} placeholder="Precio, sin respuesta, otro vehículo…" required /></label>}<label>Notas internas<textarea value={draft.notes} onChange={(event) => setDraft(lead, "notes", event.target.value)} placeholder="Seguimiento…" /></label><button className="primary-action" onClick={() => onUpdate(lead.id, draft)}>Guardar seguimiento</button><small>Recibido {formatDate(lead.createdAt)}</small></div></article>; })}</div> : <p className="empty-state">No hay leads que coincidan.</p>}</section>;
}

function BlogModule({ posts, form, editingId, loading, message, onChange, onSave, onEdit, onCancel, onArchive, onRefresh }) {
  return <div className="blog-content"><div className="blog-layout"><form className="admin-form" onSubmit={onSave}><div className="admin-form-head"><h2>{editingId ? "Editar artículo" : "Nuevo artículo"}</h2>{editingId && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}</div><label>Título<input value={form.title} onChange={(event) => onChange("title", event.target.value)} required /></label><label>Slug<input value={form.slug} onChange={(event) => onChange("slug", event.target.value)} placeholder="se-genera-del-titulo" /></label><div className="form-grid"><label>Categoría<input value={form.category || ""} onChange={(event) => onChange("category", event.target.value)} placeholder="Guías, cultura, compra" /></label><label>Etiquetas<input value={Array.isArray(form.tags) ? form.tags.join(", ") : (form.tags || "")} onChange={(event) => onChange("tags", event.target.value)} placeholder="Porsche, eléctrico, consejos" /></label></div><label>Resumen<textarea value={form.summary} onChange={(event) => onChange("summary", event.target.value)} /></label><label>Contenido<textarea className="blog-content-input" value={form.content} onChange={(event) => onChange("content", event.target.value)} required /></label><label>Imagen de portada<input value={form.coverImageUrl} onChange={(event) => onChange("coverImageUrl", event.target.value)} placeholder="/assets/editorial.jpg" /></label><div className="form-grid"><label>SEO title<input value={form.seoTitle} onChange={(event) => onChange("seoTitle", event.target.value)} /></label><label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value)}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option></select></label></div><label>SEO description<textarea value={form.seoDescription} onChange={(event) => onChange("seoDescription", event.target.value)} /></label>{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">{editingId ? "Guardar artículo" : "Crear artículo"}</button></form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">CONTENIDO EDITORIAL</span><h3>Artículos ({posts.length})</h3></div><button className="text-button" onClick={onRefresh}>Actualizar</button></div>{loading ? <p className="empty-state">Cargando artículos…</p> : posts.length ? <div className="blog-list">{posts.map((post) => <article className="blog-admin-row" key={post.id}>{post.coverImageUrl && <img src={post.coverImageUrl} alt="" />}{!post.coverImageUrl && <div className="blog-admin-placeholder" />}<div><strong>{post.title}</strong><span>{post.status} · {post.slug}</span><div><button className="text-button" onClick={() => onEdit(post)}>Editar</button><button className="text-button danger-text" onClick={() => onArchive(post.id)}>Archivar</button></div></div></article>)}</div> : <p className="empty-state">Aún no hay artículos.</p>}</section></div></div>;
}

function AuditModule({ logs, loading, onRefresh }) {
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGURIDAD · ADMINISTRACIÓN</span><h2>Actividad.</h2></div><button className="secondary-action" onClick={onRefresh}>Actualizar</button></div>{loading ? <p className="empty-state">Cargando auditoría…</p> : logs.length ? <div className="audit-list">{logs.map((log) => <article className="audit-row" key={log.id}><span className="audit-time">{formatDate(log.createdAt)}</span><div><strong>{log.action}</strong><span>{log.entityType} · {log.actorName || log.actorEmail || "Sistema"}</span></div><code>{JSON.stringify(log.metadata || {})}</code></article>)}</div> : <p className="empty-state">Aún no hay acciones registradas.</p>}</section>;
}

function PasswordResetResult({ result, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(result.temporaryPassword); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } };
  return <div className="password-reset-result"><span className="eyebrow">CONTRASEÑA TEMPORAL · {result.name}</span><code>{result.temporaryPassword}</code><p>Entrégala en persona o por un canal seguro. No se guarda ni se muestra de nuevo: {result.email} deberá cambiarla en su próximo ingreso.</p><div><button className="secondary-action" type="button" onClick={copy}>{copied ? "Copiada ✓" : "Copiar"}</button><button className="text-button" type="button" onClick={onDismiss}>Cerrar</button></div></div>;
}

function UsersModule({ users, form, onChange, onSave, onUpdate, onResetPassword, loading, message }) {
  const [resetResult, setResetResult] = useState(null);
  const [resettingId, setResettingId] = useState("");
  const requestReset = async (user) => {
    if (!window.confirm(`¿Generar una contraseña temporal para ${user.name}? Su contraseña actual dejará de funcionar.`)) return;
    setResettingId(user.id);
    try { setResetResult(await onResetPassword(user.id)); } finally { setResettingId(""); }
  };
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">ACCESOS · EQUIPO</span><h2>Usuarios.</h2></div></div>{resetResult && <PasswordResetResult result={resetResult} onDismiss={() => setResetResult(null)} />}<div className="admin-layout users-layout"><form className="admin-form" onSubmit={onSave}><div className="admin-form-head"><h2>Nuevo usuario</h2></div><label>Nombre<input value={form.name} onChange={(event) => onChange("name", event.target.value)} required /></label><label>Correo<input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} required /></label><label>Contraseña inicial<input type="password" minLength="8" value={form.password} onChange={(event) => onChange("password", event.target.value)} required /></label><label>Rol<select value={form.role} onChange={(event) => onChange("role", event.target.value)}><option value="seller">Ventas</option><option value="editor">Editor</option><option value="content_editor">Contenido</option><option value="admin">Administrador</option></select></label>{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">Crear usuario</button></form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">USUARIOS REGISTRADOS</span><h3>{users.length} cuentas</h3></div></div>{loading ? <p className="empty-state">Cargando usuarios…</p> : <div className="user-list">{users.map((user) => <article className={`user-row ${user.isActive ? "" : "is-inactive"}`} key={user.id}><div><strong>{user.name}</strong><span>{user.email} · {user.role}</span></div><div><select value={user.role} onChange={(event) => onUpdate(user, { role: event.target.value, isActive: user.isActive })}><option value="seller">Ventas</option><option value="editor">Editor</option><option value="content_editor">Contenido</option><option value="admin">Administrador</option></select><button className="text-button" type="button" onClick={() => requestReset(user)} disabled={resettingId === user.id}>{resettingId === user.id ? "Generando…" : "Restablecer contraseña"}</button><button className="text-button" onClick={() => onUpdate(user, { role: user.role, isActive: !user.isActive })}>{user.isActive ? "Desactivar" : "Activar"}</button></div></article>)}</div>}</section></div></section>;
}

function SettingsModule({ form, onChange, onSave, loading, message }) {
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">MARCA · OPERACIÓN</span><h2>Configuración.</h2></div></div><form className="settings-form admin-form" onSubmit={onSave}>{loading ? <p className="empty-state">Cargando configuración…</p> : <><div className="settings-section"><span className="eyebrow">IDENTIDAD</span><div className="form-grid"><label>Nombre comercial<input value={form.businessName} onChange={(event) => onChange("businessName", event.target.value)} required /></label><label>Logo URL<input value={form.logoUrl || ""} onChange={(event) => onChange("logoUrl", event.target.value)} placeholder="/assets/logo.svg" /></label></div></div><div className="settings-section"><span className="eyebrow">CONTACTO</span><div className="form-grid"><label>Teléfono<input value={form.phone || ""} onChange={(event) => onChange("phone", event.target.value)} /></label><label>WhatsApp<input value={form.whatsapp || ""} onChange={(event) => onChange("whatsapp", event.target.value)} /></label><label>Correo<input type="email" value={form.email || ""} onChange={(event) => onChange("email", event.target.value)} /></label><label>Moneda<input value={form.currency || "USD"} onChange={(event) => onChange("currency", event.target.value)} maxLength="8" /></label></div><label>Dirección<input value={form.address || ""} onChange={(event) => onChange("address", event.target.value)} /></label><label>Horario<input value={form.hours || ""} onChange={(event) => onChange("hours", event.target.value)} placeholder="Lun–Sáb · 9:00–18:00" /></label></div><div className="settings-section"><span className="eyebrow">CANALES</span><div className="form-grid"><label>Instagram<input value={form.instagramUrl || ""} onChange={(event) => onChange("instagramUrl", event.target.value)} /></label><label>Facebook<input value={form.facebookUrl || ""} onChange={(event) => onChange("facebookUrl", event.target.value)} /></label></div></div>{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">Guardar configuración</button></>}</form></section>;
}



const leadStages = [
  ["new", "Nuevos", "Primer contacto"],
  ["contacted", "Contactados", "Conversacion abierta"],
  ["qualified", "Calificados", "Listos para avanzar"],
  ["closed", "Cerrados", "Operacion ganada"],
  ["lost", "Perdidos", "Revisar despues"],
];

function LeadPipeline({ records, onUpdate }) {
  return <div className="lead-pipeline">{leadStages.map(([stage, label, hint]) => { const stageRecords = records.filter((lead) => lead.status === stage); return <section className={`lead-pipeline-column ${stage}`} key={stage}><div className="lead-pipeline-heading"><div><span className="eyebrow">{label}</span><small>{hint}</small></div><strong>{String(stageRecords.length).padStart(2, "0")}</strong></div><div className="lead-pipeline-cards">{stageRecords.length ? stageRecords.map((lead) => <article className="lead-pipeline-card" key={lead.id}><div className="pipeline-card-top"><strong>{lead.name}</strong><span>{formatDate(lead.createdAt)}</span></div><small>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"}</small><span className="pipeline-source">{lead.source || "Directo"}</span><select aria-label={`Mover a etapa ${lead.name}`} value={lead.status} onChange={(event) => onUpdate(lead.id, { status: event.target.value })}><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="lost">Perdido</option></select></article>) : <p className="pipeline-empty">Sin registros</p>}</div></section>; })}</div>;
}

function LeadsControlRoom({ records, users, loading, onRefresh, onUpdate, onLoadHistory }) {
  const [viewMode, setViewMode] = useState("pipeline");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const visibleRecords = records.filter((lead) => { const haystack = `${lead.name} ${lead.email || ""} ${lead.phone || ""} ${lead.brand || ""} ${lead.model || ""}`.toLowerCase(); return (statusFilter === "all" || lead.status === statusFilter) && haystack.includes(query.toLowerCase()); });
  return <>
    <section className="records-content lead-control-room"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>{viewMode === "pipeline" ? "Pipeline." : "Leads."}</h2></div><div className="lead-view-switcher"><button className={viewMode === "pipeline" ? "active" : ""} type="button" onClick={() => setViewMode("pipeline")}>Pipeline</button><button className={viewMode === "list" ? "active" : ""} type="button" onClick={() => setViewMode("list")}>Lista detallada</button></div></div>{viewMode === "pipeline" && <><div className="lead-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, correo o vehiculo..." aria-label="Buscar leads en pipeline" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar leads en pipeline"><option value="all">Todas las etapas</option><option value="new">Nuevos</option><option value="contacted">Contactados</option><option value="qualified">Calificados</option><option value="closed">Cerrados</option><option value="lost">Perdidos</option></select><span>{visibleRecords.length} de {records.length} leads</span></div>{loading ? <p className="empty-state">Cargando leads...</p> : <LeadPipeline records={visibleRecords} onUpdate={onUpdate} />}</>}</section>
    {viewMode === "list" && <LeadsModule records={records} users={users} loading={loading} onRefresh={onRefresh} onUpdate={onUpdate} onLoadHistory={onLoadHistory} />}
  </>;
}


const emptyVehicle = { brand: "", brandLogoUrl: "", category: "sports", model: "", variant: "", year: new Date().getFullYear(), condition: "used", priceUsd: "", stockNumber: "", engine: "", power: "", transmission: "", drive: "", fuelType: "", exteriorColor: "", interiorColor: "", doors: "", seats: "", mileageKm: 0, location: "", warranty: "", features: "", description: "", stock: 1, status: "draft", maxDiscountPercent: 0, images: "", media3dUrl: "", procedural3dEnabled: false, videoUrl: "", videoPosterUrl: "", panorama360Url: "" };
const emptyBlog = { title: "", slug: "", summary: "", content: "", category: "", tags: "", coverImageUrl: "", status: "draft", seoTitle: "", seoDescription: "" };
emptyVehicle.seoTitle = "";
emptyVehicle.seoDescription = "";
emptyVehicle.imageAltTexts = "";
const emptyUser = { name: "", email: "", password: "", role: "seller" };
const emptySettings = { businessName: "AUTHENTIQ", logoUrl: "", phone: "", whatsapp: "", email: "", address: "", hours: "", instagramUrl: "", facebookUrl: "", currency: "USD", privacyText: "", termsText: "" };

export default function Backoffice({ onBack, onVehiclesChanged }) {
  const [token, setToken] = useState(() => localStorage.getItem("authentiq_admin_token") || "");
  const [login, setLogin] = useState({ email: "admin@authentiq.local", password: "" });
  const [loginError, setLoginError] = useState("");
  const [activeModule, setActiveModule] = useState("dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [offers, setOffers] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [managedUsers, setManagedUsers] = useState([]);
  const [userForm, setUserForm] = useState(emptyUser);
  const [settings, setSettings] = useState(emptySettings);
  const [posts, setPosts] = useState([]);
  const [blogForm, setBlogForm] = useState(emptyBlog);
  const [editingPostId, setEditingPostId] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_admin_user") || "null"); } catch { return null; } });
  const [auditLogs, setAuditLogs] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [form, setForm] = useState(emptyVehicle);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("authentiq_theme") || "light");
  useEffect(() => { if (!message) return undefined; const timer = window.setTimeout(() => setMessage(""), 3200); return () => window.clearTimeout(timer); }, [message]);

  const request = async (path, options = {}) => { const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } }); const payload = response.status === 204 ? null : await response.json(); if (response.status === 401) { localStorage.removeItem("authentiq_admin_token"); setToken(""); throw new Error("La sesión expiró. Inicia sesión nuevamente."); } if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse"); return payload; };
  const loadVehicles = async () => { setLoading(true); try { setVehicles((await request("/api/admin/vehicles")).data || []); } catch (error) { setMessage(error.message); } finally { setLoading(false); } };
  const loadDashboard = async () => { setModuleLoading(true); try { setDashboard((await request("/api/admin/dashboard")).data); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadOffers = async () => { setModuleLoading(true); try { setOffers((await request("/api/admin/offers")).data || []); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadQuotes = async () => { setModuleLoading(true); try { setQuotes((await request("/api/admin/quotes")).data || []); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadAnalytics = async () => { try { setAnalytics((await request("/api/admin/analytics?days=30")).data || []); } catch (error) { setMessage(error.message); } };
  const loadLeads = async () => { setModuleLoading(true); try { setLeads((await request("/api/admin/leads")).data || []); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadLeadHistory = async (id) => { try { return (await request(`/api/admin/leads/${id}/events`)).data || []; } catch (error) { setMessage(error.message); return []; } };
  const loadUsers = async () => { try { setUsers((await request("/api/admin/users")).data || []); } catch (error) { setMessage(error.message); } };
  const loadManagedUsers = async () => { setModuleLoading(true); try { setManagedUsers((await request("/api/admin/users/manage")).data || []); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadSettings = async () => { setModuleLoading(true); try { setSettings((await request("/api/admin/settings")).data || emptySettings); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadBlog = async () => { setModuleLoading(true); try { setPosts((await request("/api/admin/blog")).data || []); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadAudit = async () => { setModuleLoading(true); try { setAuditLogs((await request("/api/admin/audit-logs")).data || []); } catch (error) { setMessage(error.message); } finally { setModuleLoading(false); } };
  const loadNotifications = async () => { try { const payload = await request("/api/admin/notifications"); setNotifications(payload.data || []); setUnreadNotifications(payload.unread || 0); } catch (error) { setMessage(error.message); } };
  const markNotificationsRead = async () => { try { await request("/api/admin/notifications/read", { method: "PATCH" }); setNotifications((current) => current.map((item) => ({ ...item, readAt: new Date().toISOString() }))); setUnreadNotifications(0); } catch (error) { setMessage(error.message); } };
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("authentiq_theme", theme); }, [theme]);
  useEffect(() => { if (!token) return; const role = currentUser?.role; loadDashboard(); loadNotifications(); if (["admin", "editor", "seller"].includes(role)) { loadVehicles(); loadOffers(); loadQuotes(); loadAnalytics(); loadLeads(); loadUsers(); } if (["admin", "editor", "content_editor"].includes(role)) loadBlog(); if (role === "admin") { loadAudit(); loadManagedUsers(); loadSettings(); } }, [token, currentUser?.role]);
  const handleLogin = async (event) => { event.preventDefault(); setLoginError(""); try { const response = await fetch(`${apiUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(login) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión"); localStorage.setItem("authentiq_admin_token", payload.token); localStorage.setItem("authentiq_admin_user", JSON.stringify(payload.user)); setCurrentUser(payload.user); setToken(payload.token); } catch (error) { setLoginError(error.message); } };
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const edit = (vehicle) => { const media = vehicle.media || []; setEditingId(vehicle.id); setForm({ ...vehicle, features: (vehicle.features || []).join(", "), images: (vehicle.images || []).map((image) => image.url).join(", "), imageAltTexts: (vehicle.images || []).map((image) => image.altText || "").join("\n"), media3dUrl: media.find((item) => item.type === "model_3d")?.url || "", videoUrl: media.find((item) => item.type === "video")?.url || "", videoPosterUrl: media.find((item) => item.type === "video")?.posterUrl || "", panorama360Url: media.find((item) => item.type === "panorama_360")?.url || "" }); setActiveModule("inventory"); };
  const save = async (event) => { event.preventDefault(); setMessage(""); const images = String(form.images || "").split(",").map((image) => image.trim()).filter(Boolean); const isPublishing = ["pending_review", "published"].includes(form.status); if (isPublishing && (!images.length || String(form.description || "").trim().length < 40)) { setMessage("Para publicar agrega al menos una foto y una descripción de 40 caracteres."); return; } const model3dUrl = String(form.media3dUrl || "").trim(); const videoUrl = String(form.videoUrl || "").trim(); const media = [{ type: "model_3d", url: model3dUrl }, { type: "video", url: videoUrl, posterUrl: String(form.videoPosterUrl || "").trim() || images[0] || "" }, { type: "panorama_360", url: form.panorama360Url }].filter((item) => String(item.url || "").trim()); const autoSeoTitle = String(form.seoTitle || "").trim() || `${form.brand} ${form.model} ${form.year} | AUTHENTIQ`; const autoSeoDescription = String(form.seoDescription || "").trim() || String(form.description || "").trim().slice(0, 160); /* Posicional: sin filter(Boolean), que desplazaba los alt a la imagen equivocada. */ const altLines = String(form.imageAltTexts || "").split(/\r?\n/).map((item) => item.trim()); const imageAltTexts = images.map((_, index) => altLines[index] || `${form.brand} ${form.model} ${form.year} · vista ${index + 1}`); const body = { ...form, seoTitle: autoSeoTitle, seoDescription: autoSeoDescription, media3dUrl: model3dUrl, year: Number(form.year), priceUsd: Number(form.priceUsd), doors: form.doors === "" ? null : Number(form.doors), seats: form.seats === "" ? null : Number(form.seats), mileageKm: Number(form.mileageKm), stock: Number(form.stock), maxDiscountPercent: Number(form.maxDiscountPercent), features: String(form.features || "").split(",").map((item) => item.trim()).filter(Boolean), images, imageAltTexts, media }; try { const payload = await request(editingId ? `/api/admin/vehicles/${editingId}` : "/api/admin/vehicles", { method: editingId ? "PUT" : "POST", body: JSON.stringify(body) }); onVehiclesChanged?.(payload?.data); setForm(emptyVehicle); setEditingId(null); setMessage("Vehículo guardado correctamente"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(error.message); } };
  const uploadImage = async (file) => { const body = new FormData(); body.append("file", file); const response = await fetch(`${apiUrl}/api/admin/media-upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo subir el archivo"); return payload.data.url; };
  const uploadMediaPackage = async (files) => { const body = new FormData(); files.forEach((file) => body.append("files", file, file.webkitRelativePath || file.name)); const response = await fetch(`${apiUrl}/api/admin/media-package-upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body }); const payload = await response.json(); if (!response.ok) { const missing = payload.missingCount ? ` Faltan ${payload.missingCount} dependencias.` : ""; throw new Error(`${payload.error || "No se pudo subir la carpeta 3D"}${missing}`); } return payload.data.url; };
  const deactivate = async (id) => { if (!window.confirm("¿Desactivar este vehículo?")) return; try { await request(`/api/admin/vehicles/${id}`, { method: "DELETE" }); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(error.message); } };
  const duplicateVehicle = async (id) => { try { await request(`/api/admin/vehicles/${id}/duplicate`, { method: "POST" }); setMessage("Vehículo duplicado como borrador"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(error.message); } };
  const changeVehicleStatus = async (id, status) => { if (["sold","inactive"].includes(status) && !window.confirm(`¿Marcar este vehículo como ${status==="sold"?"vendido":"inactivo"}?`)) return; try { await request(`/api/admin/vehicles/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Estado actualizado"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(error.message); } };
  const reviewVehicle = async (id, decision) => { try { await request("/api/admin/vehicles/" + id + "/review", { method: "PATCH", body: JSON.stringify({ decision }) }); setMessage(decision === "approve" ? "Vehículo aprobado y publicado" : "Vehículo devuelto a borrador"); await Promise.all([loadVehicles(), loadDashboard(), loadNotifications()]); } catch (error) { setMessage(error.message); } };
  const previewVehicle = () => { const media = [{ type: "model_3d", url: form.media3dUrl }, { type: "video", url: form.videoUrl, posterUrl: form.videoPosterUrl }, { type: "panorama_360", url: form.panorama360Url }].filter((item) => String(item.url || "").trim()); const preview = { ...form, id: "preview", priceUsd: Number(form.priceUsd || 0), mileageKm: Number(form.mileageKm || 0), media, images: String(form.images || "").split(",").map((url) => url.trim()).filter(Boolean).map((url, index) => ({ id: `preview-${index}`, url, sortOrder: index })) }; sessionStorage.setItem("authentiq_vehicle_preview", JSON.stringify(preview)); window.open("/preview", "_blank", "noopener,noreferrer"); };
  const updateStatus = async (kind, id, status) => { if (["cancelled", "rejected"].includes(status) && !window.confirm(`¿Confirmas marcar este registro como ${status === "cancelled" ? "cancelado" : "rechazado"}?`)) return; try { await request(`/api/admin/${kind}/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Estado actualizado correctamente"); await Promise.all([loadOffers(), loadDashboard()]); } catch (error) { setMessage(error.message); } };
  const updateLead = async (id, values) => { try { await request(`/api/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify(values) }); await Promise.all([loadLeads(), loadDashboard()]); } catch (error) { setMessage(error.message); } };
  const createQuote = async (values) => { try { await request("/api/admin/quotes", { method: "POST", body: JSON.stringify({ ...values, basePriceUsd: Number(values.basePriceUsd), discountUsd: Number(values.discountUsd || 0) }) }); setMessage("Cotización guardada correctamente"); await loadQuotes(); } catch (error) { setMessage(error.message); throw error; } };
  const updateQuoteStatus = async (id, status) => { try { await request(`/api/admin/quotes/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Estado de cotización actualizado"); await loadQuotes(); } catch (error) { setMessage(error.message); } };
  const changeUser = (field, value) => setUserForm((current) => ({ ...current, [field]: value }));
  const saveUser = async (event) => { event.preventDefault(); setMessage(""); try { await request("/api/admin/users", { method: "POST", body: JSON.stringify(userForm) }); setUserForm(emptyUser); setMessage("Usuario creado correctamente"); await Promise.all([loadManagedUsers(), loadUsers()]); } catch (error) { setMessage(error.message); } };
  const updateUser = async (user, values) => { try { await request(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ name: user.name, ...values }) }); await Promise.all([loadManagedUsers(), loadUsers()]); } catch (error) { setMessage(error.message); } };
  const resetUserPassword = async (id) => { try { return (await request(`/api/admin/users/${id}/reset-password`, { method: "POST" })).data; } catch (error) { setMessage(error.message); return null; } };
  const changeSettings = (field, value) => setSettings((current) => ({ ...current, [field]: value }));
  const saveSettings = async (event) => { event.preventDefault(); setMessage(""); try { const payload = await request("/api/admin/settings", { method: "PATCH", body: JSON.stringify(settings) }); setSettings(payload.data); setMessage("Configuración guardada correctamente"); } catch (error) { setMessage(error.message); } };
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  const changeBlog = (field, value) => setBlogForm((current) => ({ ...current, [field]: value }));
  const editBlog = (post) => { setEditingPostId(post.id); setBlogForm({ ...emptyBlog, ...post }); setActiveModule("blog"); };
  const saveBlog = async (event) => { event.preventDefault(); setMessage(""); try { await request(editingPostId ? `/api/admin/blog/${editingPostId}` : "/api/admin/blog", { method: editingPostId ? "PUT" : "POST", body: JSON.stringify(blogForm) }); setBlogForm(emptyBlog); setEditingPostId(null); setMessage("Artículo guardado correctamente"); await loadBlog(); } catch (error) { setMessage(error.message); } };
  const archiveBlog = async (id) => { if (!window.confirm("¿Archivar este artículo?")) return; try { await request(`/api/admin/blog/${id}`, { method: "DELETE" }); await loadBlog(); } catch (error) { setMessage(error.message); } };
  const logout = () => { localStorage.removeItem("authentiq_admin_token"); localStorage.removeItem("authentiq_admin_user"); setCurrentUser(null); setToken(""); };
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const submitPasswordChange = async (event) => {
    event.preventDefault();
    setPasswordChangeError("");
    const newPassword = String(new FormData(event.target).get("newPassword") || "");
    if (newPassword.length < 8) { setPasswordChangeError("La contraseña debe tener al menos 8 caracteres"); return; }
    setPasswordChangeLoading(true);
    try {
      const payload = await request("/api/auth/change-password", { method: "POST", body: JSON.stringify({ newPassword }) });
      localStorage.setItem("authentiq_admin_token", payload.token);
      localStorage.setItem("authentiq_admin_user", JSON.stringify(payload.user));
      setCurrentUser(payload.user);
      setToken(payload.token);
    } catch (error) { setPasswordChangeError(error.message); } finally { setPasswordChangeLoading(false); }
  };

  if (!token) return <main className="admin-page admin-login-page"><button className="back-button" onClick={onBack}>← Volver al catálogo</button><form className="admin-login" onSubmit={handleLogin}><span className="eyebrow">AUTHENTIQ · BACKOFFICE</span><h1>Acceso <em>administrativo.</em></h1><label>Correo<input type="email" value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} required /></label><label>Contraseña<input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} required /></label>{loginError && <p className="state-message error">{loginError}</p>}<button className="primary-action" type="submit">Entrar al backoffice</button></form></main>;

  // Una contraseña restablecida por un administrador solo sirve para llegar hasta aquí:
  // el backend también bloquea cualquier otra ruta mientras esta bandera siga activa.
  if (currentUser?.mustChangePassword) return <main className="admin-page admin-login-page"><form className="admin-login" onSubmit={submitPasswordChange}><span className="eyebrow">AUTHENTIQ · BACKOFFICE</span><h1>Define tu <em>nueva contraseña.</em></h1><p className="account-welcome">Tu contraseña fue restablecida por un administrador. Elige una nueva antes de continuar.</p><label>Nueva contraseña<input type="password" name="newPassword" minLength="8" autoComplete="new-password" required /></label>{passwordChangeError && <p className="state-message error">{passwordChangeError}</p>}<button className="primary-action" type="submit" disabled={passwordChangeLoading}>{passwordChangeLoading ? "Guardando…" : "Guardar y continuar"}</button><button className="text-button" type="button" onClick={logout}>Cerrar sesión</button></form></main>;

  const activeView = activeModule === "dashboard" ? <DashboardView data={dashboard} leads={leads} offers={offers} loading={moduleLoading} onNavigate={setActiveModule} /> : activeModule === "inventory" ? <InventoryModule vehicles={vehicles} form={form} editingId={editingId} loading={loading} message={message} onChange={change} onSave={save} onEdit={edit} onCancel={() => { setEditingId(null); setForm(emptyVehicle); }} onDeactivate={deactivate} onDuplicate={duplicateVehicle} onRefresh={loadVehicles} onUpload={uploadImage} onPackageUpload={uploadMediaPackage} onReview={reviewVehicle} onStatusChange={changeVehicleStatus} /> : activeModule === "leads" ? <LeadsControlRoom records={leads} users={users} loading={moduleLoading} onRefresh={loadLeads} onUpdate={updateLead} onLoadHistory={loadLeadHistory} /> : activeModule === "quotes" ? <QuotesModule quotes={quotes} leads={leads} vehicles={vehicles} loading={moduleLoading} onRefresh={loadQuotes} onCreate={createQuote} onStatusChange={updateQuoteStatus} /> : activeModule === "blog" ? <BlogModule posts={posts} form={blogForm} editingId={editingPostId} loading={moduleLoading} message={message} onChange={changeBlog} onSave={saveBlog} onEdit={editBlog} onCancel={() => { setEditingPostId(null); setBlogForm(emptyBlog); }} onArchive={archiveBlog} onRefresh={loadBlog} /> : activeModule === "offers" ? <RecordsModule kind="offers" records={offers} loading={moduleLoading} onRefresh={loadOffers} onStatusChange={(id, status) => updateStatus("offers", id, status)} /> : activeModule === "reports" ? <ReportsModule dashboard={dashboard} vehicles={vehicles} leads={leads} offers={offers} loading={moduleLoading} analytics={analytics} /> : activeModule === "audit" ? <AuditModule logs={auditLogs} loading={moduleLoading} onRefresh={loadAudit} /> : activeModule === "users" ? <UsersModule users={managedUsers} form={userForm} onChange={changeUser} onSave={saveUser} onUpdate={updateUser} onResetPassword={resetUserPassword} loading={moduleLoading} message={message} /> : <SettingsModule form={settings} onChange={changeSettings} onSave={saveSettings} loading={moduleLoading} message={message} />;
  return <main className="admin-page"><AdminNav activeModule={activeModule} onChange={setActiveModule} onBack={onBack} onLogout={logout} role={currentUser?.role} unreadNotifications={unreadNotifications} notifications={notifications} onReadNotifications={markNotificationsRead} onPreview={previewVehicle} theme={theme} onToggleTheme={toggleTheme} vehicles={vehicles} /><AnimatePresence mode="wait" initial={false}><motion.div key={activeModule} className="admin-module-transition" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2, ease: "easeOut" }}>{activeView}</motion.div></AnimatePresence><AnimatePresence><AdminToast message={message} /></AnimatePresence></main>;
}
