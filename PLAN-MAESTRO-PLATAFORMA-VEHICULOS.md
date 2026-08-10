# Plan maestro de producto y ejecucion - AUTHENTIQ

Fecha de revision: 2026-08-09  
Estado actual: MVP local avanzado, visualmente premium, todavia no listo para produccion.  
Objetivo: convertir AUTHENTIQ en una plataforma funcional de venta de vehiculos para comprador, vendedor y administrador, manteniendo una experiencia editorial de alta gama.

## 1. Principio del producto

AUTHENTIQ no debe ser solo un catalogo bonito. Debe conectar tres recorridos completos:

1. El comprador descubre, compara, entiende, pregunta, agenda y recibe seguimiento.
2. El vendedor recibe el prospecto, conoce su contexto, lo atiende y lo mueve hasta cierre o perdida.
3. El administrador controla inventario, usuarios, contenido, operacion, configuracion, seguridad y resultados.

La definicion de terminado no sera "la pantalla existe". Cada capacidad debe guardar datos reales, respetar permisos, mostrar estados de carga/error/vacio/exito y poder verificarse de punta a punta.

## 2. Referencias competitivas revisadas

| Referencia | Patron valioso | Adaptacion para AUTHENTIQ |
|---|---|---|
| [Porsche Finder](https://finder.porsche.com/mx/es-MX/search) | Filtros profundos por variante, motor, transmision, equipamiento, colores, disponibilidad, kilometraje y ubicacion | Ficha comercial completa y filtros que usen exactamente los datos administrados en backoffice |
| [Porsche Finder Brasil](https://finder.porsche.com/br/pt-BR/search) | Propietarios anteriores, primer registro, certificacion, disponibilidad y busquedas guardadas | Perfil de procedencia y confianza; favoritos y alertas en una fase posterior |
| [AutoTrader](https://www.autotrader.com/) | Busqueda por presupuesto, compra hibrida, oferta por vehiculo usado y contenido educativo | Presupuesto mensual, tasacion como lead y siguiente paso visible en cada ficha |
| [CarGurus](https://investors.cargurus.com/static-files/b497f66c-000e-42ed-9db8-94070629a98f) | Analisis de precio, reseñas, filtros detallados, financiamiento y generacion de leads | Transparencia del precio, costo/condiciones visibles y medicion del origen de cada lead |
| [Bring a Trailer](https://bringatrailer.com/how-bat-works/) | Fichas exhaustivas, galerias amplias, videos, historial, documentos y comunicacion contextual | Administracion profesional de medios, historial y documentos; consultas ligadas al vehiculo |
| [CarMax](https://www.carmax.com/) | Recorrido omnicanal: apartar, financiar, tasar, agendar y continuar el proceso | Estado de disponibilidad y agenda confiable; reserva y pagos quedan POR DEFINIR |

Conclusion: la ventaja competitiva no viene de copiar una pagina. Viene de combinar la precision de Porsche Finder, la claridad de compra de AutoTrader/CarMax y la confianza documental de Bring a Trailer, ajustadas a la operacion real del negocio.

## 3. Auditoria del producto actual

### Ya funciona

- Catalogo publico conectado a PostgreSQL.
- Busqueda, filtros basicos, orden, comparador temporal y fichas de vehiculo.
- Galeria, vista ampliada, cotizacion imprimible, calculadora financiera y compartir por WhatsApp.
- Formularios de interes, oferta y test drive guardados en base de datos.
- Login administrativo con JWT y roles en API.
- Inventario con alta, edicion, duplicado, publicacion, desactivacion y carga de fotos.
- CRM de leads con estados, asignacion, notas e historial.
- Ofertas, test drives, calendario, notificaciones, reportes, auditoria, usuarios y configuracion.
- Blog, modo oscuro, responsive y modo de presentacion.

### Parcial o insuficiente

- La ficha del vehiculo no tiene todos los datos comerciales que necesita un comprador.
- Los filtros publicos no cubren combustible, transmision, variante, color, ubicacion o equipamiento.
- No existe historial de cambios de estado del inventario.
- La agenda no aplica reglas de disponibilidad ni evita conflictos.
- Configuracion del negocio no alimenta completamente el sitio publico.
- Privacidad y consentimiento no quedan registrados con cada solicitud.
- Reportes miden registros internos, pero no visitas, fichas vistas ni conversion por canal.
- Blog no tiene categorias, etiquetas, previsualizacion completa ni gestion de SEO avanzada.
- No hay recuperacion de contrasena, verificacion de correo ni permisos granulares.
- No hay pruebas automatizadas, CI, staging, backup/restore ni guia de despliegue final.

### No implementado

- Cuenta de comprador, favoritos persistentes y busquedas guardadas.
- Alertas por nuevos vehiculos o cambios de precio.
- Tasacion de vehiculo para entrega o venta.
- Historial, inspeccion, garantia y documentos descargables por vehiculo.
- Paginas, banners y llamados a accion administrables.
- Analitica real de comportamiento y embudo.
- Importacion/exportacion completa de inventario.
- Organizaciones/multiempresa, planes, pagos e integraciones externas.

## 4. Alcance por usuario

### Comprador

- Buscar por texto y filtrar por marca, modelo, condicion, carroceria, precio, ano, kilometraje, combustible, transmision, color y ubicacion.
- Ver disponibilidad real: disponible, reservado o vendido.
- Revisar especificaciones, equipamiento, garantia, procedencia, galeria, videos y documentos permitidos.
- Comparar vehiculos con suficientes atributos para decidir.
- Calcular una cuota orientativa con aclaracion legal.
- Guardar favoritos y busquedas cuando se habilite cuenta de comprador.
- Consultar, hacer oferta, agendar visita/test drive y solicitar tasacion.
- Aceptar privacidad de forma verificable y recibir confirmacion.
- Ver contacto, ubicacion, horario, politicas y datos del negocio reales.

### Vendedor

- Ver solo la informacion necesaria para atender prospectos.
- Recibir leads con vehiculo, fuente, accion original y consentimiento.
- Asignar, contactar, registrar notas/tareas y mover etapas.
- Crear o reprogramar citas sin conflictos.
- Preparar cotizacion y registrar resultado comercial.
- Ver prioridades, vencimientos y proxima accion.

### Administrador

- Control total del inventario, taxonomias, especificaciones, medios, estados y trazabilidad.
- Control de leads, ofertas, citas, usuarios, roles, permisos y auditoria.
- Gestion de paginas, blog, banners, SEO, datos del negocio y textos legales.
- Dashboard con inventario, actividad, conversion, tiempos de respuesta y fuentes.
- Exportar/importar datos con validacion y reporte de errores.
- Configurar disponibilidad, canales, notificaciones y parametros comerciales.
- Operar backups, despliegues y recuperacion mediante procedimientos documentados.

## 5. Backlog ejecutable por bloques

### Bloque 1 - Fundacion comercial del inventario (P0)

- Agregar variante, combustible, colores, puertas, asientos, ubicacion, numero de stock, garantia y equipamiento.
- Agregar estado `reserved` y mostrar disponibilidad coherente.
- Administrar esos datos desde backoffice.
- Servirlos desde API y mostrarlos en ficha, comparador y filtros.
- Validar que un publicado tenga precio, descripcion, imagen y datos minimos.

Criterio de aceptacion: un administrador crea o edita un vehiculo completo y un comprador puede encontrarlo mediante esos atributos y entender su configuracion sin pedir datos basicos.

### Bloque 2 - Confianza, contacto y cumplimiento (P0)

- Crear endpoint publico seguro para configuracion del negocio.
- Conectar nombre, logo, telefono, WhatsApp, correo, direccion, horario y redes al sitio.
- Conectar privacidad y terminos administrados.
- Registrar consentimiento, version/texto legal, fecha, origen y accion en leads/ofertas/test drives.
- Confirmacion clara al comprador y notificacion operativa al equipo.

Criterio de aceptacion: ningun formulario comercial se envia sin consentimiento y el sitio nunca muestra datos ficticios cuando el administrador ya configuro datos reales.

### Bloque 3 - Agenda operativa real (P0)

- Horarios de atencion, duracion de cita, dias bloqueados y anticipacion minima.
- Evitar doble reserva de vehiculo, asesor o franja.
- Confirmar, reprogramar, cancelar y completar.
- Vista de agenda diaria/semanal y recordatorios internos.

Criterio de aceptacion: comprador y vendedor no pueden generar conflictos; toda modificacion queda en historial.

### Bloque 4 - CRM y cierre comercial (P0)

- Proxima accion, fecha limite, prioridad, etiquetas y motivo de perdida.
- Historial unificado de formulario, oferta, cita, notas y cambios.
- Cotizacion persistente con vigencia, moneda, condiciones y estado.
- Bandejas: nuevos sin atender, vencidos, citas de hoy y ofertas pendientes.
- Tiempo de primera respuesta y conversion por vendedor/origen.

Criterio de aceptacion: un lead puede recorrerse desde el primer contacto hasta ganado/perdido sin depender de notas externas.

### Bloque 5 - Contenido, SEO y medicion (P0 antes de publicar)

- Canonical, sitemap, robots correcto y metadatos por ficha/pagina.
- Categorias/etiquetas de blog, alt de imagen y previsualizacion.
- Paginas institucionales y banners administrables.
- Eventos: busqueda, filtro, vista de ficha, comparar, WhatsApp, oferta y test drive.
- Dashboard por fuente, vehiculo, accion y periodo.

Criterio de aceptacion: el administrador puede saber que inventario atrae y convierte, y cada URL publica tiene metadatos verificables.

### Bloque 6 - Calidad, seguridad y entrega (P0)

- Pruebas de API, componentes y recorridos Playwright.
- Validacion de permisos por endpoint y matriz de roles.
- Politica de contrasenas, recuperacion, expiracion de sesion y secretos de produccion.
- Sanitizacion, limites, logs, manejo de errores y cabeceras/CORS definitivos.
- Scripts de migracion, seed de demo separado, backup/restore y rollback.
- Manual para levantar frontend, API y PostgreSQL en el servidor final.

Criterio de aceptacion: una instalacion limpia puede desplegarse y verificarse siguiendo el manual, y los recorridos criticos pasan automaticamente.

### Bloque 7 - Mejoras P1

- Cuenta del comprador, favoritos, busquedas guardadas y alertas.
- Tasacion/intercambio, documentos e inspeccion avanzada.
- Importacion de inventario, notificaciones por email/WhatsApp y analitica avanzada.
- 360 o 3D real solo para vehiculos que tengan material compatible.

### Bloque 8 - Expansion P2

- Multiempresa, organizaciones, membresias, dominios, temas y superadmin.
- Planes, facturacion, pagos, reservas monetarias e integraciones.

Estas decisiones permanecen `POR DEFINIR` hasta conocer modelo comercial, proveedor y requisitos legales.

## 6. Orden recomendado de ejecucion

1. Fundacion comercial del inventario.
2. Configuracion publica, privacidad y consentimiento.
3. Agenda sin conflictos.
4. CRM y cotizacion persistente.
5. Contenido, SEO y analitica.
6. Pruebas, seguridad y despliegue.
7. P1 y P2 solo despues de aprobar el producto base.

## 7. Regla de avance

Cada bloque se entrega con:

- migracion idempotente cuando cambie la base de datos;
- API validada y protegida;
- interfaz de comprador y/o backoffice completa;
- estados vacio, carga, error y exito;
- prueba del recorrido real;
- build exitoso;
- actualizacion de este documento con evidencia y pendientes.

## 8. Estado de ejecucion

| Bloque | Estado | Evidencia |
|---|---|---|
| Investigacion competitiva | Completado | Referencias y patrones documentados arriba |
| Auditoria funcional inicial | Completado | Matriz actual/parcial/no implementado |
| 1. Fundacion comercial | Completado | `012_vehicle_commercial_profile.sql`; CRUD autenticado 200; ficha, comparador y filtros verificados en navegador; build exitoso |
| 2. Confianza y cumplimiento | Completado | `013_consent_and_public_settings.sql`; `/api/settings` 200; API rechaza lead sin consentimiento con 400; checkbox verificado en contacto y test drive |
| 3. Agenda real | Completado | `014_appointment_rules.sql`; reglas editables en Configuración; cita duplicada rechazada con 409; backoffice verificado sin errores |
| 4. CRM y cierre | Completado | `015_lead_triage.sql` + `016_quotes.sql`; leads con triage comercial y cotizaciones persistentes con vigencia, descuento, estados, auditoría e impresión |
| 5. Contenido, SEO y medicion | En progreso | Sitemap dinámico, robots, canonical por ruta, eventos comerciales persistidos, panel de analítica, SEO editable por vehículo (`018_vehicle_seo.sql`), ALT editable por galería y categorías/etiquetas de blog (`019_blog_taxonomy.sql`); metadatos editoriales avanzados siguen pendientes |
| 6. Calidad y entrega | En progreso | `smoke-test.js` y `role-matrix-test.js` pasan; editor, ventas y contenido verificados con cuentas QA temporales desactivadas; backup restaurado exitosamente en una base temporal; manual, matriz y backup creados; falta validar el servidor final |
