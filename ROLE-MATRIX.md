# Matriz de roles AUTHENTIQ

## Perfiles

| Perfil | Uso | Puede administrar inventario | Puede operar CRM | Puede editar contenido | Puede gestionar usuarios/configuración |
|---|---|---:|---:|---:|---:|
| Administrador | Control total | Sí | Sí | Sí | Sí |
| Editor | Inventario, operación comercial y personalización del showroom | Sí | Sí | Sí | Solo personalización |
| Ventas | Seguimiento y cierre comercial | No | Sí | No | No |
| Contenido | Journal y contenido público | No | No | Sí | No |

## Reglas críticas verificadas en backend

- Sin token: las rutas `/api/admin/*` responden `401`.
- Inventario, usuarios y configuración no dependen únicamente de botones ocultos: el backend valida el rol.
- Leads, cotizaciones, ofertas, test drives, calendario y reportes requieren perfil administrador, editor o ventas.
- Blog requiere administrador, editor o contenido.
- Auditoría, usuarios administrables, datos de cuenta (dominio, plan) e integraciones requieren administrador.
- La personalización del showroom (`/api/admin/settings`, `/api/admin/onboarding`) está abierta a administrador y editor: el editor es quien publica y ajusta el showroom a diario.
- Los formularios públicos no crean registros sin consentimiento de privacidad.

## Antes de producción

- Cambiar credenciales demo y `JWT_SECRET`.
- Crear únicamente cuentas reales con contraseñas individuales.
- Revisar los roles con el negocio antes de abrir el servidor a internet.
