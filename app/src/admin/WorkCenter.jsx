import { useMemo, useState } from "react";
import { ArrowUpRightIcon, CalendarBlankIcon, ChatCircleDotsIcon, CheckCircleIcon, ClockIcon, FileTextIcon, FunnelIcon, HandCoinsIcon, UserCircleIcon } from "@phosphor-icons/react";

const typeLabels = { lead: "Cliente", appointment: "Cita", quote: "Cotización", offer: "Oferta" };
const statusLabels = { new: "Nuevo", contacted: "Contactado", qualified: "En negociación", draft: "Borrador", sent: "Esperando respuesta", pending: "Pendiente", scheduled: "Programada" };

function relativeDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function phoneLink(phone, title, businessName) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const text = encodeURIComponent(`Hola ${title || ""}, te escribimos desde el showroom de ${businessName || "ZEVROA"}.`.trim());
  return `https://wa.me/${digits}?text=${text}`;
}

export default function WorkCenter({ items = [], loading = false, error = "", currentUser, businessName = "ZEVROA", onRefresh, onNavigate, onOpenContact }) {
  const [filter, setFilter] = useState("all");
  const now = Date.now();
  const filtered = useMemo(() => items.filter((item) => {
    if (filter === "mine") return item.assignedTo === currentUser?.id;
    if (filter === "urgent") return item.priority === "high";
    if (filter === "overdue") return item.dueAt && new Date(item.dueAt).getTime() < now;
    return filter === "all" || item.type === filter;
  }), [items, filter, currentUser?.id, now]);

  const navigateFor = (item) => item?.contactId ? onOpenContact?.(item) : onNavigate(item?.type === "lead" ? "leads" : item?.type === "appointment" ? "appointments" : item?.type === "quote" ? "quotes" : "offers");
  return <section className="work-center" aria-labelledby="work-center-title">
    <div className="work-center-head"><div><span className="eyebrow">CENTRO DE TRABAJO</span><h3 id="work-center-title">Lo siguiente que mueve el negocio.</h3><p>Prioriza una acción y mantén cada oportunidad avanzando.</p></div><button className="secondary-action" type="button" onClick={onRefresh}><ClockIcon size={16} aria-hidden="true" />Actualizar</button></div>
    <div className="work-center-toolbar" role="toolbar" aria-label="Filtrar pendientes"><FunnelIcon size={16} aria-hidden="true" /><button type="button" className={filter === "all" ? "is-active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Todo <b>{items.length}</b></button><button type="button" className={filter === "mine" ? "is-active" : ""} aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>Asignado a mí</button><button type="button" className={filter === "urgent" ? "is-active" : ""} aria-pressed={filter === "urgent"} onClick={() => setFilter("urgent")}>Urgente</button><button type="button" className={filter === "overdue" ? "is-active" : ""} aria-pressed={filter === "overdue"} onClick={() => setFilter("overdue")}>Vencido</button></div>
    {loading ? <div className="work-center-empty"><span className="loading-orbit" aria-hidden="true" />Cargando pendientes…</div> : error ? <div className="work-center-empty is-error" role="alert"><strong>No pudimos cargar el centro de trabajo.</strong><span>{error}</span><button className="secondary-action" type="button" onClick={onRefresh}>Reintentar</button></div> : filtered.length ? <div className="work-center-list">{filtered.slice(0, 8).map((item) => { const overdue = item.dueAt && new Date(item.dueAt).getTime() < now; const whatsapp = phoneLink(item.phone, item.title, businessName); return <article className={`work-queue-item ${overdue ? "is-overdue" : ""}`} key={`${item.type}-${item.id}`}><div className="work-queue-icon" aria-hidden="true">{item.type === "lead" ? <UserCircleIcon size={20} /> : item.type === "appointment" ? <CalendarBlankIcon size={20} /> : item.type === "quote" ? <FileTextIcon size={20} /> : <HandCoinsIcon size={20} />}</div><div className="work-queue-main"><div className="work-queue-meta"><span>{typeLabels[item.type]}</span>{overdue && <strong>Vencido</strong>}</div><h4>{item.title || "Sin nombre"}</h4><p>{statusLabels[item.status] || item.status || "Pendiente"} · {relativeDate(item.dueAt || item.createdAt)}{item.assignedToName ? ` · ${item.assignedToName}` : ""}</p></div><div className="work-queue-actions">{whatsapp && <a className="icon-action" href={whatsapp} target="_blank" rel="noreferrer" aria-label={`Abrir WhatsApp para ${item.title}`}><ChatCircleDotsIcon size={18} /></a>}<button className="text-button" type="button" onClick={() => navigateFor(item)}>Abrir <ArrowUpRightIcon size={15} aria-hidden="true" /></button></div></article>; })}</div> : <div className="work-center-empty"><CheckCircleIcon size={24} aria-hidden="true" /><strong>No tienes pendientes en este filtro.</strong><span>Cuando llegue un lead, una cita o una cotización, aparecerá aquí.</span></div>}
    {filtered.length > 8 && <button className="work-center-more" type="button" onClick={() => onNavigate("leads")}>Ver {filtered.length - 8} pendientes más →</button>}
  </section>;
}
