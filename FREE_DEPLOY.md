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

Antes de iniciar en produccion, el servidor rechazara automaticamente un entorno si falta `JWT_SECRET`, si las URLs publicas apuntan a localhost o si Supabase Storage no esta configurado.

## Render

1. Conectar el repositorio y seleccionar el Blueprint `render.yaml`.
2. Mantener el servicio en plan `free`.
3. Completar `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` como variables secretas.
4. Mantener `PUBLIC_API_URL` y `PUBLIC_SITE_URL` con la URL `onrender.com` que Render genere.
5. No agregar Persistent Disk.

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
- Conectar proveedores externos solo cuando existan sus credenciales y webhooks.

El plan Free permite monitores HTTP cada 5 minutos. Esto ayuda a mantener activo el servicio, pero no es una garantía absoluta: Render puede reiniciar servicios gratuitos y Supabase puede pausar proyectos sin actividad.
