-- Contenido de confianza configurable por cada concesionario.
-- Se mantiene en la configuración aislada del dealer para que el operador pueda
-- editarlo sin administrar otra colección ni exponer contenido de otro showroom.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS faq_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS testimonials JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE organization_settings
SET faq_items = '[
  {"question":"¿Puedo agendar una visita?","answer":"Sí. Elige una fecha y un horario disponible desde la ficha del vehículo; el equipo confirmará la visita."},
  {"question":"¿Puedo entregar mi vehículo actual?","answer":"Puedes solicitar una orientación de tasación y un asesor revisará la información contigo."},
  {"question":"¿La cotización es el precio final?","answer":"La cotización es informativa y queda sujeta a disponibilidad, inspección, aprobación comercial y condiciones de financiamiento."},
  {"question":"¿Cómo me responderán?","answer":"Usaremos el correo, teléfono o WhatsApp que dejaste en la solicitud. Durante el horario del showroom te indicaremos el siguiente paso."}
]'::jsonb
WHERE faq_items = '[]'::jsonb;
