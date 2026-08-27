# ZEVROA en local

## Arranque normal

Desde la carpeta `app`:

```powershell
npm run local
```

El comando levanta el API en `http://127.0.0.1:3001` y el frontend en `http://127.0.0.1:5173`. Si alguno ya está activo, no crea un proceso duplicado.

## Configuración

La conexión de PostgreSQL vive en `server/.env`. No subir ese archivo a Git. Como mínimo debe contener `PORT`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`, `PUBLIC_API_URL` y `PUBLIC_SITE_URL`.

## Base de datos

Para una instalación nueva, aplica los archivos de `database/` en orden numérico. En una instalación existente, no repitas migraciones ya aplicadas: primero revisa el estado de tu esquema y haz un backup.

## Backup

Con PostgreSQL instalado:

```powershell
npm run backup:db
```

Genera un archivo local en `backups/` en formato custom de PostgreSQL. Para restaurarlo en una base de prueba, usa `pg_restore`; no restaures sobre la base activa sin confirmar el destino.

## Verificación rápida

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
npm run build
npm --prefix server run test:e2e
```
