# ZEVROA · checklist de despliegue

La aplicación está separada en dos servicios:

- `app/`: frontend React/Vite. Se compila con `npm.cmd run build` y se sirve como archivos estáticos desde `app/dist`.
- `app/server/`: API Express/PostgreSQL. Se inicia con `npm.cmd start` y requiere Node 24 (`app/.nvmrc`).

## Arquitectura recomendada para producción

El proyecto usa Vercel como hosting oficial, con `app/vercel.json` como configuración efectiva, y Supabase como PostgreSQL y Storage. En modo serverless los archivos temporales viven en `/tmp`, por eso Supabase Storage y Vercel Cron son obligatorios para producción. La configuración histórica de Render está archivada y no forma parte del release.

## Variables del API

Copiar `app/server/.env.example` como `.env` en el servidor y configurar valores reales:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://usuario:password@host:5432/zevroa
JWT_SECRET=una-clave-larga-aleatoria
FRONTEND_ORIGIN=https://dominio-del-catalogo.com
PUBLIC_API_URL=https://api.dominio-del-catalogo.com
PUBLIC_SITE_URL=https://dominio-del-catalogo.com
UPLOADS_DIR=/var/lib/zevroa/uploads
```

`UPLOADS_DIR` debe existir, ser escribible por el proceso del API y estar incluido en los backups. Si el hosting usa storage externo, se reemplaza el adaptador de uploads antes de producción.

## Base de datos

1. Crear una base PostgreSQL vacía.
2. Ejecutar las migraciones estructurales de `app/database` en orden.
3. Ejecutar los archivos de demo solo en entornos de demo o QA, y **después** de todas las migraciones estructurales — no todas siguen el patrón `*_seed_*.sql` (`011_demo_showcase_data.sql` no lo sigue) y el orden alfabético entre ellas y las estructurales no siempre coincide con el orden de dependencia real. Lista completa de archivos de demo: `002_seed_demo.sql`, `006_seed_editorial_demo.sql`, `011_demo_showcase_data.sql`, `012_seed_commercial_profile_demo.sql`.
4. Crear el administrador con `npm.cmd run create-admin -- --email=...`.
5. Confirmar `GET /api/health` antes de abrir el catálogo.

La base completa actual llega hasta `056_currency_normalization.sql`. En una base nueva hay que aplicar las migraciones estructurales en el orden documentado por CI y excluir los cuatro archivos de demo. El comando `npm.cmd run migrate:production` aplica `045`–`056` porque está diseñado para una base de producción que ya tiene aplicado el baseline `001`–`044`; no sustituye la instalación inicial.

## Frontend

Crear `app/.env.production` con:

```env
VITE_API_URL=https://api.dominio-del-catalogo.com
# Opcional: video hero MP4/WebM. Si queda vacío se usa la portada local de ZEVROA.
VITE_HERO_VIDEO_URL=https://cdn.dominio.com/zevroa-hero.mp4
```

Después ejecutar:

```powershell
npm.cmd ci
npm.cmd run build
```

Publicar el contenido de `app/dist` en el hosting estático y configurar fallback SPA hacia `index.html`.

## Comprobaciones antes de entregar

```powershell
cd app/server
npm.cmd ci
npm.cmd start          # en otra terminal: el resto necesita el API levantado
npm.cmd run verify     # componentes + preflight + smoke + roles + E2E
```

`verify` encadena, en orden:

| Comando | Qué comprueba |
|---|---|
| `npm.cmd run check:components` | Que ningún JSX use un componente inexistente (rompe la pantalla en runtime, no en build) |
| `npm.cmd run preflight` | Variables obligatorias, conexión a PostgreSQL y almacenamiento |
| `npm.cmd run smoke` | Salud del API, sitemap, robots, login y rutas del backoffice |
| `npm.cmd run test:roles` | Permisos reales por rol en el backend |
| `npm.cmd run test:e2e` | Recorrido completo: borrador → publicar → catálogo → oferta → lead → cotización → editar → reservar → desactivar, más rechazos de medios 3D inválidos |

El E2E crea sus propios registros y los elimina al terminar.

`preflight` se ejecuta con el API levantado y confirma conexión a PostgreSQL, almacenamiento disponible y variables esenciales. En producción también exige un `JWT_SECRET` de mínimo 32 caracteres.

Después del deploy, ejecuta desde `app`:

```powershell
$env:LIVE_URL = "https://TU-SERVICIO.onrender.com"
npm.cmd run check:live
```

El chequeo live valida `/api/health`, la portada, `robots.txt`, `sitemap.xml`, la presentación y que la base de datos y el almacenamiento estén disponibles.

En producción comprobar:

- `/api/health` devuelve `database: connected` y `storage: available`.
- El catálogo carga desde el dominio público.
- Una imagen subida desde el backoffice abre con la URL pública.
- Un vehículo nuevo puede completar su ficha con fotos, poster automático y SEO. Para el 3D: un GLB se sube como archivo único; un GLTF exige subir la carpeta completa (scene.gltf + .bin + texturas). El API rechaza un GLTF sin sus dependencias y no lo guarda como si estuviera listo.
- Ejecutar `GET /api/admin/maintenance/orphan-media` (solo admin) para ver medios sin referencia y `POST` sobre la misma ruta para borrarlos. Respeta una ventana de gracia de 60 minutos para no tocar archivos recién subidos.

## Riesgo conocido: URLs de medios absolutas

Las URLs de imágenes y modelos se guardan **absolutas** en base de datos, usando `PUBLIC_API_URL` en el momento de la subida. Al mover el proyecto a otro dominio, los medios ya cargados seguirán apuntando al host anterior.

Remediación tras el cambio de dominio (ejecutar una vez, con backup previo):

```sql
UPDATE vehicle_images SET image_url = replace(image_url, 'http://localhost:3001', 'https://api.dominio-real.com');
UPDATE vehicle_media  SET url = replace(url, 'http://localhost:3001', 'https://api.dominio-real.com'),
                          poster_url = replace(poster_url, 'http://localhost:3001', 'https://api.dominio-real.com');
UPDATE blog_posts     SET cover_image_url = replace(cover_image_url, 'http://localhost:3001', 'https://api.dominio-real.com');
UPDATE business_settings SET logo_url = replace(logo_url, 'http://localhost:3001', 'https://api.dominio-real.com');
```
- El flujo comprador → oferta → admin → notificación funciona.
- PostgreSQL y `UPLOADS_DIR` tienen backup y restauración probada.
- HTTPS, dominio, CORS y `JWT_SECRET` están configurados.
