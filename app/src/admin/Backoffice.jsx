import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import imageCompression from "browser-image-compression";
import { Command } from "cmdk";
import { getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { queryClient } from "./queryClient.js";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch as fetch, apiUrl } from "./apiClient.js";
import DealerRegistrationWizard from "./DealerRegistrationWizard.jsx";
import WorkCenter from "./WorkCenter.jsx";
import ContactsModule from "./ContactsModule.jsx";
import PhoneField from "./PhoneField.jsx";
import { formatDate, formatDateTime, formatLeadSource, formatPlatform, formatPrice, formatPriority, formatRole, formatStatus, publicVehiclePath } from "./format.js";
import { contrastSafeShade, contrastSafeTint, lighten, readableInkOn } from "../utils/color.js";
import { normalizePhone } from "../utils/phone.js";
import { getStoredValue, removeStoredValue, setStoredValue } from "../utils/storage.js";
import { SlidingNumber } from "../components/animate-ui/primitives/texts/sliding-number.jsx";
import { AnimatedList } from "../ui/MotionPrimitives.jsx";
import VirtualizedList from "../ui/VirtualizedList.jsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.jsx";
import "../components/ui/alert-dialog.css";
import { mensajeDeError } from "../utils/errors.js";
import {
  ArticleIcon,
  ArrowUpRightIcon,
  BellIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretUpIcon,
  CarSimpleIcon,
  ChartLineUpIcon,
  EyeIcon,
  FileTextIcon,
  HandCoinsIcon,
  HouseIcon,
  ListChecksIcon,
  MoonIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  PlugsConnectedIcon,
  SquaresFourIcon,
  SunIcon,
  TagIcon,
  UploadSimpleIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

function normalizedHostname(value) {
  return String(value || "")
    .trim()
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function publicShowroomUrl(organization, { preview = false } = {}) {
  const origin = window.location.origin.replace(/\/$/, "");
  if (preview) return `${origin}/?preview=1`;

  const slug = String(organization?.slug || "zevroa").trim().toLowerCase();
  const currentHost = normalizedHostname(window.location.hostname);
  const configuredPlatformDomain = normalizedHostname(import.meta.env.VITE_PLATFORM_BASE_DOMAIN);
  const platformDomain = configuredPlatformDomain || (currentHost.split(".").length === 2 ? currentHost : "");
  const platformRootLabel = platformDomain.split(".")[0];
  const customDomain = normalizedHostname(organization?.customDomain);
  const customDomainReady = Boolean(customDomain && currentHost === customDomain);
  const subdomain = normalizedHostname(organization?.subdomain);

  if (customDomainReady) return `https://${customDomain}`;
  // Compatibilidad defensiva con datos antiguos que devolvían un subdominio
  // duplicado para el showroom raíz.
  if (platformDomain && slug === platformRootLabel) return `https://${platformDomain}`;
  if (slug === currentHost.split(".")[0] && subdomain === `${currentHost.split(".")[0]}.${currentHost}`) return `https://${currentHost}`;
  if (subdomain) return `https://${subdomain}`;
  return `${origin}/?dealer=${encodeURIComponent(slug)}`;
}

// Estas piezas arrastran dependencias grandes o solo se usan en módulos
// secundarios. Mantenerlas lazy evita pagar su coste al abrir Inicio.
const PlatformCenter = lazy(() => import("./PlatformCenter.jsx"));
const SocialFlyerStudio = lazy(() => import("./GraphicsStudio.jsx").then((module) => ({ default: module.SocialFlyerStudio })));
const WindowStickerModal = lazy(() => import("./GraphicsStudio.jsx").then((module) => ({ default: module.WindowStickerModal })));
const ReportsCharts = lazy(() => import("./ReportsCharts.jsx"));

// `activo` permite usarlo en diálogos que viven montados y solo se muestran al
// abrirse. Sin él, el foco quedaría atrapado en un diálogo invisible.
function useAdminDialog(onClose, activo = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!activo) return undefined;
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...dialog.querySelectorAll(selector)];
    const firstField = dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || dialog.querySelector(selector);
    window.requestAnimationFrame(() => firstField?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== "Tab") return;
      const current = focusables(); if (!current.length) return;
      if (event.shiftKey && document.activeElement === current[0]) { event.preventDefault(); current[current.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === current[current.length - 1]) { event.preventDefault(); current[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus?.(); };
  }, [activo]);
}

const Vehicle3dActionsContext = createContext({});
function localIsoDate(value = new Date()) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }


async function inspect3dFile(file) {
  if (!file) return null;
  const sizeBytes = Number(file.size || 0);
  const extension = String(file.name || "").toLowerCase().split(".").pop();
  const sizeLabel = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  if (extension !== "glb" && extension !== "gltf") return { sizeBytes, sizeLabel, animationCount: null, animationNames: [], status: "unknown" };
  try {
    let json = null;
    if (extension === "gltf") {
      json = JSON.parse(await file.slice(0, Math.min(sizeBytes, 8 * 1024 * 1024)).text());
    } else {
      const buffer = await file.slice(0, Math.min(sizeBytes, 8 * 1024 * 1024)).arrayBuffer();
      if (buffer.byteLength < 20) throw new Error("GLB incompleto");
      const view = new DataView(buffer);
      if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Cabecera GLB inválida");
      const jsonLength = view.getUint32(12, true);
      const jsonType = view.getUint32(16, true);
      if (jsonType !== 0x4e4f534a || 20 + jsonLength > buffer.byteLength) throw new Error("JSON GLB fuera del límite de lectura");
      const bytes = new Uint8Array(buffer, 20, jsonLength);
      json = JSON.parse(new TextDecoder().decode(bytes).replace(/\0+$/g, "").trim());
    }
    const animations = Array.isArray(json?.animations) ? json.animations : [];
    return { sizeBytes, sizeLabel, animationCount: animations.length, animationNames: animations.map((item, index) => item?.name || `Animación ${index + 1}`), status: "ready" };
  } catch {
    return { sizeBytes, sizeLabel, animationCount: null, animationNames: [], status: "partial" };
  }
}

const AdminDialogsContext = createContext(null);

function AdminActionDialog({ request, onResolve }) {
  const [value, setValue] = useState(request.defaultValue || "");
  const [busy, setBusy] = useState(false);
  const dialogRef = useAdminDialog(() => onResolve(null));
  const isPrompt = request.kind === "prompt";
  const submit = async (event) => {
    event?.preventDefault?.();
    if (isPrompt && request.required && !value.trim()) return;
    setBusy(true);
    await Promise.resolve(onResolve(isPrompt ? value : true));
  };
  if (!isPrompt) return <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onResolve(null); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <span className="eyebrow">ZEVROA · CONFIRMACIÓN</span>
        <AlertDialogTitle>{request.title}</AlertDialogTitle>
        {request.message && <AlertDialogDescription>{request.message}</AlertDialogDescription>}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{request.cancelLabel || "Cancelar"}</AlertDialogCancel>
        <AlertDialogAction
          data-danger={request.danger ? "true" : undefined}
          disabled={busy}
          onClick={(event) => { event.preventDefault(); submit(event); }}
        >{busy ? "Guardando…" : (request.confirmLabel || "Confirmar")}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onResolve(null); }}>
    <form className="admin-action-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-action-dialog-title" ref={dialogRef} onSubmit={submit}>
      <span className="eyebrow">ZEVROA · CONFIRMACIÓN</span>
      <h2 id="admin-action-dialog-title">{request.title}</h2>
      {request.message && <p>{request.message}</p>}
      {isPrompt && <label>{request.label || "Valor"}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder || ""} required={request.required} /></label>}
      <div className="admin-action-dialog-actions">
        <button className="secondary-action" type="button" onClick={() => onResolve(null)} disabled={busy}>{request.cancelLabel || "Cancelar"}</button>
        <button className={`primary-action${request.danger ? " danger-action" : ""}`} type="submit" disabled={busy || (isPrompt && request.required && !value.trim())}>{busy ? "Guardando…" : (request.confirmLabel || "Confirmar")}</button>
      </div>
    </form>
  </div>;
}

export function AdminDialogsProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolve = useCallback((result) => {
    setRequest((current) => {
      current?.resolve?.(result);
      return null;
    });
  }, []);
  const ask = useCallback((options = {}) => new Promise((promiseResolve) => setRequest({ kind: "confirm", ...options, resolve: promiseResolve })), []);
  const askPrompt = useCallback((options = {}) => new Promise((promiseResolve) => setRequest({ kind: "prompt", ...options, resolve: promiseResolve })), []);
  const value = useMemo(() => ({ confirm: ask, prompt: askPrompt }), [ask, askPrompt]);
  return <AdminDialogsContext.Provider value={value}>{children}<AnimatePresence>{request && <AdminActionDialog key="admin-action-dialog" request={request} onResolve={resolve} />}</AnimatePresence></AdminDialogsContext.Provider>;
}

function useAdminConfirm() {
  const value = useContext(AdminDialogsContext);
  if (!value) throw new Error("useAdminConfirm debe usarse dentro de AdminDialogsProvider");
  return value;
}

function format3dReport(report) {
  if (!report) return null;
  if (report.animationCount === null) return `Archivo ${report.sizeLabel} · análisis visual pendiente`;
  return `${report.sizeLabel} · ${report.animationCount} ${report.animationCount === 1 ? "animación detectada" : "animaciones detectadas"}`;
}

function navItemsForRole(role) {
  const salesItem = ["quotes", "Cotizaciones"];
  if (role === "admin") return [["dashboard", "Inicio"], ["inventory", "Mi inventario"], ["taxonomy", "Marcas y categorías"], ["leads", "Clientes"], salesItem, ["blog", "Contenido"], ["offers", "Ofertas"], ["reports", "Estadísticas"], ["audit", "Actividad"], ["users", "Usuarios"], ["subscription", "Plan y facturación"], ["integrations", "Conexiones"], ["settings", "Perfil y ajustes"]];
  if (role === "editor") return [["dashboard", "Inicio"], ["inventory", "Mi inventario"], ["taxonomy", "Marcas y categorías"], ["leads", "Clientes"], salesItem, ["blog", "Contenido"], ["offers", "Ofertas"], ["reports", "Estadísticas"], ["settings", "Perfil y ajustes"]];
  if (role === "content_editor") return [["dashboard", "Inicio"], ["blog", "Contenido"]];
  return [["dashboard", "Inicio"], ["leads", "Clientes"], salesItem, ["offers", "Ofertas"], ["reports", "Estadísticas"]];
}

function navItemsWithAppointments(role) {
  return navItemsForRole(role).flatMap((item) => item[0] === "leads" ? [item, ["appointments", "Citas"]] : [item]);
}

const importHeaderAliases = { marca: "brand", brand: "brand", fabricante: "brand", modelo: "model", model: "model", version: "variant", variante: "variant", variant: "variant", año: "year", ano: "year", year: "year", precio: "priceUsd", "precio usd": "priceUsd", price: "priceUsd", priceusd: "priceUsd", categoria: "category", categoría: "category", category: "category", estado: "status", status: "status", condicion: "condition", condición: "condition", inventario: "stockNumber", "numero de inventario": "stockNumber", stocknumber: "stockNumber", motor: "engine", potencia: "power", transmision: "transmission", transmisión: "transmission", traccion: "drive", tracción: "drive", combustible: "fuelType", "color exterior": "exteriorColor", "color interior": "interiorColor", kilometraje: "mileageKm", "kilometraje km": "mileageKm", mileage: "mileageKm", ubicacion: "location", ubicación: "location", garantia: "warranty", garantía: "warranty", equipamiento: "features", features: "features", descripcion: "description", descripción: "description", stock: "stock", fotos: "images", imagenes: "images", imágenes: "images", images: "images" };
function normalizeImportRow(row) { return Object.entries(row).reduce((result, [key, value]) => { const normalized = String(key || "").trim().toLowerCase(); const field = importHeaderAliases[normalized] || normalized.replaceAll(" ", ""); if (field) result[field] = value; return result; }, {}); }

function InventoryImportModal({ open, onClose, vehicles = [] }) {
  useAdminDialog(onClose, open);
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
    let created = 0; const failures = [];
    for (const row of validRows) {
      const images = String(row.images || "").split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
      const body = { ...emptyVehicle, ...row, brandLogoUrl: getAdminBrandLogoUrl(row.brand), year: Number(row.year), priceUsd: Number(row.priceUsd), mileageKm: Number(row.mileageKm || 0), stock: Number(row.stock || 1), status: "draft", condition: row.condition || "used", features: String(row.features || "").split(",").map((item) => item.trim()).filter(Boolean), images, imageAltTexts: images.map(() => `${row.brand} ${row.model}`), media: [] };
      try { const response = await fetch(`${apiUrl}/api/admin/vehicles`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo crear"); created += 1; } catch (submitError) { failures.push(`${row.brand} ${row.model}: ${submitError.message}`); }
    }
    setBusy(false); setStatus(`${created} vehículo${created === 1 ? " creado" : "s creados"} como borrador.`); window.dispatchEvent(new CustomEvent("authentiq:inventory-refresh"));
    if (failures.length) setError(`No se importaron ${failures.length}: ${failures.slice(0, 2).join(" · ")}`);
    if (!failures.length) window.setTimeout(onClose, 900);
  };
  return <div className="wizard-backdrop import-backdrop"><section className="inventory-import-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-import-title"><div className="wizard-header"><div><span className="eyebrow">ALIMENTACIÓN MASIVA</span><h2 id="inventory-import-title">Importar inventario.</h2><p>Sube un Excel o CSV, revisa las filas y créalas como borradores.</p></div><button type="button" className="wizard-close" onClick={onClose} aria-label="Cerrar importación">×</button></div><div className="import-dropzone"><input type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={parseFile} disabled={busy} /><strong>{fileName || "Selecciona tu archivo de inventario"}</strong><span>Excel .xlsx, .xls o CSV · La primera fila debe contener los encabezados.</span></div>{rows.length > 0 && <><div className="import-summary"><span>{rows.length} filas leídas</span><strong>{validRows.length} listas</strong><span>{rows.length - validRows.length} con errores</span></div><div className="import-preview"><table><thead><tr><th>Fila</th><th>Marca</th><th>Modelo</th><th>Año</th><th>Precio</th><th>Validación</th></tr></thead><tbody>{rows.slice(0, 12).map((row, index) => <tr key={`${row.brand}-${row.model}-${index}`}><td>{index + 2}</td><td>{row.brand || "—"}</td><td>{row.model || "—"}</td><td>{row.year || "—"}</td><td>{row.priceUsd || "—"}</td><td className={rowError(row) ? "import-row-error" : "import-row-ready"}>{rowError(row) || "Lista"}</td></tr>)}</tbody></table>{rows.length > 12 && <small>Mostrando las primeras 12 filas.</small>}</div></>}{error && <p className="state-message error">{error}</p>}{status && <p className="form-message">{status}</p>}<div className="wizard-footer"><button className="secondary-action" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary-action" type="button" onClick={submit} disabled={busy || !validRows.length}>{busy ? "Importando…" : `Importar ${validRows.length || "vehículos"}`}</button></div></section></div>;
}

function TaxonomyModule({ taxonomy: externalTaxonomy, loading: externalLoading = false, onRefresh: externalRefresh, onCreate: externalCreate, onUpdate: externalUpdate }) {
  const { confirm, prompt } = useAdminConfirm();
  const [localTaxonomy, setLocalTaxonomy] = useState(externalTaxonomy || { brands: [], categories: [] });
  const [localLoading, setLocalLoading] = useState(false);
  const requestTaxonomy = async (path, options = {}) => { const response = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); const payload = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(payload?.error || "No se pudo actualizar el catálogo"); return payload; };
  const refreshTaxonomy = async () => { setLocalLoading(true); try { setLocalTaxonomy((await requestTaxonomy("/api/admin/taxonomy")).data || { brands: [], categories: [] }); } finally { setLocalLoading(false); } };
  const taxonomy = externalTaxonomy || localTaxonomy;
  const loading = externalLoading || localLoading;
  const onRefresh = externalRefresh || refreshTaxonomy;
  const onCreate = externalCreate || (async (kind, values) => { await requestTaxonomy(`/api/admin/taxonomy/${kind}`, { method: "POST", body: JSON.stringify(values) }); await refreshTaxonomy(); });
  const onUpdate = externalUpdate || (async (kind, record) => { const name = await prompt({ title: `Editar ${kind === "brands" ? "marca" : "categoría"}`, message: "Actualiza el nombre que verá el equipo al crear vehículos.", label: "Nombre", defaultValue: record.name, required: true, confirmLabel: "Continuar" }); if (name === null) return; const isActive = record.isActive ? await confirm({ title: "Mantener registro activo", message: "Si lo mantienes activo, seguirá apareciendo en el asistente de inventario.", confirmLabel: "Mantener activa" }) : true; if (isActive === null) return; const logoUrl = kind === "brands" ? await prompt({ title: "Logo de la marca", message: "Puedes dejarlo vacío si no quieres cambiarlo.", label: "Logo URL", defaultValue: record.logoUrl || "", placeholder: "https://.../logo.svg", confirmLabel: "Guardar marca" }) : ""; if (logoUrl === null) return; await requestTaxonomy(`/api/admin/taxonomy/${kind}/${record.id}`, { method: "PATCH", body: JSON.stringify({ name, logoUrl, isActive }) }); await refreshTaxonomy(); });
  useEffect(() => { if (!externalTaxonomy) refreshTaxonomy().catch(() => {}); }, []);
  const [kind, setKind] = useState("brands");
  const [form, setForm] = useState({ name: "", logoUrl: "" });
  const records = taxonomy?.[kind] || [];
  const submit = async (event) => { event.preventDefault(); if (!form.name.trim()) return; await onCreate(kind, form); setForm({ name: "", logoUrl: "" }); };
  return <section className="records-content taxonomy-content"><div className="panel-heading"><div><span className="eyebrow">CATÁLOGO CONTROLADO</span><h2>Marcas y categorías.</h2><p>Administra los nombres, logos y disponibilidad que verá el equipo al crear vehículos.</p></div><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar</button></div><div className="taxonomy-tabs"><button type="button" className={kind === "brands" ? "active" : ""} onClick={() => setKind("brands")}>Marcas ({taxonomy?.brands?.length || 0})</button><button type="button" className={kind === "categories" ? "active" : ""} onClick={() => setKind("categories")}>Categorías ({taxonomy?.categories?.length || 0})</button></div><div className="taxonomy-layout"><form className="admin-form taxonomy-form" onSubmit={submit}><div className="admin-form-head"><h3>{kind === "brands" ? "Nueva marca" : "Nueva categoría"}</h3></div><label>Nombre<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={kind === "brands" ? "Ej. Genesis" : "Ej. Pickup"} required maxLength="80" /></label>{kind === "brands" && <label>Logo URL<input value={form.logoUrl} onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="https://.../logo.svg" maxLength="2000" /></label>}<button className="primary-action" type="submit">Agregar {kind === "brands" ? "marca" : "categoría"}</button><small>Los registros nuevos quedan activos para el asistente de inventario.</small></form><section className="table-panel taxonomy-list"><div className="taxonomy-list-head"><span>Nombre</span><span>Vehículos</span><span>Estado</span><span>Acción</span></div>{loading ? <p className="empty-state">Cargando catálogo…</p> : records.length ? records.map((record) => <article className="taxonomy-row" key={record.id}><div className="taxonomy-name">{kind === "brands" && <AdminBrandLogo brand={record.name} logoUrl={record.logoUrl} size="picker" />}<div><strong>{record.name}</strong>{kind === "brands" && record.logoUrl && <small>Logo personalizado</small>}</div></div><span>{record.vehicleCount || 0}</span><span className={`status-pill ${record.isActive ? "published" : "inactive"}`}>{record.isActive ? "Activa" : "Inactiva"}</span><button type="button" className="text-button" onClick={() => onUpdate(kind, record)}>{record.isActive ? "Editar / desactivar" : "Activar"}</button></article>) : <p className="empty-state">Todavía no hay registros.</p>}</section></div></section>;
}

function AdminNav({ activeModule, onChange, onBack, onLogout, role, unreadNotifications, notifications, onReadNotifications, onPreview, onOpenPublic, onOpenOnboarding, theme, onToggleTheme, vehicles = [], businessName = "ZEVROA" }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // El trabajo diario debe ser la primera lectura. Las herramientas avanzadas
  // siguen disponibles, pero no deben ocupar el panel antes de necesitarlas.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const visibleItems = navItemsWithAppointments(role);
  // Cuatro accesos bastan para el trabajo diario. El resto sigue disponible
  // en Administración y mediante Ctrl/Cmd + K, sin desaparecer ni duplicarse.
  const primaryKeysByRole = {
    admin: ["dashboard", "inventory", "leads", "appointments", "quotes"],
    editor: ["dashboard", "inventory", "leads", "appointments", "quotes"],
    seller: ["dashboard", "leads", "quotes", "reports"],
    content_editor: ["dashboard", "blog"],
  };
  const primaryKeys = primaryKeysByRole[role] || primaryKeysByRole.seller;
  const primaryItems = primaryKeys.flatMap((key) => visibleItems.filter(([itemKey]) => itemKey === key));
  const advancedItems = visibleItems.filter(([key]) => !primaryKeys.includes(key));
  const moduleContext = { dashboard: ["Inicio", "Lo importante para decidir qué hacer hoy."], inventory: ["Mi inventario", "Publica y mantén tus vehículos al día."], taxonomy: ["Marcas y categorías", "Ordena los nombres del catálogo."], leads: ["Clientes", "Responde y define el próximo paso."], quotes: ["Cotizaciones", "Prepara propuestas y espera una decisión."], blog: ["Contenido", "Cuenta mejor la historia de cada vehículo."], offers: ["Ofertas", "Revisa y responde las propuestas."], reports: ["Estadísticas", "Mide qué está avanzando."], audit: ["Actividad", "Revisa los cambios del sistema."], users: ["Usuarios", "Define quién puede hacer cada cosa."], subscription: ["Plan y facturación", "Consulta tu plan; el piloto no requiere pago."], integrations: ["Conexiones", "Activa calendario, redes y correo cuando quieras."], settings: ["Perfil y ajustes", "Configura tu identidad, contacto y agenda."] }[activeModule] || ["Panel de control", `Operación ${businessName}`];
  useEffect(() => {
    if (advancedItems.some(([key]) => key === activeModule)) setAdvancedOpen(true);
  }, [activeModule, advancedItems.length]);
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !target?.matches?.("input, textarea, select")) { event.preventDefault(); setCommandOpen(true); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <>
      <header className="admin-header">
        {/* El nombre del módulo lo titula cada módulo con su propio contexto:
            repetirlo aquí duplicaba el encabezado y comía media pantalla en móvil. */}
        <div className="admin-title-row"><h1 className="admin-app-title">{businessName} <span>Panel de control</span></h1><span className="role-chip">{role === "admin" ? "DUEÑO" : role === "content_editor" ? "CONTENIDO" : role === "editor" ? "OPERACIÓN" : "VENTAS"}</span></div>
         <div className="admin-header-actions"><button className="secondary-action command-launch" type="button" onClick={() => setCommandOpen(true)}><MagnifyingGlassIcon size={16} aria-hidden="true" />Acciones <kbd>Ctrl K</kbd></button><div className="notification-wrap"><button className="notification-button" type="button" onClick={() => setShowNotifications((current) => !current)} aria-expanded={showNotifications} aria-label="Abrir notificaciones"><BellIcon size={16} weight="regular" aria-hidden="true" />Notificaciones {unreadNotifications > 0 && <span>{unreadNotifications}</span>}</button>{showNotifications && <div className="notification-popover"><div className="notification-popover-head"><strong>Actividad reciente</strong>{unreadNotifications > 0 && <button className="text-button" type="button" onClick={onReadNotifications}>Marcar leídas</button>}</div>{notifications?.length ? notifications.slice(0, 8).map((notification) => <article className={notification.readAt ? "notification-item" : "notification-item unread"} key={notification.id}><strong>{notification.title}</strong><span>{notification.body}</span><small>{formatDate(notification.createdAt)}</small></article>) : <p className="empty-state">No hay notificaciones nuevas.</p>}</div>}</div>{["admin", "editor"].includes(role) && <button className="secondary-action onboarding-launch-button" type="button" onClick={role === "editor" ? () => onChange("settings") : onOpenOnboarding}><PaintBrushIcon size={16} weight="regular" aria-hidden="true" />Personalizar showroom</button>}<button className="secondary-action theme-toggle" type="button" onClick={onToggleTheme} aria-label="Cambiar tema">{theme === "dark" ? <SunIcon size={16} weight="regular" aria-hidden="true" /> : <MoonIcon size={16} weight="regular" aria-hidden="true" />}{theme === "dark" ? "Modo claro" : "Modo oscuro"}</button><button className="secondary-action" type="button" onClick={onPreview}><EyeIcon size={16} weight="regular" aria-hidden="true" />Vista previa vehículo</button><button className="secondary-action" type="button" onClick={onOpenPublic}><ArrowUpRightIcon size={16} weight="regular" aria-hidden="true" />Mi showroom</button><button className="secondary-action" type="button" onClick={onBack}><HouseIcon size={16} weight="regular" aria-hidden="true" />Inicio ZEVROA</button><button className="secondary-action" type="button" onClick={onLogout}>Cerrar sesión</button></div>
      </header>
      <div className="admin-presentation-launch"><span>¿Quieres enseñar el showroom sin herramientas de administración?</span><button className="secondary-action" type="button" onClick={() => window.open("/presentacion", "_blank", "noopener,noreferrer")}>Abrir vista de presentación →</button></div>
      <aside className="admin-navigation-shell">
        <div className="admin-navigation-brand"><span className="admin-navigation-kicker">Tu operación</span><strong>{businessName}</strong><small>{role === "admin" ? "Control total del showroom" : "Espacio de trabajo"}</small></div>
        <nav className="admin-nav" aria-label="Módulos administrativos">
          <div className="admin-nav-core"><span className="admin-nav-label">Trabajo diario</span>{primaryItems.map(([key, label]) => <button type="button" key={key} className={activeModule === key ? "admin-nav-item active" : "admin-nav-item"} aria-current={activeModule === key ? "page" : undefined} onClick={() => onChange(key)}><AdminModuleIcon name={key} />{label}</button>)}</div>
          {advancedItems.length > 0 && <div className="admin-nav-advanced"><button className="admin-nav-more-toggle" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((current) => !current)}><span>Más herramientas</span>{advancedOpen ? <CaretUpIcon size={15} aria-hidden="true" /> : <CaretDownIcon size={15} aria-hidden="true" />}</button>{advancedOpen && <div className="admin-nav-more-panel">{advancedItems.map(([key, label]) => <button type="button" key={key} className={activeModule === key ? "admin-nav-item active" : "admin-nav-item"} aria-current={activeModule === key ? "page" : undefined} onClick={() => { setAdvancedOpen(true); onChange(key); }}><AdminModuleIcon name={key} />{label}</button>)}</div>}</div>}
        </nav>
        {role === "content_editor" && <div className="admin-role-hint" role="note"><span className="admin-navigation-kicker">Acceso actual</span><strong>Cuenta de contenido</strong><p>Solo puedes editar Contenido. Para trabajar con inventario, clientes, citas, cotizaciones, usuarios y facturación, entra con una cuenta Dueño u Operación.</p><button className="text-button" type="button" onClick={onLogout}>Cambiar de cuenta →</button></div>}
        <div className="admin-context-bar" aria-live="polite"><span><b>{moduleContext[0]}</b><small>{moduleContext[1]}</small></span></div>
        {activeModule === "inventory" && <button className="secondary-action inventory-import-trigger" type="button" onClick={() => setImportOpen(true)}><UploadSimpleIcon size={16} aria-hidden="true" />Importar inventario</button>}
        {activeModule === "inventory" && <InventoryImportModal open={importOpen} onClose={() => setImportOpen(false)} vehicles={vehicles} />}
      </aside>
      <BackofficeCommandCenter open={commandOpen} onOpenChange={setCommandOpen} role={role} onNavigate={onChange} onPreview={onPreview} onOpenPublic={onOpenPublic} onBack={onBack} onOpenOnboarding={onOpenOnboarding} />
    </>
  );
}

function StatCard({ label, value, numericValue, prefix = "", suffix = "", note, formatValue = null }) {
  const candidate = numericValue !== undefined ? numericValue : value;
  const isNumeric = Number.isFinite(Number(candidate)) && candidate !== "";
  return <article className="stat-card"><span>{label}</span><strong>{isNumeric ? formatValue ? formatValue(Number(candidate)) : <span className="stat-card-number"><span>{prefix}</span><SlidingNumber number={Number(candidate)} thousandSeparator="," /><span>{suffix}</span></span> : value}</strong><small>{note}</small></article>;
}

function AdminEmptyState({ eyebrow = "SIN ACTIVIDAD", title, text, actionLabel, onAction }) {
  return <div className="admin-empty-state"><span className="admin-empty-mark" aria-hidden="true">◌</span><div><span className="eyebrow">{eyebrow}</span><strong>{title}</strong><p>{text}</p></div>{actionLabel && onAction && <button className="secondary-action" type="button" onClick={onAction}>{actionLabel} →</button>}</div>;
}

function AdminToast({ message, action }) {
  if (!message) return null;
  // La salida es más rápida que la entrada (~75%): confirma sin demorar al usuario.
  return <motion.div className="admin-toast" role="status" aria-live="polite" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: .22, ease: [0.22, 1, 0.36, 1] } }} exit={{ opacity: 0, y: 8, transition: { duration: .15 } }}><span className="admin-toast-mark" aria-hidden="true">✓</span><span>{message}</span>{action && <button type="button" className="admin-toast-action" onClick={action.onClick}>{action.label}</button>}</motion.div>;
}

function AdminSavedStatus({ savedAt }) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!savedAt) return undefined;
    const timer = window.setInterval(() => refresh((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, [savedAt]);
  if (!savedAt) return <small className="admin-save-status">Listo para trabajar</small>;
  const elapsed = Math.max(0, Math.floor((Date.now() - savedAt.getTime()) / 60000));
  return <small className="admin-save-status" role="status" aria-live="polite">✓ Guardado {elapsed === 0 ? "ahora" : `hace ${elapsed} min`}</small>;
}

function DashboardSkeleton() {
  return <div className="dashboard-skeleton" aria-label="Cargando resumen"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton-block" key={item} />)}</div></div>;
}

function DashboardPulse({ data, leads, offers, appointments, onNavigate, onOpenLead, currentUser }) {
  const now = Date.now();
  const isOverdue = (lead) => lead.nextActionAt && new Date(lead.nextActionAt).getTime() < now;
  const openLeads = (leads || []).filter((lead) => ["new", "contacted", "qualified"].includes(lead.status));
  // Un vendedor no necesita el pulso del concesionario entero: necesita saber a
  // quién le toca llamar hoy. Solo ofrecemos el cambio si de verdad tiene cartera.
  const myLeads = openLeads.filter((lead) => currentUser?.id && String(lead.assignedToId || "") === String(currentUser.id));
  const canFilterMine = myLeads.length > 0;
  const [scope, setScope] = useState(currentUser?.role === "seller" ? "mine" : "all");
  const showingMine = canFilterMine && scope === "mine";
  const scopedLeads = showingMine ? myLeads : openLeads;
  const hasNoNextAction = (lead) => !lead.nextActionAt;
  const byUrgency = (a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || Number(hasNoNextAction(b)) - Number(hasNoNextAction(a)) || Number(a.priority || 2) - Number(b.priority || 2) || new Date(b.createdAt) - new Date(a.createdAt);
  const priorityLeads = [...scopedLeads].sort(byUrgency).slice(0, 4);
  const overdueCount = scopedLeads.filter(isOverdue).length;
  const unplannedCount = scopedLeads.filter(hasNoNextAction).length;
  const todayIso = localIsoDate();
  // El módulo de Citas carga el historial completo (pasado y futuro) para gestión;
  // este contador debe mostrar solo lo que realmente queda por atender.
  const upcomingAppointments = (appointments || []).filter((item) => ["pending", "confirmed"].includes(item.status) && String(item.date || "").slice(0, 10) >= todayIso);
  const actions = [
    ["leads", "Clientes abiertos", scopedLeads.length, overdueCount ? `${overdueCount} vencidos · abrir seguimiento` : "Responder y asignar"],
    ["appointments", "Citas próximas", upcomingAppointments.length, "Preparar visita"],
    ["offers", "Ofertas pendientes", (offers || []).filter((item) => item.status === "pending").length, "Revisar propuesta"],
    ["inventory", "En revisión", data?.summary?.pendingReview || 0, "Aprobar inventario"],
  ];
  return <section className="dashboard-pulse">
    <article className="priority-panel">
      <div className="panel-heading"><div><span className="eyebrow">{showingMine ? "MI DÍA" : "PRIORIDAD HOY"}</span><h3>{overdueCount > 0 ? `${overdueCount} seguimiento${overdueCount === 1 ? "" : "s"} vencido${overdueCount === 1 ? "" : "s"}.` : unplannedCount > 0 ? `${unplannedCount} cliente${unplannedCount === 1 ? "" : "s"} sin próxima acción.` : showingMine ? "Tus clientes al día." : "Lo que merece atención."}</h3></div><div className="priority-panel-actions">{canFilterMine && <div className="priority-scope" role="group" aria-label="Filtrar clientes"><button type="button" className={showingMine ? "is-active" : ""} aria-pressed={showingMine} onClick={() => setScope("mine")}>Míos {myLeads.length}</button><button type="button" className={showingMine ? "" : "is-active"} aria-pressed={!showingMine} onClick={() => setScope("all")}>Todos {openLeads.length}</button></div>}<button className="text-button" type="button" onClick={() => onNavigate("leads")}>Abrir clientes</button></div></div>
      {priorityLeads.length ? <div className="priority-list">{priorityLeads.map((lead, index) => <button className={`priority-item${isOverdue(lead) ? " is-overdue" : ""}`} type="button" key={lead.id} onClick={() => onOpenLead ? onOpenLead(lead) : onNavigate("leads")}><span className="priority-index">{String(index + 1).padStart(2, "0")}</span><span className="priority-copy"><strong>{lead.name}</strong><small>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"} · {isOverdue(lead) ? "Seguimiento vencido" : hasNoNextAction(lead) ? "Sin próxima acción" : formatDateTime(lead.nextActionAt)}</small></span><span className={`status-pill ${lead.status}`}>{formatStatus(lead.status)}</span><span className="priority-arrow">→</span></button>)}</div> : <p className="empty-state">No hay clientes pendientes de seguimiento.</p>}
    </article>
    <div className="quick-action-grid">{actions.map(([key, label, count, hint], index) => <button className="quick-action" type="button" key={key} onClick={() => onNavigate(key)}><span className="quick-action-top"><span className="eyebrow">{String(index + 1).padStart(2, "0")}</span><strong><SlidingNumber number={count} thousandSeparator="," /></strong></span><span className="quick-action-label">{label}</span><small>{hint} <span>→</span></small></button>)}</div>
  </section>;
}

function DashboardWorkflowRail({ vehicles = [], leads = [], appointments = [], offers = [], onNavigate }) {
  const published = vehicles.filter((vehicle) => ["published", "reserved"].includes(vehicle.status)).length;
  const activeLeads = leads.filter((lead) => ["new", "contacted", "qualified"].includes(lead.status)).length;
  const activeAppointments = appointments.filter((item) => ["pending", "confirmed"].includes(item.status)).length;
  const pendingOffers = offers.filter((item) => item.status === "pending").length;
  const stages = [
    ["inventory", "Inventario", published, published ? "Vitrina activa" : "Añade un vehículo"],
    ["leads", "Clientes", activeLeads, activeLeads ? "Conversaciones abiertas" : "Sin leads pendientes"],
    ["appointments", "Citas", activeAppointments, activeAppointments ? "Visitas por preparar" : "Agenda despejada"],
    ["offers", "Propuestas", pendingOffers, pendingOffers ? "Propuestas por responder" : "Sin propuestas pendientes"],
  ];
  return <section className="dashboard-workflow" aria-label="Recorrido comercial del showroom">
    <div className="dashboard-workflow-heading"><div><span className="eyebrow">EL RECORRIDO DEL SHOWROOM</span><h3>De la vitrina a la venta.</h3></div><p>Una lectura rápida de dónde está tu operación y qué merece atención.</p></div>
    <div className="dashboard-workflow-rail">{stages.map(([key, label, count, note], index) => <button className={`dashboard-workflow-step${count ? " has-activity" : ""}`} type="button" key={key} onClick={() => onNavigate(key)}><span className="dashboard-workflow-number">{String(index + 1).padStart(2, "0")}</span><span className="dashboard-workflow-icon"><AdminModuleIcon name={key} /></span><strong>{label}</strong><b>{count}</b><small>{note}</small>{index < stages.length - 1 && <i aria-hidden="true">→</i>}</button>)}</div>
  </section>;
}

function DashboardSetupCard({ onboarding, onOpenOnboarding, onOpenPublic }) {
  if (!onboarding?.steps?.length) return null;
  // El centro de inicio debe usar la misma regla que el panel de personalización:
  // dominio y redes pueden mejorar el showroom, pero no deben impedir que el dealer
  // empiece a operar si identidad, contacto, agenda y vitrina están listos.
  const { essentialTotal, essentialDone, ready: isComplete, progress } = buildOnboardingGroups(onboarding);
  const nextStep = onboarding.steps.find((step) => step.essential && !step.done) || onboarding.steps.find((step) => !step.done);
  const groupDone = (ids) => onboarding.steps.filter((step) => ids.includes(step.id) && step.essential).every((step) => step.done);
  // Cada señal lleva su recuento: "Pendiente" a secas no deja cuadrar el "3/6" del encabezado.
  const groupCount = (ids) => {
    const scoped = onboarding.steps.filter((step) => ids.includes(step.id) && step.essential);
    return { total: scoped.length, done_count: scoped.filter((step) => step.done).length };
  };
  const signals = [
    { label: "Identidad", done: groupDone(["identity", "logo", "domain"]), ...groupCount(["identity", "logo", "domain"]) },
    { label: "Operación", done: groupDone(["contact", "appointments", "legal"]), ...groupCount(["contact", "appointments", "legal"]) },
    { label: "Vitrina", done: groupDone(["catalog", "social"]), ...groupCount(["catalog", "social"]) },
  ];
  return <section className={`dashboard-setup-card${isComplete ? " is-complete" : ""}`} aria-label="Estado de configuración del showroom">
    <div className="dashboard-setup-main">
      <div className="dashboard-setup-heading"><span className="eyebrow">CENTRO DE INICIO · PERSONALIZACIÓN</span><span className="dashboard-setup-percent">{progress}%</span></div>
      <h3>{isComplete ? "Tu showroom está listo." : "Deja tu showroom listo."}</h3>
      <p>{isComplete ? "Revisa la vista pública y comparte el enlace." : `${essentialTotal - essentialDone === 1 ? "Te queda 1 ajuste esencial" : `Te quedan ${essentialTotal - essentialDone} ajustes esenciales`} para empezar a recibir clientes.`}</p>
      <div className="dashboard-setup-progress" aria-label={`${progress}% configurado`}><span style={{ width: `${progress}%` }} /></div>
      <div className="dashboard-setup-actions"><button className="primary-action" type="button" onClick={isComplete ? onOpenPublic : onOpenOnboarding}>{isComplete ? "Abrir showroom público ↗" : `Continuar con ${nextStep?.label?.toLowerCase() || "la configuración"} →`}</button>{!isComplete && <button className="text-button" type="button" onClick={onOpenPublic}>Ver vista pública</button>}</div>
    </div>
      <div className="dashboard-setup-side"><div className="dashboard-setup-side-head"><span className="eyebrow">LECTURA RÁPIDA</span><small>{essentialDone}/{essentialTotal} ajustes esenciales</small></div><div className="dashboard-setup-signals">{signals.map((signal) => <div className={signal.done ? "is-done" : ""} key={signal.label}><span>{signal.done ? "✓" : "·"}</span><strong>{signal.label}</strong><small>{signal.done ? "Listo" : `${signal.done_count}/${signal.total} listos`}</small></div>)}</div><p>{isComplete ? "Comprueba el resultado desde la vista pública antes de compartir el enlace." : "La personalización seguirá disponible desde el botón Personalizar showroom."}</p></div>
  </section>;
}

function DealerShareCard({ organization, settings, onNavigate }) {
  const [copied, setCopied] = useState(false);
  const slug = organization?.slug || "zevroa";
  const customDomain = organization?.customDomain;
  const normalizedCustomDomain = normalizedHostname(customDomain);
  const customDomainReady = Boolean(normalizedCustomDomain && window.location.hostname.toLowerCase() === normalizedCustomDomain);
  const isPending = organization?.approvalStatus === "pending";

  const publicUrl = useMemo(() => {
    // Pendiente de aprobación: todavía no hay nada público que compartir, así que
    // el enlace que se ofrece es la vista previa privada, no un enlace de cliente.
    return publicShowroomUrl(organization, { preview: isPending });
  }, [organization, isPending]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    }
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(`¡Hola! Te invito a explorar nuestro showroom exclusivo en ${settings?.businessName || organization?.name || "nuestro concesionario"}: ${publicUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const openShowroom = () => {
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="dealer-share-card" aria-label="Enlace exclusivo de tu showroom">
      <div className="dealer-share-main">
        <div className="dealer-share-tag">
          <span className="eyebrow">TU SHOWROOM · ENLACE EXCLUSIVO</span>
          <span className="dealer-slug-badge">Enlace: {slug}</span>
        </div>
        <h3>{isPending ? "Tu vista previa privada" : "Comparte tu showroom"}</h3>
        <p>
          {isPending
            ? "Está en revisión. Solo tú puedes ver esta vista previa hasta que sea aprobado."
            : "Este enlace muestra únicamente tu inventario, precios y datos de contacto."}
        </p>
        {!isPending && customDomain && !customDomainReady && <p className="form-message">Tu dominio personalizado todavía no apunta al showroom. Comparte este enlace provisional mientras se actualiza el DNS.</p>}
        <div className="dealer-url-box">
          <span className="dealer-url-text">{publicUrl}</span>
          <button className="dealer-copy-btn" type="button" onClick={copyLink}>
            {copied ? "✓ ¡Copiado!" : "Copiar Enlace"}
          </button>
        </div>
        <div className="dealer-share-actions">
          <button className="primary-action" type="button" onClick={openShowroom}>
            {isPending ? "Ver vista previa ↗" : "Abrir Showroom ↗"}
          </button>
          {!isPending && <button className="secondary-action" type="button" onClick={shareWhatsApp}>
            Compartir por WhatsApp 💬
          </button>}
          <button className="text-button" type="button" onClick={() => onNavigate("settings")}>
            Personalizar Marca y Dominio →
          </button>
        </div>
      </div>
      <div className="dealer-share-side">
        <div className="dealer-preview-mini">
          <div className="dealer-preview-logo">
            {organization?.logoUrl ? (
              <img src={organization.logoUrl} alt={`Logo de ${organization.name || "tu concesionario"}`} />
            ) : (
              <span>{(organization?.name || "D").slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <strong>{settings?.businessName || organization?.name || "Tu Showroom"}</strong>
          <small>{customDomainReady ? `Dominio: ${normalizedCustomDomain}` : customDomain ? "Dominio pendiente de conexión" : "Enlace de showroom"}</small>
        </div>
      </div>
    </article>
  );
}

function DealerFirstRunCard({ onNavigate }) {
  return <section className="dealer-first-run" aria-label="Primeros pasos del showroom">
    <div className="dealer-first-run-mark" aria-hidden="true"><CarSimpleIcon size={28} weight="duotone" /></div>
    <div className="dealer-first-run-copy"><span className="eyebrow">PRIMER PASO</span><h3>Publica tu primer vehículo.</h3><p>Añade fotos, precio y datos básicos. Después podrás compartirlo con tus clientes.</p></div>
    <button className="primary-action" type="button" onClick={() => onNavigate("inventory")}>Publicar mi primer vehículo →</button>
  </section>;
}

function DashboardView({ data, vehicles = [], leads, offers, appointments, loading, error = "", onRetry, onNavigate, onOpenLead, onOpenContact, onboarding, onOpenOnboarding, onOpenPublic, organization, settings, currentUser, workQueue = [], workQueueLoading = false, workQueueError = "", onRefreshWorkQueue }) {
  if (loading) return <DashboardSkeleton />;
  if (error) return <section className="dashboard-content"><AdminEmptyState eyebrow="RESUMEN NO DISPONIBLE" title="No pudimos cargar tu resumen." text={error || "El servidor no respondió a tiempo. Tus inventarios y solicitudes siguen guardados."} actionLabel="Reintentar" onAction={onRetry} /></section>;
  if (!data) return <DashboardSkeleton />;
  const summary = data.summary || {};
  const safeLeads = Array.isArray(leads) ? leads : [];
  const safeOffers = Array.isArray(offers) ? offers : [];
  // La tarjeta no debe enseñar cero mientras el listado ya tiene datos. Esto
  // también cubre el primer render cuando dashboard e inventario responden en
  // momentos distintos: usamos el mayor valor entre el resumen y el snapshot
  // que ya está visible para el dealer.
  const publishedVehicles = vehicles.filter((vehicle) => ["published", "reserved"].includes(vehicle.status));
  const snapshot = {
    totalVehicles: Math.max(Number(summary.totalVehicles) || 0, vehicles.length),
    publishedVehicles: Math.max(Number(summary.publishedVehicles) || 0, publishedVehicles.length),
    availableStock: Math.max(Number(summary.availableStock) || 0, publishedVehicles.reduce((total, vehicle) => total + (Number(vehicle.stock) || 0), 0)),
    inventoryValue: Math.max(Number(summary.inventoryValue) || 0, publishedVehicles.reduce((total, vehicle) => total + (Number(vehicle.priceUsd) || 0), 0)),
    pendingLeads: Math.max(Number(summary.pendingLeads) || 0, safeLeads.filter((lead) => ["new", "contacted", "qualified"].includes(lead.status)).length),
    pendingOffers: Math.max(Number(summary.pendingOffers) || 0, safeOffers.filter((offer) => offer.status === "pending").length),
  };
  const statusData = (data.byStatus || []).map((item) => ({ ...item, label: item.status === "published" ? "Publicados" : item.status === "pending_review" ? "En revisión" : item.status === "draft" ? "Borradores" : item.status === "sold" ? "Vendidos" : "Inactivos" }));
  // Un showroom sin vehículos todavía no necesita compartir enlaces, gráficos
  // ni métricas vacías. Su siguiente decisión debe ser única y evidente.
  if (snapshot.totalVehicles === 0) return <section className="dashboard-content dashboard-first-run">
    <div className="dashboard-intro"><div><span className="eyebrow">ZEVROA · PRIMEROS PASOS</span><h2>Empieza por tu inventario.</h2></div><p>Publica un vehículo y luego completa lo demás.</p></div>
    {organization?.approvalStatus === "pending" && <div className="dashboard-approval-banner"><strong>Tu showroom está en revisión.</strong><p>Puedes configurarlo en privado mientras preparas tu primer vehículo.</p></div>}
    {organization?.approvalStatus === "rejected" && <div className="dashboard-approval-banner is-rejected"><strong>Tu showroom necesita una revisión.</strong><p>Prepara el inventario y contacta al equipo de ZEVROA cuando esté listo.</p></div>}
    <DealerFirstRunCard onNavigate={onNavigate} />
  </section>;
  return (
    <section className="dashboard-content">
      <div className="dashboard-intro"><div><span className="eyebrow">OPERACIÓN · EN TIEMPO REAL</span><h2>Una vista clara del negocio.</h2></div><p>Todo lo que tu equipo necesita para responder, publicar y vender.</p></div>
      {organization?.approvalStatus === "pending" && <div className="dashboard-approval-banner"><strong>Tu showroom está en revisión.</strong><p>Puedes personalizarlo todo desde aquí — se publicará en tu dominio cuando el equipo de ZEVROA lo apruebe. Mientras tanto, solo tú puedes verlo con "{"Vista previa privada"}".</p></div>}
      {organization?.approvalStatus === "rejected" && <div className="dashboard-approval-banner is-rejected"><strong>Tu showroom no fue aprobado.</strong><p>Contacta al equipo de ZEVROA para conocer los motivos y volver a enviarlo a revisión.</p></div>}
      <DealerShareCard organization={organization} settings={settings} onNavigate={onNavigate} />
      <DashboardSetupCard onboarding={onboarding} onOpenOnboarding={onOpenOnboarding} onOpenPublic={onOpenPublic} />
      <div className="stats-grid">
        <StatCard label="Vehículos" numericValue={snapshot.totalVehicles} note={`${snapshot.publishedVehicles} publicados`} />
        <StatCard label="Stock disponible" numericValue={snapshot.availableStock} note="Unidades publicadas" />
        <StatCard label="Valor inventario" numericValue={snapshot.inventoryValue} formatValue={formatPrice} note="Valor publicado por modelo" />
        <StatCard label="Clientes activos" numericValue={snapshot.pendingLeads} note={`${snapshot.pendingOffers} ofertas pendientes`} />
      </div>
      <DashboardWorkflowRail vehicles={vehicles} leads={safeLeads} appointments={appointments} offers={safeOffers} onNavigate={onNavigate} />
      <WorkCenter items={workQueue} loading={workQueueLoading} error={workQueueError} currentUser={currentUser} businessName={organization?.name || settings?.businessName || "ZEVROA"} onRefresh={onRefreshWorkQueue} onNavigate={onNavigate} onOpenContact={onOpenContact} />
      <DashboardPulse data={data} leads={leads} offers={offers} appointments={appointments} onNavigate={onNavigate} onOpenLead={onOpenLead} currentUser={currentUser} />
      <Suspense fallback={<div className="charts-grid"><div className="chart-panel chart-loading-state" role="status">Preparando gráficos…</div></div>}><ReportsCharts byBrand={data.byBrand || []} statusData={statusData} /></Suspense>
      <div className="dashboard-lower"><article className="activity-panel"><div className="panel-heading"><div><span className="eyebrow">OFERTAS</span><h3>Actividad reciente</h3></div><button className="text-button" type="button" onClick={() => onNavigate("offers")}>Ver todas →</button></div>{data.recentOffers?.length ? <AnimatedList items={data.recentOffers} className="activity-list-motion" itemClassName="activity-row" renderItem={(offer) => <><div><strong>{offer.buyerName}</strong><span>{offer.brand} {offer.model} · {formatPrice(offer.amountUsd)}</span></div><span className={`status-pill ${offer.status}`}>{formatStatus(offer.status)}</span></>} /> : <AdminEmptyState eyebrow="OFERTAS" title="Todavía no hay ofertas." text="Cuando llegue la primera, aparecerá aquí para que puedas responderla." actionLabel="Ver clientes" onAction={() => onNavigate("leads")} />}</article><article className="activity-panel"><div className="panel-heading"><div><span className="eyebrow">AGENDA</span><h3>Próximas citas</h3></div><button className="text-button" type="button" onClick={() => onNavigate("appointments")}>Abrir agenda →</button></div>{data.upcomingAppointments?.length ? <AnimatedList items={data.upcomingAppointments} className="activity-list-motion" itemClassName="activity-row" renderItem={(appointment) => <><div><strong>{appointment.customerName}</strong><span>{formatDate(appointment.date)} · {String(appointment.time || "").slice(0, 5)} · {appointment.brand} {appointment.model}</span></div><span className={`status-pill ${appointment.status}`}>{formatStatus(appointment.status)}</span></>} /> : <AdminEmptyState eyebrow="AGENDA" title="No hay citas próximas." text="Cuando un comprador solicite una visita, aparecerá aquí para preparar la atención." actionLabel="Configurar agenda" onAction={() => onNavigate("appointments")} />}</article></div>
    </section>
  );
}

function PhotoEditor({ value, altValue, onChange, onAltChange, onUpload }) {
  const [draftUrl, setDraftUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [previewIndex, setPreviewIndex] = useState(null);
  useAdminDialog(() => setPreviewIndex(null), previewIndex !== null);
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
    setUploading(true); setUploadStatus(""); setUploadError("");
    try {
      const originalBytes = files.reduce((total, file) => total + Number(file.size || 0), 0);
      const prepared = await Promise.all(files.map(async (file) => {
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size < 1_200_000) return file;
        try { return await imageCompression(file, { maxSizeMB: 1.25, maxWidthOrHeight: 2560, useWebWorker: true, initialQuality: .86, fileType: file.type === "image/png" ? "image/webp" : file.type }); }
        catch { return file; }
      }));
      const optimizedBytes = prepared.reduce((total, file) => total + Number(file.size || 0), 0);
      const urls = (await Promise.all(prepared.map((file) => onUpload(file)))).filter(Boolean);
      update([...images, ...urls], [...alignedAlts, ...urls.map(() => "")]);
      if (optimizedBytes < originalBytes) setUploadStatus(`Optimizamos las fotos antes de subirlas: ${Math.max(1, Math.round((1 - optimizedBytes / originalBytes) * 100))}% menos peso.`);
    } catch (error) { setUploadError(mensajeDeError(error, "No pudimos subir esas imágenes. Inténtalo otra vez.")); }
    finally { setUploading(false); event.target.value = ""; }
  };

  const described = alignedAlts.filter(Boolean).length;
  const closePreview = () => setPreviewIndex(null);
  useEffect(() => {
    if (previewIndex === null) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closePreview();
      if (event.key === "ArrowRight") setPreviewIndex((current) => Math.min(images.length - 1, (current ?? 0) + 1));
      if (event.key === "ArrowLeft") setPreviewIndex((current) => Math.max(0, (current ?? 0) - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewIndex, images.length]);
  return <div className="photo-editor">
    <div className="photo-editor-head"><div><span className="eyebrow">GALERÍA</span><h3>{images.length} {images.length === 1 ? "imagen" : "imágenes"}</h3></div><span>La primera es la portada · arrastra para reordenar{images.length ? ` · ${described}/${images.length} con texto alternativo` : ""}</span></div>
    <div className="photo-grid">{images.map((url, index) => <article className="photo-item" key={`${url}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const from = Number(event.dataTransfer.getData("text/plain")); if (Number.isInteger(from)) move(from, index); }}>
      <button type="button" className="photo-preview-trigger" onDoubleClick={() => setPreviewIndex(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPreviewIndex(index); } }} aria-label={`Previsualizar imagen ${index + 1}`} title="Doble clic para ampliar"><img src={url} alt={alignedAlts[index] || `Imagen ${index + 1}`} onError={(event) => { event.currentTarget.style.opacity = "0.2"; }} /><span> doble clic · ampliar</span></button>
      <span className="photo-order">{index === 0 ? "PORTADA" : String(index + 1).padStart(2, "0")}</span>
      <div className="photo-actions"><button type="button" className="photo-action" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label="Mover a la izquierda">←</button><button type="button" className="photo-action" onClick={() => move(index, index + 1)} disabled={index === images.length - 1} aria-label="Mover a la derecha">→</button><button type="button" className="photo-action remove" onClick={() => remove(index)} aria-label="Eliminar imagen">×</button></div>
      <input className="photo-alt-input" value={alignedAlts[index]} onChange={(event) => setAlt(index, event.target.value)} placeholder="Texto alternativo (accesibilidad y SEO)" aria-label={`Texto alternativo de la imagen ${index + 1}`} maxLength={180} />
    </article>)}</div>
    <div className="photo-add"><input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="/assets/mi-vehiculo.jpg o URL externa" aria-label="URL de nueva imagen" /><button className="secondary-action" type="button" onClick={add}>Agregar URL</button><label className="upload-image-button">{uploading ? "Preparando imágenes…" : "Subir imágenes"}<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={handleUpload} disabled={uploading} /></label></div>
    {uploadStatus && <p className="photo-upload-status">{uploadStatus}</p>}{uploadError && <p className="media-upload-error">{uploadError}</p>}
    <AnimatePresence>{previewIndex !== null && images[previewIndex] && <motion.div className="admin-image-lightbox" role="dialog" aria-modal="true" aria-label="Previsualización de imagen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview(); }}><button type="button" className="admin-lightbox-close" onClick={closePreview} aria-label="Cerrar previsualización">×</button><button type="button" className="admin-lightbox-nav previous" onClick={() => setPreviewIndex((current) => Math.max(0, current - 1))} disabled={previewIndex === 0} aria-label="Imagen anterior">←</button><figure><img src={images[previewIndex]} alt={alignedAlts[previewIndex] || `Imagen ${previewIndex + 1}`} /><figcaption>{previewIndex + 1} / {images.length} · {alignedAlts[previewIndex] || "Sin texto alternativo"}</figcaption></figure><button type="button" className="admin-lightbox-nav next" onClick={() => setPreviewIndex((current) => Math.min(images.length - 1, current + 1))} disabled={previewIndex === images.length - 1} aria-label="Imagen siguiente">→</button></motion.div>}</AnimatePresence>
  </div>;
}

function MediaOps({ form, vehicleId = form?.id, onChange, onUpload, onPackageUpload, onGenerate3d, onRefresh3d }) {
  const generationActions = useContext(Vehicle3dActionsContext);
  onGenerate3d ||= generationActions.onGenerate3d;
  onRefresh3d ||= generationActions.onRefresh3d;
  const [uploadingField, setUploadingField] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [modelReport, setModelReport] = useState(null);
  const [sourceFiles, setSourceFiles] = useState([]);
  const [generationJob, setGenerationJob] = useState(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const generate3dFallback = async (id, files) => { const body = new FormData(); files.forEach((file) => body.append("images", file, file.name)); const response = await fetch(`${apiUrl}/api/admin/vehicles/${id}/3d-generation`, { method: "POST", credentials: "include", body }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo iniciar la generación 3D"); return payload.data; };
  const refresh3dFallback = async (id, jobId) => { const response = await fetch(`${apiUrl}/api/admin/vehicles/${id}/3d-generation/${jobId}/refresh`, { credentials: "include" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo consultar el trabajo 3D"); return payload.data; };
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
    try {
      if (field === "media3dUrl") setModelReport(await inspect3dFile(file));
      onChange(field, await onUpload(file));
    } catch (error) { setUploadError(mensajeDeError(error, "No se pudo cargar el archivo")); } finally { setUploadingField(""); }
  };
  const uploadPackage = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length || !onPackageUpload) return;
    setUploadingField("media3dPackage");
    setUploadError("");
    try {
      const entry = files.find((file) => /\.gltf$/i.test(file.name));
      if (entry) setModelReport(await inspect3dFile(entry));
      onChange("media3dUrl", await onPackageUpload(files));
    } catch (error) { setUploadError(mensajeDeError(error, "No se pudo cargar la carpeta 3D")); } finally { setUploadingField(""); }
  };
  const modelReportText = format3dReport(modelReport);
  const modelHeavy = Number(modelReport?.sizeBytes || 0) > 30 * 1024 * 1024;
  const start3dGeneration = async () => {
    if (!vehicleId) { setUploadError("Guarda primero el vehículo como borrador para generar su modelo 3D desde fotos."); return; }
    if (!sourceFiles.length) { setUploadError("Selecciona entre 1 y 5 fotos del vehículo."); return; }
    setGenerationLoading(true); setUploadError("");
    try { setGenerationJob(await (onGenerate3d || generate3dFallback)(vehicleId, sourceFiles)); }
    catch (error) { setUploadError(mensajeDeError(error, "No se pudo iniciar la generación 3D")); }
    finally { setGenerationLoading(false); }
  };
  useEffect(() => {
    if (!generationJob?.id || !vehicleId || !(onRefresh3d || refresh3dFallback) || ["needs_review", "ready", "failed"].includes(generationJob.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await (onRefresh3d || refresh3dFallback)(vehicleId, generationJob.id);
        setGenerationJob(next);
        if (next.modelUrl) { onChange("media3dUrl", next.modelUrl); setModelReport(null); }
      } catch (error) { setUploadError(mensajeDeError(error, "No se pudo consultar el trabajo 3D")); }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [generationJob?.id, generationJob?.status, vehicleId]);
  return <section className="media-studio-panel" aria-label="Estudio multimedia del vehículo">
    <div className="media-studio-head"><div><span className="eyebrow">FOTOS, VIDEO Y 3D</span><h3>Haz que el vehículo se sienta real.</h3><p>Sube tus archivos directamente. ZEVROA prepara la portada, el movimiento y la experiencia visual sin obligarte a pegar rutas técnicas.</p></div><div className="media-studio-score"><strong>{String(Math.min(imageCount, 99)).padStart(2, "0")}</strong><span>{imageCount === 1 ? "foto conectada" : "fotos conectadas"}</span></div></div>
    <div className="media-studio-status"><span><i className={imageCount ? "is-ready" : ""}>●</i> {imageCount ? `${imageCount} foto${imageCount === 1 ? "" : "s"} conectada${imageCount === 1 ? "" : "s"}` : "Sin galería todavía"}</span><span><i className={modelUrl && !modelStatus.includes("requiere") ? "is-ready" : ""}>●</i> {modelStatus}</span><span><i className={form.videoUrl ? "is-ready" : ""}>●</i> {form.videoUrl ? "Video listo" : "Video opcional"}</span></div>
    <div className="media-3d-generator"><div><span className="eyebrow">MODELO 3D DESDE TUS FOTOS</span><h4>Convierte tu sesión de fotos en una pieza interactiva.</h4><p>Selecciona hasta 5 ángulos del vehículo. El modelo se genera en segundo plano y queda pendiente de revisión antes de publicarse.</p></div><div className="media-3d-generator-actions"><label className="media-source-picker"><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => { setSourceFiles([...event.target.files].slice(0, 5)); setUploadError(""); }} /><span>{sourceFiles.length ? `${sourceFiles.length} foto${sourceFiles.length === 1 ? "" : "s"} seleccionada${sourceFiles.length === 1 ? "" : "s"}` : "Elegir fotos para convertir"}</span></label><button type="button" className="primary-action" onClick={start3dGeneration} disabled={generationLoading || !sourceFiles.length || !vehicleId}>{generationLoading ? "Enviando al motor 3D…" : "Generar modelo 3D"}</button></div>{!vehicleId && <small>Guarda el vehículo primero; luego podrás generar el modelo sin salir de este asistente.</small>}{generationJob && <div className={`media-generation-status ${generationJob.status === "needs_review" ? "is-ready" : generationJob.status === "failed" ? "is-error" : "is-processing"}`}><strong>{generationJob.status === "needs_review" ? "Modelo listo para revisar" : generationJob.status === "failed" ? "La generación necesita atención" : "Generando modelo…"}</strong><span>{generationJob.status === "needs_review" ? "El GLB se conectó a la ficha. Guarda los cambios para publicarlo." : generationJob.error || "Estamos consultando el progreso automáticamente."}</span></div>}</div>
    <div className="media-studio-grid">{mediaItems.map((item) => <article className="media-upload-card" key={item.field}><div className="media-upload-card-head"><span className="media-upload-icon">{item.icon}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div>{form[item.field] && <span className="media-connected">{item.field === "media3dUrl" && modelStatus.includes("requiere") ? "REVISAR" : "LISTO"}</span>}</div><label className="media-dropzone"><input type="file" accept={item.accept} onChange={(event) => upload(event, item.field)} disabled={Boolean(uploadingField)} /><span>{uploadingField === item.field ? "Subiendo archivo…" : form[item.field] ? "Reemplazar archivo" : "Cargar archivo"}</span><small>Seleccionar desde tu computadora</small></label>{item.field === "media3dUrl" && <label className="media-dropzone media-folder-dropzone"><input type="file" multiple webkitdirectory="" directory="" onChange={uploadPackage} disabled={Boolean(uploadingField)} /><span>{uploadingField === "media3dPackage" ? "Preparando carpeta…" : "Cargar carpeta GLTF completa"}</span><small>Selecciona la carpeta con scene.gltf, .bin y texturas</small></label>}</article>)}</div>
    {modelReport && <div className={`media-3d-health ${modelHeavy ? "is-warning" : "is-ready"}`}><div><span className="eyebrow">3D HEALTH CHECK</span><strong>{modelReportText}</strong></div><span>{modelReport.animationCount === null ? "Revisa el modelo en el visor al abrir la ficha." : modelReport.animationCount ? "El comprador podrá reproducir sus animaciones." : "No trae clips internos; el visor mostrará rotación y zoom."}</span>{modelReport.animationNames?.length > 0 && <small className="media-3d-animation-names">Clips: {modelReport.animationNames.join(" · ")}</small>}{modelHeavy && <small>Archivo pesado: conviene optimizar texturas o polígonos para evitar esperas en móviles.</small>}</div>}
    {uploadError && <p className="media-upload-error">{uploadError}</p>}
    <details className="media-advanced"><summary>Fuentes avanzadas <span>URL externa opcional</span></summary><div className="media-advanced-grid"><label>URL del modelo 3D<input type="url" value={modelUrl} onChange={(event) => { setModelReport(null); onChange("media3dUrl", event.target.value); }} placeholder="https://.../vehiculo.glb" /></label><label>URL del video<input type="url" value={form.videoUrl || ""} onChange={(event) => onChange("videoUrl", event.target.value)} placeholder="https://.../walkaround.mp4" /></label><label>URL de portada<input type="url" value={form.videoPosterUrl || ""} onChange={(event) => onChange("videoPosterUrl", event.target.value)} placeholder="https://.../poster.jpg" /></label><label>URL de vista 360<input type="url" value={form.panorama360Url || ""} onChange={(event) => onChange("panorama360Url", event.target.value)} placeholder="https://.../panorama.jpg" /></label></div></details>
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

const adminBrandLogoSlugs = { Acura: "acura", "Alfa Romeo": "alfaromeo", Audi: "audi", Bentley: "bentley", BMW: "bmw", Buick: "buick", BYD: "https://commons.wikimedia.org/wiki/Special:FilePath/BYD_Company%2C_Ltd._-_Logo.svg", Cadillac: "cadillac", Changan: "https://commons.wikimedia.org/wiki/Special:FilePath/Changan_icon.svg", Chevrolet: "chevrolet", Chrysler: "chrysler", Citroen: "citroen", Daihatsu: "daihatsu", Dodge: "dodge", Ferrari: "ferrari", Fiat: "fiat", Ford: "ford", GMC: "gmc", Honda: "honda", Hyundai: "hyundai", Infiniti: "infiniti", Jaguar: "jaguar", Jeep: "jeep", Kia: "kia", Lamborghini: "lamborghini", "Land Rover": "landrover", Lexus: "lexus", Lotus: "lotus", Maserati: "maserati", Mazda: "mazda", McLaren: "mclaren", MINI: "mini", Mitsubishi: "mitsubishi", Nissan: "nissan", Peugeot: "peugeot", Polestar: "polestar", Porsche: "porsche", RAM: "ram", Renault: "renault", "Rolls-Royce": "rollsroyce", SEAT: "seat", Skoda: "skoda", Subaru: "subaru", Suzuki: "suzuki", Tesla: "tesla", Toyota: "toyota", Volkswagen: "volkswagen", Volvo: "volvo", "Mercedes-AMG": "mercedesbenz", "Mercedes-Benz": "mercedesbenz" };
const adminBrandDirectory = Object.keys(adminBrandLogoSlugs).sort((a, b) => a.localeCompare(b));
function getAdminBrandLogoUrl(brand) { const slug = adminBrandLogoSlugs[brand]; return slug?.startsWith("http") ? slug : slug ? `https://cdn.simpleicons.org/${slug}` : ""; }
function AdminBrandLogo({ brand, logoUrl = "", size = "normal" }) { const src = logoUrl || getAdminBrandLogoUrl(brand); return <span className={`admin-brand-logo ${size}`}>{src && <img src={src} alt={`${brand} logo`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.add("has-fallback"); }} />}<b aria-hidden="true">{brand?.slice(0, 2).toUpperCase()}</b></span>; }

function BrandPickerBase({ vehicles, form, onChange, taxonomy = { brands: [] } }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useAdminDialog(() => setOpen(false), open);
  useEffect(() => { if (!open) return undefined; const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [open]);
  const records = taxonomy.brands?.length ? taxonomy.brands : adminBrandDirectory.map((name) => ({ name, logoUrl: getAdminBrandLogoUrl(name), isActive: true }));
  const visible = records.filter((item) => item.isActive !== false && item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (record) => { onChange("brand", record.name); onChange("brandLogoUrl", record.logoUrl || getAdminBrandLogoUrl(record.name)); setOpen(false); };
  return <section className="brand-picker"><div className="brand-picker-head"><div><span className="eyebrow">IDENTIDAD DE MARCA</span><h3>{form.brand || "Selecciona una marca"}</h3><p>Elige una marca administrada desde Marcas y categorías.</p></div><button type="button" className="secondary-action" onClick={() => setOpen(true)}>Elegir marca</button></div>{form.brand && <div className="brand-picker-selected"><AdminBrandLogo brand={form.brand} logoUrl={form.brandLogoUrl} size="wizard" /><div><strong>{form.brand}</strong><small>Logo conectado a esta ficha</small></div></div>}{open && <div className="brand-picker-dialog" role="dialog" aria-modal="true" aria-label="Seleccionar marca"><div className="brand-picker-dialog-head"><h3>Selecciona la marca</h3><button type="button" className="wizard-close" onClick={() => setOpen(false)} aria-label="Cerrar marcas">×</button></div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar marca..." aria-label="Buscar marca" /><div className="brand-picker-grid">{visible.map((record) => <button type="button" key={record.id || record.name} className={form.brand === record.name ? "is-selected" : ""} onClick={() => choose(record)}><AdminBrandLogo brand={record.name} logoUrl={record.logoUrl} size="picker" /><strong>{record.name}</strong><small>{vehicles.filter((vehicle) => vehicle.brand === record.name).length} modelos</small></button>)}</div>{!visible.length && <p className="empty-state">No hay marcas disponibles que coincidan.</p>}</div>}</section>;
}

function BrandPicker({ vehicles, form, onChange, taxonomy }) {
  return <><BrandPickerBase vehicles={vehicles} form={form} onChange={onChange} taxonomy={taxonomy} /><WizardIdentityFields form={form} onChange={onChange} /></>;
}

function normalizeVehicleWords(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function repeatedVariantWarning(model, variant) {
  const normalizedModel = normalizeVehicleWords(model);
  const normalizedVariant = normalizeVehicleWords(variant);
  if (!normalizedModel || !normalizedVariant || normalizedModel === normalizedVariant) return "";
  return normalizedModel.endsWith(` ${normalizedVariant}`)
    ? `El modelo ya termina en “${String(variant).trim()}”. Déjalo como modelo y usa la versión una sola vez para evitar un título duplicado.`
    : "";
}

function WizardIdentityFields({ form, onChange }) {
  const fields = [
    ["category", "Categoría", "text"],
    ["model", "Modelo", "text"],
    ["variant", "Versión / variante", "text"],
    ["year", "Año", "number"],
    ["priceUsd", "Precio", "number"],
  ];
  const warning = repeatedVariantWarning(form.model, form.variant);
  return <section className="inventory-field-section wizard-identity-fields"><summary><span><strong>Identidad y precio</strong><small>La información principal de la ficha.</small></span><b>5 campos</b></summary><div className="form-grid">{fields.map(([field, label, type]) => <label key={field}>{label}<input type={type} value={form[field] ?? ""} onChange={(event) => onChange(field, event.target.value)} required={field === "model" || field === "year" || field === "priceUsd"} /></label>)}</div>{warning && <p className="vehicle-field-warning" role="alert">{warning}</p>}</section>;
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
  const warning = repeatedVariantWarning(form.model, form.variant);
  return <div className="inventory-field-sections">{visibleGroups.map((group, index) => <details className="inventory-field-section" key={group.id} open><summary><span><strong>{group.title}</strong><small>{group.note}</small></span><b>{group.fields.length + (group.id === "availability" ? 2 : 0)} campos</b></summary><div className="form-grid">{group.fields.map(renderField)}{group.id === "availability" && <><label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value)}><option value="draft">Borrador</option><option value="pending_review">En revisión</option><option value="published">Publicado</option><option value="reserved">Reservado</option><option value="sold">Vendido</option><option value="inactive">Inactivo</option></select></label><label>Condición<select value={form.condition} onChange={(event) => onChange("condition", event.target.value)}><option value="new">Nuevo</option><option value="used">Usado</option></select></label></>}</div>{group.id === "identity" && warning && <p className="vehicle-field-warning" role="alert">{warning}</p>}</details>)}</div>;
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

function InventoryVirtualRow({ vehicle, selected, onToggle, onEdit, onDuplicate, onDeactivate, onStatusChange, onOpenSticker, onOpenSocial }) {
  const model3d = model3dState(vehicle.media?.find((item) => item.type === "model_3d")?.url);
  const hasVideo = vehicle.media?.some((item) => item.type === "video");
  const seoReady = Boolean(String(vehicle.seoTitle || "").trim() && String(vehicle.seoDescription || "").trim());
  const isPublic = ["published", "reserved"].includes(vehicle.status);
  const blockers = publishBlockers(vehicle);
  return <article className="inventory-virtual-row">
    <div className="inventory-virtual-main"><label className="inventory-virtual-select"><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Seleccionar ${vehicle.brand} ${vehicle.model}`} /><span /></label><div className="inventory-cell-main"><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.stockNumber ? `#${vehicle.stockNumber}` : "Sin número de inventario"}{vehicle.variant ? ` · ${vehicle.variant}` : ""}</small></div></div>
    <div className="inventory-virtual-meta"><span>{vehicle.year}</span><span className={`status-pill ${vehicle.status}`}>{vehicleStatusLabels[vehicle.status] || vehicle.status}</span><span className="inventory-badges"><span className={vehicle.images?.length ? "media-badge is-ready" : "media-badge is-missing"}>{vehicle.images?.length || 0} ◫</span><span className={`media-badge is-${model3d.code}`}>{model3d.label}</span><span className={hasVideo ? "media-badge is-ready" : "media-badge"}>▶</span><span className={seoReady ? "media-badge is-ready" : "media-badge is-warn"}>{seoReady ? "SEO ✓" : "SEO !"}</span></span><strong>{formatPrice(vehicle.priceUsd)}</strong></div>
    {blockers.length > 0 && <small className="inventory-warning">{isPublic ? `Publicado sin ${blockers.join(" y ")}` : `Falta: ${blockers.join(", ")}`}</small>}
    <div className="inventory-virtual-actions">{isPublic && <PublicVehicleActions vehicle={vehicle} />}<button className="text-button" type="button" onClick={() => onEdit(vehicle)}>Editar</button><button className="text-button" type="button" onClick={() => onDuplicate(vehicle.id)}>Duplicar</button><button className={vehicle.status === "inactive" ? "text-button" : "text-button danger-text"} type="button" onClick={() => vehicle.status === "inactive" ? onStatusChange(vehicle.id, "draft") : onDeactivate(vehicle.id)}>{vehicle.status === "inactive" ? "Restaurar" : "Archivar"}</button><button className="text-button" type="button" onClick={() => onOpenSticker?.(vehicle)}>Cartel / QR</button><button className="text-button" type="button" onClick={() => onOpenSocial?.(vehicle)}>Flyer social</button><select className="status-quick-action" value="" onChange={(event) => { if (event.target.value) onStatusChange(vehicle.id, event.target.value); event.target.value = ""; }} aria-label={`Cambiar estado de ${vehicle.brand} ${vehicle.model}`}><option value="">Más estados…</option>{["draft", "published", "reserved", "sold", "inactive"].filter((option) => option !== vehicle.status).map((option) => <option key={option} value={option}>{vehicleStatusLabels[option]}</option>)}</select></div>
  </article>;
}

function wizardStepState(form, index) {
  const images = String(form.images || "").split(",").map((item) => item.trim()).filter(Boolean);
  const states = [
    Boolean(form.brand && form.model && Number(form.year) > 0 && Number(form.priceUsd) > 0),
    Boolean(form.status && form.condition),
    Boolean(form.engine && form.transmission && form.fuelType),
    String(form.description || "").trim().length >= 40,
    Boolean(String(form.seoTitle || "").trim() && String(form.seoDescription || "").trim()),
    images.length > 0,
    true,
    publishBlockers({ ...form, images: images.map((url, index) => ({ url, sortOrder: index })) }).length === 0,
  ];
  return states[index];
}

function WizardReview({ form, editingId }) {
  const images = String(form.images || "").split(",").map((item) => item.trim()).filter(Boolean);
  const blockers = publishBlockers({ ...form, images: images.map((url, index) => ({ url, sortOrder: index })) });
  const model = model3dState(form.media3dUrl);
  const effectiveSeoTitle = String(form.seoTitle || "").trim() || `${form.brand || "Vehículo"} ${form.model || ""} ${form.year || ""} | ZEVROA`;
  const effectiveSeoDescription = String(form.seoDescription || "").trim() || String(form.description || "").trim().slice(0, 160);
  const rows = [["Marca / modelo", `${form.brand || "Sin marca"} ${form.model || "Sin modelo"}`], ["Año", form.year || "Sin definir"], ["Precio", Number(form.priceUsd) > 0 ? formatPrice(Number(form.priceUsd)) : "Sin precio"], ["Estado", vehicleStatusLabels[form.status] || form.status || "Borrador"], ["Stock", Number.isFinite(Number(form.stock)) && form.stock !== "" ? `${Number(form.stock)} ${Number(form.stock) === 1 ? "unidad" : "unidades"}` : "0 unidades"], ["Galería", `${images.length} ${images.length === 1 ? "imagen" : "imágenes"}`], ["3D", model.code === "none" ? "Opcional · no conectado" : model.title], ["SEO", effectiveSeoTitle ? "Título preparado" : "Pendiente"]];
  return <section className="wizard-review" aria-label="Revisión final de la ficha"><div className="wizard-review-head"><div><span className="eyebrow">ÚLTIMA REVISIÓN</span><h3>{editingId ? "Confirma los cambios antes de guardar." : "Así se guardará tu vehículo."}</h3><p>Este resumen refleja los datos normalizados que se enviarán al guardar. Puedes volver a cualquier etapa sin perder lo que completaste.</p></div><span className={blockers.length ? "wizard-review-score is-warning" : "wizard-review-score is-ready"}>{blockers.length ? `${blockers.length} pendientes` : "LISTA"}</span></div><div className="wizard-review-grid">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="wizard-review-copy"><span>Descripción comercial</span><p>{String(form.description || "").trim() || "Sin descripción. Se guardará como borrador hasta completarla."}</p><small>SEO: {effectiveSeoDescription || "Se generará al guardar cuando exista una descripción."}</small></div>{blockers.length ? <div className="wizard-review-warning"><strong>Antes de publicar</strong><p>Falta{blockers.length > 1 ? "n" : ""}: {blockers.join(", ")}. Puedes guardar como borrador, pero completa esto para mostrarlo públicamente.</p></div> : <div className="wizard-review-success">✓ La ficha tiene los mínimos para publicarse.</div>}</section>;
}

function VehicleWizard({ vehicles, taxonomy, form, editingId, message, onChange, onSave, onCancel, onUpload, onPackageUpload, onGenerate3d, onRefresh3d, onPreview }) {
  const { confirm } = useAdminConfirm();
  const [step, setStep] = useState(0);
  const initialSnapshot = useRef(JSON.stringify(form));
  const steps = ["Identidad", "Disponibilidad", "Ficha técnica", "Presentación", "Visibilidad", "Imágenes", "3D y medios", "Revisión final"];
  const fields = ["brand", "category", "model", "variant", "year", "priceUsd", "stockNumber", "engine", "power", "transmission", "drive", "fuelType", "exteriorColor", "interiorColor", "doors", "seats", "mileageKm", "location", "warranty", "features", "description", "seoTitle", "seoDescription", "stock", "maxDiscountPercent"];
  const numericFields = ["year", "priceUsd", "doors", "seats", "mileageKm", "stock", "maxDiscountPercent"];
  const fieldLabels = { brand: "Marca", brandLogoUrl: "Logo real de la marca (URL SVG)", category: "Categoría", model: "Modelo", variant: "Versión / variante", year: "Año", priceUsd: "Precio", stockNumber: "Número de inventario", engine: "Motor", power: "Potencia", transmission: "Transmisión", drive: "Tracción", fuelType: "Combustible", exteriorColor: "Color exterior", interiorColor: "Color interior", doors: "Puertas", seats: "Asientos", mileageKm: "Kilometraje (km)", location: "Ubicación", warranty: "Garantía", features: "Equipamiento (separado por comas)", description: "Descripción comercial", seoTitle: "Título SEO", seoDescription: "Descripción SEO", stock: "Unidades", maxDiscountPercent: "Descuento máximo %" };
  const goTo = (next) => setStep(Math.max(0, Math.min(steps.length - 1, next)));
  const isDirty = JSON.stringify(form) !== initialSnapshot.current;
  const requestClose = async () => { if (isDirty && !(await confirm({ title: "Descartar cambios", message: "Tienes cambios sin guardar en esta ficha. Si sales ahora, se perderán.", confirmLabel: "Descartar cambios", danger: true }))) return; onCancel?.(); };
  useEffect(() => {
    if (!isDirty) return undefined;
    const warnBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);
  return <div className="wizard-backdrop"><form className="admin-form inventory-wizard" onSubmit={onSave}><div className="wizard-header"><div><span className="eyebrow">FICHA {editingId ? "· EDICIÓN" : "· NUEVA"}</span><h2>{editingId ? "Editar vehículo" : "Nuevo vehículo"}</h2><p>{isDirty ? "Tienes cambios sin guardar. Puedes avanzar por las etapas sin perderlos." : "Completa cada etapa. Puedes volver a cualquiera sin perder los datos."}</p></div><button type="button" className="wizard-close" onClick={requestClose} aria-label="Cerrar ventana">×</button></div><nav className="wizard-steps" aria-label="Etapas de la ficha">{steps.map((label, index) => { const complete = wizardStepState(form, index); return <button type="button" key={label} className={index === step ? "active" : index < step ? "is-done" : ""} onClick={() => goTo(index)} aria-current={index === step ? "step" : undefined}><span>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span>{label}</button>; })}</nav><div className="wizard-stage"><VehicleReadiness form={form} />{step === 0 && <BrandPicker vehicles={vehicles} form={form} onChange={onChange} taxonomy={taxonomy} />}{step > 0 && step < 5 && <InventoryFieldSections fields={fields} fieldLabels={fieldLabels} numericFields={numericFields} form={form} onChange={onChange} activeStep={step} />}{step === 5 && <PhotoEditor value={form.images} altValue={form.imageAltTexts} onChange={(value) => onChange("images", value)} onAltChange={(value) => onChange("imageAltTexts", value)} onUpload={onUpload} />}{step === 6 && <MediaOps form={form} onChange={onChange} onUpload={onUpload} onPackageUpload={onPackageUpload} />}{step === 7 && <WizardReview form={form} editingId={editingId} />}</div>{message && <p className="form-message" role="status">{message}</p>}<div className="wizard-footer"><button className="secondary-action" type="button" onClick={() => goTo(step - 1)} disabled={step === 0}>← Atrás</button><div className="wizard-footer-actions">{onPreview && <button className="secondary-action wizard-preview-action" type="button" onClick={onPreview}>Vista previa ↗</button>}{step < steps.length - 1 ? <button className="primary-action" type="button" onClick={() => goTo(step + 1)}>Siguiente →</button> : <button className="primary-action" type="submit">{editingId ? "Guardar cambios" : "Crear vehículo"}</button>}</div></div></form></div>;
}

function InventoryTableModule({ vehicles, taxonomy, form, editingId, loading, message, onChange, onSave, onEdit, onCancel, onDeactivate, onDuplicate, onRefresh, onUpload, onPackageUpload, onReview, onStatusChange, onPreview, onOpenSticker, onOpenSocial, onBulk, onExport }) {
  const { confirm } = useAdminConfirm();
  const fields = ["brand", "category", "model", "variant", "year", "priceUsd", "stockNumber", "engine", "power", "transmission", "drive", "fuelType", "exteriorColor", "interiorColor", "doors", "seats", "mileageKm", "location", "warranty", "features", "description", "seoTitle", "seoDescription", "stock", "maxDiscountPercent"];
  const fieldLabels = { brand: "Marca", brandLogoUrl: "Logo real de la marca (URL SVG)", category: "Categoría", model: "Modelo", variant: "Versión / variante", year: "Año", priceUsd: "Precio", stockNumber: "Número de inventario", engine: "Motor", power: "Potencia", transmission: "Transmisión", drive: "Tracción", fuelType: "Combustible", exteriorColor: "Color exterior", interiorColor: "Color interior", doors: "Puertas", seats: "Asientos", mileageKm: "Kilometraje (km)", location: "Ubicación", warranty: "Garantía", features: "Equipamiento (separado por comas)", description: "Descripción comercial", seoTitle: "Título SEO", seoDescription: "Descripción SEO", stock: "Unidades", maxDiscountPercent: "Descuento máximo %" };
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [inventorySort, setInventorySort] = useState("updatedAt");
  const [selectedIds, setSelectedIds] = useState([]);
  useEffect(() => { const refresh = () => onRefresh?.(); window.addEventListener("authentiq:inventory-refresh", refresh); return () => window.removeEventListener("authentiq:inventory-refresh", refresh); }, [onRefresh]);
  const filteredVehicles = vehicles.filter((vehicle) => (statusFilter === "all" || vehicle.status === statusFilter)
    && `${vehicle.brand} ${vehicle.model} ${vehicle.year} ${vehicleStatusLabels[vehicle.status] || vehicle.status} ${vehicle.stockNumber || ""}`.toLowerCase().includes(globalFilter.toLowerCase()));
  const inventoryTable = useReactTable({
    data: filteredVehicles,
    columns: [{ accessorKey: inventorySort }],
    state: { sorting: [{ id: inventorySort, desc: inventorySort !== "brand" && inventorySort !== "model" }] },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const sortedVehicles = inventoryTable.getRowModel().rows.map((row) => row.original);
  const visibleIds = sortedVehicles.map((vehicle) => vehicle.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const toggleSelected = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleAllVisible = () => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  const runBulk = async (operation) => { if (!selectedIds.length || !onBulk) return; const label = { publish: "publicar", archive: "archivar", sold: "marcar como vendidos", draft: "volver a borrador" }[operation]; if (!(await confirm({ title: `${label[0].toUpperCase()}${label.slice(1)} ${selectedIds.length} vehículos`, message: "La acción se aplicará únicamente a la selección de este concesionario. Archivar es reversible.", confirmLabel: "Continuar", danger: operation === "archive" }))) return; await onBulk(selectedIds, operation); setSelectedIds([]); };
  const numericFields = ["year", "priceUsd", "doors", "seats", "mileageKm", "stock", "maxDiscountPercent"];
  const wizardSteps = ["Identidad", "Disponibilidad", "Ficha técnica", "Presentación", "Visibilidad", "Imágenes", "3D y medios"];
  const [wizardOpen, setWizardOpen] = useState(false);
  useEffect(() => { if (editingId) setWizardOpen(true); }, [editingId]);
  const closeWizard = () => { setWizardOpen(false); onCancel?.(); };
  const saveWizard = async (event) => { if (form.status === "published" && !(await confirm({ title: "Publicar vehículo", message: "Quedará visible en el catálogo y podrá compartirse públicamente.", confirmLabel: "Publicar vehículo" }))) return; await onSave(event); setWizardOpen(false); };
  if (wizardOpen) return <VehicleWizard vehicles={vehicles} taxonomy={taxonomy} form={form} editingId={editingId} message={message} onChange={onChange} onSave={saveWizard} onCancel={closeWizard} onUpload={onUpload} onPackageUpload={onPackageUpload} onPreview={onPreview} />;
  const renderVirtualVehicle = (vehicle) => <InventoryVirtualRow vehicle={vehicle} selected={selectedIds.includes(vehicle.id)} onToggle={() => toggleSelected(vehicle.id)} onEdit={onEdit} onDuplicate={onDuplicate} onDeactivate={onDeactivate} onStatusChange={onStatusChange} onOpenSticker={onOpenSticker} onOpenSocial={onOpenSocial} />;
  return <div className="inventory-content"><div className="admin-layout"><form className="admin-form" onSubmit={onSave}><div className="admin-form-head"><h2>{editingId ? "Editar vehículo" : "Nuevo vehículo"}</h2>{editingId && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}</div><VehicleReadiness form={form} /><InventoryFieldSections fields={fields} fieldLabels={fieldLabels} numericFields={numericFields} form={form} onChange={onChange} /><MediaOps form={form} onChange={onChange} onUpload={onUpload} onPackageUpload={onPackageUpload} /><PhotoEditor value={form.images} altValue={form.imageAltTexts} onChange={(value) => onChange("images", value)} onAltChange={(value) => onChange("imageAltTexts", value)} onUpload={onUpload} />{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">{editingId ? "Guardar cambios" : "Crear vehículo"}</button></form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")}</span><h3>Vehículos registrados</h3></div><button className="text-button" type="button" onClick={onRefresh}>Actualizar</button></div>{vehicles.length > 0 && <div className="inventory-table-filters"><input className="table-search" placeholder="Buscar por marca, modelo o número de inventario…" value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar inventario por estado"><option value="all">Todos los estados</option>{Object.entries(vehicleStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={inventorySort} onChange={(event) => setInventorySort(event.target.value)} aria-label="Ordenar inventario"><option value="updatedAt">Más recientes</option><option value="brand">Marca</option><option value="model">Modelo</option><option value="year">Año</option><option value="priceUsd">Precio</option></select><span>{filteredVehicles.length} de {vehicles.length}</span></div>}{vehicles.length > 0 && <div className="inventory-bulk-bar"><strong>{selectedIds.length ? `${selectedIds.length} seleccionados` : "Edición masiva"}</strong><button type="button" className="text-button" onClick={toggleAllVisible}>{allVisibleSelected ? "Quitar selección" : "Seleccionar visibles"}</button>{onExport && <button type="button" className="text-button" onClick={onExport}>Exportar CSV</button>}{selectedIds.length > 0 && <><button type="button" className="text-button" onClick={() => runBulk("publish")}>Publicar</button><button type="button" className="text-button" onClick={() => runBulk("draft")}>Borrador</button><button type="button" className="text-button" onClick={() => runBulk("sold")}>Vendidos</button><button type="button" className="text-button danger-text" onClick={() => runBulk("archive")}>Archivar</button></>}</div>}{loading ? <p className="empty-state">Cargando inventario…</p> : <div className="table-scroll">{sortedVehicles.length > 100 ? <VirtualizedList items={sortedVehicles} renderItem={renderVirtualVehicle} className="inventory-virtual-list" estimateSize={176} /> : vehicles.length > 0 && <table className="inventory-table"><thead><tr><th className="selection-head"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Seleccionar vehículos visibles" /></th><th>Vehículo</th><th>Año</th><th>Estado</th><th>Medios</th><th>SEO</th><th>Precio</th><th /></tr></thead><tbody>{sortedVehicles.map((vehicle) => {
      const model3d = model3dState(vehicle.media?.find((item) => item.type === "model_3d")?.url);
      const hasVideo = vehicle.media?.some((item) => item.type === "video");
      const seoReady = Boolean(String(vehicle.seoTitle || "").trim() && String(vehicle.seoDescription || "").trim());
      const blockers = publishBlockers(vehicle);
      const isPublic = ["published", "reserved"].includes(vehicle.status);
       return <tr key={vehicle.id}><td className="selection-cell"><input type="checkbox" checked={selectedIds.includes(vehicle.id)} onChange={() => toggleSelected(vehicle.id)} aria-label={`Seleccionar ${vehicle.brand} ${vehicle.model}`} /></td>
        <td><div className="inventory-cell-main"><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.stockNumber ? `#${vehicle.stockNumber}` : "Sin número de inventario"}{vehicle.variant ? ` · ${vehicle.variant}` : ""}</small></div></td>
        <td>{vehicle.year}</td>
        <td><div className="inventory-cell-main"><span className={`status-pill ${vehicle.status}`}>{vehicleStatusLabels[vehicle.status] || vehicle.status}</span>{!isPublic && <small>No visible en el catálogo</small>}{isPublic && !!blockers.length && <small className="inventory-warning">Publicado sin {blockers.join(" y ")}</small>}{!isPublic && !!blockers.length && <small className="inventory-warning">Falta: {blockers.join(", ")}</small>}</div></td>
        <td><div className="inventory-badges"><span className={vehicle.images?.length ? "media-badge is-ready" : "media-badge is-missing"} title={`${vehicle.images?.length || 0} imágenes`}>{vehicle.images?.length || 0} ◫</span><span className={`media-badge is-${model3d.code}`} title={model3d.title}>{model3d.label}</span><span className={hasVideo ? "media-badge is-ready" : "media-badge"} title={hasVideo ? "Video conectado" : "Sin video"}>▶</span></div></td>
        <td><span className={seoReady ? "media-badge is-ready" : "media-badge is-warn"} title={seoReady ? "Título y descripción SEO definidos" : "Faltan metadatos SEO"}>{seoReady ? "SEO ✓" : "SEO !"}</span></td>
        <td>{formatPrice(vehicle.priceUsd)}</td>
         <td><div className="table-actions">{isPublic && <PublicVehicleActions vehicle={vehicle} />}<button className="text-button" type="button" onClick={() => onEdit(vehicle)}>Editar</button><button className="text-button" type="button" onClick={() => onDuplicate(vehicle.id)}>Duplicar</button>{vehicle.status === "inactive" ? <button className="text-button" type="button" onClick={() => onStatusChange(vehicle.id, "draft")}>Restaurar</button> : <button className="text-button danger-text" type="button" onClick={() => onDeactivate(vehicle.id)}>Archivar</button>}<button className="text-button" type="button" onClick={() => onOpenSticker?.(vehicle)}>Cartel / QR</button><button className="text-button" type="button" onClick={() => onOpenSocial?.(vehicle)}>Flyer social</button>{vehicle.status === "pending_review" && <><button className="text-button review-action" type="button" onClick={() => onReview(vehicle.id, "approve")}>Aprobar</button><button className="text-button danger-text" type="button" onClick={() => onReview(vehicle.id, "reject")}>Devolver</button></>}<select className="status-quick-action" value="" onChange={(event) => { if (event.target.value) onStatusChange(vehicle.id, event.target.value); event.target.value = ""; }} aria-label={`Cambiar estado de ${vehicle.brand} ${vehicle.model}`}><option value="">Más estados…</option>{["draft", "published", "reserved", "sold", "inactive"].filter((option) => option !== vehicle.status).map((option) => <option key={option} value={option}>{vehicleStatusLabels[option]}</option>)}</select></div></td>
      </tr>;
    })}</tbody></table>}{!filteredVehicles.length && (vehicles.length
      /* Un filtro sin resultados y un inventario recién creado son dos situaciones
         distintas: la segunda es el primer día del dealer y necesita indicarle qué hacer. */
      ? <div className="inventory-empty"><strong>Ningún vehículo coincide con esa búsqueda.</strong><p>Prueba con otra marca o modelo, o quita el filtro de estado para ver todo el inventario.</p><button className="secondary-action" type="button" onClick={() => { setGlobalFilter(""); setStatusFilter("all"); }}>Quitar filtros</button></div>
      : <div className="inventory-empty is-first-run"><span className="eyebrow">TU PRIMER VEHÍCULO</span><strong>Aquí vivirá tu inventario.</strong><p>Publica un vehículo y tu showroom deja de estar vacío. El asistente te pide marca, modelo, precio y fotos — puedes guardarlo como borrador y terminarlo después.</p><button className="primary-action" type="button" onClick={() => setWizardOpen(true)}>Publicar mi primer vehículo →</button><small>También puedes importar varios de una vez desde un Excel.</small></div>)}</div>}</section></div></div>;
}

function InventoryModule(props) {
  const { vehicles = [], form, editingId, message, onChange, onSave, onCancel, onUpload, onPackageUpload, onPreview, onOpenSticker, onOpenSocial } = props;
  const taxonomy = props.taxonomy || { brands: [], categories: [] };
  const [wizardOpen, setWizardOpen] = useState(false);
  useEffect(() => { if (editingId) setWizardOpen(true); }, [editingId]);
  const openPreview = () => { const media = [{ type: "model_3d", url: form.media3dUrl }, { type: "video", url: form.videoUrl, posterUrl: form.videoPosterUrl }, { type: "panorama_360", url: form.panorama360Url }].filter((item) => String(item.url || "").trim()); const preview = { ...form, id: "preview", priceUsd: Number(form.priceUsd || 0), mileageKm: Number(form.mileageKm || 0), media, images: String(form.images || "").split(",").map((url) => url.trim()).filter(Boolean).map((url, index) => ({ id: `preview-${index}`, url, sortOrder: index })) }; sessionStorage.setItem("authentiq_vehicle_preview", JSON.stringify(preview)); window.open("/preview", "_blank", "noopener,noreferrer"); };
  const closeWizard = () => { setWizardOpen(false); onCancel?.(); };
  if (wizardOpen) return <VehicleWizard vehicles={vehicles} taxonomy={taxonomy} form={form} editingId={editingId} message={message} onChange={onChange} onSave={onSave} onCancel={closeWizard} onUpload={onUpload} onPackageUpload={onPackageUpload} onPreview={onPreview || openPreview} />;
  const published = vehicles.filter((vehicle) => vehicle.status === "published").length;
  const review = vehicles.filter((vehicle) => vehicle.status === "pending_review").length;
  const missingPhotos = vehicles.filter((vehicle) => !vehicle.images?.length).length;
  return <div className="inventory-hub"><div className="inventory-overview-head"><div><span className="eyebrow">CENTRO DE INVENTARIO</span><h2>Tu inventario, listo para vender.</h2><p>Revisa qué está publicado, completa lo pendiente y abre el asistente solo cuando necesites crear o editar un vehículo.</p></div><button className="primary-action inventory-new-button" type="button" onClick={() => setWizardOpen(true)}>+ Nuevo vehículo</button></div><div className="inventory-overview-stats"><article><span>Vehículos registrados</span><strong>{vehicles.length}</strong><small>En tu inventario</small></article><article><span>Publicados</span><strong>{published}</strong><small>Visibles en catálogo</small></article><article><span>En revisión</span><strong>{review}</strong><small>Requieren atención</small></article><article className={missingPhotos ? "is-warning" : ""}><span>Medios pendientes</span><strong>{missingPhotos}</strong><small>{missingPhotos ? "Sin fotografía principal" : "Inventario completo"}</small></article></div><InventoryTableModule {...props} taxonomy={taxonomy} onPreview={onPreview} onOpenSticker={onOpenSticker} onOpenSocial={onOpenSocial} /></div>;
}

function RecordsModule({ kind, records, loading, onRefresh, onStatusChange }) {
  const renderRecord = (record) => <article className="record-row" key={record.id}><div><strong>{record.buyerName}</strong><span>{record.brand} {record.model} · {formatPrice(record.amountUsd)}</span>{record.message && <p>{record.message}</p>}</div><div className="record-actions"><span className={`status-pill ${record.status}`}>{formatStatus(record.status)}</span><select value={record.status} onChange={(event) => onStatusChange(record.id, event.target.value)} aria-label={`Cambiar estado de la oferta de ${record.buyerName}`}><option value="pending">Pendiente</option><option value="accepted">Aceptada</option><option value="rejected">Rechazada</option></select></div></article>;
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>Ofertas recibidas.</h2></div><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar</button></div>{loading ? <div className="admin-loading-state"><span className="loading-orbit" aria-hidden="true" /><span>Consultando oportunidades…</span></div> : records.length ? <VirtualizedList items={records} renderItem={renderRecord} className="records-list" estimateSize={100} /> : <AdminEmptyState eyebrow="OFERTAS" title="Todavía no hay ofertas." text="Las ofertas enviadas desde las fichas aparecerán aquí para darles seguimiento." actionLabel="Actualizar" onAction={onRefresh} />}</section>;
}


function ReportsModule({ dashboard, vehicles, leads, offers, loading, analytics, funnelData }) {
  const [period, setPeriod] = useState("all");
  const reportSummary = dashboard?.summary || {};
  const publishedVehicles = vehicles.filter((vehicle) => ["published", "reserved"].includes(vehicle.status));
  const reportPublishedCount = Math.max(Number(reportSummary.publishedVehicles) || 0, publishedVehicles.length);
  const reportStock = Math.max(Number(reportSummary.availableStock) || 0, publishedVehicles.reduce((total, vehicle) => total + (Number(vehicle.stock) || 0), 0));
  const reportInventoryValue = Math.max(Number(reportSummary.inventoryValue) || 0, publishedVehicles.reduce((total, vehicle) => total + (Number(vehicle.priceUsd) || 0), 0));
  const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
  const recent = (records) => records.filter((record) => !cutoff || new Date(record.createdAt).getTime() >= cutoff);
  const periodOffers = recent(offers);
  const periodLeads = recent(leads);
  const funnel = [{ name: "Clientes", value: periodLeads.length, fill: "#c8a24b" }, { name: "Ofertas", value: periodOffers.length, fill: "#5f6f6b" }, { name: "Cerrados", value: periodLeads.filter((lead) => lead.status === "closed").length, fill: "#2f3b39" }];
  const acceptedOffers = periodOffers.filter((offer) => offer.status === "accepted");
  const conversion = periodLeads.length ? Math.round((periodLeads.filter((lead) => ["qualified", "closed"].includes(lead.status)).length / periodLeads.length) * 100) : 0;
  const exportReport = () => { const rows = [["Métrica", "Valor"], ["Periodo", period === "all" ? "Histórico" : `Últimos ${period} días`], ["Vehículos publicados", reportPublishedCount], ["Stock disponible", reportStock], ["Leads", periodLeads.length], ["Ofertas", periodOffers.length], ["Ofertas aceptadas", acceptedOffers.length], ["Conversión calificados/cerrados", `${conversion}%`]]; const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = `zevroa-reporte-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); };
  return <section className="reports-content"><div className="panel-heading"><div><span className="eyebrow">CÓMO VA EL NEGOCIO</span><h2>Reportes.</h2></div><div className="panel-actions"><select className="report-period" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Periodo del reporte"><option value="all">Todo el histórico</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option></select><button type="button" className="secondary-action" onClick={exportReport}>Exportar CSV</button></div></div>{loading ? <p className="empty-state">Preparando reporte…</p> : <><div className="report-kpis"><AnalyticsEventsPanel analytics={analytics} /><AnalyticsFunnelPanel data={funnelData} /><StatCard label="Conversión comercial" value={`${conversion}%`} note="Leads calificados o cerrados" /><StatCard label="Ofertas aceptadas" value={acceptedOffers.length} note={`${periodOffers.length} ofertas en el periodo`} /><StatCard label="Inventario publicado" value={reportPublishedCount} note={`${publishedVehicles.length} registros cargados`} /></div><div className="report-grid"><article className="chart-panel report-chart"><div className="panel-heading"><div><span className="eyebrow">EMBUDO</span><h3>Interés que se convierte en acción</h3></div></div><Suspense fallback={<div className="chart-box chart-loading-state" role="status">Preparando gráfico…</div>}><ReportsCharts variant="funnel" funnel={funnel} /></Suspense></article><article className="report-insight"><span className="eyebrow">LECTURA RÁPIDA</span><h3>{conversion >= 30 ? "El interés está avanzando." : "Hay oportunidad en el seguimiento."}</h3><p>{conversion >= 30 ? "La operación está convirtiendo una parte saludable de sus leads en conversaciones calificadas." : "Prioriza los leads nuevos y contactados para aumentar el paso hacia ofertas."}</p><div className="insight-line"><span>Valor de inventario</span><strong>{formatPrice(reportInventoryValue)}</strong></div><div className="insight-line"><span>Stock disponible</span><strong>{reportStock} unidades</strong></div></article></div></>}</section>;
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
  appointment_submitted: "Citas solicitadas",
  trade_in_submitted: "Vehículos para entregar",
  search_alert_submitted: "Búsquedas guardadas",
  price_alert_submitted: "Alertas de precio",
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

const adminModuleIcons = { dashboard: SquaresFourIcon, inventory: CarSimpleIcon, taxonomy: TagIcon, leads: UsersThreeIcon, appointments: CalendarBlankIcon, quotes: FileTextIcon, blog: ArticleIcon, offers: HandCoinsIcon, reports: ChartLineUpIcon, audit: ListChecksIcon, users: UsersIcon, subscription: HandCoinsIcon, integrations: PlugsConnectedIcon, settings: PaintBrushIcon };
function AdminModuleIcon({ name }) {
  const Icon = adminModuleIcons[name] || SquaresFourIcon;
  return <Icon className="admin-nav-icon" size={17} weight="regular" aria-hidden="true" />;
}

function BackofficeCommandCenter({ open, onOpenChange, role, onNavigate, onPreview, onOpenPublic, onBack, onOpenOnboarding }) {
  const moduleActions = navItemsWithAppointments(role).map(([key, label]) => ({ value: `abrir ${label}`, label, icon: adminModuleIcons[key] || SquaresFourIcon, run: () => onNavigate(key) }));
  const quickActions = [{ value: "vista previa vehículo", label: "Vista previa del vehículo", icon: EyeIcon, run: onPreview }, { value: "abrir mi showroom", label: "Ver mi showroom", icon: ArrowUpRightIcon, run: onOpenPublic }, { value: "abrir inicio zevroa", label: "Ir al inicio de ZEVROA", icon: HouseIcon, run: onBack }];
  if (["admin", "editor"].includes(role)) quickActions.unshift({ value: "personalizar showroom", label: "Personalizar showroom", icon: PaintBrushIcon, run: role === "editor" ? () => onNavigate("settings") : onOpenOnboarding });
  const renderAction = (action) => { const Icon = action.icon; return <Command.Item key={action.value} value={action.value} onSelect={() => { action.run(); onOpenChange(false); }}><Icon size={18} weight="regular" aria-hidden="true" /><span>{action.label}</span><ArrowUpRightIcon size={15} aria-hidden="true" /></Command.Item>; };
  return <Command.Dialog open={open} onOpenChange={onOpenChange} label="Acciones rápidas del panel" className="command-dialog"><div className="command-shell"><div className="command-search"><MagnifyingGlassIcon size={18} aria-hidden="true" /><Command.Input autoFocus placeholder="Busca una sección o una acción…" /></div><Command.List><Command.Empty>No encontramos esa acción.</Command.Empty><Command.Group heading="Acciones rápidas">{quickActions.map(renderAction)}</Command.Group><Command.Separator /><Command.Group heading="Módulos">{moduleActions.map(renderAction)}</Command.Group></Command.List><footer><span>Escribe para buscar</span><kbd>Esc</kbd><span>para cerrar</span></footer></div></Command.Dialog>;
}

function WhatsAppAction({ lead }) {
  const digits = String(lead?.phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const message = encodeURIComponent(`Hola ${lead.name || ""}, te escribo sobre tu consulta${lead.brand && lead.model ? ` del ${lead.brand} ${lead.model}` : ""}.`);
  return <a className="copy-action whatsapp-action" href={`https://wa.me/${digits}?text=${message}`} target="_blank" rel="noreferrer">WhatsApp</a>;
}

function PublicVehicleActions({ vehicle }) {
  const path = publicVehiclePath(vehicle);
  const url = `${window.location.origin}${path}`;
  return <div className="public-vehicle-actions"><a className="text-button" href={path} target="_blank" rel="noreferrer">Abrir ficha</a><CopyAction value={url} label="URL pública" /></div>;
}



function LeadContactActions({ lead, onLoadHistory, onAddAppointment, onCreateQuote }) {
  const [events, setEvents] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = async () => { const next = !historyOpen; setHistoryOpen(next); if (next && !events) setEvents(await onLoadHistory(lead.id)); };
  return <div className="lead-history">{lead.appointmentId && <LeadAppointmentBadge lead={lead} />}<div className="lead-history-actions"><WhatsAppAction lead={lead} /><CopyAction value={lead.phone} label="teléfono" /><CopyAction value={lead.email} label="correo" /><button className="text-button" type="button" onClick={toggleHistory}>{historyOpen ? "Ocultar historial" : "Ver historial"}</button>{lead.vehicleId && !lead.appointmentId && <button className="text-button appointment-inline-action" type="button" onClick={() => onAddAppointment?.(lead)}>Agendar cita</button>}{lead.vehicleId && <button className="text-button quote-inline-action" type="button" onClick={() => onCreateQuote?.(lead)}>Crear cotización</button>}</div>{historyOpen && <div className="lead-events">{events?.length ? events.map((event) => <div className="lead-event" key={event.id}><strong>{event.eventType}</strong><span>{event.note || "Sin detalle"}</span><small>{formatDate(event.createdAt)} · {event.actorName || "Sistema"}</small></div>) : <span>{events ? "Aún no hay eventos registrados." : "Cargando historial…"}</span>}</div>}</div>;
}

function LeadAppointmentModal({ lead, onClose, onCreate }) {
  const [form, setForm] = useState({ date: "", time: "", notes: "" });
  const [availability, setAvailability] = useState({ loading: false, slots: [], message: "Selecciona una fecha." });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useAdminDialog(onClose);
  useEffect(() => {
    if (!form.date) { setAvailability({ loading: false, slots: [], message: "Selecciona una fecha." }); return undefined; }
    let cancelled = false;
    setAvailability({ loading: true, slots: [], message: "Consultando horarios…" });
    fetch(`${apiUrl}/api/appointments/availability?date=${encodeURIComponent(form.date)}`)
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo consultar la agenda"); return payload.data; })
      .then((data) => { if (!cancelled) setAvailability({ loading: false, slots: data.slots || [], message: data.slots?.some((slot) => slot.available) ? "Selecciona un horario disponible." : "No hay horarios disponibles para ese día." }); })
      .catch((requestError) => { if (!cancelled) setAvailability({ loading: false, slots: [], message: requestError.message }); });
    return () => { cancelled = true; };
  }, [form.date]);
  const submit = async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await onCreate({ leadId: lead.id, ...form }); onClose(); } catch (requestError) { setError(requestError.message); } finally { setSaving(false); } };
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="lead-modal appointment-admin-modal" role="dialog" aria-modal="true" aria-labelledby="lead-appointment-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button><span className="eyebrow">AGENDA COMERCIAL</span><h2 id="lead-appointment-title">Agregar cita.</h2><p className="modal-vehicle">{lead.name} · {lead.brand} {lead.model}</p><form className="lead-form" onSubmit={submit}><div className="lead-form-grid"><label>Fecha<input type="date" min={localIsoDate()} value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value, time: "" }))} required /></label><label>Horario<select value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} disabled={!form.date || availability.loading} required><option value="">{availability.loading ? "Consultando…" : "Selecciona"}</option>{availability.slots.filter((slot) => slot.available).map((slot) => <option value={slot.time} key={slot.time}>{slot.time}</option>)}</select></label></div><p className="appointment-availability-note">{availability.message}</p><label>Notas internas<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Confirmar visita, asesor asignado…" /></label>{error && <p className="state-message error">{error}</p>}<button className="primary-action" type="submit" disabled={saving || availability.loading || !form.time}>{saving ? "Agendando…" : "Confirmar cita"}</button></form></motion.section></motion.div>;
}

function QuoteShareAction({ quote, onShare }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const share = async () => {
    setStatus("Generando…");
    try { const nextUrl = await onShare(quote.id); setUrl(nextUrl); await navigator.clipboard?.writeText(nextUrl); setStatus("Enlace copiado"); } catch (error) { setStatus(mensajeDeError(error, "No se pudo compartir")); }
  };
  return <div className="quote-share-action"><button className="text-button" type="button" onClick={share}>{status === "Generando…" ? status : "Compartir URL"}</button>{url && <><CopyAction value={url} label="URL pública" /><small>{status}</small></>}</div>;
}

function QuotesModule({ quotes, leads, vehicles, loading, onRefresh, onCreate, onStatusChange, onShare, onExport, initialLead }) {
  const initial = { leadId: "", vehicleId: "", customerName: "", customerEmail: "", customerPhone: "", basePriceUsd: "", discountUsd: 0, validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), notes: "" };
  const [form, setForm] = useState(initial);
  useEffect(() => {
    if (!initialLead?.id) return;
    const vehicle = vehicles.find((item) => item.id === initialLead.vehicleId);
    setForm((current) => ({ ...current, leadId: initialLead.id, vehicleId: initialLead.vehicleId || "", customerName: initialLead.name || "", customerEmail: initialLead.email || "", customerPhone: initialLead.phone || "", basePriceUsd: vehicle?.priceUsd ?? current.basePriceUsd }));
  }, [initialLead?.id, initialLead?.vehicleId, initialLead?.name, initialLead?.email, initialLead?.phone, vehicles]);
  const selectedLead = leads.find((lead) => lead.id === form.leadId);
  const total = Math.max(0, Number(form.basePriceUsd || 0) - Number(form.discountUsd || 0));
  const selectLead = (leadId) => { const lead = leads.find((item) => item.id === leadId); const vehicle = vehicles.find((item) => item.id === lead?.vehicleId); setForm((current) => ({ ...current, leadId, vehicleId: lead?.vehicleId || current.vehicleId, customerName: lead?.name || current.customerName, customerEmail: lead?.email || current.customerEmail, customerPhone: lead?.phone || current.customerPhone, basePriceUsd: vehicle?.priceUsd ?? current.basePriceUsd })); };
  const selectVehicle = (vehicleId) => { const vehicle = vehicles.find((item) => item.id === vehicleId); setForm((current) => ({ ...current, vehicleId, basePriceUsd: vehicle?.priceUsd ?? current.basePriceUsd })); };
  const submit = async (event) => { event.preventDefault(); await onCreate(form); setForm(initial); };
  return <section className="records-content quotes-content"><div className="panel-heading"><div><span className="eyebrow">DOCUMENTOS COMERCIALES</span><h2>Cotizaciones.</h2></div><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar</button></div><div className="quotes-layout"><form className="admin-form quote-form" onSubmit={submit}><div className="admin-form-head"><h2>Nueva cotización</h2><span className="quote-total-preview">{formatPrice(total)}</span></div><label>Cliente relacionado<select value={form.leadId} onChange={(event) => selectLead(event.target.value)}><option value="">Seleccionar cliente (opcional)</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}{lead.brand ? ` · ${lead.brand} ${lead.model}` : ""}</option>)}</select></label><label>Vehículo<select value={form.vehicleId} onChange={(event) => selectVehicle(event.target.value)}><option value="">Seleccionar vehículo</option>{vehicles.filter((vehicle) => ["published", "reserved"].includes(vehicle.status)).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.year}</option>)}</select></label><div className="form-grid"><label>Cliente<input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} required /></label><label>Correo<input type="email" value={form.customerEmail} onChange={(event) => setForm({ ...form, customerEmail: event.target.value })} /></label><label>Teléfono<input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></label><label>Vigente hasta<input type="date" value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} /></label><label>Precio base<input type="number" min="0" step="0.01" value={form.basePriceUsd} onChange={(event) => setForm({ ...form, basePriceUsd: event.target.value })} required /></label><label>Descuento<input type="number" min="0" step="0.01" value={form.discountUsd} onChange={(event) => setForm({ ...form, discountUsd: event.target.value })} /></label></div><label>Notas para el cliente<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Garantía, condiciones, entrega…" /></label><button className="primary-action" type="submit">Guardar cotización</button>{selectedLead && <small>Se creará vinculada al seguimiento de {selectedLead.name}.</small>}</form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">HISTORIAL · {quotes.length.toString().padStart(2, "0")}</span><h3>Propuestas emitidas</h3></div></div>{loading ? <p className="empty-state">Cargando cotizaciones…</p> : quotes.length ? <div className="quotes-list">{quotes.map((quote) => <article className="quote-admin-row" key={quote.id}><div className="quote-admin-main"><span className="eyebrow">{quote.quoteNumber}</span><strong>{quote.customerName}</strong><span>{quote.brand ? `${quote.brand} ${quote.model} · ${quote.year}` : "Sin vehículo"}</span><small>{quote.customerEmail || quote.customerPhone || "Sin contacto"} · Vigente {formatDate(quote.validUntil)}</small></div><div className="quote-admin-total"><strong>{formatPrice(quote.totalUsd)}</strong><span>Base {formatPrice(quote.basePriceUsd)}{Number(quote.discountUsd) ? ` · -${formatPrice(quote.discountUsd)}` : ""}</span></div><div className="quote-admin-actions"><select value={quote.status} onChange={(event) => onStatusChange(quote.id, event.target.value)} aria-label={`Estado de ${quote.quoteNumber}`}><option value="draft">Borrador</option><option value="sent">Enviada</option><option value="accepted">Aceptada</option><option value="expired">Vencida</option><option value="cancelled">Cancelada</option></select><button className="text-button" type="button" onClick={() => window.print()}>Imprimir</button>{onShare && !["cancelled", "expired"].includes(quote.status) && <QuoteShareAction quote={quote} onShare={onShare} />}</div></article>)}</div> : <p className="empty-state">Aún no hay cotizaciones guardadas.</p>}</section></div></section>;
}

function LeadsModule({ records, users, loading, onRefresh, onUpdate, onLoadHistory, onAddAppointment, onCreateQuote, onDirtyChange, initialLeadId = "", attentionFilter = "all" }) {
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const focusedLeadRef = useRef(null);
  const draftFor = (lead) => drafts[lead.id] || { status: lead.status, notes: lead.notes || "", assignedTo: lead.assignedToId || "", priority: lead.priority || 2, nextAction: lead.nextAction || "", nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt).toISOString().slice(0, 16) : "", lostReason: lead.lostReason || "" };
  const setDraft = (lead, field, value) => setDrafts((current) => ({ ...current, [lead.id]: { ...draftFor(lead), [field]: value } }));
  useEffect(() => {
    const dirty = Object.keys(drafts).length > 0;
    onDirtyChange?.(dirty);
    window.dispatchEvent(new CustomEvent("authentiq:lead-dirty", { detail: dirty }));
  }, [drafts, onDirtyChange]);
  useEffect(() => {
    const guard = (event) => { if (Object.keys(drafts).length > 0) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [drafts]);
  useEffect(() => {
    if (!initialLeadId) return undefined;
    setQuery("");
    setStatusFilter("all");
    const timer = window.setTimeout(() => focusedLeadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(timer);
  }, [initialLeadId]);
  useEffect(() => {
    setDrafts((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(current).forEach(([id, draft]) => {
        const saved = records.find((lead) => lead.id === id);
        const savedNextActionAt = saved?.nextActionAt ? new Date(saved.nextActionAt).toISOString().slice(0, 16) : "";
        if (saved && draft.status === saved.status && draft.notes === (saved.notes || "") && draft.assignedTo === (saved.assignedToId || "") && Number(draft.priority) === Number(saved.priority || 2) && draft.nextAction === (saved.nextAction || "") && draft.nextActionAt === savedNextActionAt && draft.lostReason === (saved.lostReason || "")) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [records]);
  const visibleRecords = records.filter((lead) => { const haystack = `${lead.name} ${lead.email || ""} ${lead.phone || ""} ${lead.brand || ""} ${lead.model || ""}`.toLowerCase(); const overdue = lead.nextActionAt && new Date(lead.nextActionAt).getTime() < Date.now(); const noAction = !lead.nextActionAt; const attentionMatches = attentionFilter === "all" || (attentionFilter === "overdue" && overdue) || (attentionFilter === "no_action" && noAction) || (attentionFilter === "planned" && !noAction && !overdue); return (statusFilter === "all" || lead.status === statusFilter) && attentionMatches && haystack.includes(query.toLowerCase()); });
  const exportLeads = () => { const csv = ["Nombre,Correo,Telefono,Estado,Origen,Vehiculo,Recibido", ...visibleRecords.map((lead) => [lead.name, lead.email, lead.phone, lead.status, lead.source, `${lead.brand || ""} ${lead.model || ""}`, formatDate(lead.createdAt)].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(","))].join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = `zevroa-leads-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); };
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>Clientes.</h2></div><div className="panel-actions"><button type="button" className="secondary-action" onClick={exportLeads}>Exportar CSV</button><button type="button" className="secondary-action" onClick={onRefresh}>Actualizar</button></div></div><div className="lead-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, correo o vehículo…" aria-label="Buscar clientes" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar clientes por estado"><option value="all">Todos los estados</option><option value="new">Nuevos</option><option value="contacted">Contactados</option><option value="qualified">Calificados</option><option value="closed">Cerrados</option><option value="lost">Perdidos</option></select><span>{visibleRecords.length} de {records.length} clientes</span></div>{loading ? <p className="empty-state">Cargando clientes…</p> : visibleRecords.length ? <div className="leads-list">{visibleRecords.map((lead) => { const draft = draftFor(lead); return <article className={`lead-row${lead.id === initialLeadId ? " is-focused" : ""}`} ref={lead.id === initialLeadId ? focusedLeadRef : undefined} key={lead.id}><div className="lead-main"><div className="lead-heading"><strong>{lead.name}</strong><span className={`status-pill ${draft.status}`}>{formatStatus(draft.status)}</span><span className={`priority-mark p${draft.priority}`} title={`Prioridad ${formatPriority(draft.priority)}`}>{formatPriority(draft.priority)}</span></div><span>{lead.email || "Sin correo"} · {lead.phone || "Sin teléfono"}</span><span>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"} · {formatLeadSource(lead.source)}</span><LeadContactActions lead={lead} onLoadHistory={onLoadHistory} onAddAppointment={onAddAppointment} onCreateQuote={onCreateQuote} />{lead.nextAction && <p className="lead-next-action">Próxima acción: {lead.nextAction}{lead.nextActionAt ? ` · ${formatDateTime(lead.nextActionAt)}` : ""}</p>}{lead.message && <p>{lead.message}</p>}</div><div className="lead-management"><label>Estado<select value={draft.status} onChange={(event) => setDraft(lead, "status", event.target.value)}><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option><option value="lost">Perdido</option></select></label><label>Prioridad<select value={draft.priority} onChange={(event) => setDraft(lead, "priority", Number(event.target.value))}><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option></select></label><label>Asignar a<select value={draft.assignedTo} onChange={(event) => setDraft(lead, "assignedTo", event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {formatRole(user.role)}</option>)}</select></label><label>Próxima acción<input value={draft.nextAction} onChange={(event) => setDraft(lead, "nextAction", event.target.value)} placeholder="Llamar y confirmar presupuesto" /></label><label>Vencimiento<input type="datetime-local" value={draft.nextActionAt} onChange={(event) => setDraft(lead, "nextActionAt", event.target.value)} /></label>{draft.status === "lost" && <label>Motivo de pérdida<input value={draft.lostReason} onChange={(event) => setDraft(lead, "lostReason", event.target.value)} placeholder="Precio, sin respuesta, otro vehículo…" required /></label>}<label>Notas internas<textarea value={draft.notes} onChange={(event) => setDraft(lead, "notes", event.target.value)} placeholder="Seguimiento…" /></label><button type="button" className="primary-action" onClick={() => onUpdate(lead.id, draft)}>Guardar seguimiento</button><small>Recibido {formatDate(lead.createdAt)}</small></div></article>; })}</div> : <p className="empty-state">No hay clientes que coincidan.</p>}</section>;
}

function VirtualizedClientRow({ lead, onLoadHistory, onAddAppointment, onCreateQuote }) {
  return <article className={`lead-row lead-virtual-row${lead.status === "new" ? " is-new" : ""}`}>
    <div className="lead-main"><div className="lead-heading"><strong>{lead.name}</strong><span className={`status-pill ${lead.status}`}>{formatStatus(lead.status)}</span><span className={`priority-mark p${lead.priority || 2}`}>{formatPriority(lead.priority || 2)}</span></div><span>{lead.email || "Sin correo"} · {lead.phone || "Sin teléfono"}</span><span>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"} · {formatLeadSource(lead.source)}</span><LeadContactActions lead={lead} onLoadHistory={onLoadHistory} onAddAppointment={onAddAppointment} onCreateQuote={onCreateQuote} /></div>
    <div className="lead-virtual-summary"><span>{lead.nextAction ? `Próxima acción: ${lead.nextAction}` : "Sin próxima acción"}</span><small>{lead.nextActionAt ? formatDateTime(lead.nextActionAt) : `Recibido ${formatDate(lead.createdAt)}`}</small></div>
  </article>;
}

function VirtualizedLeadsModule({ records, loading, onRefresh, onLoadHistory, onAddAppointment, onCreateQuote }) {
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>Clientes.</h2><p className="module-note">Lista optimizada para grandes volúmenes. Abre un cliente para editar su seguimiento.</p></div><button type="button" className="secondary-action" onClick={onRefresh}>Actualizar</button></div>{loading ? <p className="empty-state">Cargando clientes…</p> : records.length ? <VirtualizedList items={records} renderItem={(lead) => <VirtualizedClientRow lead={lead} onLoadHistory={onLoadHistory} onAddAppointment={onAddAppointment} onCreateQuote={onCreateQuote} />} className="leads-list" estimateSize={150} /> : <p className="empty-state">No hay clientes.</p>}</section>;
}

function BlogModule({ posts, form, editingId, loading, message, onChange, onSave, onEdit, onCancel, onArchive, onRefresh }) {
  return <div className="blog-content"><div className="blog-layout"><form className="admin-form" onSubmit={onSave}><div className="admin-form-head"><h2>{editingId ? "Editar artículo" : "Nuevo artículo"}</h2>{editingId && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}</div><label>Título<input value={form.title} onChange={(event) => onChange("title", event.target.value)} required /></label><label>Enlace del artículo<input value={form.slug} onChange={(event) => onChange("slug", event.target.value)} placeholder="se-genera-del-titulo" /></label><div className="form-grid"><label>Categoría<input value={form.category || ""} onChange={(event) => onChange("category", event.target.value)} placeholder="Guías, cultura, compra" /></label><label>Etiquetas<input value={Array.isArray(form.tags) ? form.tags.join(", ") : (form.tags || "")} onChange={(event) => onChange("tags", event.target.value)} placeholder="Porsche, eléctrico, consejos" /></label></div><label>Resumen<textarea value={form.summary} onChange={(event) => onChange("summary", event.target.value)} /></label><label>Contenido<textarea className="blog-content-input" value={form.content} onChange={(event) => onChange("content", event.target.value)} required /></label><label>Imagen de portada<input value={form.coverImageUrl} onChange={(event) => onChange("coverImageUrl", event.target.value)} placeholder="/assets/editorial.jpg" /></label><div className="form-grid"><label>Título para Google<input value={form.seoTitle} onChange={(event) => onChange("seoTitle", event.target.value)} /></label><label>Estado<select value={form.status} onChange={(event) => onChange("status", event.target.value)}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option></select></label></div><label>Descripción para Google<textarea value={form.seoDescription} onChange={(event) => onChange("seoDescription", event.target.value)} /></label>{message && <p className="form-message">{message}</p>}<button className="primary-action" type="submit">{editingId ? "Guardar artículo" : "Crear artículo"}</button></form><section className="table-panel"><div className="panel-heading"><div><span className="eyebrow">CONTENIDO EDITORIAL</span><h3>Artículos ({posts.length})</h3></div><button type="button" className="text-button" onClick={onRefresh}>Actualizar</button></div>{loading ? <p className="empty-state">Cargando artículos…</p> : posts.length ? <div className="blog-list">{posts.map((post) => <article className="blog-admin-row" key={post.id}>{post.coverImageUrl && <img src={post.coverImageUrl} alt={`Portada de ${post.title}`} />}{!post.coverImageUrl && <div className="blog-admin-placeholder" />}<div><strong>{post.title}</strong><span>{formatStatus(post.status)} · Enlace: {post.slug}</span><div><button type="button" className="text-button" onClick={() => onEdit(post)}>Editar</button><button type="button" className="text-button danger-text" onClick={() => onArchive(post.id)}>Archivar</button></div></div></article>)}</div> : <p className="empty-state">Aún no hay artículos.</p>}</section></div></div>;
}

function AuditModule({ logs, loading, onRefresh }) {
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">SEGURIDAD · ADMINISTRACIÓN</span><h2>Actividad.</h2></div><button type="button" className="secondary-action" onClick={onRefresh}>Actualizar</button></div>{loading ? <p className="empty-state">Cargando auditoría…</p> : logs.length ? <div className="audit-list">{logs.map((log) => <article className="audit-row" key={log.id}><span className="audit-time">{formatDate(log.createdAt)}</span><div><strong>{log.action}</strong><span>{log.entityType} · {log.actorName || log.actorEmail || "Sistema"}</span></div><code>{JSON.stringify(log.metadata || {})}</code></article>)}</div> : <p className="empty-state">Aún no hay acciones registradas.</p>}</section>;
}

function PasswordResetResult({ result, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(result.temporaryPassword); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } };
  return <div className="password-reset-result"><span className="eyebrow">CONTRASEÑA TEMPORAL · {result.name}</span><code>{result.temporaryPassword}</code><p>Entrégala en persona o por un canal seguro. No se guarda ni se muestra de nuevo: {result.email} deberá cambiarla en su próximo ingreso.</p><div><button className="secondary-action" type="button" onClick={copy}>{copied ? "Copiada ✓" : "Copiar"}</button><button className="text-button" type="button" onClick={onDismiss}>Cerrar</button></div></div>;
}

function UsersModule({ users, form, onChange, onSave, onUpdate, onResetPassword, onDelete, onInvite, onMfaSetup, loading, message }) {
  const { confirm } = useAdminConfirm();
  const [resetResult, setResetResult] = useState(null);
  const [resettingId, setResettingId] = useState("");
  const [invite, setInvite] = useState({ fullName: "", email: "", role: "seller" });
  const [inviteState, setInviteState] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [mfaState, setMfaState] = useState(null);
  const requestReset = async (user) => {
    if (!(await confirm({ title: "Restablecer contraseña", message: `Se generará una contraseña temporal para ${user.name}. Su contraseña actual dejará de funcionar.`, confirmLabel: "Generar contraseña" }))) return;
    setResettingId(user.id);
    try { setResetResult(await onResetPassword(user.id)); } finally { setResettingId(""); }
  };
  const requestDelete = async (user) => {
    if (!(await confirm({ title: "Eliminar usuario", message: `Eliminarás definitivamente a ${user.name}. Esta acción no se puede deshacer.`, confirmLabel: "Eliminar usuario", danger: true }))) return;
    onDelete?.(user);
  };
  const submitInvite = async (event) => { event.preventDefault(); setInviteLoading(true); setInviteState(""); try { await onInvite?.(invite); setInvite({ fullName: "", email: "", role: "seller" }); setInviteState("Invitación enviada. El enlace vence en 72 horas."); } catch (error) { setInviteState(mensajeDeError(error)); } finally { setInviteLoading(false); } };
  const startMfa = async () => { setInviteState(""); try { setMfaState(await onMfaSetup?.()); } catch (error) { setInviteState(mensajeDeError(error)); } };
  const verifyMfa = async (event) => { event.preventDefault(); try { const formData = new FormData(event.target); const result = await onMfaSetup?.({ setupToken: mfaState.setupToken, code: formData.get("code") }); setMfaState({ recoveryCodes: result?.recoveryCodes || [] }); } catch (error) { setInviteState(mensajeDeError(error)); } };
  return (
    <section className="records-content">
      <div className="panel-heading"><div><span className="eyebrow">ACCESOS · EQUIPO</span><h2>Usuarios.</h2></div></div>
      {resetResult && <PasswordResetResult result={resetResult} onDismiss={() => setResetResult(null)} />}
       <div className="security-setup-panel"><div><span className="eyebrow">SEGURIDAD DEL EQUIPO</span><h3>Invita sin compartir contraseñas.</h3><p>El miembro crea su propia clave desde un enlace de un solo uso. Activa MFA para proteger esta cuenta.</p></div><button className="secondary-action" type="button" onClick={startMfa}>Activar MFA</button>{mfaState?.setupToken && <form className="security-mfa-form" onSubmit={verifyMfa}><label>Código de tu autenticador<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required placeholder="000000" /></label><button className="primary-action" type="submit">Confirmar MFA</button><p>Clave manual: <code>{mfaState.secret}</code></p></form>}{mfaState?.recoveryCodes?.length > 0 && <div className="recovery-codes" role="status"><strong>Guarda estos códigos de recuperación.</strong><span>{mfaState.recoveryCodes.join(" · ")}</span></div>}</div><form className="admin-form invite-form" onSubmit={submitInvite}><div className="admin-form-head"><h2>Invitar al equipo</h2></div><label>Nombre<input value={invite.fullName} onChange={(event) => setInvite((current) => ({ ...current, fullName: event.target.value }))} required /></label><label>Correo<input type="email" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} required /></label><label>Rol<select value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value }))}><option value="seller">Ventas</option><option value="editor">Editor</option><option value="content_editor">Contenido</option><option value="admin">Administrador</option></select></label>{inviteState && <p className="form-message" role="status">{inviteState}</p>}<button className="primary-action" type="submit" disabled={inviteLoading}>{inviteLoading ? "Enviando…" : "Enviar invitación"}</button></form><div className="admin-layout users-layout">
        <form className="admin-form" onSubmit={onSave}>
          <div className="admin-form-head"><h2>Nuevo usuario</h2></div>
          <label>Nombre<input value={form.name} onChange={(event) => onChange("name", event.target.value)} required /></label>
          <label>Correo<input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} required /></label>
          <label>Contraseña inicial<input type="password" minLength="8" value={form.password} onChange={(event) => onChange("password", event.target.value)} required /></label>
          <label>Rol<select value={form.role} onChange={(event) => onChange("role", event.target.value)}><option value="seller">Ventas</option><option value="editor">Editor</option><option value="content_editor">Contenido</option><option value="admin">Administrador</option></select></label>
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-action" type="submit">Crear usuario</button>
        </form>
        <section className="table-panel">
          <div className="panel-heading"><div><span className="eyebrow">USUARIOS REGISTRADOS</span><h3>{users.length} cuentas</h3></div></div>
          {loading ? <p className="empty-state">Cargando usuarios…</p> : <div className="user-list">{users.map((user) => <article className={`user-row ${user.isActive ? "" : "is-inactive"}`} key={user.id}>
            <div><strong>{user.name}</strong><span>{user.email} · {formatRole(user.role)}</span></div>
            <div>
              <select value={user.role} onChange={(event) => onUpdate(user, { role: event.target.value, isActive: user.isActive })} aria-label={`Rol de ${user.name}`}><option value="seller">Ventas</option><option value="editor">Editor</option><option value="content_editor">Contenido</option><option value="admin">Administrador</option></select>
              <button className="text-button" type="button" onClick={() => requestReset(user)} disabled={resettingId === user.id}>{resettingId === user.id ? "Generando…" : "Restablecer contraseña"}</button>
              <button className="text-button" type="button" onClick={() => onUpdate(user, { role: user.role, isActive: !user.isActive })}>{user.isActive ? "Desactivar" : "Activar"}</button>
              {!user.isActive && <button className="text-button" type="button" onClick={() => requestDelete(user)}>Eliminar</button>}
            </div>
          </article>)}</div>}
        </section>
      </div>
    </section>
  );
}

function AppointmentSettingsFields({ form, onChange }) {
  const days = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [7, "Dom"]];
  const selectedDays = Array.isArray(form.appointmentDays) ? form.appointmentDays : [1, 2, 3, 4, 5, 6];
  const toggleDay = (day) => onChange("appointmentDays", selectedDays.includes(day) ? selectedDays.filter((item) => item !== day) : [...selectedDays, day].sort((a, b) => a - b));
  return <div className="settings-section appointment-settings"><span className="eyebrow">AGENDA DE CITAS</span><p className="settings-section-note">Define cuándo puede reservar un comprador y cuántas visitas puede atender el equipo al mismo tiempo.</p><div className="form-grid"><label>Inicio<input type="time" value={form.appointmentStart || "09:00"} onChange={(event) => onChange("appointmentStart", event.target.value)} /></label><label>Cierre<input type="time" value={form.appointmentEnd || "18:00"} onChange={(event) => onChange("appointmentEnd", event.target.value)} /></label><label>Duración (minutos)<input type="number" min="15" max="240" step="15" value={form.appointmentDurationMinutes || 60} onChange={(event) => onChange("appointmentDurationMinutes", Number(event.target.value))} /></label><label>Antelación mínima (horas)<input type="number" min="0" max="720" value={form.appointmentMinNoticeHours ?? 2} onChange={(event) => onChange("appointmentMinNoticeHours", Number(event.target.value))} /></label><label>Máximo de días para reservar<input type="number" min="1" max="365" value={form.appointmentMaxDaysAhead || 30} onChange={(event) => onChange("appointmentMaxDaysAhead", Number(event.target.value))} /></label><label>Citas simultáneas<input type="number" min="1" max="20" value={form.appointmentCapacity || 1} onChange={(event) => onChange("appointmentCapacity", Number(event.target.value))} /></label></div><div className="appointment-days"><span>Días disponibles</span><div>{days.map(([day, label]) => <button className={selectedDays.includes(day) ? "is-active" : ""} type="button" key={day} onClick={() => toggleDay(day)} aria-pressed={selectedDays.includes(day)}>{label}</button>)}</div></div></div>;
}



// Fuente única de verdad de la personalización: el asistente de bienvenida y el
// panel de Configuración deben contar los mismos bloques y el mismo porcentaje.
// Antes cada uno tenía su propia lista y mostraban cifras distintas del mismo estado.
const onboardingGroups = [
  { id: "brand", label: "Tu marca", hint: "Cómo se llama y cómo se ve tu concesionario.", destination: "settings" },
  { id: "showcase", label: "Tu vitrina", hint: "Lo que el comprador va a mirar.", destination: "inventory" },
  { id: "operation", label: "Tu operación", hint: "Cómo te contactan y cuándo te visitan.", destination: "settings" },
];

// El progreso siempre se mide sobre lo esencial: lo opcional (dominio propio,
// redes) no debe hacer sentir al concesionario que su showroom está incompleto.
function buildOnboardingGroups(onboarding) {
  const steps = onboarding?.steps || [];
  const groups = onboardingGroups
    .map((group) => {
      const groupSteps = steps.filter((step) => (step.group || "operation") === group.id);
      const essential = groupSteps.filter((step) => step.essential);
      const pending = essential.filter((step) => !step.done);
      const done = groupSteps.length > 0 && pending.length === 0;
      // El asistente necesita una frase: si falta algo, dice exactamente qué falta.
      const detail = done ? group.hint : `Falta: ${pending.slice(0, 2).map((step) => step.label.toLowerCase()).join(" · ")}${pending.length > 2 ? ` · +${pending.length - 2}` : ""}`;
      return { ...group, steps: groupSteps, essentialTotal: essential.length, essentialDone: essential.length - pending.length, done, detail, nextStep: groupSteps.find((step) => step.essential && !step.done) || groupSteps.find((step) => !step.done) };
    })
    .filter((group) => group.steps.length > 0);
  const essentialTotal = Number(onboarding?.essentialTotal ?? steps.filter((step) => step.essential).length);
  const essentialDone = Number(onboarding?.essentialDone ?? steps.filter((step) => step.essential && step.done).length);
  return { groups, essentialTotal, essentialDone, ready: essentialTotal > 0 && essentialDone === essentialTotal, progress: essentialTotal ? Math.round((essentialDone / essentialTotal) * 100) : 100 };
}

function OnboardingPanel({ onboarding, onNavigate, onOpenPublic }) {
  if (!onboarding) return null;
  const destinations = { identity: "settings", logo: "settings", contact: "settings", appointments: "settings", social: "integrations", legal: "settings", domain: "settings", catalog: "inventory" };
  const steps = onboarding.steps || [];
  const { groups, essentialTotal, essentialDone, ready, progress: essentialProgress } = buildOnboardingGroups(onboarding);
  const nextStep = steps.find((step) => step.essential && !step.done) || steps.find((step) => !step.done);
  const goToStep = (step) => {
    onNavigate?.(destinations[step.id] || "settings");
    window.setTimeout(() => document.querySelector(".settings-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  return <section className="onboarding-panel" aria-label="Estado de personalización del showroom">
    <div className="onboarding-heading"><div><span className="eyebrow">PERSONALIZAR TU SHOWROOM</span><h3>{ready ? "Tu showroom está listo para recibir compradores." : (essentialTotal - essentialDone === 1 ? "Falta 1 ajuste para poder abrir." : `Faltan ${essentialTotal - essentialDone} ajustes para poder abrir.`)}</h3><p>{ready ? "Lo esencial ya está. Lo demás son mejoras que puedes hacer cuando quieras." : "Solo lo esencial. Lo opcional queda debajo y no bloquea nada."}</p></div><div className="onboarding-heading-meta"><strong>{essentialProgress}%</strong><small>{essentialDone}/{essentialTotal} ajustes esenciales</small></div></div>
    <div className="onboarding-progress"><span style={{ width: `${essentialProgress}%` }} /></div>
    <div className="onboarding-groups">{groups.map((group) => {
      return <div className="onboarding-group" key={group.id}>
        <div className="onboarding-group-head"><strong>{group.label}</strong><small>{group.hint}</small></div>
        <div className="onboarding-steps">{group.steps.map((step) => <div className={step.done ? "onboarding-step is-done" : step.essential ? "onboarding-step is-required" : "onboarding-step is-optional"} key={step.id}><span aria-hidden="true">{step.done ? "✓" : step.essential ? "!" : "+"}</span><div><strong>{step.label}{!step.essential && !step.done && <em> · opcional</em>}</strong><small>{step.detail}</small></div><button type="button" onClick={() => goToStep(step)}>{step.done ? "Revisar" : "Configurar"} →</button></div>)}</div>
      </div>;
    })}</div>
    {ready ? <div className="onboarding-complete"><span>✓</span><div><strong>Lista para enseñar</strong><p>Abre el catálogo público y compruébalo como lo verá un comprador.</p></div><button className="onboarding-next-action" type="button" onClick={onOpenPublic}>Abrir catálogo ↗</button></div> : nextStep && <button className="onboarding-next-action" type="button" onClick={() => goToStep(nextStep)}>Continuar con {nextStep.label.toLowerCase()} →</button>}
  </section>;
}

const onboardingDestinations = { identity: "settings", logo: "settings", contact: "settings", appointments: "settings", social: "integrations", legal: "settings", domain: "settings", catalog: "inventory" };
const onboardingMeta = {
  identity: { eyebrow: "01 · IDENTIDAD", title: "Presenta una marca que se sienta propia.", copy: "Define el nombre, slug y base comercial del concesionario para que todo lo demás parta de la misma identidad." },
  logo: { eyebrow: "02 · RECONOCIMIENTO", title: "Haz que te reconozcan desde el primer vistazo.", copy: "Sube el logo que aparecerá en la navegación, las fichas y la experiencia pública del comprador." },
  contact: { eyebrow: "03 · CONVERSIÓN", title: "Deja tus canales a una acción de distancia.", copy: "Añade teléfono, WhatsApp, correo, dirección y horario para que cada consulta tenga una respuesta clara." },
  catalog: { eyebrow: "04 · INVENTARIO", title: "Construye la vitrina que vas a vender.", copy: "Crea tu primer vehículo, administra marcas y publica fichas con fotos, vídeo o modelo 3D." },
  appointments: { eyebrow: "05 · SHOWROOM", title: "Abre la puerta a las visitas.", copy: "Define horarios, duración, antelación y capacidad para que el comprador pueda reservar sin llamadas." },
  social: { eyebrow: "06 · ALCANCE", title: "Conecta la conversación con tus redes.", copy: "Guarda los perfiles de Instagram y Facebook y prepara publicaciones por vehículo desde un solo lugar." },
  legal: { eyebrow: "07 · CONFIANZA", title: "Publica con la información correcta.", copy: "Revisa privacidad y términos antes de compartir el showroom con compradores reales." },
  domain: { eyebrow: "08 · DOMINIO", title: "Pon tu nombre en la dirección.", copy: "Conecta el dominio del dealer cuando estés listo. Es opcional para empezar y no bloquea la configuración." },
};

function WelcomeOnboarding({ onboarding, organization, onNavigate, onDismiss, onOpenPublic }) {
  useAdminDialog(onDismiss);
  const { groups: displaySteps, essentialTotal, essentialDone, ready, progress } = buildOnboardingGroups(onboarding);
  const firstPending = displaySteps.find((step) => !step.done);
  const [selectedId, setSelectedId] = useState(firstPending?.id || displaySteps[0]?.id);
  const selected = displaySteps.find((step) => step.id === selectedId) || firstPending || displaySteps[0];
  const selectedIndex = Math.max(0, displaySteps.findIndex((step) => step.id === selected?.id));
  const isComplete = ready;
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", closeOnEscape); };
  }, [onDismiss]);
  const openSelected = () => { onDismiss(); onNavigate?.(selected.destination); };
  const pendingInSelected = selected ? selected.essentialTotal - selected.essentialDone : 0;
  return <motion.div className="welcome-onboarding-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section className="welcome-onboarding" role="dialog" aria-modal="true" aria-labelledby="welcome-onboarding-title" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ duration: .28, ease: [0.22, 1, 0.36, 1] }}>
      <header className="welcome-onboarding-header">
        <div>
          <span className="eyebrow">PERSONALIZA TU SHOWROOM</span>
          <h2 id="welcome-onboarding-title">{organization?.name || "Tu showroom"}<br /><em>empieza aquí.</em></h2>
          <p>Son {essentialTotal} ajustes esenciales repartidos en {displaySteps.length} bloques. Puedes hacerlos en cualquier orden y volver cuando quieras.</p>
        </div>
        <button className="welcome-onboarding-close" type="button" onClick={onDismiss} aria-label="Cerrar personalización">×</button>
      </header>
      <div className="welcome-onboarding-progress">
        <span><b>{progress}%</b> configurado</span>
        <div><motion.i initial={false} animate={{ width: `${progress}%` }} transition={{ duration: .6, ease: [0.22, 1, 0.36, 1] }} /></div>
        <small>{essentialDone} de {essentialTotal} ajustes esenciales</small>
      </div>
      <div className="welcome-onboarding-layout">
        {/* La barra lateral lista los bloques *y* los ajustes que contiene cada uno:
            sin esto el dealer lee "3 de 6" pero solo ve tres filas y no cuadra la cuenta. */}
        <aside className="welcome-onboarding-list" aria-label="Áreas de configuración">
          {displaySteps.map((step, index) => {
            const isSelected = step.id === selected.id;
            return <motion.div
              className={`welcome-onboarding-block${isSelected ? " is-selected" : ""}${step.done ? " is-done" : ""}`}
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: .32, delay: .06 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
            >
              <button type="button" onClick={() => setSelectedId(step.id)} aria-expanded={isSelected} aria-controls={`welcome-block-${step.id}`}>
                <span className={step.done ? "welcome-step-number is-done" : "welcome-step-number"}>{step.done ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <span className="welcome-block-copy">
                  <strong>{step.label}</strong>
                  <small>{step.done ? "Completado · puedes revisarlo" : step.detail}</small>
                </span>
                <span className={`welcome-block-count${step.done ? " is-done" : ""}`}>{step.essentialDone}/{step.essentialTotal}</span>
              </button>
              <ul className="welcome-block-items" id={`welcome-block-${step.id}`}>
                {step.steps.map((item) => <li key={item.id} className={item.done ? "is-done" : item.essential ? "is-pending" : "is-optional"}>
                  <span aria-hidden="true">{item.done ? "✓" : item.essential ? "!" : "+"}</span>
                  <span>{item.label}{!item.essential && <em> · opcional</em>}</span>
                </li>)}
              </ul>
            </motion.div>;
          })}
        </aside>
        <div className="welcome-onboarding-detail">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selected?.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="eyebrow">{String(selectedIndex + 1).padStart(2, "0")} · {selected.label.toUpperCase()}</span>
              <h3>{isComplete ? "Todo listo para presentar." : `Prepara ${selected.label.toLowerCase()}.`}</h3>
              <p>{isComplete ? "Tu identidad, operación y vitrina ya están configuradas. Mira ahora la experiencia desde el lado del comprador." : selected.hint}</p>
              {/* La barra lateral ya enumera los ajustes; aquí se explica solo el
                  siguiente y por qué importa, en vez de repetir la misma lista. */}
              <div className="welcome-onboarding-surface">
                <div className="welcome-surface-mark">{organization?.logoUrl ? <img src={organization.logoUrl} alt="" /> : <span>{(organization?.name || "A").slice(0, 2).toUpperCase()}</span>}</div>
                <div>
                  <small>{isComplete ? "SIGUIENTE PASO" : selected.done ? "TODO LISTO EN ESTE BLOQUE" : "LO SIGUIENTE"}</small>
                  <strong>{isComplete ? "Abrir el showroom público" : selected.done ? "Puedes revisarlo cuando quieras" : (selected.nextStep?.label || "Revisar este bloque")}</strong>
                  <p>{isComplete
                    ? "Comprueba que el showroom se vea y se sienta como propio."
                    : selected.done
                      ? "Este bloque ya está completo. Entra si quieres cambiar algo."
                      : `${selected.nextStep?.detail || ""} Quedan ${pendingInSelected} de ${selected.essentialTotal} en este bloque.`}</p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
          <div className="welcome-onboarding-actions">
            <button className="primary-action" type="button" onClick={isComplete ? onOpenPublic : openSelected}>{isComplete ? "Abrir showroom público ↗" : `${selected.done ? "Revisar" : "Configurar"} ${selected.label.toLowerCase()} →`}</button>
            <button className="text-button" type="button" onClick={onDismiss}>Seguir explorando el panel</button>
          </div>
        </div>
      </div>
      <footer className="welcome-onboarding-footer"><span>Los cambios se guardan por concesionario.</span><span>Centro de inicio disponible desde el panel.</span></footer>
    </motion.section>
  </motion.div>;
}

function SubscriptionModule({ billing, plans = [], health, onRefresh, onStartBillingCheckout }) {
  const current = billing || {};
  const currentPlan = plans.find((plan) => plan.code === current.planCode);
  const vehicleLimit = current.vehicleLimit ?? currentPlan?.vehicleLimit;
  const vehicleUsage = Number(current.vehicleUsage || 0);
  const monthlyAmount = Number(current.monthlyAmount || 0);
  const usagePercent = vehicleLimit ? Math.min(100, Math.round((vehicleUsage / Number(vehicleLimit)) * 100)) : 0;
  const checkoutReady = Boolean(current.checkoutReady || health?.billing?.configured);
  const statusLabels = { trialing: "Prueba activa", active: "Activa", past_due: "Pago pendiente", cancelled: "Cancelada" };
  const displayPlans = plans.length ? plans : [{ code: "starter", name: "Starter", description: "Para comenzar con una vitrina digital ordenada.", monthlyAmount: 99, vehicleLimit: 40, features: ["Showroom white-label", "Inventario y leads", "Agenda de citas"] }];
  return (
    <section className="records-content subscription-content">
      <header className="subscription-header">
        <div><span className="eyebrow">CUENTA / SUSCRIPCIÓN</span><h2>Tu plan, claro desde el primer día.</h2><p>Revisa qué tienes activo, cuánto inventario estás usando y cuándo tiene sentido crecer.</p></div>
        <div className={`subscription-status ${current.status || "trialing"}`}><span>ESTADO</span><strong>{statusLabels[current.status] || "En configuración"}</strong></div>
      </header>
      <section className="subscription-current" aria-label="Resumen del plan actual">
        <div className="subscription-current-plan"><span className="eyebrow">PLAN ACTUAL</span><strong>{current.planName || currentPlan?.name || "Starter"}</strong><p>{current.description || currentPlan?.description || "Tu base para organizar inventario y oportunidades."}</p></div>
        <div className="subscription-current-metric"><span>Mensualidad</span><strong>{monthlyAmount > 0 ? `$${monthlyAmount.toLocaleString("en-US")} ${current.currency || "USD"}` : "Durante la prueba"}</strong><small>{current.currentPeriodEnd ? `Próxima fecha: ${formatDate(current.currentPeriodEnd)}` : "Fecha de cobro pendiente"}</small></div>
        <div className="subscription-current-metric"><span>Inventario activo</span><strong>{vehicleLimit ? `${vehicleUsage} / ${vehicleLimit}` : `${vehicleUsage} / ilimitado`}</strong><div className="subscription-usage"><i style={{ width: `${usagePercent}%` }} /></div><small>{vehicleLimit ? `${usagePercent}% del límite utilizado` : "Sin límite de vehículos"}</small></div>
      </section>
      <div className="subscription-section-heading"><div><span className="eyebrow">ELIGE SEGÚN TU OPERACIÓN</span><h3>Crece cuando tu negocio lo necesite.</h3></div><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar estado</button></div>
      <div className="subscription-plans">
        {displayPlans.map((plan) => {
          const isCurrent = plan.code === current.planCode;
          const features = Array.isArray(plan.features) ? plan.features : [];
          return <article className={`subscription-plan${isCurrent ? " is-current" : ""}`} key={plan.code}>{isCurrent && <span className="subscription-plan-badge">TU PLAN</span>}<div><span className="eyebrow">{plan.code.toUpperCase()}</span><h3>{plan.name}</h3><p>{plan.description}</p></div><strong className="subscription-plan-price">${Number(plan.monthlyAmount || 0).toLocaleString("en-US")}<small> / mes</small></strong><span className="subscription-plan-limit">{plan.vehicleLimit ? `Hasta ${plan.vehicleLimit} vehículos` : "Vehículos ilimitados"}</span><ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className={isCurrent ? "secondary-action" : "primary-action"} type="button" disabled={isCurrent || !checkoutReady} onClick={() => onStartBillingCheckout(plan.code)}>{isCurrent ? "Plan actual" : checkoutReady ? `Elegir ${plan.name}` : "Disponible al activar cobros"}</button></article>;
        })}
      </div>
      <aside className="subscription-help"><div><span className="eyebrow">SIN LETRA PEQUEÑA</span><strong>La información debe ayudarte a decidir.</strong><p>{checkoutReady ? "El checkout seguro de Stripe se abrirá solo cuando elijas un plan. El estado final se confirma mediante el webhook de facturación." : "Ahora estás en modo local. Puedes revisar los planes sin introducir una tarjeta ni activar cobros reales."}</p></div><span className="subscription-help-mark" aria-hidden="true">↗</span></aside>
    </section>
  );
}

function IntegrationsModule({ integrations = [], billing, health, drafts = [], vehicles = [], organization, settings, loading, onRefresh, onCreateDraft, onExportCalendar, onConnectGoogleCalendar, onStartBillingCheckout }) {
  const [platform, setPlatform] = useState("both");
  const [vehicleId, setVehicleId] = useState("");
  const [caption, setCaption] = useState("");
  const integration = (provider) => integrations.find((item) => item.provider === provider) || {};
  const statusLabel = (status) => ({ ready: "ACTIVO", oauth_ready: "LISTO PARA CONECTAR", connected: "CONECTADO", local_export_ready: "EXPORTACIÓN MANUAL", drafts_ready: "BORRADORES LISTOS", checkout_ready: "LISTO PARA COBRAR", verified: "VERIFICADO", dns_pending: "DOMINIO PENDIENTE", not_configured: "FALTA CONFIGURAR", local_demo: "MODO DEMO" }[status] || "PENDIENTE");
  const statusTone = (status) => ["ready", "oauth_ready", "connected", "local_export_ready", "drafts_ready", "checkout_ready", "verified"].includes(status) ? "ready" : "trial";
  const healthItems = [health?.email, health?.googleCalendar, health?.metaSocial, health?.billing, health?.domain].filter(Boolean);
  const google = integration("google_calendar");
  const googleConnected = google.status === "connected";
  const startBillingCheckout = async (planCode = "starter") => {
    if (onStartBillingCheckout) return onStartBillingCheckout(planCode);
    const response = await fetch("/api/admin/billing/checkout", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planCode }) });
    const payload = await response.json();
    if (!response.ok || !payload?.data?.url) throw new Error(payload?.error || "No se pudo preparar el checkout");
    window.location.assign(payload.data.url);
  };
  const createDraft = async (event) => { event.preventDefault(); if (!caption.trim()) return; await onCreateDraft({ platform, vehicleId: vehicleId || null, caption, hashtags: ["vehiculos", "showroom", "autentiqu"] }); setCaption(""); };
  const healthName = (item) => ({ resend: "EMAIL", google_calendar: "GOOGLE CALENDAR", meta_social: "META SOCIAL", none: "PAGOS" }[item.provider] || "DOMINIO");
  if (loading) return <section className="records-content integrations-content"><p className="empty-state">Cargando conexiones…</p></section>;
  return <section className="records-content integrations-content"><div className="panel-heading"><div><span className="eyebrow">HERRAMIENTAS DEL SHOWROOM</span><h2>Conexiones y difusión.</h2><p>Revisa qué funciona hoy y activa servicios externos cuando tengas sus credenciales.</p></div><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar estados</button></div><div className="integration-health-grid">{healthItems.map((item, index) => <article className="integration-health-card" key={`${item.provider || "domain"}-${index}`}><span className="eyebrow">{healthName(item)}</span><strong className={`integration-status ${statusTone(item.status)}`}>{statusLabel(item.status)}</strong><p>{item.detail}</p></article>)}</div><div className="integration-grid"><article className="integration-card"><span className="integration-icon">↗</span><div><span className="eyebrow">AGENDA</span><h3>Google Calendar</h3><p>{googleConnected ? "Las citas nuevas se sincronizan con el calendario conectado." : "Puedes descargar la agenda ahora o conectar Google para sincronizarla automáticamente."}</p></div><strong className={`integration-status ${googleConnected ? "ready" : "trial"}`}>{googleConnected ? "CONECTADO" : statusLabel(health?.googleCalendar?.status || "local_export_ready")}</strong>{googleConnected ? <button className="secondary-action" type="button" onClick={onRefresh}>Actualizar conexión</button> : health?.googleCalendar?.configured ? <button className="primary-action" type="button" onClick={onConnectGoogleCalendar}>Conectar Google Calendar</button> : <small>El dueño debe añadir las credenciales de conexión del servidor.</small>}<button className="secondary-action" type="button" onClick={onExportCalendar}>Descargar agenda .ics</button><small>{google.config?.calendarName || `Agenda de ${organization?.name || "tu showroom"}`} · {googleConnected ? "Sincronización automática activa" : "Exportación manual disponible"}</small></article><article className="integration-card"><span className="integration-icon">◎</span><div><span className="eyebrow">DIFUSIÓN</span><h3>Contenido para redes</h3><p>Prepara publicaciones para Instagram y Facebook sin publicarlas automáticamente.</p></div><strong className="integration-status ready">BORRADORES LISTOS</strong><form className="social-draft-form" onSubmit={createDraft}><select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">Publicación general</option>{vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.brand} {vehicle.model}</option>)}</select><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="both">Instagram + Facebook</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select><textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Escribe el texto de la publicación…" rows="3" /><button className="primary-action" type="submit">Guardar borrador</button></form><div className="social-draft-list">{drafts.slice(0, 3).map((draft) => <article key={draft.id}><strong>{draft.model ? `${draft.brand} ${draft.model}` : "Publicación general"}</strong><span>{formatPlatform(draft.platform)} · {formatStatus(draft.status)}</span><p>{draft.caption}</p></article>)}{!drafts.length && <small>Aún no hay borradores. Crea el primero arriba.</small>}</div></article><article className="integration-card"><span className="integration-icon">$</span><div><span className="eyebrow">CUENTA DEL SERVICIO</span><h3>Facturación</h3><p>{billing?.checkoutReady ? "Stripe está preparado. Completa el checkout para activar tu plan; el webhook debe quedar validado antes de producción." : "El sistema está en modo demo. No solicita tarjeta ni procesa dinero todavía."}</p></div><strong className={`integration-status ${billing?.checkoutReady ? "ready" : "trial"}`}>{billing?.checkoutReady ? "LISTO PARA COBRAR" : "MODO DEMO"}</strong><div className="billing-summary"><span>Plan <b>{billing?.planName || billing?.planCode || "Starter"}</b></span><span>Inventario <b>{billing?.vehicleLimit ? `${billing?.vehicleUsage || 0}/${billing.vehicleLimit}` : `${billing?.vehicleUsage || 0} / ilimitado`}</b></span><span>Mensualidad <b>{billing?.monthlyAmount ? `$${billing.monthlyAmount} ${billing.currency || "USD"}` : "Pendiente"}</b></span></div>{billing?.checkoutReady && <button className="primary-action" type="button" onClick={() => startBillingCheckout(billing?.planCode || "starter")}>Abrir checkout de Stripe</button>}<small>Proveedor: {health?.billing?.provider || "no configurado"} · El webhook es obligatorio antes de producción.</small></article></div><SocialFlyerStudio vehicles={vehicles} organization={organization} settings={settings} /><div className="integration-note"><span>ACTIVACIÓN EXTERNA</span><p>Email requiere Resend, redes requieren una app Meta, cobros requieren proveedor y webhook, y el dominio requiere DNS. Hasta completar esos datos, el sistema mantiene las alternativas manuales disponibles.</p></div></section>;
}

function BrandAssetField({ label, value, placeholder, onChange, onUpload }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUpload) return;
    setUploading(true);
    setError("");
    try { onChange(await onUpload(file)); } catch (uploadError) { setError(uploadError.message); } finally { setUploading(false); }
  };
  return <div className="brand-asset-field"><label>{label}<input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label><label className="asset-upload-button"><input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />{uploading ? "Subiendo…" : "Subir archivo"}</label>{value && <img className="brand-asset-preview" src={value} alt={`Vista previa de ${label.toLowerCase()}`} />}{error && <small className="media-upload-error">{error}</small>}</div>;
}

function BrandingPreview({ form, organization, onOpenPublic }) {
  const primary = /^#[0-9a-f]{6}$/i.test(form.primaryColor || "") ? form.primaryColor : "#c8a24b";
  const accent = /^#[0-9a-f]{6}$/i.test(form.accentColor || "") ? form.accentColor : "#b28b37";
  return <div className="branding-preview" style={{ "--preview-primary": primary, "--preview-accent": accent }}><div className="branding-preview-top"><span>{form.logoUrl || organization.logoUrl ? <img src={form.logoUrl || organization.logoUrl} alt="Logo de marca" /> : <b>{(organization.name || form.businessName || "A").slice(0, 2).toUpperCase()}</b>}</span><small>VISTA PREVIA DEL SHOWROOM</small></div><strong>{form.businessName || organization.name || "Nombre del concesionario"}</strong><p>Una identidad propia, lista para recibir compradores.</p><button type="button" onClick={onOpenPublic}>Ver como comprador →</button></div>;
}

function LegalSettingsFields({ form, onChange }) {
  return <><div className="settings-section legal-settings"><span className="eyebrow">LEGAL Y CONFIANZA</span><p className="settings-section-note">Sustituye los borradores por los textos aprobados por el concesionario antes de publicar.</p><label>Política de privacidad<textarea value={form.privacyText || ""} onChange={(event) => onChange("privacyText", event.target.value)} rows="7" maxLength="12000" /></label><label>Términos y condiciones<textarea value={form.termsText || ""} onChange={(event) => onChange("termsText", event.target.value)} rows="7" maxLength="12000" /></label></div><TrustContentFields form={form} onChange={onChange} /> </>;
}

function AnalyticsFunnelPanel({ data }) {
  const funnel = data?.funnel || {};
  const sources = Array.isArray(data?.sources) ? data.sources.slice(0, 3) : [];
  return <article className="chart-panel analytics-events-panel"><span className="eyebrow">EMBUDO · ÚLTIMOS {data?.days || 30} DÍAS</span><h3>{Number(funnel.visits || 0).toLocaleString("en-US")} visitas → {Number(funnel.leads || 0).toLocaleString("en-US")} leads</h3><div className="insight-line"><span>Tiempo medio de respuesta</span><strong>{data?.responseTime?.averageMinutes ? `${Math.round(Number(data.responseTime.averageMinutes))} min` : "Sin datos"}</strong></div>{sources.length ? <div className="analytics-event-list">{sources.map((item) => <div className="insight-line" key={item.source}><span>{item.source}</span><strong>{item.conversions} conversiones</strong></div>)}</div> : <small>Aún no hay fuentes atribuidas.</small>}</article>;
}

function TrustContentFields({ form, onChange }) {
  const faqItems = Array.isArray(form.faqItems) ? form.faqItems : [];
  const testimonials = Array.isArray(form.testimonials) ? form.testimonials : [];
  const updateItem = (field, index, key, value) => onChange(field, (Array.isArray(form[field]) ? form[field] : []).map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const removeItem = (field, index) => onChange(field, (Array.isArray(form[field]) ? form[field] : []).filter((_, itemIndex) => itemIndex !== index));
  return <div className="settings-section trust-content-settings"><span className="eyebrow">CONFIANZA Y CONTENIDO</span><p className="settings-section-note">Responde las dudas que más escuchas y publica opiniones autorizadas. Si no agregas testimonios, esa sección no aparece en tu showroom.</p>{form.trustContentAvailable === false && <p className="state-message warning">La base de producción todavía está pendiente de la migración de contenido. Tus cambios generales se guardan; FAQ y opiniones se habilitarán al completarla.</p>}<div className="trust-editor-block"><div className="settings-section-heading"><div><h3>Preguntas frecuentes</h3><p>Hasta 12 preguntas claras para ayudar al comprador a decidir.</p></div><button type="button" className="secondary-action" disabled={faqItems.length >= 12 || form.trustContentAvailable === false} onClick={() => onChange("faqItems", [...faqItems, { question: "", answer: "" }])}>Agregar pregunta</button></div>{faqItems.length ? <div className="trust-editor-list">{faqItems.map((item, index) => <article className="trust-editor-item" key={`faq-${index}`}><div className="trust-editor-item-head"><strong>Pregunta {index + 1}</strong><button type="button" className="text-button danger-text" disabled={form.trustContentAvailable === false} onClick={() => removeItem("faqItems", index)}>Quitar</button></div><label>Pregunta<input value={item.question || ""} maxLength="180" disabled={form.trustContentAvailable === false} onChange={(event) => updateItem("faqItems", index, "question", event.target.value)} placeholder="¿Puedo agendar una visita?" /></label><label>Respuesta<textarea value={item.answer || ""} maxLength="1200" rows="3" disabled={form.trustContentAvailable === false} onChange={(event) => updateItem("faqItems", index, "answer", event.target.value)} placeholder="Explica el siguiente paso de forma sencilla." /></label></article>)}</div> : <p className="trust-editor-empty">No hay preguntas personalizadas. El showroom usará las preguntas base.</p>}</div><div className="trust-editor-block"><div className="settings-section-heading"><div><h3>Opiniones de clientes</h3><p>Agrega solo testimonios reales con autorización para publicarlos.</p></div><button type="button" className="secondary-action" disabled={testimonials.length >= 8 || form.trustContentAvailable === false} onClick={() => onChange("testimonials", [...testimonials, { quote: "", name: "", detail: "" }])}>Agregar opinión</button></div>{testimonials.length ? <div className="trust-editor-list">{testimonials.map((item, index) => <article className="trust-editor-item" key={`testimonial-${index}`}><div className="trust-editor-item-head"><strong>Opinión {index + 1}</strong><button type="button" className="text-button danger-text" disabled={form.trustContentAvailable === false} onClick={() => removeItem("testimonials", index)}>Quitar</button></div><label>Opinión<textarea value={item.quote || ""} maxLength="500" rows="3" disabled={form.trustContentAvailable === false} onChange={(event) => updateItem("testimonials", index, "quote", event.target.value)} placeholder="La experiencia fue clara y sin presión." /></label><div className="form-grid"><label>Nombre<input value={item.name || ""} maxLength="120" disabled={form.trustContentAvailable === false} onChange={(event) => updateItem("testimonials", index, "name", event.target.value)} placeholder="María R." /></label><label>Contexto<input value={item.detail || ""} maxLength="180" disabled={form.trustContentAvailable === false} onChange={(event) => updateItem("testimonials", index, "detail", event.target.value)} placeholder="Compró un SUV · Santo Domingo" /></label></div></article>)}</div> : <p className="trust-editor-empty">Todavía no hay opiniones publicadas.</p>}</div></div>;
}

function SettingsModule({ form, organization, onboarding, onChange, onOrganizationChange, onSave, onOrganizationSave, onUpload, onNavigate, onOpenPublic, loading, message, organizationMessage }) {
  const [activeSection, setActiveSection] = useState("brand");
  const [profileLinkCopied, setProfileLinkCopied] = useState(false);
  const savedSnapshot = useRef(JSON.stringify({ form, organization }));
  const justSaved = message === "Configuración guardada correctamente" || organizationMessage === "Perfil guardado correctamente";
  const settingsDirty = !justSaved && JSON.stringify({ form, organization }) !== savedSnapshot.current;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("authentiq:settings-dirty", { detail: settingsDirty }));
    const guard = (event) => { if (settingsDirty) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [settingsDirty]);
  useEffect(() => {
    if (message === "Configuración guardada correctamente" || organizationMessage === "Perfil guardado correctamente") savedSnapshot.current = JSON.stringify({ form, organization });
  }, [message, organizationMessage, form, organization]);
  // Cada pestaña avisa si le falta algo: evita que el operador tenga que abrir
  // las cinco secciones para saber qué queda pendiente.
  const sectionReady = {
    brand: Boolean(organization?.logoUrl || form.faviconUrl),
    showroom: Boolean(form.heroHeadline || form.heroImageUrl),
    contact: Boolean(form.phone || form.whatsapp || form.email),
    appointments: Boolean(form.appointmentStart && form.appointmentEnd && form.appointmentDays?.length),
    legal: Boolean(form.privacyText && form.termsText && !/borrador|pendiente de revisión/i.test(`${form.privacyText} ${form.termsText}`)),
  };
  const sections = [["brand", "Marca"], ["showroom", "Portada"], ["contact", "Contacto"], ["appointments", "Agenda"], ["legal", "Legal"]];
  const pendingSections = sections.filter(([id]) => !sectionReady[id]);
  const isOwner = Boolean(organization?.id);
  const profileLink = publicShowroomUrl(organization);
  const copyProfileLink = async () => {
    try { await navigator.clipboard.writeText(profileLink); } catch { /* El botón sigue dando feedback aunque el navegador bloquee el portapapeles. */ }
    setProfileLinkCopied(true);
    window.setTimeout(() => setProfileLinkCopied(false), 2200);
  };
  return <section className="records-content"><div className="panel-heading"><div><span className="eyebrow">PERFIL Y AJUSTES</span><h2>Tu showroom, a tu manera.</h2><p>Empieza por el nombre y el enlace público. Lo demás son mejoras que puedes activar cuando las necesites.</p></div></div><OnboardingPanel onboarding={onboarding} onNavigate={onNavigate} onOpenPublic={onOpenPublic} /><div className="settings-form admin-form"><nav className="settings-tabs" aria-label="Secciones de personalización">{sections.map(([id, label]) => <button key={id} type="button" className={`${activeSection === id ? "is-active" : ""}${sectionReady[id] ? " is-ready" : " is-pending"}`} aria-current={activeSection === id ? "page" : undefined} onClick={() => setActiveSection(id)}>{label}<span className="settings-tab-mark" aria-hidden="true">{sectionReady[id] ? "✓" : "•"}</span><span className="visually-hidden">{sectionReady[id] ? " (completa)" : " (falta información)"}</span></button>)}</nav>{pendingSections.length > 0 && <p className="settings-pending-hint">Falta información en: {pendingSections.map(([, label]) => label).join(", ")}.</p>}{activeSection === "brand" && isOwner && <form onSubmit={onOrganizationSave} className="settings-section organization-profile"><span className="eyebrow">PERFIL DEL CONCESIONARIO</span><p className="settings-section-note">Nombre, logo, enlace público y dominio opcional. Aquí no se gestionan formularios de contacto.</p><div className="form-grid"><label>Nombre del concesionario<input value={organization.name || ""} onChange={(event) => onOrganizationChange("name", event.target.value)} required /></label><label>Nombre del enlace público<input value={organization.slug || ""} onChange={(event) => onOrganizationChange("slug", event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /><small>Ejemplo: concesionario-jordi. Se usará en tu dirección pública.</small></label><BrandAssetField label="Logo del concesionario" value={organization.logoUrl} onChange={(value) => onOrganizationChange("logoUrl", value)} onUpload={onUpload} placeholder="/uploads/logo.webp" /><label>Dominio personalizado <span>Opcional</span><input value={organization.customDomain || ""} onChange={(event) => onOrganizationChange("customDomain", event.target.value)} placeholder="www.concesionario.com" inputMode="url" /><small>{organization.subdomain ? <>Tu showroom ya está disponible en <strong>{organization.subdomain}</strong>. Usa un dominio propio solo si ya lo tienes.</> : "Después de guardarlo, apunta este dominio al hosting."}</small></label></div><div className="settings-public-link"><div><span className="eyebrow">ENLACE PÚBLICO</span><strong>{profileLink}</strong><small>Este es el enlace que puedes compartir con tus clientes.</small></div><div><button className="secondary-action" type="button" onClick={copyProfileLink}>{profileLinkCopied ? "✓ Copiado" : "Copiar enlace"}</button><button className="text-button" type="button" onClick={onOpenPublic}>Abrir showroom ↗</button></div></div>{organizationMessage && <p className="form-message">{organizationMessage}</p>}<button className="secondary-action" type="submit">Guardar perfil</button></form>}<form onSubmit={onSave}>{loading ? <p className="empty-state">Cargando configuración…</p> : <>{activeSection === "brand" && <div className="settings-section branding-settings"><span className="eyebrow">IDENTIDAD VISUAL</span><p className="settings-section-note">Elige los colores y el icono que verán los compradores. Puedes comprobarlos antes de publicar.</p><div className="branding-layout"><div className="branding-controls"><div className="form-grid"><label>Color principal<div className="color-input-row"><input type="color" value={form.primaryColor || "#c8a24b"} onChange={(event) => onChange("primaryColor", event.target.value)} /><input value={form.primaryColor || "#c8a24b"} onChange={(event) => onChange("primaryColor", event.target.value)} pattern="#[0-9a-fA-F]{6}" /></div></label><label>Color de acento<div className="color-input-row"><input type="color" value={form.accentColor || "#b28b37"} onChange={(event) => onChange("accentColor", event.target.value)} /><input value={form.accentColor || "#b28b37"} onChange={(event) => onChange("accentColor", event.target.value)} pattern="#[0-9a-fA-F]{6}" /></div></label></div><BrandAssetField label="Icono del navegador" value={form.faviconUrl} onChange={(value) => onChange("faviconUrl", value)} onUpload={onUpload} placeholder="/uploads/favicon.png" /></div><BrandingPreview form={form} organization={organization} onOpenPublic={onOpenPublic} /></div></div>}{activeSection === "showroom" && <div className="settings-section"><span className="eyebrow">PORTADA Y SECCIONES</span><p className="settings-section-note">Define la primera impresión y qué información verá un comprador.</p><div className="form-grid"><label>Titular principal<input value={form.heroHeadline || ""} onChange={(event) => onChange("heroHeadline", event.target.value)} placeholder="Elige lo que te mueve." maxLength="160" /><small>Si lo dejas vacío se utilizará el titular principal del sistema.</small></label><label>Subtítulo<input value={form.heroSubheadline || ""} onChange={(event) => onChange("heroSubheadline", event.target.value)} placeholder="Vehículos con carácter, información clara..." maxLength="280" /></label></div><BrandAssetField label="Imagen de portada" value={form.heroImageUrl} onChange={(value) => onChange("heroImageUrl", value)} onUpload={onUpload} placeholder="/uploads/portada.webp" /><div className="settings-toggle-grid"><label><input type="checkbox" checked={form.showFinancing !== false} onChange={(event) => onChange("showFinancing", event.target.checked)} /> Mostrar opciones de financiamiento</label><label><input type="checkbox" checked={form.showBrandRail !== false} onChange={(event) => onChange("showBrandRail", event.target.checked)} /> Mostrar marcas disponibles</label><label><input type="checkbox" checked={form.showModelLineRail !== false} onChange={(event) => onChange("showModelLineRail", event.target.checked)} /> Mostrar tipos de vehículos</label><label><input type="checkbox" checked={form.showBlog !== false} onChange={(event) => onChange("showBlog", event.target.checked)} /> Mostrar artículos y novedades</label></div></div>}{activeSection === "contact" && <div className="settings-section"><span className="eyebrow">CONTACTO Y REDES</span><p className="settings-section-note">Deja una forma clara de contactarte desde cada vehículo.</p><div className="form-grid"><PhoneField label="Teléfono comercial" value={form.phone || ""} onChange={(value) => onChange("phone", value)} hint="Lo usarás como teléfono de contacto del showroom." /><PhoneField label="WhatsApp comercial" value={form.whatsapp || ""} onChange={(value) => onChange("whatsapp", value)} hint="Este número abrirá el chat de WhatsApp para tus compradores." /><label>Correo<input type="email" value={form.email || ""} onChange={(event) => onChange("email", event.target.value)} autoComplete="email" /></label><label>Moneda<input value={form.currency || "USD"} onChange={(event) => onChange("currency", event.target.value)} maxLength="8" /></label><label>Instagram<input value={form.instagramUrl || ""} onChange={(event) => onChange("instagramUrl", event.target.value)} inputMode="url" /></label><label>Facebook<input value={form.facebookUrl || ""} onChange={(event) => onChange("facebookUrl", event.target.value)} inputMode="url" /></label></div><label>Dirección<input value={form.address || ""} onChange={(event) => onChange("address", event.target.value)} autoComplete="street-address" /></label><label>Horario visible<input value={form.hours || ""} onChange={(event) => onChange("hours", event.target.value)} placeholder="Lun–Sáb · 9:00–18:00" /></label><p className="settings-field-note">El WhatsApp se mostrará en los botones públicos del showroom y en las fichas de vehículos.</p></div>}{activeSection === "appointments" && <AppointmentSettingsFields form={form} onChange={onChange} />}{activeSection === "legal" && <LegalSettingsFields form={form} onChange={onChange} />}{message && <p className="form-message">{message}</p>}<div className="settings-save-bar"><span>Revisa el resultado antes de compartir el enlace.</span><div><button className="secondary-action" type="button" onClick={onOpenPublic}>Vista previa</button><button className="primary-action" type="submit">Guardar cambios</button></div></div></>}</form></div></section>;
}

const leadStages = [
  ["new", "Nuevos", "Primer contacto"],
  ["contacted", "Contactados", "Conversación abierta"],
  ["qualified", "Calificados", "Listos para avanzar"],
  ["closed", "Cerrados", "Operación ganada"],
  ["lost", "Perdidos", "Revisar después"],
];

function LeadPipelineCard({ lead, onUpdate, onOpenList, onCreateQuote }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `lead:${lead.id}`, data: { status: lead.status } });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  
  const phoneDigits = useMemo(() => String(lead.phone || "").replace(/\D/g, ""), [lead.phone]);
  const waText = useMemo(() => {
    const car = lead.brand ? `${lead.brand} ${lead.model || ""}` : "tu vehículo de interés";
    return encodeURIComponent(`Hola ${lead.name || ""}, te escribo del concesionario sobre tu consulta por ${car}. ¿Cómo te podemos ayudar?`);
  }, [lead]);

  const sla = useMemo(() => {
    if (lead.status !== "new") return null;
    const elapsedMinutes = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 60000);
    if (elapsedMinutes < 30) {
      return { label: `⚡ Nuevo · ${elapsedMinutes}m`, className: "sla-fresh", title: "Lead recibido hace menos de 30 minutos. Contacta de inmediato." };
    }
    return { label: `⚠️ SLA +${elapsedMinutes}m`, className: "sla-delayed", title: "Atención prioritaria requerida. Más de 30m sin contactar." };
  }, [lead.status, lead.createdAt]);

  return (
    <article ref={setNodeRef} style={style} className={`lead-pipeline-card${isDragging ? " is-dragging" : ""}`}>
      <div className="pipeline-card-top">
        <strong>{lead.name}</strong>
        <button className="pipeline-drag-handle" type="button" {...listeners} {...attributes} aria-label={`Arrastrar a ${lead.name}`} title="Arrastra para mover de etapa">⠿</button>
        <span>{formatDate(lead.createdAt)}</span>
      </div>

      {sla && (
        <div className={`pipeline-sla-badge ${sla.className}`} title={sla.title}>
          {sla.label}
        </div>
      )}

      <small>{lead.brand ? `${lead.brand} ${lead.model}` : "Contacto general"}</small>
      <div className="pipeline-card-meta">
        <span className={`priority-mark p${lead.priority || 2}`} title={`Prioridad ${formatPriority(lead.priority)}`}>{formatPriority(lead.priority)}</span>
        <span>{lead.assignedTo || "Sin asignar"}</span>
      </div>
      {lead.nextAction && <p className="pipeline-next-action">{lead.nextAction}{lead.nextActionAt ? ` · ${formatDateTime(lead.nextActionAt)}` : ""}</p>}
      <span className="pipeline-source">{formatLeadSource(lead.source)}</span>

      {phoneDigits ? (
        <div className="pipeline-quick-contact">
          <a
            href={`https://wa.me/${phoneDigits}?text=${waText}`}
            target="_blank"
            rel="noreferrer"
            className="pipeline-wa-btn"
            title="Abrir chat en WhatsApp con mensaje personalizado"
          >
            💬 WhatsApp
          </a>
          <a
            href={`tel:${phoneDigits}`}
            className="pipeline-call-btn"
            title="Llamar directamente"
          >
            📞 Llamar
          </a>
        </div>
      ) : null}

      <select aria-label={`Mover a etapa ${lead.name}`} value={lead.status} onChange={(event) => onUpdate(lead.id, { status: event.target.value })}>
        <option value="new">Nuevo</option>
        <option value="contacted">Contactado</option>
        <option value="qualified">Calificado</option>
        <option value="closed">Cerrado</option>
        <option value="lost">Perdido</option>
      </select>
      {lead.vehicleId && <button type="button" className="pipeline-manage-button quote-inline-action" onClick={() => onCreateQuote?.(lead)}>Crear cotización →</button>}
      {onOpenList && <button type="button" className="pipeline-manage-button" onClick={onOpenList}>Abrir ficha del cliente →</button>}
    </article>
  );
}

function LeadPipelineColumn({ stage, label, hint, records, onUpdate, onOpenList, onCreateQuote }) {
  const { isOver, setNodeRef } = useDroppable({ id: `stage:${stage}` });
  return (
    <section className={`lead-pipeline-column ${stage}${isOver ? " is-drop-target" : ""}`}>
      <div className="lead-pipeline-heading">
        <div>
          <span className="eyebrow">{label}</span>
          <small>{hint}</small>
        </div>
        <strong>{String(records.length).padStart(2, "0")}</strong>
      </div>
      <div ref={setNodeRef} className="lead-pipeline-cards">
        {records.length ? (
          records.map((lead) => (
            <LeadPipelineCard lead={lead} key={lead.id} onUpdate={onUpdate} onCreateQuote={onCreateQuote} onOpenList={onOpenList} />
          ))
        ) : (
          <p className="pipeline-empty">Suelta un cliente aquí</p>
        )}
      </div>
    </section>
  );
}

function LeadPipeline({ records, onUpdate, onOpenList, onCreateQuote }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const moveLead = ({ active, over }) => {
    const target = String(over?.id || "");
    if (!target.startsWith("stage:")) return;
    const leadId = String(active.id || "").replace(/^lead:/, "");
    const lead = records.find((item) => item.id === leadId);
    const status = target.replace(/^stage:/, "");
    if (lead && lead.status !== status) onUpdate(lead.id, { status });
  };
  return <DndContext sensors={sensors} onDragEnd={moveLead}><div className="lead-pipeline">{leadStages.map(([stage, label, hint]) => <LeadPipelineColumn stage={stage} label={label} hint={hint} records={records.filter((lead) => lead.status === stage)} key={stage} onUpdate={onUpdate} onCreateQuote={onCreateQuote} onOpenList={onOpenList} />)}</div></DndContext>;
}

function LeadAttentionSummary({ records, activeFilter, onSelect }) {
  const openRecords = records.filter((lead) => !["closed", "lost"].includes(lead.status));
  const now = Date.now();
  const overdue = openRecords.filter((lead) => lead.nextActionAt && new Date(lead.nextActionAt).getTime() < now);
  const noAction = openRecords.filter((lead) => !lead.nextActionAt);
  const planned = openRecords.filter((lead) => lead.nextActionAt && new Date(lead.nextActionAt).getTime() >= now);
  const items = [["all", "Cartera abierta", openRecords.length, "Todos los pendientes"], ["overdue", "Vencidos", overdue.length, "Atención inmediata"], ["no_action", "Sin próxima acción", noAction.length, "Asignar siguiente paso"], ["planned", "Con seguimiento", planned.length, "Ya tienen fecha"]];
  return <div className="lead-attention-summary" role="group" aria-label="Resumen del seguimiento">{items.map(([key, label, count, hint]) => <button key={key} type="button" className={activeFilter === key ? "is-active" : ""} onClick={() => onSelect(key)}><span>{label}</span><strong>{count}</strong><small>{hint}</small></button>)}</div>;
}

function LeadsControlRoom({ records, users, loading, onRefresh, onUpdate, onLoadHistory, onAddAppointment, onCreateQuote, initialLeadId = "" }) {
  const { confirm } = useAdminConfirm();
  const [viewMode, setViewMode] = useState("pipeline");
  const [listDirty, setListDirty] = useState(false);
  const [attentionFilter, setAttentionFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const selectAttention = (filter) => { setAttentionFilter(filter); setViewMode("list"); setQuery(""); setStatusFilter("all"); };
  const visibleRecords = records.filter((lead) => { const haystack = `${lead.name} ${lead.email || ""} ${lead.phone || ""} ${lead.brand || ""} ${lead.model || ""}`.toLowerCase(); const overdue = lead.nextActionAt && new Date(lead.nextActionAt).getTime() < Date.now(); const noAction = !lead.nextActionAt; const attentionMatches = attentionFilter === "all" || (attentionFilter === "overdue" && overdue) || (attentionFilter === "no_action" && noAction) || (attentionFilter === "planned" && !noAction && !overdue); return (statusFilter === "all" || lead.status === statusFilter) && attentionMatches && haystack.includes(query.toLowerCase()); });
  useEffect(() => {
    const syncDirty = (event) => setListDirty(Boolean(event.detail));
    window.addEventListener("authentiq:lead-dirty", syncDirty);
    return () => window.removeEventListener("authentiq:lead-dirty", syncDirty);
  }, []);
  useEffect(() => {
    if (initialLeadId) setViewMode("list");
  }, [initialLeadId]);
  const changeLeadView = async (nextView) => { if (listDirty && !(await confirm({ title: "Descartar cambios de seguimiento", message: "Tienes cambios sin guardar en esta vista. Si continúas, se perderán.", confirmLabel: "Continuar", danger: true }))) return; setListDirty(false); setViewMode(nextView); };
  const refreshLeadView = async () => { if (listDirty && !(await confirm({ title: "Actualizar seguimiento", message: "Tienes cambios sin guardar. Actualizar puede reemplazar lo que estás editando.", confirmLabel: "Actualizar", danger: true }))) return; setListDirty(false); onRefresh(); };
  return <>
    <section className="records-content lead-control-room"><div className="panel-heading"><div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h2>{viewMode === "pipeline" ? "Seguimiento." : "Clientes."}</h2></div><div className="lead-view-switcher"><button className={viewMode === "pipeline" ? "active" : ""} type="button" onClick={() => changeLeadView("pipeline")}>Seguimiento</button><button className={viewMode === "list" ? "active" : ""} type="button" onClick={() => changeLeadView("list")}>Lista detallada</button></div></div><LeadAttentionSummary records={records} activeFilter={attentionFilter} onSelect={selectAttention} />{viewMode === "pipeline" && <><div className="lead-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, correo o vehículo..." aria-label="Buscar clientes" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar clientes"><option value="all">Todas las etapas</option><option value="new">Nuevos</option><option value="contacted">Contactados</option><option value="qualified">Calificados</option><option value="closed">Cerrados</option><option value="lost">Perdidos</option></select><button className="text-button" type="button" onClick={refreshLeadView}>Actualizar</button><span>{visibleRecords.length} de {records.length} clientes</span></div>{loading ? <p className="empty-state">Cargando clientes...</p> : <LeadPipeline records={visibleRecords} onUpdate={onUpdate} onCreateQuote={onCreateQuote} onOpenList={() => changeLeadView("list")} />}</>}</section>
    {viewMode === "list" && <><div className="lead-attention-filter"><label>Prioridad de seguimiento<select value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value)} aria-label="Filtrar seguimiento"><option value="all">Todo el seguimiento</option><option value="overdue">Seguimientos vencidos</option><option value="no_action">Sin próxima acción</option><option value="planned">Con acción futura</option></select></label></div>{records.length > 100 ? <VirtualizedLeadsModule records={records} loading={loading} onRefresh={onRefresh} onLoadHistory={onLoadHistory} onAddAppointment={onAddAppointment} onCreateQuote={onCreateQuote} /> : <LeadsModule records={records} users={users} loading={loading} onRefresh={onRefresh} onUpdate={onUpdate} onLoadHistory={onLoadHistory} onAddAppointment={onAddAppointment} onCreateQuote={onCreateQuote} initialLeadId={initialLeadId} attentionFilter={attentionFilter} />}</>}
  </>;
}

function LeadAppointmentBadge({ lead }) {
  if (!lead.appointmentId) return null;
  const status = lead.appointmentStatus === "confirmed" ? "Confirmada" : lead.appointmentStatus === "cancelled" ? "Cancelada" : "Pendiente";
  return <span className="lead-appointment-badge">Cita · {status} · {formatDate(lead.appointmentDate)} {String(lead.appointmentTime || "").slice(0, 5)}</span>;
}


function AppointmentsModule({ appointments, blocks, loading, onRefresh, onStatusChange, onCreateBlock, onDeleteBlock, canManageBlocks, onExport, onOpenIntegrations = () => window.dispatchEvent(new CustomEvent("zevroa:open-admin-module", { detail: "integrations" })) }) {
  const [dateFilter, setDateFilter] = useState("");
  const [blockForm, setBlockForm] = useState({ date: "", start: "", end: "", reason: "" });
  const visible = appointments.filter((appointment) => !dateFilter || String(appointment.date).slice(0, 10) === dateFilter);
  const visibleBlocks = blocks.filter((block) => !dateFilter || String(block.date).slice(0, 10) === dateFilter);
  const calendarAnchor = new Date(`${dateFilter || localIsoDate()}T12:00:00`);
  calendarAnchor.setDate(calendarAnchor.getDate() - ((calendarAnchor.getDay() + 6) % 7));
  const calendarDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(calendarAnchor);
    date.setDate(calendarAnchor.getDate() + index);
    const iso = localIsoDate(date);
    return { iso, date, label: new Intl.DateTimeFormat("es-DO", { weekday: "short" }).format(date).replace(".", ""), number: date.getDate(), items: appointments.filter((appointment) => String(appointment.date).slice(0, 10) === iso) };
  });
  const submitBlock = async (event) => { event.preventDefault(); await onCreateBlock(blockForm); setBlockForm({ date: "", start: "", end: "", reason: "" }); };
  return <section className="records-content appointments-content"><div className="panel-heading"><div><span className="eyebrow">AGENDA COMERCIAL</span><h2>Citas.</h2><p className="module-intro">Organiza las visitas, confirma horarios y evita cruces en un solo lugar.</p></div><div className="panel-actions"><button className="secondary-action" type="button" onClick={() => setDateFilter("")}>Hoy</button><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filtrar citas por fecha" /><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar</button></div></div><section className="calendar-sync-callout" aria-label="Sincronización de calendario"><div className="calendar-sync-icon"><CalendarBlankIcon size={24} weight="duotone" /></div><div><span className="eyebrow">PARA NO PERDER NINGUNA VISITA</span><h3>Conecta Google Calendar</h3><p>Las citas nuevas de tu showroom pueden aparecer automáticamente en el calendario del equipo. El dueño lo autoriza una sola vez desde Conexiones.</p></div><div className="calendar-sync-actions"><button className="primary-action" type="button" onClick={onOpenIntegrations}>Conectar calendario</button>{onExport && <button className="text-button" type="button" onClick={onExport}>Descargar .ics</button>}</div></section><div className="appointments-summary"><span><strong>{visible.length}</strong> cita{visible.length === 1 ? "" : "s"} {dateFilter ? "para este día" : "registradas"}</span><span>Los horarios se bloquean automáticamente al alcanzar la capacidad configurada.</span></div><section className="agenda-week" aria-label="Vista semanal de la agenda"><div className="agenda-week-head"><div><span className="eyebrow">VISTA RÁPIDA</span><strong>Esta semana</strong></div><small>Selecciona un día para ver sus citas</small></div><div className="agenda-week-grid">{calendarDays.map((day) => <button type="button" className={`agenda-day${dateFilter === day.iso ? " is-selected" : ""}${day.iso === localIsoDate() ? " is-today" : ""}`} key={day.iso} onClick={() => setDateFilter(day.iso)}><span>{day.label}</span><strong>{day.number}</strong><small>{day.items.length ? `${day.items.length} cita${day.items.length === 1 ? "" : "s"}` : "Libre"}</small>{day.items.slice(0, 2).map((item) => <em key={item.id}>{String(item.time).slice(0, 5)} · {item.customerName}</em>)}</button>)}</div></section>{loading ? <p className="empty-state">Cargando agenda…</p> : visible.length ? <div className="appointments-list">{visible.map((appointment) => <article className="appointment-admin-row" key={appointment.id}><div className="appointment-date"><strong>{formatDate(appointment.date)}</strong><span>{String(appointment.time).slice(0, 5)} · {Number(appointment.durationMinutes) || 60} min</span></div><div className="appointment-main"><strong>{appointment.customerName}</strong><span>{appointment.brand ? `${appointment.brand} ${appointment.model} · ${appointment.year}` : "Vehículo no disponible"}</span><small>{appointment.customerEmail || appointment.customerPhone || "Sin contacto"}</small>{appointment.notes && <p>{appointment.notes}</p>}</div><div className="appointment-actions"><span className={`status-pill ${appointment.status}`}>{appointment.status === "confirmed" ? "Confirmada" : appointment.status === "cancelled" ? "Cancelada" : "Pendiente"}</span><select value={appointment.status} onChange={(event) => onStatusChange(appointment.id, event.target.value)} aria-label={`Estado de la cita de ${appointment.customerName}`}><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="cancelled">Cancelada</option></select></div></article>)}</div> : <AdminEmptyState eyebrow="AGENDA VACÍA" title="No hay citas para mostrar." text="Cuando un comprador solicite una visita, la cita aparecerá aquí para confirmarla." />}{canManageBlocks && <section className="appointment-blocks"><div className="panel-heading"><div><span className="eyebrow">EXCEPCIONES DE AGENDA</span><h3>Bloqueos.</h3></div></div><form className="appointment-block-form" onSubmit={submitBlock}><label>Fecha<input type="date" value={blockForm.date} onChange={(event) => setBlockForm({ ...blockForm, date: event.target.value })} required /></label><label>Desde<input type="time" value={blockForm.start} onChange={(event) => setBlockForm({ ...blockForm, start: event.target.value })} /></label><label>Hasta<input type="time" value={blockForm.end} onChange={(event) => setBlockForm({ ...blockForm, end: event.target.value })} /></label><label>Motivo<input value={blockForm.reason} onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })} placeholder="Feriado, vacaciones…" required /></label><button className="primary-action" type="submit">Bloquear horario</button></form><div className="appointment-block-list">{visibleBlocks.length ? visibleBlocks.map((block) => <article key={block.id}><div><strong>{formatDate(block.date)}</strong><span>{block.start ? `${String(block.start).slice(0, 5)}–${String(block.end).slice(0, 5)}` : "Todo el día"} · {block.reason}</span></div><button className="text-button" type="button" onClick={() => onDeleteBlock(block.id)}>Eliminar</button></article>) : <p className="empty-state">No hay bloqueos para este filtro.</p>}</div></section>}</section>;
}

const emptyVehicle = { brand: "", brandLogoUrl: "", category: "sports", model: "", variant: "", year: new Date().getFullYear(), condition: "used", priceUsd: "", stockNumber: "", engine: "", power: "", transmission: "", drive: "", fuelType: "", exteriorColor: "", interiorColor: "", doors: "", seats: "", mileageKm: 0, location: "", warranty: "", features: "", description: "", stock: 1, status: "draft", maxDiscountPercent: 0, images: "", media3dUrl: "", procedural3dEnabled: false, videoUrl: "", videoPosterUrl: "", panorama360Url: "" };
const emptyBlog = { title: "", slug: "", summary: "", content: "", category: "", tags: "", coverImageUrl: "", status: "draft", seoTitle: "", seoDescription: "" };
emptyVehicle.seoTitle = "";
emptyVehicle.seoDescription = "";
emptyVehicle.imageAltTexts = "";
const emptyUser = { name: "", email: "", password: "", role: "seller" };
const emptySettings = { businessName: "ZEVROA", logoUrl: "", primaryColor: "#c8a24b", accentColor: "#b28b37", faviconUrl: "", phone: "", whatsapp: "", email: "", address: "", hours: "", instagramUrl: "", facebookUrl: "", currency: "USD", privacyText: "", termsText: "", appointmentTimezone: "America/Santo_Domingo", appointmentStart: "09:00", appointmentEnd: "18:00", appointmentDurationMinutes: 60, appointmentMinNoticeHours: 2, appointmentMaxDaysAhead: 30, appointmentDays: [1, 2, 3, 4, 5, 6], appointmentCapacity: 1, heroHeadline: "", heroSubheadline: "", heroImageUrl: "", showFinancing: true, showBrandRail: true, showModelLineRail: true, showBlog: true, faqItems: [], testimonials: [] };
const emptyOrganization = { id: "", name: "ZEVROA", slug: "zevroa", logoUrl: "", customDomain: "", isActive: true };

function InvitationAcceptance({ token, onBack, onAccepted }) {
  const [form, setForm] = useState({ password: "", confirmation: "" });
  const [state, setState] = useState({ loading: false, error: "", success: "" });
  const submit = async (event) => {
    event.preventDefault();
    if (form.password.length < 8) { setState({ loading: false, error: "La contraseña debe tener al menos 8 caracteres.", success: "" }); return; }
    if (form.password !== form.confirmation) { setState({ loading: false, error: "Las contraseñas no coinciden.", success: "" }); return; }
    setState({ loading: true, error: "", success: "" });
    try {
      const response = await fetch(`${apiUrl}/api/auth/accept-invitation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: form.password }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo aceptar la invitación.");
      setState({ loading: false, error: "", success: "Cuenta creada. Ya puedes entrar al panel." });
      window.setTimeout(() => onAccepted?.(payload.data?.user?.email || ""), 900);
    } catch (error) { setState({ loading: false, error: mensajeDeError(error), success: "" }); }
  };
  return <main className="admin-page admin-login-page invitation-page"><button className="back-button" type="button" onClick={onBack}>← Volver al acceso</button><form className="admin-login" onSubmit={submit}><span className="eyebrow">ZEVROA · INVITACIÓN</span><h1>Activa tu <em>acceso.</em></h1><p className="account-welcome">Crea tu contraseña para entrar al espacio de trabajo del concesionario. Este enlace solo se puede usar una vez.</p><label>Nueva contraseña<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" minLength="8" required /></label><label>Repite la contraseña<input type="password" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} autoComplete="new-password" minLength="8" required /></label>{state.error && <p className="state-message error" role="alert">{state.error}</p>}{state.success && <p className="state-message success" role="status">{state.success}</p>}<button className="primary-action" type="submit" disabled={state.loading || Boolean(state.success)}>{state.loading ? "Creando cuenta…" : state.success ? "Cuenta creada" : "Crear acceso"}</button></form></main>;
}

function BackofficeWorkspace({ onBack, onVehiclesChanged, initialMode = "login", impersonation = null }) {
  // La sesión normal vive en una cookie HttpOnly; el token de soporte solo vive
  // en memoria de esta pestaña para no persistir credenciales en el navegador.
  const [token, setToken] = useState(() => impersonation?.token || "");
  const [sessionResolved, setSessionResolved] = useState(() => Boolean(impersonation?.token));
  const [authMode, setAuthMode] = useState(initialMode);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryState, setRecoveryState] = useState({ loading: false, message: "", error: "" });
  const [activeModule, setActiveModule] = useState("dashboard");
  const [leadFocusId, setLeadFocusId] = useState("");
  const [leadDraftDirty, setLeadDraftDirty] = useState(false);
  const [settingsDraftDirty, setSettingsDraftDirty] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [workQueue, setWorkQueue] = useState([]);
  const [workQueueError, setWorkQueueError] = useState("");
  const [workQueueLoading, setWorkQueueLoading] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [taxonomy, setTaxonomy] = useState({ brands: [], categories: [] });
  const [offers, setOffers] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [quoteLead, setQuoteLead] = useState(null);
  const [analytics, setAnalytics] = useState([]);
  const [funnelData, setFunnelData] = useState(null);
  const [leads, setLeads] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactsError, setContactsError] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactDetail, setContactDetail] = useState(null);
  const [contactTimeline, setContactTimeline] = useState([]);
  const [contactDetailLoading, setContactDetailLoading] = useState(false);
  const [contactDetailError, setContactDetailError] = useState("");
  const [customersView, setCustomersView] = useState("crm");
  const [appointments, setAppointments] = useState([]);
  const [appointmentBlocks, setAppointmentBlocks] = useState([]);
  const [users, setUsers] = useState([]);
  const [managedUsers, setManagedUsers] = useState([]);
  const [appointmentLead, setAppointmentLead] = useState(null);
  const [userForm, setUserForm] = useState(emptyUser);
  const [settings, setSettings] = useState(emptySettings);
  const [organization, setOrganization] = useState(emptyOrganization);
  const [onboarding, setOnboarding] = useState(null);
  const [welcomeOnboardingOpen, setWelcomeOnboardingOpen] = useState(false);
  const [integrations, setIntegrations] = useState([]);
  const [billing, setBilling] = useState(null);
  const [billingPlans, setBillingPlans] = useState([]);
  const [integrationHealth, setIntegrationHealth] = useState(null);
  const [socialDrafts, setSocialDrafts] = useState([]);
  const [organizationMessage, setOrganizationMessage] = useState("");
  const [posts, setPosts] = useState([]);
  const [blogForm, setBlogForm] = useState(emptyBlog);
  const [editingPostId, setEditingPostId] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => impersonation?.user || null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [form, setForm] = useState(emptyVehicle);
  const [editingId, setEditingId] = useState(null);
  const [stickerVehicle, setStickerVehicle] = useState(null);
  const [message, setMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [toastAction, setToastAction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [theme, setTheme] = useState(() => getStoredValue("authentiq_theme", "light") || "light");
  const { confirm, prompt } = useAdminConfirm();
  useEffect(() => {
    const syncLeadDraft = (event) => setLeadDraftDirty(Boolean(event.detail));
    window.addEventListener("authentiq:lead-dirty", syncLeadDraft);
    return () => window.removeEventListener("authentiq:lead-dirty", syncLeadDraft);
  }, []);
  useEffect(() => {
    const syncSettingsDraft = (event) => setSettingsDraftDirty(Boolean(event.detail));
    window.addEventListener("authentiq:settings-dirty", syncSettingsDraft);
    return () => window.removeEventListener("authentiq:settings-dirty", syncSettingsDraft);
  }, []);
  useEffect(() => { if (!message) return undefined; const timer = window.setTimeout(() => setMessage(""), 3200); return () => window.clearTimeout(timer); }, [message]);
  useEffect(() => {
    if (!message) return;
    if (/(guardad|actualizad|archivad|publicad|restaurad|duplicad|exportad|generad|recibid|confirmad|copiad|cread)/i.test(message)) setLastSavedAt(new Date());
    if (!toastAction) return;
    const timer = window.setTimeout(() => setToastAction(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message, toastAction]);
  useEffect(() => {
    const openModule = (event) => { if (event.detail) navigateAdmin(event.detail); };
    window.addEventListener("zevroa:open-admin-module", openModule);
    return () => window.removeEventListener("zevroa:open-admin-module", openModule);
  }, [activeModule, leadDraftDirty, settingsDraftDirty]);

  const confirmDiscardAdminDraft = async () => {
    const dirty = activeModule === "leads" ? leadDraftDirty : activeModule === "settings" ? settingsDraftDirty : false;
    if (!dirty) return true;
    const warning = activeModule === "settings" ? "Tienes cambios de personalización sin guardar. ¿Quieres salir y descartarlos?" : "Tienes cambios de seguimiento sin guardar. ¿Quieres salir y descartarlos?";
    if (!(await confirm({ title: "Descartar cambios", message: warning, confirmLabel: "Salir sin guardar", danger: true }))) return false;
    if (activeModule === "settings") setSettingsDraftDirty(false);
    else setLeadDraftDirty(false);
    return true;
  };
  const navigateAdmin = async (nextModule) => {
    if (nextModule === activeModule) return true;
    if (!(await confirmDiscardAdminDraft())) return false;
    setActiveModule(nextModule);
    return true;
  };
  const openLeadFromDashboard = async (lead) => {
    if (!lead?.id) return;
    if (await navigateAdmin("leads")) { setCustomersView("pipeline"); setLeadFocusId(lead.id); }
  };

  const request = async (path, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const execute = async () => {
      const response = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
      const payload = response.status === 204 ? null : await response.json();
      if (response.status === 401) { setCurrentUser(null); setToken(""); setSessionResolved(true); throw new Error("La sesión expiró. Inicia sesión nuevamente."); }
      if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse");
      return payload;
    };
    if (method === "GET") {
      return queryClient.fetchQuery({ queryKey: ["admin", currentUser?.id || "session", path], queryFn: execute });
    }
    const result = await execute();
    await queryClient.invalidateQueries({ queryKey: ["admin", currentUser?.id || "session"] });
    return result;
  };
  const loadVehicles = async () => { setLoading(true); try { setVehicles((await request("/api/admin/vehicles")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setLoading(false); } };
  const loadTaxonomy = async () => { try { setTaxonomy((await request("/api/admin/taxonomy")).data || { brands: [], categories: [] }); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadDashboard = async () => { setModuleLoading(true); setDashboardError(""); try { setDashboard((await request("/api/admin/dashboard")).data); } catch (error) { setDashboardError(mensajeDeError(error)); setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadWorkQueue = async () => { setWorkQueueLoading(true); setWorkQueueError(""); try { setWorkQueue((await request("/api/admin/work-queue")).data || []); } catch (error) { setWorkQueueError(mensajeDeError(error)); } finally { setWorkQueueLoading(false); } };
  const loadOffers = async () => { setModuleLoading(true); try { setOffers((await request("/api/admin/offers")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadQuotes = async () => { setModuleLoading(true); try { setQuotes((await request("/api/admin/quotes")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadAnalytics = async () => { try { const [events, funnel] = await Promise.all([request("/api/admin/analytics?days=30"), request("/api/admin/analytics/funnel?days=30")]); setAnalytics(events.data || []); setFunnelData(funnel.data || null); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadLeads = async () => { setModuleLoading(true); try { setLeads((await request("/api/admin/leads")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadContacts = async () => { setContactsError(""); try { setContacts((await request("/api/admin/contacts")).data || []); } catch (error) { setContactsError(mensajeDeError(error)); } };
  const selectContact = async (contact) => {
    if (!contact?.id) return;
    setSelectedContact(contact); setContactDetail(null); setContactTimeline([]); setContactDetailError(""); setContactDetailLoading(true);
    try {
      const [detailPayload, timelinePayload] = await Promise.all([request(`/api/admin/contacts/${contact.id}`), request(`/api/admin/contacts/${contact.id}/timeline`)]);
      setContactDetail(detailPayload.data || null); setContactTimeline(timelinePayload.data || []);
    } catch (error) { setContactDetailError(mensajeDeError(error)); } finally { setContactDetailLoading(false); }
  };
  const addContactNote = async (contactId, note) => {
    try {
      await request(`/api/admin/contacts/${contactId}/notes`, { method: "POST", body: JSON.stringify({ note }) });
      setMessage("Nota guardada en el cliente");
      await Promise.all([loadContacts(), selectContact({ id: contactId })]);
    } catch (error) { setMessage(mensajeDeError(error)); }
  };
  const assignContact = async (contactId, assignedTo) => {
    try {
      await request(`/api/admin/contacts/${contactId}/assign`, { method: "PATCH", body: JSON.stringify({ assignedTo: assignedTo || null }) });
      setMessage("Responsable actualizado");
      await Promise.all([loadContacts(), selectContact({ id: contactId })]);
    } catch (error) { setMessage(mensajeDeError(error)); }
  };
  const openContactFromWork = async (item) => {
    if (!item?.contactId) return navigateAdmin(item?.type === "appointment" ? "appointments" : item?.type === "quote" ? "quotes" : item?.type === "offer" ? "offers" : "leads");
    if (await navigateAdmin("leads")) { setCustomersView("crm"); await selectContact(contacts.find((contact) => contact.id === item.contactId) || { id: item.contactId, fullName: item.title }); }
  };
  const loadAppointments = async () => { setModuleLoading(true); try { setAppointments((await request("/api/admin/appointments")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadAppointmentBlocks = async () => { try { setAppointmentBlocks((await request("/api/admin/appointment-blocks")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadLeadHistory = async (id) => { try { return (await request(`/api/admin/leads/${id}/events`)).data || []; } catch (error) { setMessage(mensajeDeError(error)); return []; } };
  const loadUsers = async () => { try { setUsers((await request("/api/admin/users")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadManagedUsers = async () => { setModuleLoading(true); try { setManagedUsers((await request("/api/admin/users/manage")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadSettings = async () => { setModuleLoading(true); try { const nextSettings = (await request("/api/admin/settings")).data || emptySettings; setSettings(nextSettings); if (nextSettings.currency) setStoredValue("authentiq_currency", String(nextSettings.currency).trim().toUpperCase()); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadOrganization = async () => { try { setOrganization((await request("/api/admin/organization")).data || emptyOrganization); } catch (error) { setOrganizationMessage(mensajeDeError(error)); } };
  const loadOnboarding = async () => { try { setOnboarding((await request("/api/admin/onboarding")).data || null); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadIntegrations = async () => { if (currentUser?.role !== "admin") return; try { const [payload, billingPayload] = await Promise.all([request("/api/admin/integrations"), request("/api/admin/billing")]); setIntegrations(payload.data?.integrations || []); setBilling(billingPayload.data || payload.data?.billing || null); setBillingPlans(billingPayload.data?.plans || []); setIntegrationHealth(payload.data?.health || null); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadSocialDrafts = async () => { try { setSocialDrafts((await request("/api/admin/social/drafts")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } };
  const loadBlog = async () => { setModuleLoading(true); try { setPosts((await request("/api/admin/blog")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadAudit = async () => { setModuleLoading(true); try { setAuditLogs((await request("/api/admin/audit-logs")).data || []); } catch (error) { setMessage(mensajeDeError(error)); } finally { setModuleLoading(false); } };
  const loadNotifications = async () => { try { const payload = await request("/api/admin/notifications"); setNotifications(payload.data || []); setUnreadNotifications(payload.unread || 0); } catch (error) { setMessage(mensajeDeError(error)); } };
  const markNotificationsRead = async () => { try { await request("/api/admin/notifications/read", { method: "PATCH" }); setNotifications((current) => current.map((item) => ({ ...item, readAt: new Date().toISOString() }))); setUnreadNotifications(0); } catch (error) { setMessage(mensajeDeError(error)); } };
  useEffect(() => { document.documentElement.dataset.theme = theme; setStoredValue("authentiq_theme", theme); }, [theme]);
  useEffect(() => {
    if (impersonation?.token || token || currentUser) {
      setSessionResolved(true);
      return undefined;
    }
    let cancelled = false;
    fetch(`${apiUrl}/api/auth/me`, { credentials: "include" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled) return;
        if (payload?.user) setCurrentUser(payload.user);
        setSessionResolved(true);
      })
      .catch(() => { if (!cancelled) setSessionResolved(true); });
    return () => { cancelled = true; };
  }, [impersonation?.token, token, currentUser?.id]);
  useEffect(() => {
    const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
    const primaryColor = validColor(settings.primaryColor, "#c8a24b");
    const accentColor = validColor(settings.accentColor, "#b28b37");
    document.documentElement.style.setProperty("--tenant-primary", primaryColor);
    document.documentElement.style.setProperty("--tenant-accent", accentColor);
    // Se publican las variantes calculadas, no el token final: escribir
    // `--tenant-primary-ink` como estilo inline en <html> gana siempre contra la
    // regla `html[data-theme="dark"]` de styles.css, que apunta a ese mismo
    // elemento, y dejaba el backoffice en modo oscuro con el dorado calculado
    // para fondo claro (3.37:1). Mismo criterio que en App.jsx; el CSS elige.
    // La referencia es #ebe6dc, la superficie clara más oscura del sistema.
    document.documentElement.style.setProperty("--tenant-primary-ink-light", contrastSafeShade(primaryColor, "#ebe6dc"));
    document.documentElement.style.setProperty("--tenant-accent-ink-light", contrastSafeShade(accentColor, "#ebe6dc"));
    document.documentElement.style.setProperty("--tenant-on-primary", readableInkOn(primaryColor));
    document.documentElement.style.setProperty("--tenant-primary-hover", lighten(primaryColor));
    document.documentElement.style.setProperty("--tenant-primary-on-dark", contrastSafeTint(primaryColor, "#111315"));
    document.documentElement.style.setProperty("--tenant-accent-on-dark", contrastSafeTint(accentColor, "#111315"));
    const favicon = document.querySelector("link[data-authentiq-favicon]");
    if (favicon) favicon.href = settings.faviconUrl || "/favicon.svg";
  }, [settings.primaryColor, settings.accentColor, settings.faviconUrl]);
  useEffect(() => { if (!sessionResolved || !currentUser) return; const role = currentUser.role; loadDashboard(); loadNotifications(); if (["admin", "editor", "seller"].includes(role)) { loadVehicles(); loadOffers(); loadQuotes(); loadAnalytics(); loadLeads(); loadContacts(); loadAppointments(); loadUsers(); loadWorkQueue(); } if (["admin", "editor"].includes(role)) { loadAppointmentBlocks(); loadTaxonomy(); loadSettings(); loadOnboarding(); } if (["admin", "editor", "content_editor"].includes(role)) { loadBlog(); loadSocialDrafts(); } if (role === "admin") { loadAudit(); loadManagedUsers(); loadOrganization(); loadIntegrations(); } }, [sessionResolved, currentUser?.role]);
  const onboardingStorageKey = currentUser?.id ? `authentiq_onboarding_seen_${currentUser.id}` : "";
  useEffect(() => {
    if (!currentUser || currentUser?.role !== "admin" || !onboarding || onboarding.progress >= 100 || !onboardingStorageKey) { setWelcomeOnboardingOpen(false); return undefined; }
    if (getStoredValue(onboardingStorageKey) === "1") return undefined;
    const timer = window.setTimeout(() => {
      setActiveModule("settings");
      setWelcomeOnboardingOpen(true);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [currentUser?.id, currentUser?.role, onboarding?.progress, onboardingStorageKey]);
  const handleLogin = async (event) => { event.preventDefault(); setLoginError(""); try { const response = await fetch(`${apiUrl}/api/auth/login`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(login) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión"); if (payload.mfaRequired) { setMfaChallenge(payload.challengeToken || ""); setMfaCode(""); return; } setCurrentUser(payload.user); setToken(payload.token || ""); setSessionResolved(true); } catch (error) { setLoginError(mensajeDeError(error)); } };
  const submitMfaChallenge = async (event) => { event.preventDefault(); setLoginError(""); try { const response = await fetch(`${apiUrl}/api/auth/mfa/challenge`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken: mfaChallenge, code: mfaCode }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo validar el código"); setCurrentUser(payload.user); setToken(payload.token || ""); setMfaChallenge(""); setMfaCode(""); setSessionResolved(true); } catch (error) { setLoginError(mensajeDeError(error)); } };
  const submitRecovery = async (event) => { event.preventDefault(); setRecoveryState({ loading: true, message: "", error: "" }); try { const response = await fetch(`${apiUrl}/api/auth/password-reset/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: recoveryEmail }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo preparar la recuperación"); setRecoveryState({ loading: false, message: payload.message, error: "" }); } catch (error) { setRecoveryState({ loading: false, message: "", error: mensajeDeError(error) }); } };
  // window.close() solo funciona si el navegador reconoce que esta pestaña se abrió
  // por script (como hace impersonateDealer en PlatformCenter); si no, no pasa nada
  // y cae al respaldo de volver a la pantalla pública en esta misma pestaña.
  const exitImpersonation = () => { window.close(); onBack(); };
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const generate3d = async (vehicleId, files) => { const body = new FormData(); files.forEach((file) => body.append("images", file, file.name)); const response = await fetch(`${apiUrl}/api/admin/vehicles/${vehicleId}/3d-generation`, { method: "POST", credentials: "include", body }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo iniciar la generación 3D"); return payload.data; };
  const refresh3d = async (vehicleId, jobId) => (await request(`/api/admin/vehicles/${vehicleId}/3d-generation/${jobId}/refresh`)).data;
  const edit = async (vehicle) => { if (!(await navigateAdmin("inventory"))) return; const media = vehicle.media || []; setEditingId(vehicle.id); setForm({ ...vehicle, features: (vehicle.features || []).join(", "), images: (vehicle.images || []).map((image) => image.url).join(", "), imageAltTexts: (vehicle.images || []).map((image) => image.altText || "").join("\n"), media3dUrl: media.find((item) => item.type === "model_3d")?.url || "", videoUrl: media.find((item) => item.type === "video")?.url || "", videoPosterUrl: media.find((item) => item.type === "video")?.posterUrl || "", panorama360Url: media.find((item) => item.type === "panorama_360")?.url || "" }); };
  const save = async (event) => { event.preventDefault(); setMessage(""); const images = String(form.images || "").split(",").map((image) => image.trim()).filter(Boolean); const isPublishing = ["pending_review", "published"].includes(form.status); if (isPublishing && (!images.length || String(form.description || "").trim().length < 40)) { setMessage("Para publicar agrega al menos una foto y una descripción de 40 caracteres."); return; } const model3dUrl = String(form.media3dUrl || "").trim(); const videoUrl = String(form.videoUrl || "").trim(); const media = [{ type: "model_3d", url: model3dUrl }, { type: "video", url: videoUrl, posterUrl: String(form.videoPosterUrl || "").trim() || images[0] || "" }, { type: "panorama_360", url: form.panorama360Url }].filter((item) => String(item.url || "").trim()); const autoSeoTitle = String(form.seoTitle || "").trim() || `${form.brand} ${form.model} ${form.year} | ZEVROA`; const autoSeoDescription = String(form.seoDescription || "").trim() || String(form.description || "").trim().slice(0, 160); /* Posicional: sin filter(Boolean), que desplazaba los alt a la imagen equivocada. */ const altLines = String(form.imageAltTexts || "").split(/\r?\n/).map((item) => item.trim()); const imageAltTexts = images.map((_, index) => altLines[index] || `${form.brand} ${form.model} ${form.year} · vista ${index + 1}`); const body = { ...form, seoTitle: autoSeoTitle, seoDescription: autoSeoDescription, media3dUrl: model3dUrl, year: Number(form.year), priceUsd: Number(form.priceUsd), doors: form.doors === "" ? null : Number(form.doors), seats: form.seats === "" ? null : Number(form.seats), mileageKm: Number(form.mileageKm), stock: Number(form.stock), maxDiscountPercent: Number(form.maxDiscountPercent), features: String(form.features || "").split(",").map((item) => item.trim()).filter(Boolean), images, imageAltTexts, media }; try { const payload = await request(editingId ? `/api/admin/vehicles/${editingId}` : "/api/admin/vehicles", { method: editingId ? "PUT" : "POST", body: JSON.stringify(body) }); onVehiclesChanged?.(payload?.data); setForm(emptyVehicle); setEditingId(null); setMessage("Vehículo guardado correctamente"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const uploadImage = async (file) => { const body = new FormData(); body.append("file", file); const response = await fetch(`${apiUrl}/api/admin/media-upload`, { method: "POST", credentials: "include", body }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo subir el archivo"); return payload.data.url; };
  const uploadMediaPackage = async (files) => { const body = new FormData(); files.forEach((file) => body.append("files", file, file.webkitRelativePath || file.name)); const response = await fetch(`${apiUrl}/api/admin/media-package-upload`, { method: "POST", credentials: "include", body }); const payload = await response.json(); if (!response.ok) { const missing = payload.missingCount ? ` Faltan ${payload.missingCount} dependencias.` : ""; throw new Error(`${payload.error || "No se pudo subir la carpeta 3D"}${missing}`); } return payload.data.url; };
  const deactivate = async (id) => { if (!(await confirm({ title: "Archivar vehículo", message: "El vehículo dejará de aparecer en el inventario activo y no será visible públicamente.", confirmLabel: "Archivar vehículo", danger: true }))) return; try { await request(`/api/admin/vehicles/${id}`, { method: "DELETE" }); setMessage("Vehículo archivado"); setToastAction({ label: "Deshacer", onClick: async () => { try { await request(`/api/admin/vehicles/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "draft" }) }); setToastAction(null); setMessage("Vehículo restaurado como borrador"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setToastAction(null); setMessage(mensajeDeError(error)); } } }); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const duplicateVehicle = async (id) => { try { await request(`/api/admin/vehicles/${id}/duplicate`, { method: "POST" }); setMessage("Vehículo duplicado como borrador"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const changeVehicleStatus = async (id, status) => { const statusLabel = status === "sold" ? "vendido" : status === "inactive" ? "inactivo" : status === "published" ? "publicado" : "borrador"; if (["sold", "inactive", "published"].includes(status) && !(await confirm({ title: `${status === "published" ? "Publicar" : "Marcar como"} vehículo`, message: status === "published" ? "Quedará visible en el catálogo y podrá compartirse públicamente." : `El estado del vehículo pasará a ${statusLabel}.`, confirmLabel: status === "published" ? "Publicar vehículo" : "Cambiar estado", danger: status !== "published" }))) return; try { await request(`/api/admin/vehicles/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Estado actualizado"); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const bulkVehicles = async (ids, operation) => { try { const payload = await request("/api/admin/vehicles/bulk", { method: "POST", body: JSON.stringify({ ids, operation }) }); setMessage(`${payload.data.updated} vehículos actualizados`); await Promise.all([loadVehicles(), loadDashboard()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const exportVehicles = async () => { try { const response = await fetch(`${apiUrl}/api/admin/export/vehicles.csv`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "No se pudo exportar el inventario"); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `zevroa-inventario-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); setMessage("Inventario exportado"); } catch (error) { setMessage(mensajeDeError(error)); } };
  const reviewVehicle = async (id, decision) => { try { await request("/api/admin/vehicles/" + id + "/review", { method: "PATCH", body: JSON.stringify({ decision }) }); setMessage(decision === "approve" ? "Vehículo aprobado y publicado" : "Vehículo devuelto a borrador"); await Promise.all([loadVehicles(), loadDashboard(), loadNotifications()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const previewVehicle = () => { const media = [{ type: "model_3d", url: form.media3dUrl }, { type: "video", url: form.videoUrl, posterUrl: form.videoPosterUrl }, { type: "panorama_360", url: form.panorama360Url }].filter((item) => String(item.url || "").trim()); const preview = { ...form, id: "preview", priceUsd: Number(form.priceUsd || 0), mileageKm: Number(form.mileageKm || 0), media, images: String(form.images || "").split(",").map((url) => url.trim()).filter(Boolean).map((url, index) => ({ id: `preview-${index}`, url, sortOrder: index })) }; sessionStorage.setItem("authentiq_vehicle_preview", JSON.stringify(preview)); window.open("/preview", "_blank", "noopener,noreferrer"); };
  const updateStatus = async (kind, id, status) => { if (["cancelled", "rejected"].includes(status) && !(await confirm({ title: status === "cancelled" ? "Cancelar registro" : "Rechazar registro", message: `El registro quedará marcado como ${status === "cancelled" ? "cancelado" : "rechazado"}.`, confirmLabel: status === "cancelled" ? "Cancelar registro" : "Rechazar", danger: true }))) return; try { await request(`/api/admin/${kind}/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Estado actualizado correctamente"); await Promise.all([loadOffers(), loadDashboard()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const updateLead = async (id, values) => { try { const current = leads.find((lead) => lead.id === id) || {}; const payload = { status: current.status || "new", notes: current.notes || "", assignedTo: current.assignedToId || "", priority: current.priority || 2, nextAction: current.nextAction || "", nextActionAt: current.nextActionAt || "", lostReason: current.lostReason || "", updatedAt: current.updatedAt || "", ...values }; await request(`/api/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify(payload) }); await Promise.all([loadLeads(), loadDashboard()]); return true; } catch (error) { setMessage(mensajeDeError(error)); return false; } };
  const updateAppointment = async (id, status) => { if (status === "cancelled" && !(await confirm({ title: "Cancelar cita", message: "La cita se marcará como cancelada y dejará de ocupar ese horario.", confirmLabel: "Cancelar cita", danger: true }))) return; try { await request(`/api/admin/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Cita actualizada correctamente"); await loadAppointments(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const createAppointmentFromLead = async (values) => { const payload = await request("/api/admin/appointments", { method: "POST", body: JSON.stringify(values) }); setMessage("Cita confirmada correctamente"); await Promise.all([loadAppointments(), loadLeads(), loadNotifications()]); return payload.data; };
  const createAppointmentBlock = async (values) => { try { await request("/api/admin/appointment-blocks", { method: "POST", body: JSON.stringify(values) }); setMessage("Bloqueo guardado correctamente"); await Promise.all([loadAppointmentBlocks(), loadAppointments()]); } catch (error) { setMessage(mensajeDeError(error)); throw error; } };
  const deleteAppointmentBlock = async (id) => { if (!(await confirm({ title: "Eliminar bloqueo", message: "El horario volverá a estar disponible para nuevas citas.", confirmLabel: "Eliminar bloqueo", danger: true }))) return; try { await request(`/api/admin/appointment-blocks/${id}`, { method: "DELETE" }); setMessage("Bloqueo eliminado"); await Promise.all([loadAppointmentBlocks(), loadAppointments()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const createQuote = async (values) => { try { await request("/api/admin/quotes", { method: "POST", body: JSON.stringify({ ...values, basePriceUsd: Number(values.basePriceUsd), discountUsd: Number(values.discountUsd || 0) }) }); setQuoteLead(null); setMessage("Cotización guardada correctamente"); await loadQuotes(); } catch (error) { setMessage(mensajeDeError(error)); throw error; } };
  const openQuoteForLead = async (lead) => { if (!(await confirmDiscardAdminDraft())) return; setQuoteLead(lead); setActiveModule("quotes"); };
  const updateQuoteStatus = async (id, status) => { try { await request(`/api/admin/quotes/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setMessage("Estado de cotización actualizado"); await loadQuotes(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const shareQuote = async (id) => { const payload = await request(`/api/admin/quotes/${id}/share`, { method: "POST" }); setMessage("Enlace público generado"); await loadQuotes(); return payload.data.url; };
  const changeUser = (field, value) => setUserForm((current) => ({ ...current, [field]: value }));
  const saveUser = async (event) => { event.preventDefault(); setMessage(""); try { await request("/api/admin/users", { method: "POST", body: JSON.stringify(userForm) }); setUserForm(emptyUser); setMessage("Usuario creado correctamente"); await Promise.all([loadManagedUsers(), loadUsers()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const inviteUser = async (values) => { const payload = await request("/api/admin/invitations", { method: "POST", body: JSON.stringify(values) }); return payload.data; };
  const setupMfa = async (values = null) => (await request(values ? "/api/admin/mfa/verify" : "/api/admin/mfa/setup", { method: "POST", body: JSON.stringify(values || {}) })).data;
  const updateUser = async (user, values) => { try { await request(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ name: user.name, ...values }) }); await Promise.all([loadManagedUsers(), loadUsers()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const resetUserPassword = async (id) => { try { return (await request(`/api/admin/users/${id}/reset-password`, { method: "POST" })).data; } catch (error) { setMessage(mensajeDeError(error)); return null; } };
  const deleteUser = async (user) => { try { await request(`/api/admin/users/${user.id}`, { method: "DELETE" }); setMessage("Usuario eliminado correctamente"); await Promise.all([loadManagedUsers(), loadUsers()]); } catch (error) { setMessage(mensajeDeError(error)); } };
  const createTaxonomy = async (kind, values) => { try { await request(`/api/admin/taxonomy/${kind}`, { method: "POST", body: JSON.stringify(values) }); setMessage("Registro agregado al catálogo"); await loadTaxonomy(); } catch (error) { setMessage(mensajeDeError(error)); throw error; } };
  const updateTaxonomy = async (kind, record) => { const name = await prompt({ title: `Editar ${kind === "brands" ? "marca" : "categoría"}`, message: "Actualiza el nombre que verá el equipo al crear vehículos.", label: "Nombre", defaultValue: record.name, required: true, confirmLabel: "Continuar" }); if (name === null) return; const isActive = record.isActive ? await confirm({ title: "Mantener registro activo", message: "Si lo mantienes activo, seguirá apareciendo en el asistente de inventario.", confirmLabel: "Mantener activa" }) : true; if (isActive === null) return; const logoUrl = kind === "brands" ? await prompt({ title: "Logo de la marca", message: "Puedes dejarlo vacío si no quieres cambiarlo.", label: "Logo URL", defaultValue: record.logoUrl || "", placeholder: "https://.../logo.svg", confirmLabel: "Guardar marca" }) : ""; if (logoUrl === null) return; try { await request(`/api/admin/taxonomy/${kind}/${record.id}`, { method: "PATCH", body: JSON.stringify({ name, logoUrl, isActive }) }); setMessage("Catálogo actualizado"); await loadTaxonomy(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const changeSettings = (field, value) => setSettings((current) => ({ ...current, [field]: value }));
  const changeOrganization = (field, value) => setOrganization((current) => ({ ...current, [field]: value }));
  const saveSettings = async (event) => { event.preventDefault(); setMessage(""); try { const normalizedSettings = { ...settings, phone: normalizePhone(settings.phone), whatsapp: normalizePhone(settings.whatsapp) }; const payload = await request("/api/admin/settings", { method: "PATCH", body: JSON.stringify(normalizedSettings) }); setSettings(payload.data); if (payload.data?.currency) setStoredValue("authentiq_currency", String(payload.data.currency).trim().toUpperCase()); setMessage("Configuración guardada correctamente"); await loadOnboarding(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const saveOrganization = async (event) => { event.preventDefault(); setOrganizationMessage(""); try { const payload = await request("/api/admin/organization", { method: "PATCH", body: JSON.stringify(organization) }); setOrganization(payload.data); setOrganizationMessage("Perfil guardado correctamente"); await loadOnboarding(); } catch (error) { setOrganizationMessage(mensajeDeError(error)); } };
  const saveIntegration = async (provider, config) => { try { await request(`/api/admin/integrations/${provider}`, { method: "PATCH", body: JSON.stringify({ config }) }); setMessage("Integración local actualizada"); await loadIntegrations(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const connectGoogleCalendar = async () => { if (currentUser?.role !== "admin") { setMessage("Esta conexión la configura el dueño del concesionario."); return; } try { const payload = await request("/api/admin/integrations/google-calendar/connect"); if (!payload?.data?.authorizationUrl) throw new Error("No se pudo preparar la autorización de Google"); window.location.assign(payload.data.authorizationUrl); } catch (error) { setMessage(mensajeDeError(error)); } };
  const startBillingCheckout = async (planCode = "starter") => { try { const payload = await request("/api/admin/billing/checkout", { method: "POST", body: JSON.stringify({ planCode }) }); if (!payload?.data?.url) throw new Error("Stripe no devolvió una URL de checkout"); window.location.assign(payload.data.url); } catch (error) { setMessage(mensajeDeError(error)); } };
  const createSocialDraft = async (values) => { try { await request("/api/admin/social/drafts", { method: "POST", body: JSON.stringify(values) }); setMessage("Borrador social guardado"); await loadSocialDrafts(); } catch (error) { setMessage(mensajeDeError(error)); throw error; } };
  const exportCalendar = async () => { try { const response = await fetch(`${apiUrl}/api/admin/calendar.ics`, { credentials: "include", ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }); if (!response.ok) throw new Error("No se pudo exportar la agenda"); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "agenda-showroom.ics"; link.click(); URL.revokeObjectURL(url); setMessage("Agenda descargada correctamente"); } catch (error) { setMessage(mensajeDeError(error)); } };
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  const changeBlog = (field, value) => setBlogForm((current) => ({ ...current, [field]: value }));
  const editBlog = async (post) => { if (!(await navigateAdmin("blog"))) return; setEditingPostId(post.id); setBlogForm({ ...emptyBlog, ...post }); };
  const saveBlog = async (event) => { event.preventDefault(); setMessage(""); try { await request(editingPostId ? `/api/admin/blog/${editingPostId}` : "/api/admin/blog", { method: editingPostId ? "PUT" : "POST", body: JSON.stringify(blogForm) }); setBlogForm(emptyBlog); setEditingPostId(null); setMessage("Artículo guardado correctamente"); await loadBlog(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const archiveBlog = async (id) => { if (!(await confirm({ title: "Archivar artículo", message: "El artículo dejará de aparecer publicado, pero podrás conservarlo en el panel.", confirmLabel: "Archivar artículo", danger: true }))) return; try { await request(`/api/admin/blog/${id}`, { method: "DELETE" }); setMessage("Artículo archivado"); await loadBlog(); } catch (error) { setMessage(mensajeDeError(error)); } };
  const logout = async () => { if (!(await confirmDiscardAdminDraft())) return; await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {}); queryClient.removeQueries({ queryKey: ["admin", currentUser?.id || "session"] }); setCurrentUser(null); setToken(""); setSessionResolved(true); };
  const handleBack = async () => { if (await confirmDiscardAdminDraft()) onBack(); };
  const openOnboarding = () => { if (onboardingStorageKey) removeStoredValue(onboardingStorageKey); setActiveModule("settings"); setWelcomeOnboardingOpen(true); };
  const dismissOnboarding = () => { if (onboardingStorageKey) setStoredValue(onboardingStorageKey, "1"); setWelcomeOnboardingOpen(false); };
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
      setCurrentUser(payload.user);
      setToken(payload.token || "");
      setSessionResolved(true);
    } catch (error) { setPasswordChangeError(mensajeDeError(error)); } finally { setPasswordChangeLoading(false); }
  };

  if (!sessionResolved) return <main className="admin-page"><p className="state-message">Comprobando tu sesión…</p></main>;
  if (!token && !currentUser) {
    const invitationToken = new URLSearchParams(window.location.search).get("invite")?.trim() || "";
    if (invitationToken) return <InvitationAcceptance token={invitationToken} onBack={onBack} onAccepted={(email) => { setLogin({ email, password: "" }); setAuthMode("login"); const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`; window.history.replaceState({}, "", cleanUrl); }} />;
    if (authMode === "register") {
      return (
        <main className="admin-page admin-login-page dealer-register-page">
          <button className="back-button" type="button" onClick={onBack}>← Volver a ZEVROA</button>
          {/* El alta venía del landing oscuro y caía en una página crema medio vacía.
              Esta columna mantiene la identidad y responde lo que el dealer se pregunta
              antes de dar su correo: qué recibe, qué cuesta y qué pasa después. */}
          <aside className="register-brand" aria-label="Qué incluye crear tu showroom">
            <div>
              <span className="register-brand-mark">ZEVROA<i>°</i></span>
              <h2>Tu showroom en línea, listo esta misma tarde.</h2>
              <p>Publicas tu inventario una vez y tu vitrina, tus clientes y tus citas quedan en el mismo sitio.</p>
            </div>
            <ul className="register-brand-points">
              <li><strong>14 días de prueba</strong><span>No pedimos tarjeta para empezar.</span></li>
              <li><strong>Tu dirección incluida</strong><span>Sin comprar dominio ni contratar hosting.</span></li>
              <li><strong>Sin permanencia</strong><span>Cancelas cuando quieras desde el panel.</span></li>
            </ul>
            <ol className="register-brand-steps">
              <li><b>1</b><span>Creas la cuenta — dos minutos.</span></li>
              <li><b>2</b><span>Personalizas logo, contacto y horario.</span></li>
              <li><b>3</b><span>Publicas tu primer vehículo y compartes el enlace.</span></li>
            </ol>
          </aside>
          <DealerRegistrationWizard
            apiUrl={apiUrl}
            onCancel={() => setAuthMode("login")}
            onRegisterSuccess={(payload) => {
              setCurrentUser(payload.user);
              setToken(payload.token || "");
              setSessionResolved(true);
              setActiveModule("settings");
              setAuthMode("login");
            }}
          />
        </main>
      );
    }
    if (authMode === "forgot") {
      return <main className="admin-page admin-login-page"><button className="back-button" type="button" onClick={() => setAuthMode("login")}>← Volver al acceso</button><form className="admin-login" onSubmit={submitRecovery}><span className="eyebrow">ZEVROA · SEGURIDAD</span><h1>Recupera tu <em>acceso.</em></h1><p className="account-welcome">Te enviaremos un enlace si existe una cuenta con ese correo.</p><label>Correo<input type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} autoComplete="email" required /></label>{recoveryState.message && <p className="state-message success" role="status">{recoveryState.message}</p>}{recoveryState.error && <p className="state-message error" role="alert">{recoveryState.error}</p>}<button className="primary-action" type="submit" disabled={recoveryState.loading}>{recoveryState.loading ? "Enviando…" : "Enviar enlace"}</button></form></main>;
    }
    if (mfaChallenge) return <main className="admin-page admin-login-page"><button className="back-button" type="button" onClick={() => { setMfaChallenge(""); setMfaCode(""); }}>← Volver al acceso</button><form className="admin-login" onSubmit={submitMfaChallenge}><span className="eyebrow">ZEVROA · SEGURIDAD</span><h1>Confirma tu <em>identidad.</em></h1><p className="account-welcome">Escribe el código de 6 dígitos de tu aplicación autenticadora. También puedes usar un código de recuperación.</p><label>Código de autenticación<input inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 8))} autoFocus required /></label>{loginError && <p className="state-message error" role="alert">{loginError}</p>}<button className="primary-action" type="submit">Verificar y entrar</button></form></main>;
    return (
      <main className="admin-page admin-login-page">
        <button className="back-button" type="button" onClick={onBack}>← Volver al catálogo</button>
        <form className="admin-login" onSubmit={handleLogin}>
          <span className="eyebrow">ZEVROA · PANEL DE CONTROL</span>
          <h1>Acceso <em>administrativo.</em></h1>
          <p className="account-welcome admin-login-copy">
            Gestiona tu inventario, cotizaciones, clientes y herramientas comerciales en tiempo real.
          </p>
          <label>Correo<input type="email" value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} placeholder="admin@tuconcesionario.com" autoComplete="username" required /></label>
          <label>Contraseña<input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Tu contraseña" autoComplete="current-password" required /></label>
          {loginError && <p className="state-message error" role="alert">{loginError}</p>}
          <button className="primary-action" type="submit">Entrar al panel</button>
          <button className="text-button" type="button" onClick={() => { setRecoveryEmail(login.email); setRecoveryState({ loading: false, message: "", error: "" }); setAuthMode("forgot"); }}>¿Olvidaste tu contraseña?</button>
          <div className="dealer-login-switch">
            <p>¿Quieres tener tu propio showroom con tu marca y catálogo?</p>
            <button className="secondary-action" type="button" onClick={() => setAuthMode("register")}>
              Crear nuevo showroom de concesionario →
            </button>
          </div>
        </form>
      </main>
    );
  }

  // Una contraseña restablecida por un administrador solo sirve para llegar hasta aquí:
  // el backend también bloquea cualquier otra ruta mientras esta bandera siga activa.
  if (currentUser?.mustChangePassword) return <main className="admin-page admin-login-page"><form className="admin-login" onSubmit={submitPasswordChange}><span className="eyebrow">ZEVROA · PANEL DE CONTROL</span><h1>Define tu <em>nueva contraseña.</em></h1><p className="account-welcome">Tu contraseña fue restablecida por un administrador. Elige una nueva antes de continuar.</p><label>Nueva contraseña<input type="password" name="newPassword" minLength="8" autoComplete="new-password" required /></label>{passwordChangeError && <p className="state-message error">{passwordChangeError}</p>}<button className="primary-action" type="submit" disabled={passwordChangeLoading}>{passwordChangeLoading ? "Guardando…" : "Guardar y continuar"}</button><button className="text-button" type="button" onClick={logout}>Cerrar sesión</button></form></main>;
  if (currentUser?.role === "platform_admin") return <Suspense fallback={<main className="admin-page"><p className="state-message">Cargando administración de plataforma…</p></main>}><PlatformCenter token={token} user={currentUser} onLogout={logout} onBack={onBack} /></Suspense>;

  // "?preview=1" fuerza al SPA a resolver la organización por el JWT de esta sesión en
  // vez de por el dominio actual: funciona sin importar si ya hay dominio propio asignado.
  const openPublic = () => window.open("/?preview=1", "_blank", "noopener,noreferrer");
  const activeView = activeModule === "dashboard" ? <DashboardView data={dashboard} vehicles={vehicles} leads={leads} offers={offers} appointments={appointments} loading={moduleLoading} error={dashboardError} onRetry={loadDashboard} onNavigate={navigateAdmin} onOpenLead={openLeadFromDashboard} onOpenContact={openContactFromWork} onboarding={onboarding} onOpenOnboarding={openOnboarding} onOpenPublic={openPublic} organization={organization} settings={settings} currentUser={currentUser} workQueue={workQueue} workQueueLoading={workQueueLoading} workQueueError={workQueueError} onRefreshWorkQueue={loadWorkQueue} /> : activeModule === "inventory" ? <InventoryModule vehicles={vehicles} form={form} editingId={editingId} loading={loading} message={message} onChange={change} onSave={save} onEdit={edit} onCancel={() => { setEditingId(null); setForm(emptyVehicle); }} onDeactivate={deactivate} onDuplicate={duplicateVehicle} onRefresh={loadVehicles} onUpload={uploadImage} onPackageUpload={uploadMediaPackage} onReview={reviewVehicle} onStatusChange={changeVehicleStatus} onBulk={bulkVehicles} onExport={exportVehicles} onOpenSticker={setStickerVehicle} onOpenSocial={() => navigateAdmin("integrations")} /> : activeModule === "leads" ? <div className="customers-module-shell"><div className="customer-view-switcher" role="tablist" aria-label="Vista de clientes"><button type="button" role="tab" aria-selected={customersView === "crm"} className={customersView === "crm" ? "active" : ""} onClick={() => setCustomersView("crm")}>Clientes</button><button type="button" role="tab" aria-selected={customersView === "pipeline"} className={customersView === "pipeline" ? "active" : ""} onClick={() => setCustomersView("pipeline")}>Seguimiento</button></div>{customersView === "crm" ? <ContactsModule contacts={contacts} users={users} loading={moduleLoading} error={contactsError} selectedContact={selectedContact} detail={contactDetail} timeline={contactTimeline} detailLoading={contactDetailLoading} detailError={contactDetailError} canAssign={["admin", "editor"].includes(currentUser?.role)} onRefresh={loadContacts} onSelect={selectContact} onAddNote={addContactNote} onAssign={assignContact} onOpenLead={(id) => { setCustomersView("pipeline"); setLeadFocusId(id); }} onCreateAppointment={setAppointmentLead} onCreateQuote={openQuoteForLead} onOpenPipeline={() => setCustomersView("pipeline")} /> : <LeadsControlRoom records={leads} users={users} loading={moduleLoading} onRefresh={loadLeads} onUpdate={updateLead} onLoadHistory={loadLeadHistory} onAddAppointment={setAppointmentLead} onCreateQuote={openQuoteForLead} initialLeadId={leadFocusId} />}</div> : activeModule === "appointments" ? <AppointmentsModule appointments={appointments} blocks={appointmentBlocks} loading={moduleLoading} onRefresh={() => Promise.all([loadAppointments(), loadAppointmentBlocks()])} onStatusChange={updateAppointment} onCreateBlock={createAppointmentBlock} onDeleteBlock={deleteAppointmentBlock} canManageBlocks={["admin", "editor"].includes(currentUser?.role)} /> : activeModule === "quotes" ? <QuotesModule quotes={quotes} leads={leads} vehicles={vehicles} loading={moduleLoading} initialLead={quoteLead} onRefresh={loadQuotes} onCreate={createQuote} onStatusChange={updateQuoteStatus} onShare={shareQuote} /> : activeModule === "blog" ? <BlogModule posts={posts} form={blogForm} editingId={editingPostId} loading={moduleLoading} message={message} onChange={changeBlog} onSave={saveBlog} onEdit={editBlog} onCancel={() => { setEditingPostId(null); setBlogForm(emptyBlog); }} onArchive={archiveBlog} onRefresh={loadBlog} /> : activeModule === "offers" ? <RecordsModule kind="offers" records={offers} loading={moduleLoading} onRefresh={loadOffers} onStatusChange={(id, status) => updateStatus("offers", id, status)} /> : activeModule === "reports" ? <ReportsModule dashboard={dashboard} vehicles={vehicles} leads={leads} offers={offers} loading={moduleLoading} analytics={analytics} funnelData={funnelData} /> : activeModule === "audit" ? <AuditModule logs={auditLogs} loading={moduleLoading} onRefresh={loadAudit} /> : activeModule === "users" ? <UsersModule users={managedUsers} form={userForm} onChange={changeUser} onSave={saveUser} onUpdate={updateUser} onResetPassword={resetUserPassword} onDelete={deleteUser} onInvite={inviteUser} onMfaSetup={setupMfa} loading={moduleLoading} message={message} /> : activeModule === "subscription" ? <SubscriptionModule billing={billing} plans={billingPlans} health={integrationHealth} onRefresh={loadIntegrations} onStartBillingCheckout={startBillingCheckout} /> : activeModule === "integrations" ? <IntegrationsModule integrations={integrations} billing={billing} health={integrationHealth} drafts={socialDrafts} vehicles={vehicles} organization={organization} settings={settings} loading={moduleLoading} onRefresh={() => Promise.all([loadIntegrations(), loadSocialDrafts()])} onCreateDraft={createSocialDraft} onExportCalendar={exportCalendar} onConnectGoogleCalendar={connectGoogleCalendar} /> : <SettingsModule form={settings} organization={organization} onboarding={onboarding} onChange={changeSettings} onOrganizationChange={changeOrganization} onSave={saveSettings} onOrganizationSave={saveOrganization} onUpload={uploadImage} onNavigate={navigateAdmin} onOpenPublic={openPublic} loading={moduleLoading} message={message} organizationMessage={organizationMessage} />;
  return (
    <main className="admin-page">
      {impersonation && <div className="impersonation-banner"><span>Modo soporte · viendo la cuenta de <strong>{currentUser?.name || currentUser?.email}</strong>. Los cambios se guardan en su cuenta real.</span><button className="text-button" type="button" onClick={exitImpersonation}>Salir del modo soporte</button></div>}
      <AdminNav activeModule={activeModule} onChange={navigateAdmin} onBack={handleBack} onLogout={logout} role={currentUser?.role} unreadNotifications={unreadNotifications} notifications={notifications} onReadNotifications={markNotificationsRead} onPreview={previewVehicle} onOpenPublic={openPublic} onOpenOnboarding={openOnboarding} theme={theme} onToggleTheme={toggleTheme} vehicles={vehicles} businessName={organization?.name || settings?.businessName || "ZEVROA"} />
      <section className="admin-content-column">
        <div className="admin-content-heading"><span>Espacio de trabajo</span><div><strong>{organization?.name || settings?.businessName || "Tu showroom"}</strong><AdminSavedStatus savedAt={lastSavedAt} /></div></div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={activeModule} className="admin-module-transition" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2, ease: "easeOut" }}>
            <Suspense fallback={<div className="admin-loading-state" role="status"><span className="loading-orbit" aria-hidden="true" />Preparando esta herramienta…</div>}>{activeModule === "taxonomy" ? <TaxonomyModule taxonomy={taxonomy} loading={moduleLoading} onRefresh={loadTaxonomy} onCreate={createTaxonomy} onUpdate={updateTaxonomy} /> : activeView}</Suspense>
          </motion.div>
        </AnimatePresence>
      </section>
      <AnimatePresence>{appointmentLead && <LeadAppointmentModal lead={appointmentLead} onClose={() => setAppointmentLead(null)} onCreate={createAppointmentFromLead} />}</AnimatePresence>
      <AnimatePresence>{welcomeOnboardingOpen && onboarding && <WelcomeOnboarding onboarding={onboarding} organization={organization} onNavigate={navigateAdmin} onDismiss={dismissOnboarding} onOpenPublic={openPublic} />}</AnimatePresence>
      <AnimatePresence>{stickerVehicle && <Suspense fallback={null}><WindowStickerModal vehicle={stickerVehicle} organization={organization} settings={settings} onClose={() => setStickerVehicle(null)} /></Suspense>}</AnimatePresence>
      <AnimatePresence><AdminToast message={message} action={toastAction} /></AnimatePresence>
    </main>
  );
}

export default function Backoffice(props) {
  return <AdminDialogsProvider><BackofficeWorkspace {...props} /></AdminDialogsProvider>;
}


