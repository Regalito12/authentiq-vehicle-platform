# Matriz de roles AUTHENTIQ

## Perfiles

| Perfil | Uso | Puede administrar inventario | Puede operar CRM | Puede editar contenido | Puede gestionar usuarios/configuración |
|---|---|---:|---:|---:|---:|
| Administrador | Control total | Sí | Sí | Sí | Sí |
| Editor | Inventario y operación comercial | Sí | Sí | Sí | No |
| Ventas | Seguimiento y cierre comercial | No | Sí | No | No |
| Contenido | Journal y contenido público | No | No | Sí | No |

## Reglas críticas verificadas en backend

- Sin token: las rutas `/api/admin/*` responden `401`.
- Inventario, usuarios y configuración no dependen únicamente de botones ocultos: el backend valida el rol.
- Leads, cotizaciones, ofertas, test drives, calendario y reportes requieren perfil administrador, editor o ventas.
- Blog requiere administrador, editor o contenido.
- Auditoría, usuarios administrables y configuración requieren administrador.
- Los formularios públicos no crean registros sin consentimiento de privacidad.

## Antes de producción

- Cambiar credenciales demo y `JWT_SECRET`.
- Crear únicamente cuentas reales con contraseñas individuales.
- Revisar los roles con el negocio antes de abrir el servidor a internet.
