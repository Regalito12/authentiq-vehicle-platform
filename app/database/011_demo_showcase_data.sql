BEGIN;

-- Datos de presentación local. Se pueden volver a cargar sin duplicarlos.
DELETE FROM notifications WHERE notification_type = 'demo_showcase';
DELETE FROM audit_logs WHERE metadata->>'demo' = 'true';
DELETE FROM offers WHERE message LIKE '[DEMO SHOWCASE]%';
DELETE FROM test_drive_requests WHERE notes LIKE '[DEMO SHOWCASE]%';
DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE source = 'demo-showcase');
DELETE FROM leads WHERE source = 'demo-showcase';

CREATE TEMP TABLE demo_leads (label VARCHAR(40) PRIMARY KEY, id UUID) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO leads (lead_type, vehicle_id, name, email, phone, message, source, status, notes, assigned_to, last_contacted_at)
  SELECT 'test_drive', v.id, 'Valentina Rosario', 'valentina.demo@authentiq.local', '809 555 0142', 'Interesada en conocer el Panamera durante el fin de semana.', 'demo-showcase', 'qualified', '[DEMO SHOWCASE] Cliente de presentación', COALESCE((SELECT id FROM admin_users WHERE email = 'ventas.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1)), NOW() - INTERVAL '2 hours'
  FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id WHERE b.name = 'Porsche' AND v.model = 'Panamera 4S' LIMIT 1
  RETURNING id
)
INSERT INTO demo_leads (label, id) SELECT 'valentina', id FROM inserted;

WITH inserted AS (
  INSERT INTO leads (lead_type, vehicle_id, name, email, phone, message, source, status, notes, assigned_to)
  SELECT 'offer', v.id, 'Mateo Castillo', 'mateo.demo@authentiq.local', '809 555 0188', 'Solicita una propuesta para entrega inmediata.', 'demo-showcase', 'new', '[DEMO SHOWCASE] Oferta pendiente de revisión', COALESCE((SELECT id FROM admin_users WHERE email = 'ventas.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1))
  FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id WHERE b.name = 'Porsche' AND v.model = 'Macan GTS' LIMIT 1
  RETURNING id
)
INSERT INTO demo_leads (label, id) SELECT 'mateo', id FROM inserted;

WITH inserted AS (
  INSERT INTO leads (lead_type, vehicle_id, name, email, phone, message, source, status, notes, assigned_to, last_contacted_at)
  SELECT 'test_drive', v.id, 'Andrés Méndez', 'andres.demo@authentiq.local', '809 555 0126', 'Busca una experiencia eléctrica de alto rendimiento.', 'demo-showcase', 'contacted', '[DEMO SHOWCASE] Seguimiento iniciado', COALESCE((SELECT id FROM admin_users WHERE email = 'editor.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1)), NOW() - INTERVAL '1 day'
  FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id WHERE b.name = 'Porsche' AND v.model = 'Taycan Turbo S' LIMIT 1
  RETURNING id
)
INSERT INTO demo_leads (label, id) SELECT 'andres', id FROM inserted;

WITH inserted AS (
  INSERT INTO leads (lead_type, vehicle_id, name, email, phone, message, source, status, notes, assigned_to)
  SELECT 'interest', v.id, 'Camila Herrera', 'camila.demo@authentiq.local', '809 555 0109', 'Solicita disponibilidad y opciones de configuración.', 'demo-showcase', 'closed', '[DEMO SHOWCASE] Caso cerrado para demostración', COALESCE((SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1), (SELECT id FROM admin_users LIMIT 1))
  FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id WHERE b.name = 'Audi' AND v.model = 'RS e-tron GT' LIMIT 1
  RETURNING id
)
INSERT INTO demo_leads (label, id) SELECT 'camila', id FROM inserted;

INSERT INTO test_drive_requests (vehicle_id, lead_id, customer_name, customer_email, customer_phone, requested_date, requested_time, status, notes, assigned_to)
SELECT v.id, d.id, 'Valentina Rosario', 'valentina.demo@authentiq.local', '809 555 0142', CURRENT_DATE + 1, '10:30', 'confirmed', '[DEMO SHOWCASE] Cita confirmada para presentación', COALESCE((SELECT id FROM admin_users WHERE email = 'ventas.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1))
FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id CROSS JOIN demo_leads d WHERE b.name = 'Porsche' AND v.model = 'Panamera 4S' AND d.label = 'valentina' LIMIT 1;

INSERT INTO test_drive_requests (vehicle_id, lead_id, customer_name, customer_email, customer_phone, requested_date, requested_time, status, notes, assigned_to)
SELECT v.id, d.id, 'Andrés Méndez', 'andres.demo@authentiq.local', '809 555 0126', CURRENT_DATE + 2, '15:00', 'pending', '[DEMO SHOWCASE] Cita pendiente de confirmación', COALESCE((SELECT id FROM admin_users WHERE email = 'editor.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1))
FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id CROSS JOIN demo_leads d WHERE b.name = 'Porsche' AND v.model = 'Taycan Turbo S' AND d.label = 'andres' LIMIT 1;

INSERT INTO offers (vehicle_id, lead_id, buyer_name, buyer_email, buyer_phone, amount_usd, payment_method, message, status, reviewed_by, reviewed_at)
SELECT v.id, d.id, 'Mateo Castillo', 'mateo.demo@authentiq.local', '809 555 0188', v.price_usd - 4500, 'cash', '[DEMO SHOWCASE] Propuesta comercial de presentación', 'pending', NULL, NULL
FROM vehicles v JOIN vehicle_brands b ON b.id = v.brand_id CROSS JOIN demo_leads d WHERE b.name = 'Porsche' AND v.model = 'Macan GTS' AND d.label = 'mateo' LIMIT 1;

INSERT INTO lead_events (lead_id, actor_id, event_type, note)
SELECT d.id, COALESCE((SELECT id FROM admin_users WHERE email = 'ventas.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1)), 'status_change', 'Lead de demostración calificado para mostrar el historial.' FROM demo_leads d WHERE d.label = 'valentina';

INSERT INTO lead_events (lead_id, actor_id, event_type, note)
SELECT d.id, COALESCE((SELECT id FROM admin_users WHERE email = 'editor.demo@authentiq.local' LIMIT 1), (SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1)), 'note', 'Se registró seguimiento inicial desde la demo.' FROM demo_leads d WHERE d.label = 'andres';

INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
SELECT COALESCE((SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1), (SELECT id FROM admin_users LIMIT 1)), 'demo.seed', 'showcase', NULL, jsonb_build_object('demo', true, 'label', 'showcase_data');

INSERT INTO notifications (user_id, notification_type, title, body, entity_type)
SELECT id, 'demo_showcase', 'Demo lista para presentar', 'Hay leads, citas y una oferta de muestra cargados en el backoffice.', 'showcase'
FROM admin_users WHERE is_active = TRUE;

COMMIT;
