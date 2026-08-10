# Manual de instalación AUTHENTIQ

## Requisitos

- Node.js LTS.
- PostgreSQL 15 o superior.
- Una base de datos vacía para AUTHENTIQ.

## Base de datos

1. Configurar `DATABASE_URL` en `app/server/.env`.
2. Aplicar en orden los archivos `app/database/001_*.sql` hasta el último número.
3. Ejecutar los seeds demo solo en ambientes de demostración.
4. Crear el administrador con `npm run create-admin -- --email=correo-real`.

## API y frontend

En `app/server/.env` definir:

```text
DATABASE_URL=postgresql://usuario:contraseña@servidor:5432/authentiq
JWT_SECRET=un-secreto-largo-y-aleatorio
PRIVACY_POLICY_VERSION=2026-08-09
PUBLIC_SITE_URL=https://dominio-real.com
```

Luego:

```text
cd app/server
npm install
npm run smoke
npm run test:roles
npm start
```

En otra terminal:

```text
cd app
npm install
npm run build
npm run dev -- --host 0.0.0.0
```

## Backup y verificación

- Crear backups con `app/server/scripts/backup-db.ps1`.
- Verificar `GET /api/health`.
- Ejecutar `npm run smoke` antes de entregar.
- Cambiar todas las credenciales demo y no copiar `.env` al repositorio.
