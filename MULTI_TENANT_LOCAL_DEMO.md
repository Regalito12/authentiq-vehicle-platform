# Demo local: dos dealers aislados

Esta demostración no toca Supabase ni producción. El seed se niega a ejecutarse si la base configurada no es `localhost` o `127.0.0.1`.

1. Desde `app/server`, ejecuta `npm run seed:local-tenants`.
2. Desde la raíz, ejecuta `npm run local`.
3. Abre estos dos catálogos en el navegador:
   - `http://localhost:5173/?dealer=dealer-demo` — Aurea Motors
   - `http://localhost:5173/?dealer=velocity-demo` — Velocity Motors
4. Confirma el aislamiento con `npm run test:tenants` desde `app/server`.

Los accesos de demo usan la contraseña local configurada en `LOCAL_DEMO_ADMIN_PASSWORD`; si no se configura, es `12345678`.

- Aurea Motors: `demo@dealer.local`
- Velocity Motors: `velocity@dealer.local`

Cada dealer recibe una organización, ajustes de marca, usuario administrador, taxonomía (marcas/categorías) e inventario propios. El parámetro `?dealer=` solo funciona con la API local y sirve para una demo sin editar el archivo `hosts` de Windows. En producción se reemplaza por el dominio o subdominio asignado a cada dealer; el backend ya resuelve la organización por `custom_domain`.
