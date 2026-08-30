import { useEffect, useMemo, useState } from "react";
import VirtualizedList from "../ui/VirtualizedList.jsx";
import { formatDate, formatDateTime, formatStatus } from "./format.js";

const timelineLabels = {
  lead_new: "Lead recibido",
  lead_contacted: "Cliente contactado",
  lead_qualified: "En negociación",
  lead_closed: "Venta ganada",
  lead_lost: "Oportunidad perdida",
  appointment_pending: "Cita solicitada",
  appointment_confirmed: "Cita confirmada",
  appointment_completed: "Cita completada",
  appointment_cancelled: "Cita cancelada",
  quote_draft: "Cotización en borrador",
  quote_sent: "Cotización enviada",
  quote_accepted: "Cotización aceptada",
  quote_expired: "Cotización vencida",
  quote_cancelled: "Cotización cancelada",
  offer_pending: "Oferta recibida",
  offer_accepted: "Oferta aceptada",
  offer_rejected: "Oferta rechazada",
  internal_note: "Nota interna",
  assignment_changed: "Responsable actualizado",
  lead_received: "Lead histórico",
};

function contactActivity(contact) {
  const items = [
    [contact.leadCount, "lead"],
    [contact.appointmentCount, "cita"],
    [contact.quoteCount, "cotización"],
    [contact.offerCount, "oferta"],
  ].filter(([count]) => Number(count) > 0);
  return items.length ? items.map(([count, label]) => `${count} ${label}${Number(count) === 1 ? "" : "s"}`).join(" · ") : "Sin actividad todavía";
}

function ContactRow({ contact, selected, onSelect }) {
  return <button type="button" className={`crm-contact-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(contact)} aria-pressed={selected}>
    <span className="crm-contact-avatar" aria-hidden="true">{String(contact.fullName || "?").slice(0, 2).toUpperCase()}</span>
    <span className="crm-contact-copy"><strong>{contact.fullName || "Contacto sin nombre"}</strong><small>{contact.email || contact.phone || "Sin datos de contacto"}</small><small>{contactActivity(contact)}</small></span>
    <span className="crm-contact-meta"><b>{contact.latestLeadStatus ? formatStatus(contact.latestLeadStatus) : "Nuevo"}</b><small>{contact.lastActivityAt ? formatDate(contact.lastActivityAt) : "Sin fecha"}</small></span>
  </button>;
}

function ContactTimeline({ items = [] }) {
  if (!items.length) return <p className="empty-state">Todavía no hay eventos para este contacto.</p>;
  return <ol className="crm-timeline" aria-label="Historial del cliente">{items.map((item, index) => <li key={`${item.eventType}-${item.createdAt}-${index}`}><span className="crm-timeline-dot" aria-hidden="true" /><div><strong>{timelineLabels[item.eventType] || String(item.eventType || "Actividad").replaceAll("_", " ")}</strong><p>{item.note || "Actividad registrada"}</p><small>{formatDateTime(item.createdAt)}{item.actorName ? ` · ${item.actorName}` : ""}</small></div></li>)}</ol>;
}

export default function ContactsModule({ contacts = [], users = [], loading = false, error = "", selectedContact, detail, timeline = [], detailLoading = false, detailError = "", canAssign = false, onRefresh, onSelect, onAddNote, onAssign, onOpenLead, onCreateAppointment, onCreateQuote, onOpenPipeline }) {
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return contacts;
    return contacts.filter((contact) => [contact.fullName, contact.email, contact.phone].some((value) => String(value || "").toLowerCase().includes(normalized)));
  }, [contacts, query]);

  useEffect(() => { setNote(""); }, [selectedContact?.id]);

  const saveNote = async (event) => {
    event.preventDefault();
    const value = note.trim();
    if (!value || !selectedContact?.id) return;
    setSavingNote(true);
    try { await onAddNote(selectedContact.id, value); setNote(""); } finally { setSavingNote(false); }
  };
  const lead = detail?.leads?.[0] || null;

  return <section className="contacts-module records-content" aria-labelledby="contacts-title">
    <div className="panel-heading">
      <div><span className="eyebrow">CRM COMERCIAL</span><h2 id="contacts-title">Clientes.</h2><p className="module-note">Un contacto reúne sus solicitudes, citas, propuestas y seguimiento sin duplicar conversaciones.</p></div>
      <div className="panel-actions"><button className="secondary-action" type="button" onClick={onOpenPipeline}>Ver seguimiento</button><button className="secondary-action" type="button" onClick={onRefresh}>Actualizar</button></div>
    </div>
    <div className="crm-workspace">
      <section className="crm-contact-list" aria-label="Lista de clientes">
        <label className="crm-search">Buscar cliente<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o teléfono" /></label>
        <p className="crm-list-summary" aria-live="polite">{visibleContacts.length} de {contacts.length} clientes</p>
        {loading ? <p className="empty-state">Cargando clientes…</p> : error ? <div className="admin-empty-state"><strong>No pudimos cargar el CRM.</strong><p>{error}</p><button type="button" className="secondary-action" onClick={onRefresh}>Reintentar</button></div> : visibleContacts.length ? <VirtualizedList items={visibleContacts} renderItem={(contact) => <ContactRow contact={contact} selected={selectedContact?.id === contact.id} onSelect={onSelect} />} className="crm-contact-virtual-list" estimateSize={92} /> : <p className="empty-state">No hay clientes que coincidan.</p>}
      </section>
      <aside className="crm-contact-detail" aria-live="polite">
        {!selectedContact ? <div className="crm-detail-empty"><span className="eyebrow">CLIENTE</span><h3>Selecciona un cliente.</h3><p>Verás todo el contexto comercial antes de responder o preparar una propuesta.</p></div> : detailLoading ? <p className="empty-state">Cargando historial de {selectedContact.fullName}…</p> : detailError ? <div className="admin-empty-state"><strong>No pudimos abrir este cliente.</strong><p>{detailError}</p><button type="button" className="secondary-action" onClick={() => onSelect(selectedContact)}>Reintentar</button></div> : <>
          <div className="crm-detail-head"><div><span className="eyebrow">CLIENTE ÚNICO</span><h3>{detail?.fullName || selectedContact.fullName}</h3><p>{detail?.email || selectedContact.email || "Sin correo"}{(detail?.email || selectedContact.email) && (detail?.phone || selectedContact.phone) ? " · " : ""}{detail?.phone || selectedContact.phone || "Sin teléfono"}</p></div>{canAssign && <label className="crm-assignment">Responsable<select value={detail?.assignedTo || ""} onChange={(event) => onAssign(selectedContact.id, event.target.value)}><option value="">Sin asignar</option>{users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>}</div>
          <div className="crm-detail-stats"><span><b>{detail?.leads?.length || 0}</b> leads</span><span><b>{detail?.appointments?.length || 0}</b> citas</span><span><b>{detail?.quotes?.length || 0}</b> cotizaciones</span><span><b>{detail?.offers?.length || 0}</b> ofertas</span></div>
          <div className="crm-detail-actions">{lead && <button type="button" className="secondary-action" onClick={() => onOpenLead(lead.id)}>Abrir seguimiento</button>}{lead && <button type="button" className="secondary-action" onClick={() => onCreateAppointment(lead)}>Agendar cita</button>}{lead && <button type="button" className="primary-action" onClick={() => onCreateQuote(lead)}>Crear cotización</button>}</div>
          <form className="crm-note-form" onSubmit={saveNote}><label>Nota interna<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ej. Llamar el jueves para confirmar presupuesto" maxLength={4000} /></label><button type="submit" className="text-button" disabled={!note.trim() || savingNote}>{savingNote ? "Guardando…" : "Guardar nota"}</button></form>
          <ContactTimeline items={timeline} />
        </>}
      </aside>
    </div>
  </section>;
}
