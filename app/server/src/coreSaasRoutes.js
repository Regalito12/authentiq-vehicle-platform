const CRM_TABLE_ERROR_CODES = new Set(["42P01", "42703"]);

function organizationIdOf(req) {
  return req.admin?.organizationId || null;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email && email.includes("@") ? email.slice(0, 200) : null;
}

function normalizePhone(value) {
  const phone = String(value || "").replace(/[^0-9]+/g, "");
  return phone ? phone.slice(-60) : null;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, columns, rows) {
  const content = [columns.map((column) => csvCell(column.label)).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(","))].join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` }).send(`\uFEFF${content}\r\n`);
}

function missingCrmSchema(error) {
  return CRM_TABLE_ERROR_CODES.has(error?.code);
}

function requireOrganization(req, res) {
  const organizationId = organizationIdOf(req);
  if (!organizationId) {
    res.status(403).json({ error: "Esta cuenta no tiene un concesionario activo", code: "ORGANIZATION_REQUIRED" });
    return null;
  }
  return organizationId;
}

function registerCoreSaasRoutes({ app, pool, authenticate, requireRoles, adminOrganizationId, writeAudit }) {
  const crmRoles = ["admin", "editor", "seller"];

  app.get("/api/admin/contacts", authenticate, requireRoles(...crmRoles), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const query = String(req.query.query || "").trim().slice(0, 120);
    try {
      const result = await pool.query(`
        SELECT c.id, c.full_name AS "fullName", c.email, c.phone, c.notes,
               c.assigned_to AS "assignedTo", au.full_name AS "assignedToName",
               c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.last_activity_at AS "lastActivityAt",
               COUNT(DISTINCT l.id)::int AS "leadCount",
               COUNT(DISTINCT a.id)::int AS "appointmentCount",
               COUNT(DISTINCT q.id)::int AS "quoteCount",
               COUNT(DISTINCT o.id)::int AS "offerCount",
               MAX(l.created_at) AS "lastLeadAt",
               (ARRAY_AGG(l.status ORDER BY l.created_at DESC) FILTER (WHERE l.status IS NOT NULL))[1] AS "latestLeadStatus"
        FROM crm_contacts c
        LEFT JOIN admin_users au ON au.id = c.assigned_to AND au.organization_id = c.organization_id
        LEFT JOIN leads l ON l.contact_id = c.id AND l.organization_id = c.organization_id
        LEFT JOIN test_drive_requests a ON a.contact_id = c.id AND a.organization_id = c.organization_id
        LEFT JOIN quotes q ON q.contact_id = c.id AND q.organization_id = c.organization_id
        LEFT JOIN offers o ON o.contact_id = c.id AND o.organization_id = c.organization_id
        WHERE c.organization_id=$1
          AND ($2='' OR c.full_name ILIKE '%' || $2 || '%' OR c.email ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
        GROUP BY c.id, au.full_name
        ORDER BY c.last_activity_at DESC, c.created_at DESC
        LIMIT 250
      `, [organizationId, query]);
      res.json({ data: result.rows });
    } catch (error) {
      if (missingCrmSchema(error)) return res.status(503).json({ error: "El CRM aún necesita aplicar su migración", code: "CRM_MIGRATION_REQUIRED" });
      console.error("CRM contacts query failed", error);
      res.status(500).json({ error: "No se pudieron cargar los clientes" });
    }
  });

  app.get("/api/admin/contacts/:id", authenticate, requireRoles(...crmRoles), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    try {
      const contact = await pool.query(`
        SELECT c.id, c.full_name AS "fullName", c.email, c.phone, c.notes,
               c.assigned_to AS "assignedTo", au.full_name AS "assignedToName",
               c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.last_activity_at AS "lastActivityAt"
        FROM crm_contacts c
        LEFT JOIN admin_users au ON au.id=c.assigned_to AND au.organization_id=c.organization_id
        WHERE c.id=$1 AND c.organization_id=$2
      `, [req.params.id, organizationId]);
      if (!contact.rowCount) return res.status(404).json({ error: "Cliente no encontrado" });
      const [leads, appointments, quotes, offers] = await Promise.all([
        pool.query(`SELECT id, lead_type AS "leadType", name, email, phone, message, status, priority, next_action AS "nextAction", next_action_at AS "nextActionAt", created_at AS "createdAt" FROM leads WHERE contact_id=$1 AND organization_id=$2 ORDER BY created_at DESC`, [req.params.id, organizationId]),
        pool.query(`SELECT id, requested_date AS "date", requested_time AS "time", status, created_at AS "createdAt" FROM test_drive_requests WHERE contact_id=$1 AND organization_id=$2 ORDER BY created_at DESC`, [req.params.id, organizationId]),
        pool.query(`SELECT id, quote_number AS "quoteNumber", total_amount AS "totalAmount", COALESCE(total_amount, total_usd) AS "totalUsd", currency, status, created_at AS "createdAt" FROM quotes WHERE contact_id=$1 AND organization_id=$2 ORDER BY created_at DESC`, [req.params.id, organizationId]),
        pool.query(`SELECT id, amount AS amount, COALESCE(amount, amount_usd) AS "amountUsd", currency, status, created_at AS "createdAt" FROM offers WHERE contact_id=$1 AND organization_id=$2 ORDER BY created_at DESC`, [req.params.id, organizationId]),
      ]);
      res.json({ data: { ...contact.rows[0], leads: leads.rows, appointments: appointments.rows, quotes: quotes.rows, offers: offers.rows } });
    } catch (error) {
      if (missingCrmSchema(error)) return res.status(503).json({ error: "El CRM aún necesita aplicar su migración", code: "CRM_MIGRATION_REQUIRED" });
      console.error("CRM contact detail failed", error);
      res.status(500).json({ error: "No se pudo cargar el cliente" });
    }
  });

  app.get("/api/admin/contacts/:id/timeline", authenticate, requireRoles(...crmRoles), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    try {
      const result = await pool.query(`
        SELECT event_type AS "eventType", note, metadata, created_at AS "createdAt", actor_id AS "actorId", actor_name AS "actorName"
        FROM (
          SELECT e.event_type, e.note, e.metadata, e.created_at, e.actor_id, u.full_name AS actor_name
          FROM crm_contact_events e LEFT JOIN admin_users u ON u.id=e.actor_id
          WHERE e.contact_id=$1 AND e.organization_id=$2
          UNION ALL
          SELECT 'lead_' || l.status, COALESCE(l.message, 'Solicitud recibida'), jsonb_build_object('leadId', l.id, 'leadType', l.lead_type), l.created_at, NULL, NULL
          FROM leads l WHERE l.contact_id=$1 AND l.organization_id=$2
          UNION ALL
          SELECT 'appointment_' || COALESCE(a.status, 'requested'), COALESCE(a.notes, 'Cita registrada'), jsonb_build_object('appointmentId', a.id, 'date', a.requested_date, 'time', a.requested_time), a.created_at, NULL, NULL
          FROM test_drive_requests a WHERE a.contact_id=$1 AND a.organization_id=$2
          UNION ALL
          SELECT 'quote_' || q.status, 'Cotización ' || q.quote_number, jsonb_build_object('quoteId', q.id, 'quoteNumber', q.quote_number, 'totalAmount', q.total_amount, 'totalUsd', COALESCE(q.total_amount, q.total_usd), 'currency', q.currency), q.created_at, q.created_by, u.full_name
          FROM quotes q LEFT JOIN admin_users u ON u.id=q.created_by WHERE q.contact_id=$1 AND q.organization_id=$2
          UNION ALL
          SELECT 'offer_' || o.status, 'Oferta recibida', jsonb_build_object('offerId', o.id, 'amount', o.amount, 'amountUsd', COALESCE(o.amount, o.amount_usd), 'currency', o.currency), o.created_at, NULL, NULL
          FROM offers o WHERE o.contact_id=$1 AND o.organization_id=$2
        ) timeline
        ORDER BY created_at DESC
        LIMIT 300
      `, [req.params.id, organizationId]);
      res.json({ data: result.rows });
    } catch (error) {
      if (missingCrmSchema(error)) return res.status(503).json({ error: "El CRM aún necesita aplicar su migración", code: "CRM_MIGRATION_REQUIRED" });
      console.error("CRM timeline query failed", error);
      res.status(500).json({ error: "No se pudo cargar el seguimiento" });
    }
  });

  app.post("/api/admin/contacts/:id/notes", authenticate, requireRoles(...crmRoles), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const note = String(req.body?.note || "").trim().slice(0, 4000);
    if (!note) return res.status(400).json({ error: "Escribe una nota antes de guardarla" });
    try {
      const contact = await pool.query("SELECT id FROM crm_contacts WHERE id=$1 AND organization_id=$2", [req.params.id, organizationId]);
      if (!contact.rowCount) return res.status(404).json({ error: "Cliente no encontrado" });
      const result = await pool.query("INSERT INTO crm_contact_events (organization_id, contact_id, actor_id, event_type, note) VALUES ($1,$2,$3,'internal_note',$4) RETURNING id, created_at AS \"createdAt\"", [organizationId, req.params.id, req.admin.id, note]);
      await pool.query("UPDATE crm_contacts SET updated_at=NOW(), last_activity_at=NOW() WHERE id=$1 AND organization_id=$2", [req.params.id, organizationId]);
      await writeAudit(req, "crm.contact_note", "crm_contact", req.params.id, {});
      res.status(201).json({ data: { ...result.rows[0], note } });
    } catch (error) {
      if (missingCrmSchema(error)) return res.status(503).json({ error: "El CRM aún necesita aplicar su migración", code: "CRM_MIGRATION_REQUIRED" });
      console.error("CRM note failed", error);
      res.status(500).json({ error: "No se pudo guardar la nota" });
    }
  });

  app.patch("/api/admin/contacts/:id/assign", authenticate, requireRoles("admin", "editor"), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const assignedTo = req.body?.assignedTo ? String(req.body.assignedTo) : null;
    try {
      if (assignedTo) {
        const user = await pool.query("SELECT id FROM admin_users WHERE id=$1 AND organization_id=$2 AND is_active=TRUE", [assignedTo, organizationId]);
        if (!user.rowCount) return res.status(400).json({ error: "El vendedor no pertenece a este concesionario" });
      }
      const result = await pool.query(`UPDATE crm_contacts SET assigned_to=$1, updated_at=NOW(), last_activity_at=NOW() WHERE id=$2 AND organization_id=$3 RETURNING id, assigned_to AS "assignedTo"`, [assignedTo, req.params.id, organizationId]);
      if (!result.rowCount) return res.status(404).json({ error: "Cliente no encontrado" });
      await pool.query("INSERT INTO crm_contact_events (organization_id, contact_id, actor_id, event_type, note, metadata) VALUES ($1,$2,$3,'assignment_changed',$4,$5::jsonb)", [organizationId, req.params.id, req.admin.id, assignedTo ? "Cliente asignado a un vendedor." : "Asignación retirada.", JSON.stringify({ assignedTo })]);
      await writeAudit(req, "crm.contact_assign", "crm_contact", req.params.id, { assignedTo });
      res.json({ data: result.rows[0] });
    } catch (error) {
      if (missingCrmSchema(error)) return res.status(503).json({ error: "El CRM aún necesita aplicar su migración", code: "CRM_MIGRATION_REQUIRED" });
      console.error("CRM assignment failed", error);
      res.status(500).json({ error: "No se pudo asignar el cliente" });
    }
  });

  app.get("/api/admin/work-queue", authenticate, requireRoles(...crmRoles), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    try {
      const [leads, appointments, quotes, offers] = await Promise.all([
        pool.query(`SELECT l.id, l.contact_id AS "contactId", 'lead' AS type, l.status, COALESCE(l.next_action_at, l.created_at) AS "dueAt", l.priority, COALESCE(c.full_name,l.name) AS title, COALESCE(c.phone,l.phone) AS phone, COALESCE(c.email,l.email) AS email, l.assigned_to AS "assignedTo", au.full_name AS "assignedToName", l.vehicle_id AS "vehicleId", l.created_at AS "createdAt" FROM leads l LEFT JOIN crm_contacts c ON c.id=l.contact_id AND c.organization_id=l.organization_id LEFT JOIN admin_users au ON au.id=l.assigned_to WHERE l.organization_id=$1 AND l.status NOT IN ('closed','lost') ORDER BY COALESCE(l.next_action_at,l.created_at) ASC LIMIT 100`, [organizationId]),
        pool.query(`SELECT a.id, a.contact_id AS "contactId", 'appointment' AS type, a.status, (a.requested_date + a.requested_time) AS "dueAt", 'normal' AS priority, COALESCE(c.full_name,a.customer_name) AS title, COALESCE(c.phone,a.customer_phone) AS phone, COALESCE(c.email,a.customer_email) AS email, a.assigned_to AS "assignedTo", au.full_name AS "assignedToName", a.vehicle_id AS "vehicleId", a.created_at AS "createdAt" FROM test_drive_requests a LEFT JOIN crm_contacts c ON c.id=a.contact_id AND c.organization_id=a.organization_id LEFT JOIN admin_users au ON au.id=a.assigned_to WHERE a.organization_id=$1 AND a.status NOT IN ('completed','cancelled') ORDER BY a.requested_date, a.requested_time LIMIT 100`, [organizationId]),
        pool.query(`SELECT q.id, q.contact_id AS "contactId", 'quote' AS type, q.status, COALESCE(q.valid_until::timestamptz, q.created_at) AS "dueAt", 'normal' AS priority, COALESCE(c.full_name,q.customer_name) AS title, COALESCE(c.phone,q.customer_phone) AS phone, COALESCE(c.email,q.customer_email) AS email, q.created_by AS "assignedTo", au.full_name AS "assignedToName", q.vehicle_id AS "vehicleId", q.created_at AS "createdAt" FROM quotes q LEFT JOIN crm_contacts c ON c.id=q.contact_id AND c.organization_id=q.organization_id LEFT JOIN admin_users au ON au.id=q.created_by WHERE q.organization_id=$1 AND q.status IN ('draft','sent') ORDER BY COALESCE(q.valid_until::timestamptz,q.created_at) ASC LIMIT 100`, [organizationId]),
        pool.query(`SELECT o.id, o.contact_id AS "contactId", 'offer' AS type, o.status, o.created_at AS "dueAt", 'high' AS priority, COALESCE(c.full_name,o.buyer_name) AS title, COALESCE(c.phone,o.buyer_phone) AS phone, COALESCE(c.email,o.buyer_email) AS email, NULL::uuid AS "assignedTo", NULL::text AS "assignedToName", o.vehicle_id AS "vehicleId", o.created_at AS "createdAt" FROM offers o LEFT JOIN crm_contacts c ON c.id=o.contact_id AND c.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.status='pending' ORDER BY o.created_at ASC LIMIT 100`, [organizationId]),
      ]);
      const data = [...leads.rows, ...appointments.rows, ...quotes.rows, ...offers.rows].sort((a, b) => new Date(a.dueAt || a.createdAt) - new Date(b.dueAt || b.createdAt)).slice(0, 250);
      res.json({ data, generatedAt: new Date().toISOString() });
    } catch (error) {
      if (missingCrmSchema(error)) return res.status(503).json({ error: "El Centro de trabajo necesita aplicar la migración CRM", code: "CRM_MIGRATION_REQUIRED" });
      console.error("Work queue query failed", error);
      res.status(500).json({ error: "No se pudo cargar el Centro de trabajo" });
    }
  });

  app.get("/api/admin/export/vehicles.csv", authenticate, requireRoles(...crmRoles), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    try {
      const result = await pool.query(`SELECT v.id, b.name AS brand, v.model, v.variant, v.year, v.status, v.stock_number AS "stockNumber", COALESCE(v.price_amount, v.price_usd) AS price, v.price_currency AS currency, v.mileage_km AS "mileageKm", v.location, v.created_at AS "createdAt", v.updated_at AS "updatedAt" FROM vehicles v LEFT JOIN vehicle_brands b ON b.id=v.brand_id WHERE v.organization_id=$1 ORDER BY v.created_at DESC`, [organizationId]);
      sendCsv(res, "zevroa-inventario.csv", [{ key: "id", label: "ID" }, { key: "brand", label: "Marca" }, { key: "model", label: "Modelo" }, { key: "variant", label: "Versión" }, { key: "year", label: "Año" }, { key: "status", label: "Estado" }, { key: "stockNumber", label: "Stock" }, { key: "price", label: "Precio" }, { key: "currency", label: "Moneda" }, { key: "mileageKm", label: "Kilómetros" }, { key: "location", label: "Ubicación" }, { key: "createdAt", label: "Creado" }, { key: "updatedAt", label: "Actualizado" }], result.rows);
    } catch (error) {
      console.error("Vehicle export failed", error);
      res.status(500).json({ error: "No se pudo exportar el inventario" });
    }
  });

  app.post("/api/admin/vehicles/bulk", authenticate, requireRoles("admin", "editor"), async (req, res) => {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map((id) => String(id).trim()).filter(Boolean))].slice(0, 100);
    const operation = String(req.body?.operation || "").trim();
    const statusByOperation = { publish: "published", archive: "inactive", sold: "sold", draft: "draft" };
    if (!ids.length) return res.status(400).json({ error: "Selecciona al menos un vehículo" });
    if (!statusByOperation[operation]) return res.status(400).json({ error: "Operación masiva no válida" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE vehicles SET status=$1, updated_at=NOW() WHERE organization_id=$2 AND id = ANY($3::uuid[]) RETURNING id, status`, [statusByOperation[operation], organizationId, ids]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "No encontramos vehículos de este concesionario" }); }
      await client.query("COMMIT");
      await writeAudit(req, "vehicle.bulk_status", "vehicle", null, { operation, requested: ids.length, updated: result.rowCount, status: statusByOperation[operation] });
      res.json({ data: { operation, status: statusByOperation[operation], updated: result.rowCount, ids: result.rows.map((row) => row.id) } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Bulk vehicle update failed", error);
      res.status(500).json({ error: "No se pudo actualizar el inventario" });
    } finally { client.release(); }
  });
}

export { registerCoreSaasRoutes, normalizeEmail, normalizePhone };
