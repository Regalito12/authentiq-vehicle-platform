# ZEVROA · QA aislado y restauración

Las pruebas de roles, aislamiento, invitaciones y restauración escriben datos.
Ejecuta todo en un proyecto Supabase QA separado, nunca en producción.

## Variables obligatorias

```text
QA_ENVIRONMENT=qa
ZEVROA_QA_CONFIRMATION=zevroa-qa
QA_DATABASE_URL=postgresql://...base-qa...
QA_SUPABASE_URL=https://...qa.supabase.co
QA_SUPABASE_SERVICE_ROLE_KEY=...
QA_SUPABASE_STORAGE_BUCKET=vehicle-media
QA_TEST_URL=https://...preview-o-qa...
QA_TEST_ADMIN_EMAIL=...
QA_TEST_ADMIN_PASSWORD=...
```

No guardes ese archivo de variables en Git. Los comandos remotos se niegan a
correr si faltan `QA_ENVIRONMENT=qa` o `ZEVROA_QA_CONFIRMATION=zevroa-qa`.

## Orden de ejecución

1. Crea el proyecto QA en Supabase y sus buckets.
2. Aplica las migraciones con `DATABASE_URL` apuntando a QA:

   ```powershell
   npm.cmd run migrate:production
   ```

3. Confirma el esquema y variables:

   ```powershell
   npm.cmd run qa:preflight
   ```

4. Crea fixtures QA: dos dealers aprobados, un `platform_admin`, un `admin`,
   un `editor` y un `seller`. Usa correos de prueba únicos.
5. Ejecuta roles y aislamiento:

   ```powershell
   npm.cmd run qa:roles
   npm.cmd run qa:tenants
   ```

6. Crea un respaldo QA verificable:

   ```powershell
   npm.cmd run backup:qa
   ```

7. Restaura únicamente sobre otra base QA vacía. La operación borra objetos y
   datos de ese destino:

   ```powershell
   $env:ALLOW_QA_STORAGE_RESTORE = "true"
   npm.cmd run restore:db:qa -- -BackupFile "C:\ruta\zevroa-AAAA.dump"
   npm.cmd run restore:storage:qa -- "C:\ruta\storage-AAAA"
   ```

8. Comprueba login, conteos, hash del manifiesto y una imagen restaurada antes
   de aprobar el release comercial.
