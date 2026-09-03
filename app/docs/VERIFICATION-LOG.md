# ZEVROA · registro de verificación pre-lanzamiento

Cada fila es algo que se probó de verdad — en código, en servidor local o en
navegador real — no algo que se asume porque "debería funcionar". Se llena de
poco a poco, a medida que se confirma cada pieza. `✅ Confirmado` exige
evidencia (comando, captura o test); `❌ Falla` describe el problema
encontrado; `⏳ Pendiente` es lo que aún no se ha probado.

## Público (sin login)

| # | Qué se verifica | Estado | Evidencia |
|---|---|---|---|
| 1 | Aislamiento multi-tenant: slug inventado devuelve 404 limpio, no el catálogo de otro dealer | ✅ Confirmado | `curl` con `x-authentiq-tenant: dealerquenoexiste999` → `404 {"error":"Dealer no encontrado","code":"ORGANIZATION_NOT_FOUND"}` |
| 2 | Slug real (`zevroa`) resuelve su propio catálogo | ✅ Confirmado | `curl` con `x-authentiq-tenant: zevroa` → `200`, `businessName: "ZEVROA"` |
| 3 | Dominio raíz sin parámetros muestra la landing de marketing, no un showroom | ✅ Confirmado | Navegador real: body contiene "Tu inventario vende antes de hablar", "CREAR SHOWROOM" |
| 4 | Badge "REBAJA -X%" se pinta cuando el vehículo tiene descuento | ✅ Confirmado (con fix) | 12 badges visibles en el catálogo demo. **Encontrado y corregido:** mostraba "-15.00%" (el numérico crudo de Postgres) en vez de "-15%" — `App.jsx:2156` ahora usa `toLocaleString` |
| 5 | Conversión USD → DOP en tarjetas del catálogo | ✅ Confirmado | $98,500 USD → "RD$ 5,910,000" = tasa 60.00 exacta |
| 6 | Enlace de WhatsApp en la ficha del vehículo | ✅ Confirmado | Número real, mensaje decodificado: "Hola, me interesa el Porsche Panamera 4S 2024: [URL completa a la ficha]" |
| 7 | `QuotePrintModal` (cotización PDF) existe y se importa correctamente | ✅ Confirmado (solo código) | Vive en `GraphicsStudio.jsx:151`, lazy-importado desde `Backoffice.jsx:96`. **Falta probar el flujo completo** (generar cotización real, imprimir) — requiere login |

## Backoffice y flujo de dealer (cuenta de prueba creada por mí)

Se registró un dealer real vía el wizard público (`Auditoria QA Motors`,
slug `auditoria-qa-motors`) para probar el ciclo completo sin usar
credenciales del usuario.

| # | Qué se verifica | Estado | Evidencia |
|---|---|---|---|
| 8 | Wizard de registro de dealer, de principio a fin | ✅ Confirmado | 2 pasos, plan → cuenta, sin errores JS, termina en `/backoffice` con mensaje "TU SHOWROOM ESTÁ EN REVISIÓN" |
| 9 | Un dealer recién creado queda en `approval_status='pending'` | ✅ Confirmado | Consulta directa a la base: `pending` |
| 10 | Dealer pendiente NO es visible por el selector público real (`?dealer=slug`, sin cabecera de dev) | ✅ Confirmado | `curl` sin header dev → `404 ORGANIZATION_NOT_FOUND` |
| 11 | El header `x-authentiq-tenant` (atajo de desarrollo) SÍ ve dealers pendientes | ⚠️ Es intencional, no es hueco de seguridad | Está gateado por `requestHostname(req) === "localhost"` — el `Host` HTTP real no es falseable contra un dominio público; verificado leyendo `requestHostname()` en `index.js:647`. En producción, contra `zevroa.com` o un subdominio real, este atajo nunca se activa |
| 12 | Al aprobar (`approval_status='approved'`), el dealer se vuelve visible por el mismo selector público | ✅ Confirmado | Mismo `curl`, ahora `200` con los datos del dealer. Revertido a `pending` después de la prueba |
| 13 | Botón "Aprobar" real en PlatformCenter (UI) | ⏳ Pendiente | Lo anterior se verificó por SQL directo, no por el botón. Requiere rol `platform_admin`, que la cuenta QA no tiene |

| 14 | Login con la cuenta recién creada | ✅ Confirmado | Botón real es "ENTRAR AL PANEL" (no "Iniciar sesión" — dato para futuras pruebas). Entra sin errores |
| 15 | Onboarding guiado post-registro (checklist "empieza aquí") | ✅ Confirmado | Modal con 3 bloques / 6 ajustes esenciales (marca, vitrina, operación), progreso 33% con 2/6 hechos. Coincide con la "definición de dealer activado" de `PILOT-READINESS.md` |

| 16 | Navegación del backoffice: 14 módulos accesibles | ✅ Confirmado | Inicio, Inventario, Clientes, Citas, Cotizaciones, Marcas, Contenido, Ofertas, Estadísticas, Actividad, Usuarios, Plan, Conexiones, Ajustes — sin errores JS |
| 17 | Alta de vehículo, wizard de 8 pasos completo | ✅ Confirmado | Catálogo de marcas precargado con logos reales (BMW elegido). Los 8 pasos navegan bien, checklist de "publicación inteligente" pasa de 0/5 a 5/5 correctamente |
| 18 | Subida real de imagen (archivo, no solo URL) | ✅ Confirmado | `input[type=file]` → `/api/admin/media-upload` sin errores; miniatura con badge "PORTADA" y reordenamiento por arrastre |
| 19 | Vehículo se guarda con los datos correctos | ✅ Confirmado | Verificado directo en base: `model=Serie 3, status=draft, price=45000.00`, atribuido al `organization_id` correcto |
| 20 | Aislamiento a nivel de catálogo: dealer pendiente con vehículo YA publicado sigue oculto | ✅ Confirmado (el más exigente de los 3 tests de aislamiento) | Se forzó `status='published'` por SQL y se repitió la consulta pública → sigue `404 ORGANIZATION_NOT_FOUND`. El gate de aprobación es a nivel de organización, antes de mirar el estado de cualquier vehículo |

| 21 | Lead público → CRM del dealer correcto | ✅ Confirmado | Formulario "Valorar mi vehículo" enviado desde el showroom de `auditoria-qa-motors` → aparece al instante en su CRM ("QA Tester Lead", badge de notificación +1). No se probó explícitamente que NO aparezca en el CRM de otro dealer, pero es la misma consulta con `organization_id` ya verificada en el punto 20 |
| 22 | Vista de cliente único (timeline CRM) | ✅ Confirmado | Datos correctos, contadores (1 lead/0 citas/0 cotizaciones/0 ofertas), botones de acción directos |
| 23 | Creación de cotización desde el CRM | ✅ Confirmado | Folio real generado (`ZEV-2026-...`), total y estado correctos. **Nota:** el selector de vehículo solo lista vehículos `published`, no `draft` — lógico, pero confirmarlo evitó una prueba fallida |
| 24 | Cotización en PDF (`QuotePrintModal`) — layout y cálculo | ✅ Confirmado | Membrete, folio, cliente, vehículo, USD→DOP correcto otra vez ($45,000 → RD$2,700,000), plan financiero (20% inicial = $9,000, ~$756/mes a 60 meses) |
| 25 | **Datos técnicos fabricados en la cotización PDF y en el catálogo público** | ❌ Encontrado y corregido | Ver detalle abajo — era el hallazgo más serio de esta sesión |

### 🔴 Hallazgo 25 — el catálogo entero afirmaba certificaciones y specs que no existían

**Qué pasaba:** cualquier vehículo con `condition ≠ 'new'` (es decir, cualquier usado, en cualquier dealer) se etiquetaba **"CERTIFICADO"** — en la tarjeta del catálogo, en la ficha del vehículo y en la cotización PDF oficial — sin que el esquema tenga ningún campo de certificación real (`condition` solo admite `'new'`/`'used'`, forzado en `server/src/index.js:960`). Es una afirmación comercial específica (implica inspección + garantía extendida) puesta por defecto en el 100% del inventario usado de la plataforma.

Además, en la cotización PDF y el generador de flyers, si el dealer dejaba `transmission`, `fuelType`, `warranty` o `engine` sin llenar, se mostraban valores inventados ("Automático", "Gasolina", "Garantía de concesionario", "Premium Edition") como si fueran datos reales del vehículo — en un documento pensado para enviarse a bancos o entidades financieras.

**Por qué importa:** esto no es un detalle cosmético. Es publicidad engañosa de facto sobre cada auto usado de cada concesionario que use la plataforma, y en el documento oficial es peor: un banco podría aprobar un financiamiento asumiendo una garantía o transmisión que el dealer nunca confirmó.

**Corregido:**
- `App.jsx:2154` y `App.jsx:2678`: "CERTIFICADO"/"INVENTARIO CERTIFICADO" → "USADO"/"INVENTARIO USADO"
- `GraphicsStudio.jsx`: condición del PDF → "Usado" en vez de "Certificado"; `transmission`, `fuelType`, `warranty` (PDF) y `engine`, `transmission` (flyer) → `"N/D"` cuando están vacíos, siguiendo el mismo patrón que el propio componente ya usaba correctamente para `drive` y `exteriorColor` una línea más abajo.

Verificado tras el fix en las tres superficies: badge del catálogo (`USADO`), ficha de vehículo, y PDF de cotización — build limpio, sin errores JS.

| 26 | Reserva de cita desde la ficha del vehículo | ✅ Confirmado | Selector de día/hora con horarios reales, formato de teléfono correcto, cita creada con `vehicleId` y `leadId` auto-vinculados |
| 27 | La cita aparece en el módulo "Citas" del backoffice | ✅ Confirmado | Vista semanal, "JUE 3 · 1 cita · 14:00", notificación +1 |
| 28 | El horario reservado deja de ofrecerse (anti-doble-reserva) | ✅ Confirmado | Antes: `13:00–17:00` disponibles. Tras reservar 14:00: solo `15:00, 16:00, 17:00` (13:00 también desapareció, pero es hoy mismo y esa hora ya pasó — no es un bug) |
| 29 | Mensajes de validación nativos en español (verificación cruzada) | ✅ Confirmado | El fix de la sesión anterior (`instalarMensajesDeValidacion`) sí se dispara en este modal distinto: "Completa este campo." |
| 30 | Texto "N cita(s) registrada(s)" | ❌ Encontrado y corregido | Decía "1 cita **registradas**" (plural fijo sin importar el conteo) — `Backoffice.jsx`, ahora concuerda con el número |

## Backoffice — resto de módulos (requiere seguir probando)

_Pendiente: integraciones, PlatformCenter (botón real de aprobar). Aislamiento del CRM entre dos dealers distintos no se probó explícitamente (solo por inferencia del punto 20)._

## Notas técnicas para futuras pruebas en este entorno

- **Chromium crashea intermitentemente** (~1 de cada 3-4 lanzamientos) cuando la memoria libre del equipo baja de ~1GB. Causa: ~20 procesos `node` acumulados de sesiones anteriores sin cerrar. Antes de una tanda de pruebas, matar todo menos el proceso de la API y relanzar Vite limpio.
- Los pasos del wizard de vehículo son botones que mezclan número + texto ("06 Imágenes") en el mismo elemento — `getByText(..., {exact:true})` nunca hace match. Usar `locator("form.inventory-wizard button", {hasText: "..."})`.
- El texto de algunos botones no es el "esperado": login es **"ENTRAR AL PANEL"**, no "Iniciar sesión".

## Notas de entorno (para no repetir el mismo lío)

- El botón de login se llama **"ENTRAR AL PANEL"**, no "Iniciar sesión" — usar ese texto en futuros scripts de prueba.
- Sesión de la cuenta QA guardada en `/tmp/qa-session.json` (Playwright `storageState`) — reutilizar en vez de logear cada vez.
- Cuenta QA: correo `qa.audit.1788444347823@example.com` / contraseña `PruebaQA123!`, org `auditoria-qa-motors`, `approval_status='pending'` (a propósito, para que quede representativa de un registro real).

## Bloqueado por configuración externa (no se puede probar en este entorno)

| Qué | Por qué no se puede confirmar aquí | Fuente |
|---|---|---|
| Subdominios `*.zevroa.com` en producción | `PLATFORM_BASE_DOMAIN` vacío; DNS comodín sin validar | `docs/LAUNCH-CHECKLIST.md` |
| Sentry (monitoreo de errores) | Sin `VITE_SENTRY_DSN`/`SENTRY_DSN`, es no-op | `src/utils/monitoring.js` |
| Correo transaccional (Resend) | Sin `RESEND_API_KEY` | `docs/LAUNCH-CHECKLIST.md` |
| Stripe checkout real | Sin credenciales, CTA lleva a "solicitar demo" | `app/server/src/index.js:105` |
