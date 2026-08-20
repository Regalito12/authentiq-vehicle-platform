# Despliegue gratuito: Render + Supabase

## Arquitectura

- Render Free: frontend y API Node/Express.
- Supabase Free: PostgreSQL y Storage.
- Render no guarda archivos permanentes; cada upload se sube a Supabase Storage.
- UptimeRobot Free puede consultar `/api/health` cada 5 minutos para reducir el spin-down de Render.

## Supabase

1. Crear un proyecto gratuito en Supabase.
2. Copiar la connection string de PostgreSQL y guardarla como `DATABASE_URL` en Render.
3. Ejecutar `app/database/033_supabase_storage_bucket.sql` en el SQL Editor.
4. Copiar `Project URL` como `SUPABASE_URL`.
5. Copiar la clave `service_role` como `SUPABASE_SERVICE_ROLE_KEY` únicamente en Render.
6. Usar `vehicle-media` como `SUPABASE_STORAGE_BUCKET`.
7. Aplicar las migraciones SQL de `app/database` en orden antes del primer uso.

Antes de iniciar en produccion, el servidor rechazara automaticamente un entorno si falta `JWT_SECRET`, si las URLs publicas apuntan a localhost, si Supabase Storage no esta configurado o si se exige protección anti-bot sin la clave secreta.

## Render

1. Conectar el repositorio y seleccionar el Blueprint `render.yaml`.
2. Mantener el servicio en plan `free`.
3. Completar `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` como variables secretas.
4. Mantener `PUBLIC_API_URL`, `PUBLIC_SITE_URL` y `FRONTEND_ORIGIN` con la URL `onrender.com` que Render genere. En esta arquitectura deja `VITE_API_URL` vacío: frontend y API comparten el mismo dominio.
5. No agregar Persistent Disk.
6. En Cloudflare Turnstile, crear un widget para el dominio de cada entorno. Agregar su clave pública como `VITE_TURNSTILE_SITE_KEY` y la secreta como `TURNSTILE_SECRET_KEY`. Render debe reconstruir el frontend después de guardar la clave pública.
7. Para Google Calendar, crear un cliente OAuth de tipo aplicación web y registrar exactamente `https://TU-SERVICIO.onrender.com/api/integrations/google-calendar/callback`. En Render completar `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` y `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`. El Blueprint deja `GOOGLE_CALENDAR_REQUIRED=true`, por lo que el servicio no arrancará con una configuración incompleta.

## Monitor gratuito

Crear en UptimeRobot un monitor HTTP para:

`https://TU-SERVICIO.onrender.com/api/health`

## Lista final antes de entregar

- Reemplazar los textos legales borrador desde Backoffice -> Configuracion -> Legal y confianza.
- Cambiar las credenciales de demostracion y crear el administrador real.
- Verificar una subida de imagen y una lectura desde `vehicle-media`.
- Confirmar que los endpoints `export/leads.csv`, `export/appointments.csv` y `export/quotes.csv` descarguen datos del tenant correcto.
- Ejecutar `npm run backup:db` desde `app/server` en una máquina con `pg_dump` y conservar el `.dump` junto a su manifiesto SHA-256.
- Confirmar dominio, DNS, SSL, telefono, WhatsApp y horario del concesionario.
- Confirmar que cada dominio de dealer devuelve su propio `robots.txt`, `sitemap.xml`, canonical y tarjeta para compartir.
- Crear y verificar el widget Turnstile desde un navegador real: contacto, oferta y cita deben rechazar envíos sin token.
- Conectar proveedores externos solo cuando existan sus credenciales y webhooks.
- En Backoffice -> Integraciones -> Google Calendar, completar la autorización OAuth una vez desplegado. La configuración de variables solo prepara el conector; no concede acceso al calendario hasta que el dealer autoriza su cuenta.

El plan Free permite monitores HTTP cada 5 minutos. Esto ayuda a mantener activo el servicio, pero no es una garantía absoluta: Render puede reiniciar servicios gratuitos y Supabase puede pausar proyectos sin actividad.
