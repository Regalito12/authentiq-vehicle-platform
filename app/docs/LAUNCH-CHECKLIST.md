# ZEVROA · checklist de lanzamiento

Este documento distingue lo que ya está preparado en el repositorio de lo que
requiere una cuenta externa. No pegues secretos en este archivo ni en Git.

## Antes de activar subdominios

1. En Namecheap crea el registro que Vercel muestra para el comodín:
   `A  *.zevroa.com  76.76.21.21`.
2. En Vercel confirma que `*.zevroa.com` ya no muestra *Invalid configuration*.
3. Agrega estas variables en **Preview** y **Production**:
   `PLATFORM_BASE_DOMAIN=zevroa.com` y `VITE_PLATFORM_BASE_DOMAIN=zevroa.com`.
4. Haz un deploy nuevo y prueba `dealer-demo.zevroa.com` con un dealer aprobado.

No actives esas dos variables antes de que el DNS comodín esté validado: el
wizard evita prometer un enlace que todavía no resolvería.

## Formularios y correo

- Cloudflare Turnstile: incluye `zevroa.com`, `www.zevroa.com` y, tras el
  wildcard, `*.zevroa.com` en los hostnames permitidos. Confirma que la clave
  pública corresponde a `VITE_TURNSTILE_SITE_KEY` y la secreta a
  `TURNSTILE_SECRET_KEY`. Si se exige protección, usa `BOT_PROTECTION_REQUIRED=true`.
- Resend: verifica el dominio remitente y agrega `RESEND_API_KEY` y
  `RESEND_FROM_EMAIL`. Sin ellas, la interfaz muestra que el correo está
  pendiente y el servidor no finge que esté conectado.
- Google Calendar: registra exactamente el redirect URI guardado en
  `GOOGLE_CALENDAR_REDIRECT_URI` y completa una autorización inicial.
- Sentry: al crear el proyecto, agrega `SENTRY_DSN` y `VITE_SENTRY_DSN`.

## Backup y restauración de prueba

Ejecuta esto desde `app` con `DATABASE_URL` apuntando a una base de **QA**:

```powershell
npm.cmd run backup:db
pg_restore --clean --if-exists --no-owner --dbname "<QA_DATABASE_URL>" "<archivo-zevroa.dump>"
```

El comando genera un `.dump` y comprueba que `pg_restore` puede leerlo. La
restauración debe hacerse solamente en QA, nunca sobre producción. Conserva el
archivo y su manifiesto SHA-256 en almacenamiento privado y confirma que QA
abre, inicia sesión y ve datos coherentes antes de lanzar comercialmente.

## Release seguro

1. Ejecuta `npm.cmd run check:production`, `npm.cmd run build` y
   `npm.cmd --prefix server run check:migrations`.
2. Despliega a Preview y prueba `/backoffice`, catálogo, una ficha, un formulario
   y móvil 390 px.
3. Cuando el preview esté correcto, despliega a Production. El cron de
   recordatorios queda registrado para `/api/internal/appointment-reminders`;
   necesita `CRON_SECRET` y empieza a correr únicamente tras ese deploy.
4. Comprueba en producción `/api/health`, `/robots.txt`, `/sitemap.xml`,
   `/backoffice` y el dominio principal. Revisa el header CSP y consola sin
   errores.

## Pagos

Los planes llevan a solicitar una demo. No actives Stripe ni cambies el CTA
hasta tener cuenta de negocio, productos/precios, webhook y prueba de pago.
