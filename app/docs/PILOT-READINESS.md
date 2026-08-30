# ZEVROA · readiness del piloto RD

Documento operativo para el piloto controlado en República Dominicana. Separa
lo que está implementado en el repositorio de lo que requiere una cuenta,
decisión o validación fuera del código.

## Inventario de alcance

| Área | Estado | Evidencia / siguiente validación |
|---|---|---|
| Catálogo, búsqueda, filtros y orden | Implementado | Rutas públicas y parámetros `q`, `brand`, `category`, `condition`, `fuel`, `transmission`, `minPrice`, `maxPrice`, `minYear`, `sort`.
| Fichas, galería, comparación y favoritos | Implementado | Ficha por slug, estados de inventario, favoritos locales/autenticados y comparador.
| Contacto, WhatsApp, ofertas y test drives | Implementado | API deriva el vehículo y el tenant; la cita se vincula al vehículo y al lead cuando existe.
| CRM, leads, citas y cotizaciones | Implementado | Backoffice con estados, asignación, notas, próxima acción, agenda y cotizaciones compartibles.
| Aislamiento multi-tenant y roles | Implementado | `test:roles`, `test:tenants` y consultas con `organization_id`.
| Moneda por inventario | Implementado | Migración `056_currency_normalization.sql`, contrato `price`/`currency`, rechazo de moneda cruzada.
| Analytics canónico | Implementado | Alias históricos, eventos permitidos, metadata sin PII y `dealerId` derivado por servidor.
| SEO técnico | Implementado | Prerender, sitemap, robots, canonical y JSON-LD con moneda del vehículo.
| Datos reales, fotos y taxonomía final | Parcial | Requiere carga y revisión comercial del dealer piloto.
| Correo comercial transaccional | Bloqueado por dependencia externa | Requiere dominio remitente y `RESEND_API_KEY`/`RESEND_FROM_EMAIL`.
| Sentry frontend/backend | Bloqueado por dependencia externa | Requiere `VITE_SENTRY_DSN` y `SENTRY_DSN` reales.
| Legal definitivo | Bloqueado por dependencia externa | Los textos actuales son borradores; requieren revisión legal con datos reales.
| Dominio público y wildcard | Bloqueado por dependencia externa | Requiere DNS y URLs públicas confirmadas.
| Google Calendar, Meta y Stripe | Opcional para piloto | Mantener exportación/manual y billing en prueba; no cobrar automáticamente.

## Definición de dealer activado

Un dealer cuenta como activado cuando cumple simultáneamente:

1. Está aprobado.
2. Tiene cinco vehículos publicados.
3. Tiene configurada la recepción de leads.
4. Todo ocurre dentro de los primeros siete días.

Billing no es requisito de activación durante el piloto.

## Baseline que debe registrarse antes de abrir tráfico

| Métrica | Valor inicial | Fuente | Cadencia |
|---|---:|---|---|
| Búsquedas iniciadas | — | `analytics_events` / `search_started` | Semanal |
| Fichas vistas | — | `view_vehicle` | Semanal |
| Contactos | — | leads, WhatsApp separado | Semanal |
| Leads cualificados | — | leads con `status = qualified` | Semanal |
| Citas | — | `test_drive_requests` vinculadas a lead | Semanal |
| Tiempo de primera respuesta | — | timeline/CRM | Semanal |
| Dealers activos | — | organizaciones activadas | Semanal |
| Inventario actualizado | — | vehículos publicados modificados en 30 días | Semanal |

No se debe contar un clic de WhatsApp como lead cualificado. Una venta solo
entra en la métrica cuando existe un resultado comercial registrado.

## Go / no-go

Antes de usar datos reales deben estar confirmados: backup restaurable,
migración `056` aplicada, dominio y URLs públicas, revisión legal, Sentry,
correo comercial si se promete entrega por email, ausencia de filtración entre
tenants, smoke/roles/tenants/E2E/accesibilidad y prueba manual en móvil de
catálogo, ficha, formulario y cita.

El piloto recomendado es un dealer real, con máximo tres dealers en la primera
iteración y dos a cuatro semanas de observación. Stripe, Google Calendar y Meta
pueden permanecer en modo opcional/manual.
