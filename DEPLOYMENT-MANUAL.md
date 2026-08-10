# Manual de instalación AUTHENTIQ

## Requisitos

- Node.js LTS.
- PostgreSQL 15 o superior.
- Una base de datos vacía para AUTHENTIQ.

## Base de datos

1. Configurar `DATABASE_URL` en `app/server/.env`.
2. Aplicar en orden numérico los archivos estructurales de `app/database/`, **excluyendo los de demo**: `002_seed_demo.sql`, `006_seed_editorial_demo.sql`, `011_demo_showcase_data.sql` y `012_seed_commercial_profile_demo.sql`. Un simple `sort` alfabético de *todos* los `.sql` falla: `012_seed_commercial_profile_demo.sql` ordena antes que `012_vehicle_commercial_profile.sql` pero depende de columnas que esa migración crea.
3. Si el ambiente es de demostración, aplicar los 4 archivos de demo listados arriba **después** de todas las migraciones estructurales, en el orden numérico de su prefijo.
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
