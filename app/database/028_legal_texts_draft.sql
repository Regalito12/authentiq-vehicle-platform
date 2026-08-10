-- 028_legal_texts_draft.sql
-- Idempotente: solo escribe si el campo sigue vacío (no pisa un texto que el
-- negocio ya haya editado desde el backoffice).
--
-- Contexto: privacy_text y terms_text estaban en NULL, así que el sitio público
-- mostraba el marcador "pendiente de aprobación antes del lanzamiento público"
-- (ver institutionalContent en app/src/App.jsx). Esto reemplaza el marcador por
-- un borrador real, basado en lo que la aplicación efectivamente hace —
-- verificado contra el código, no inventado — para que el sitio no publique
-- una politica de privacidad vacía.
--
-- IMPORTANTE: esto es un borrador de base, no un documento legal final. No
-- soy abogado ni conozco la entidad legal, RNC, domicilio fiscal o requisitos
-- regulatorios exactos del negocio. Antes de operar públicamente, un abogado
-- debe revisar y ajustar este texto a la jurisdicción y estructura real del
-- negocio. El texto es editable desde Backoffice > Configuración en cualquier
-- momento; esta migración solo asegura que nunca quede vacío.

BEGIN;

UPDATE business_settings
SET privacy_text = $$AUTHENTIQ · Política de privacidad (borrador base — pendiente de revisión legal)

Esta política describe qué datos recopila AUTHENTIQ y cómo los trata. Es un borrador inicial redactado a partir del funcionamiento real de la plataforma; el negocio debe revisarla con asesoría legal antes de operar públicamente y puede editarla en cualquier momento desde el panel administrativo.

1. Qué datos recopilamos
- Formularios de contacto, interés y oferta: nombre, correo, teléfono y el mensaje que escribas.
- Cuenta de comprador (opcional): nombre, correo, teléfono y contraseña (almacenada de forma cifrada, nunca en texto plano).
- Consentimiento: registramos si aceptaste esta política, cuándo y en qué formulario, para poder demostrarlo si es necesario.
- Uso del sitio: preferencias guardadas en tu navegador (tema claro/oscuro, favoritos, sesión de comprador) y eventos de navegación (qué páginas visitas, qué filtros usas, qué vehículos ves) asociados a una sesión anónima, no a tu identidad salvo que tengas una cuenta.

2. Para qué los usamos
- Responder tus consultas, ofertas y solicitudes de cotización.
- Gestionar tu cuenta de comprador y tus favoritos, si la creas.
- Medir qué contenido funciona para mejorar el catálogo y la atención comercial.
- Cumplir obligaciones legales y de auditoría interna cuando corresponda.

3. Con quién los compartimos
No vendemos ni compartimos tus datos con terceros con fines publicitarios. Solo los ve el equipo comercial de AUTHENTIQ que necesita atenderte, y —únicamente si el negocio lo configura expresamente— un sistema interno de notificaciones para agilizar la respuesta.

4. Cuánto tiempo los conservamos
Mientras tu cuenta esté activa o mientras sea razonablemente necesario para la relación comercial (por ejemplo, para dar seguimiento a una oferta). Puedes solicitar la eliminación de tus datos en cualquier momento a través de los canales de contacto publicados en el sitio.

5. Tus derechos
Puedes solicitar acceso, corrección o eliminación de tus datos personales, y retirar tu consentimiento para comunicaciones comerciales, escribiendo a través de los canales de contacto publicados en este sitio.

6. Cambios a esta política
Si actualizamos esta política, la nueva versión y su fecha quedarán reflejadas aquí. El consentimiento que ya diste queda registrado con la versión vigente en el momento en que lo otorgaste.$$
WHERE id = 1 AND (privacy_text IS NULL OR btrim(privacy_text) = '');

UPDATE business_settings
SET terms_text = $$AUTHENTIQ · Términos y condiciones (borrador base — pendiente de revisión legal)

Estos términos describen cómo funciona el sitio y qué implica usarlo. Es un borrador inicial pendiente de revisión legal; el negocio puede editarlo en cualquier momento desde el panel administrativo.

1. Naturaleza del catálogo
La información de precio, disponibilidad, especificaciones y condición de cada vehículo se muestra de buena fe pero está sujeta a confirmación e inspección. AUTHENTIQ puede corregir errores evidentes de precio o descripción sin previo aviso.

2. Ofertas y cotizaciones
Enviar una oferta o generar una cotización a través del sitio es una manifestación de interés, no una compra ni una reserva confirmada. Toda operación queda sujeta a disponibilidad del vehículo, verificación de la propuesta y aprobación comercial de AUTHENTIQ. Las cotizaciones generadas tienen una vigencia limitada, indicada en el propio documento.

3. Cuenta de comprador
Si creas una cuenta, eres responsable de mantener tu contraseña en privado y de la actividad que ocurra bajo tu sesión. Puedes cerrar tu cuenta o solicitar su eliminación en cualquier momento.

4. Uso aceptable
No está permitido usar el sitio para extraer datos de forma automatizada y masiva, interferir con su funcionamiento, ni enviar información falsa en los formularios de contacto u oferta.

5. Disponibilidad del servicio
AUTHENTIQ hace un esfuerzo razonable por mantener el sitio disponible, pero no garantiza operación ininterrumpida y puede realizar mantenimiento con o sin aviso previo.

6. Cambios a estos términos
Si actualizamos estos términos, la versión vigente será la publicada en este sitio en el momento de tu visita o solicitud.$$
WHERE id = 1 AND (terms_text IS NULL OR btrim(terms_text) = '');

COMMIT;

-- Verificación:
--   SELECT length(privacy_text), length(terms_text) FROM business_settings WHERE id=1;
--   (ambos deben ser mayores que 0)
