# Auditoría técnica AUTHENTIQ · 2026-08-09

Revisión completa de frontend, API, base de datos, medios 3D, roles y despliegue, con corrección e implementación verificada.

## Resumen

| | |
|---|---|
| Problemas encontrados | 26 |
| Corregidos y verificados | 22 |
| Documentados sin corregir (requieren decisión o credencial) | 4 |
| Comprobaciones automatizadas al final | 51, todas en verde |

---

## 1. Fallos críticos (rompían la aplicación)

### 1.1 El módulo de Reportes reventaba la pantalla
`ReportsModule` usaba `<AnalyticsEventsPanel />`, un componente que no existía en ningún archivo. Su CSS (`.analytics-events-panel`, `.analytics-event-list`) seguía en `styles.css`, lo que indica que se eliminó por accidente. El build de Vite pasaba sin avisar porque es un `ReferenceError` de tiempo de ejecución: al abrir *Reportes* con perfil admin, editor o ventas, la pantalla quedaba en blanco.

**Corrección:** componente reconstruido sobre el CSS existente, mostrando los eventos de los últimos 30 días con etiquetas en español.
**Prevención:** `npm run check:components` detecta cualquier JSX que use un componente no definido. Se comprobó que el detector reproduce este bug exacto al revertir el fix.

### 1.2 Un modelo 3D roto se servía a los compradores
El Porsche 911 GT3 publicado apuntaba a `uploads/1786308536352-xu2cq260.gltf`: un GLTF suelto al que le faltaban **las 33 dependencias** (`scene.bin` + 32 texturas). `model-viewer` no puede cargarlo, así que la ficha se quedaba en «CARGANDO MODELO» de forma indefinida.

El modelo completo y válido **ya estaba en disco** en `uploads/packages/1786309890909-j29fy980/`. No se sustituyó por ningún cubo ni efecto procedural: se reconectó el modelo real.

**Verificado:** `scene.gltf` responde 200 con `model/gltf+json` y **33/33 dependencias descargables por HTTP**.

### 1.3 Cualquier error de render dejaba la página en blanco
No existía ningún error boundary. Un fallo en el visor 3D, el video o el estudio visual tumbaba la ficha entera.

**Corrección:** `SectionBoundary` aísla visor 3D, video y estudio visual. Si el 3D falla, el comprador ve un estado elegante que lo lleva a la galería; el resto de la ficha sigue intacto.

### 1.4 El login administrativo podía dejar la petición colgada
`POST /api/auth/login` no tenía `try/catch`. Con PostgreSQL caído, la promesa rechazada no producía respuesta HTTP. Tampoco había manejador global de errores ni de 404.

**Corrección:** `try/catch` con 503, manejador 404 JSON para `/api/*`, manejador global de errores que no filtra detalles internos, y captura de `unhandledRejection` / `uncaughtException`.

---

## 2. SEO y rutas

### 2.1 El título, canonical y Open Graph nunca cambiaban por vehículo
El efecto de metadatos dependía de `[selected]`, pero `navigate()` pone `selected = null` en cada navegación: la ficha se resuelve por ruta (`routeVehicle`). El efecto no volvía a ejecutarse nunca. Además `og:title` y `og:image` leían `selected`, siempre nulo, así que **todo vehículo compartido en WhatsApp o redes mostraba el título y la imagen genéricos del sitio**.

**Corrección:** dependencias reales (`activeVehicle?.id`, `pathname`, `loading`), metadatos leídos de `activeVehicle`, y se añadieron `twitter:*` y `og:type`. Los borradores y `/preview` ahora emiten `noindex, nofollow`.

### 2.2 Dos vehículos con la misma marca y modelo compartían URL
`vehiclePath()` era `slugify(marca-modelo)`. Dos «Porsche 911» generaban `/vehiculos/porsche-911` y `.find()` devolvía siempre el primero: el segundo era inalcanzable.

**Corrección:** el slug incluye variante y un sufijo del id. `findVehicleByPath()` acepta también el formato antiguo para no romper enlaces ya compartidos.

### 2.3 El sitemap generaba URLs corruptas
```js
.replace(/[\\u0300-\\u036f]/g, "")   // doble barra: no es un rango Unicode
```
Al estar mal escapada, la clase de caracteres eliminaba literalmente `\`, `u`, `0`, `3`, `6` y `f` del slug. `porsche-911-gt3` salía como `porsche-911-gt`. **Ninguna URL del sitemap con esos caracteres coincidía con una ruta real del sitio.**

**Corrección:** el backend usa ahora `vehicleSlug()`, gemela de la del frontend. Se añadió `lastmod`, escapado XML y se quitó la URL con fragmento (`/#catalog`), que no es válida en un sitemap.

---

## 3. Coherencia de estados comerciales

El catálogo público sirve `published` **y** `reserved`, pero:

- `POST /api/leads` solo aceptaba `published` → consultar por un vehículo reservado devolvía 404.
- `syncCatalogVehicle` en el frontend eliminaba del catálogo cualquier vehículo que no fuera `published` → al reservar desde el backoffice, desaparecía de la vitrina aunque el API lo siguiera sirviendo.

**Corrección:** leads acepta `published` y `reserved`; las ofertas sobre un reservado responden **409 con un mensaje comercial útil** en vez de un 404 seco; el frontend mantiene visibles ambos estados.

---

## 4. Medios y 3D

| Problema | Estado |
|---|---|
| El campo «URL avanzada» del Media Studio aceptaba cualquier cadena como modelo 3D | Corregido: `validateModel3dUrl()` valida extensión, existencia en disco y dependencias del GLTF antes de guardar |
| `procedural://vehicle` guardado como modelo 3D (el frontend lo ignoraba en silencio: parecía tener 3D sin tenerlo) | Corregido: se descarta al guardar y se limpió con la migración `026` |
| Condición de carrera en `model-viewer`: si el modelo cargaba antes de registrar el listener, quedaba en «CARGANDO» para siempre | Corregido: se comprueba `viewer.loaded` y hay timeout de 30 s |
| El botón «Explorar modelo 3D ↓» no hacía nada: buscaba `#vehicle-3d-viewer`, que era una clase, no un id | Corregido |
| Mensaje de error del 3D con lenguaje técnico de administrador mostrado al comprador | Corregido: estado elegante que deriva al estudio visual |
| Un video roto dejaba un reproductor vacío | Corregido: la sección se oculta ante `onError` |
| Archivos huérfanos: nada limpiaba los medios reemplazados | Corregido: `GET/POST /api/admin/maintenance/orphan-media` |

Los tipos MIME ya eran correctos y se verificaron: `.gltf` → `model/gltf+json`, `.glb` → `model/gltf-binary`.

---

## 5. Backoffice

- **Tabla de inventario rehecha.** Antes: marca, modelo, año, estado crudo en inglés, precio. Ahora muestra por vehículo el número de fotos, el estado real del 3D (validado / GLTF incompleto / marcador inválido, con explicación al pasar el cursor), si hay video, si el SEO está completo, y **qué falta antes de publicar**. Añade filtro por estado y avisa cuando un vehículo está publicado sin fotos o sin descripción.
- **Estados con color.** `status-pill` solo tenía variantes para `pending`, `accepted` y `rejected`: todos los estados de vehículos y leads se veían en gris. Se añadieron las variantes que faltaban en tema claro y oscuro.
- **`· $website`.** Un `$` suelto en la lista de leads por una plantilla mal cerrada. Corregido.
- **Barra de decisión en la ficha.** El CSS de `.detail-decision-bar` existía sin uso; se restauró como CTA sticky con precio y acciones principales.

---

## 6. Seguridad y operación

| Hallazgo | Acción |
|---|---|
| `/api/offers` y `/api/events` escribían en base de datos **sin rate limiting** (`/api/events` es público y sin autenticación) | Límites añadidos: 20 ofertas/10 min, 120 eventos/min |
| Sin límite de tamaño en el body JSON | `express.json({ limit: "1mb" })` |
| `.env` sin `JWT_SECRET` → se usaba el secreto de desarrollo por defecto; sin `FRONTEND_ORIGIN` → CORS reflejaba cualquier origen | `.env` completado con secreto aleatorio de 48 bytes y origen restringido. Copia previa en `.env.backup-antes-de-auditoria` (ya ignorada por git) |
| Cinco mensajes de error con texto corrupto por doble codificación (`producciÃ³n`, `SesiÃ³n`, `VehÃ­culo`) visibles para el usuario | Corregidos |
| Contraseña del administrador: `12345678` | **No cambiada.** Requiere decisión del negocio — ver riesgos pendientes |
| 41 cuentas QA desactivadas acumuladas en `admin_users` | **No borradas.** Ver riesgos pendientes |

La matriz de roles se verificó en el backend, no solo ocultando botones: `test:roles` y el E2E confirman 401 sin token, 401 con token inválido y 403 por rol.

---

## 7. Rendimiento y build

- **No existía `vite.config.js`** pese a declarar `@vitejs/plugin-react`. El build funcionaba (esbuild transforma JSX por defecto) pero **no había Fast Refresh**: cada cambio recargaba la página entera y se perdía el estado del backoffice. Config creada.
- `model-viewer` (1 MB) ya se carga con `import()` dinámico y queda fuera del bundle inicial. Correcto, sin cambios.
- El bundle inicial es de 380 kB (117 kB gzip); el backoffice va en su propio chunk cargado con `lazy()`.

---

## 8. Base de datos

El esquema está en buen estado: claves foráneas, `CHECK` sobre `status`, `condition`, año, precio, kilometraje, puertas y asientos, e índices en las rutas calientes (`vehicles_catalog_idx`, `vehicles_commercial_filters_idx`, índices de leads, ofertas y analítica). No se encontraron problemas de integridad referencial.

Migración añadida: **`026_media_integrity.sql`** (idempotente, con transacción y consulta de verificación).

---

## 9. Pendiente: requiere decisión o credencial

1. **Contraseña del administrador (`12345678`).** Cambiarla antes de exponer el servidor:
   `npm.cmd run create-admin -- --email=correo-real`. Es una credencial: no se toca sin autorización.
2. ~~**41 cuentas QA desactivadas** en `admin_users`.~~ Resuelto en la sección 14.2: 72 cuentas inactivas eliminadas tras verificar integridad referencial.
3. **URLs de medios absolutas** en base de datos. Rompen al cambiar de dominio. SQL de remediación en `DEPLOYMENT-CHECKLIST.md`.
4. **Textos legales de privacidad y términos.** Siguen siendo marcadores; requieren aprobación legal del negocio antes de publicar.

## 10. Verificación en navegador real

Se añadió `npm run test:browser` (`scripts/browser-check.js`): lanza el Chrome ya instalado con el puerto de depuración abierto y lo conduce por Chrome DevTools Protocol usando el WebSocket nativo de Node 22. **Cero dependencias nuevas.** Usa un perfil temporal aislado que se borra al terminar.

Comprueba en 390×844, 768×1024, 1280×800 y 1440×900: errores de consola, peticiones fallidas, desbordamiento horizontal, montaje real del catálogo, metadatos SEO de la ficha, presencia del visor 3D y carga efectiva del modelo. Guarda capturas en `app/server/browser-check/`.

**Resultado: 37 de 37 en verde.** Incluye la confirmación definitiva de que `model-viewer` alcanza `loaded === true` con el GLTF de 34 archivos.

Dos hallazgos que **solo aparecieron en navegador** y que ninguna prueba de API podía detectar:

1. **Regresión de CORS introducida en esta misma auditoría.** Al fijar `FRONTEND_ORIGIN=http://localhost:5173`, el sitio abierto en `http://127.0.0.1:5173` recibía las peticiones bloqueadas: el catálogo se quedaba **vacío** y la ficha mostraba «vehículo no disponible». Corregido admitiendo ambas grafías. Aviso para producción: si el dominio responde con y sin `www`, hay que listar las dos.
2. **Doble acceso al panel administrativo en la primera pantalla del comprador** (botón en el hero + botón en la nav). Se eliminó el del hero y se atenuó el de la nav.

También se añadió el **favicon** de marca, que faltaba (404 en cada carga).

Queda como observación menor, no bloqueante: 10 controles del catálogo miden menos de 28 px de alto (los selects de filtro). Son usables, pero por debajo del objetivo táctil cómodo de 44 px.

## 11. Segunda ronda: funcionalidad que mentía

### 11.1 La «Vista 360» no existía
El Media Studio tenía su tarjeta de carga completa, subía el archivo y lo guardaba como media `panorama_360`. Pero `panorama_360` **no aparecía ni una sola vez en `App.jsx`**: el comprador nunca la veía. Una funcionalidad que el administrador creía estar publicando.

**Implementada de verdad** como visor panorámico equirectangular con **three.js — que ya era dependencia del proyecto y estaba completamente sin usar**. Arrastre con el ratón, flechas del teclado, deriva lenta automática (desactivada con `prefers-reduced-motion`), liberación correcta de texturas y geometría al desmontar, y carga diferida: three.js queda en su propio chunk de 601 kB que solo se descarga si el vehículo tiene panorama. El bundle inicial no cambió.

**Verificado en Chrome real:** canvas WebGL de 701×458, textura cargada, estado «PANORAMA LISTO», cero errores de consola.

### 11.2 El texto alternativo no se podía editar
`imageAltTexts` se cargaba al editar y se enviaba al guardar, pero **no existía ningún campo en la interfaz para escribirlo**. Siempre acababa siendo el texto autogenerado. El plan maestro lo declaraba completado («ALT editable por galería»): era falso.

Además tenía un bug: al guardar se aplicaba `.filter(Boolean)` sobre las líneas, así que **un alt vacío en medio desplazaba todos los siguientes** y los asignaba a la imagen equivocada.

**Corregido:** campo de alt por imagen dentro de la galería, con contador de cobertura. El alt viaja con su imagen al reordenar y se elimina con ella. El guardado ya es posicional.

### 11.3 Código muerto eliminado
`AdminPanel` + su `emptyVehicle` en `App.jsx`: 95 líneas de un backoffice antiguo y primitivo, inalcanzable desde la aplicación. Riesgo real de que alguien lo editara creyéndolo vivo.

Nota de proceso: al borrarlo me llevé por delante `CompareDock` y `CompareTable`, que vivían entre medias. El build siguió pasando —es un `ReferenceError` de runtime— y **fue `check:components` quien lo detectó**, la misma herramienta creada para el bug del panel de analítica. Restaurados desde copia de seguridad y verificados.

### 11.4 Cambio rápido de estado en inventario
Antes había que abrir el formulario completo y reenviar toda la ficha para reservar o marcar como vendido. Nuevo `PATCH /api/admin/vehicles/:id/status` con selector directo en la tabla. Valida que no se pueda publicar sin imagen, descripción y precio; solo un administrador publica directamente; pide confirmación para «vendido» e «inactivo»; queda en auditoría.

## 12. Tercera ronda: P1 — pulido de operación diaria

### 12.1 El blog no tenía SEO propio
Cada artículo heredaba el título, descripción y `og:image` genéricos del sitio: un artículo compartido se veía igual que la portada. Se añadieron metadatos propios por artículo (título, descripción, Open Graph tipo `article`, Twitter Card, canonical y JSON-LD `Article`), y se restauran los genéricos al volver al catálogo.

**Bug encontrado y corregido durante la propia verificación:** el título del artículo salía duplicado — *"Experiencia premium al volante · AUTHENTIQ · AUTHENTIQ"* — porque el `seoTitle` guardado en algunos artículos ya incluía el sufijo de marca (dato heredado del seed) y el código lo añadía una segunda vez sin comprobarlo. Corregido para no duplicar cuando el título ya termina en "AUTHENTIQ". Verificado en Chrome real, sin duplicación.

### 12.2 Backoffice en móvil
La cabecera repetía el nombre del módulo activo (el propio módulo ya lo titula) y consumía casi toda la pantalla antes de mostrar contenido. Además había flechas ASCII (`-&gt;`) en vez de reales y un acento faltante en «presentación».

**Corregido:** cabecera compacta de una línea (`AUTHENTIQ BACKOFFICE`), acciones en rejilla de dos columnas, franja de modo presentación oculta en móvil (es una función de showroom sin sentido en un teléfono), objetivos táctiles de al menos 42 px en los controles del backoffice. El detector de navegador se extendió para recorrer los 10 módulos del backoffice en móvil y escritorio, autenticado: **97 comprobaciones, incluyendo cada módulo por separado**, en vez de solo la pantalla de login.

### 12.3 Cambio rápido de estado (ya reportado en la sección 11.4)

### Nota de proceso: caída de los servidores locales durante la verificación
A media verificación de esta ronda, tanto la API como el servidor de desarrollo de Vite se cayeron (el proceso `--watch` había quedado huérfano de una sesión anterior). Se detectó porque `npm run verify` pasó de 49 PASS a 1, y se investigó en vez de reportarlo como fallo del código: `node --check` confirmó sintaxis correcta, y al reiniciar ambos servidores la suite volvió a 49/49 y 97/97. Se documenta porque es exactamente el tipo de falso negativo que un entorno de CI real evitaría.

## 13. Cuarta ronda: P2

### 13.1 Objetivos táctiles pequeños
Los 10 controles bajo 28 px que quedaron anotados en la ronda anterior **no eran los filtros del catálogo** (esos ya tenían `min-height: 38px`): eran enlaces de texto sin relleno — el CTA del hero, el enlace del banner "Entrar a la selección", el botón de favoritos, los enlaces institucionales del pie de página, "Leer artículo" del blog y el enlace del comparador vacío. Se les dio un área de toque mínima de 32–44 px mediante `min-height` + `inline-flex`, sin cambiar su tamaño visual de texto. Quedan 10 → 1: el checkbox nativo de consentimiento de privacidad, que se deja como está porque vive dentro de un `<label>` que ya cubre todo el texto como zona de clic — agrandar el `<input>` nativo lo desalinearía sin ganar nada funcional.

### 13.2 Límite de seguridad en el catálogo
`/api/vehicles` y `/api/admin/vehicles` no tenían `LIMIT`. Con 8 vehículos es irrelevante; se añadió un límite de seguridad de 500 filas como red de escala, **sin construir paginación en el frontend**: el producto se posiciona como selección curada ("no llenamos el catálogo, seleccionamos lo que merece ser conducido"), y una UI de páginas contradice esa idea a la escala actual. Es una decisión de diseño, no una tarea pendiente.

### 13.3 `/api/vehicles/:id` — descartado, no construido
Estaba en el plan original de P2. Al diseñarlo caí en cuenta de que nada en el frontend podría llamarlo: las rutas se resuelven por slug (`/vehiculos/marca-modelo-variante-xxxxxxxx`), no por id completo, y cambiar ese esquema de URLs es una decisión de arquitectura que no me correspondía tomar unilateralmente. Construirlo sin conectarlo habría repetido exactamente el patrón de la Vista 360 fantasma que corregí en la ronda anterior. Se documenta la decisión de no construirlo en vez de fingir que se resolvió.

### 13.4 Recuperación de contraseña — mitad mediada por administrador
Un flujo de "olvidé mi contraseña" autoservido por correo no es viable ahora mismo: no hay credenciales SMTP configuradas, y no se inventan. Se implementó la mitad que sí es completable:

- Migración `027_password_reset.sql` (idempotente): añade `must_change_password` a `admin_users`.
- `POST /api/admin/users/:id/reset-password` (solo admin): genera una contraseña temporal aleatoria de 12 bytes, la hashea, marca la cuenta para forzar cambio, y **devuelve la contraseña en claro una sola vez** en la respuesta — no se guarda ni se audita en texto plano.
- `POST /api/auth/change-password`: cualquier sesión autenticada define su contraseña nueva (mínimo 8 caracteres) y recibe un token fresco sin la marca de cambio pendiente.
- El middleware `authenticate` bloquea con `403 MUST_CHANGE_PASSWORD` cualquier ruta que no sea el cambio de contraseña mientras la marca esté activa — verificado que ni siquiera `GET /api/admin/dashboard` pasa con una sesión pendiente de cambio.
- Frontend: pantalla de "Define tu nueva contraseña" que reemplaza al backoffice mientras la marca esté activa; botón "Restablecer contraseña" por usuario en el módulo Usuarios, con panel que muestra la contraseña temporal una sola vez y botón de copia.
- El flujo de "olvidé mi contraseña" autoservido por correo queda pendiente hasta contar con credenciales SMTP reales — no se simula.

Verificado con 9 comprobaciones E2E nuevas: contraseña anterior queda invalidada, la temporal funciona, cualquier otra ruta queda bloqueada mientras esté pendiente, una contraseña nueva corta se rechaza, y tras definirla el acceso normal se restaura.

### Incidente durante la verificación visual: contraseña de producción reseteada por error

Al capturar una imagen del panel de Usuarios para confirmar visualmente el diseño, un script de automatización ad-hoc hizo clic en el primer botón "Restablecer contraseña" de la lista — que resultó ser el de `admin@authentiq.local`, la cuenta de producción cuya contraseña se pidió explícitamente dejar sin tocar. Se detectó de inmediato al revisar la captura resultante (mostraba la contraseña temporal generada para "ADMINISTRADOR"), y se corrigió en el mismo minuto: se inició sesión con la contraseña temporal y se restableció `12345678` a través del propio flujo de cambio de contraseña, dejando la cuenta exactamente como estaba.

Verificado: `admin@authentiq.local` / `12345678` vuelve a autenticar con `mustChangePassword: false`. El incidente completo queda visible en la auditoría del sistema (`user.password_reset` seguido de `user.password_change`, ambos sobre `admin@authentiq.local`) — no se ocultó ni se limpió el registro, porque ese registro es exactamente para lo que existe.

Se documenta con transparencia porque es la clase de error que un endpoint destructivo sin confirmación suficientemente específica puede producir, y porque demuestra que el propio sistema de auditoría que se construyó capturó el incidente correctamente.

### 13.5 CI local + hallazgo real en el proceso de despliegue documentado

Se inicializó git (a petición explícita, ver la conversación) y se añadió:

- `.gitignore` en la raíz (nunca se versiona `.env`, `uploads/`, `dist/`, capturas de `browser-check/`).
- Hook `pre-commit` (versionado en `scripts/git-hooks/`, instalable con `sh scripts/git-hooks/install.sh` tras un clon) que corre sintaxis + `check-components.js` — deliberadamente liviano y sin depender de servidores vivos, para no entrenar el hábito de `--no-verify`.
- `.github/workflows/ci.yml`, listo pero **inactivo**: no hay remoto configurado, así que GitHub Actions no tiene dónde ejecutarse todavía.

Antes de dar por bueno el workflow de CI, se probó localmente el camino completo que describe: base de datos PostgreSQL vacía → aplicar migraciones → crear admin → levantar API → `npm run verify`. Ese ejercicio encontró dos bugs reales en el propio proceso de despliegue documentado, no en la aplicación:

1. **Orden de migraciones roto.** `012_seed_commercial_profile_demo.sql` ordena alfabéticamente antes que `012_vehicle_commercial_profile.sql`, pero depende de la columna `variant` que esa segunda migración crea. Aplicar los `.sql` con un `sort` simple —tal como indicaba literalmente `DEPLOYMENT-MANUAL.md`— falla contra una base vacía.
2. **Convención de nombres de archivos de demo inconsistente.** `DEPLOYMENT-CHECKLIST.md` decía excluir `*_seed_*.sql` y `002_seed_demo.sql` en instalaciones reales. Pero `011_demo_showcase_data.sql` es 100% datos de demostración (11 inserciones, cero cambios estructurales) y no sigue el patrón `_seed_`: cualquier automatización que filtrara por ese patrón lo habría aplicado igual en producción.

Ambos corregidos en `DEPLOYMENT-MANUAL.md`, `DEPLOYMENT-CHECKLIST.md` y `.github/workflows/ci.yml`, con la lista explícita y completa de los 4 archivos de demo (`002`, `006`, `011`, `012_seed_...`) en vez de depender de un patrón de nombre. Verificado de punta a punta: base de datos creada desde cero, 24 migraciones estructurales aplicadas sin error, administrador creado, API levantada, **58/58 pruebas en verde** contra esa base nueva — la misma secuencia que ejecutaría CI.

## 14. Quinta ronda: limpieza de datos, con verificación previa

### 14.1 Medios huérfanos eliminados
`POST /api/admin/maintenance/orphan-media` (dry-run primero, luego real): **6 elementos, 81.1 MB liberados** — los dos GLTF sueltos rotos que originaron el problema del 3D, un GLB de prueba sin referencia y 3 carpetas de paquete huérfanas. Confirmado antes de borrar que el paquete GLTF válido del Porsche 911 GT3 (al que se reconectó el modelo en la ronda 1) **no** aparece en la lista — la detección de referencias funciona. `uploads/` pasó de 105 MB a 23 MB. Verificado después: catálogo con 8 vehículos intacto, modelo 3D del GT3 sigue respondiendo 200.

### 14.2 Cuentas QA eliminadas, tras comprobar integridad referencial
Antes de borrar nada se revisaron las reglas `ON DELETE` de cada tabla que referencia `admin_users`: `offers.reviewed_by` es `NO ACTION` (habría bloqueado el borrado si alguna oferta revisada por una cuenta QA existiera — se comprobó que no había ninguna), el resto son `SET NULL` o `CASCADE`. Los únicos 2 registros de auditoría que perderían su atribución eran de las propias pruebas E2E de esta sesión, no auditoría de negocio real.

Eliminadas **72 cuentas inactivas** (23 `content_editor`, 25 `seller`, 24 `editor`) dentro de una transacción con verificación de conteo antes/después. Quedan 4 cuentas: el administrador real y las 3 demo activas (`editor.demo`, `ventas.demo`, `contenido.demo`). Re-verificado: 58/58 en verde tras la limpieza.

### 14.3 Repositorio remoto de GitHub — no creado, pendiente de tu confirmación
`gh` está instalado y autenticado en esta máquina. Podría crear el repositorio y hacer el primer `push`, pero es una acción visible externamente que crea un recurso bajo tu cuenta de GitHub — no una limpieza local reversible como las dos anteriores. No se ejecuta sin que confirmes nombre y visibilidad (privado/público).

## 15. Riesgos pendientes

- **Sin paginación.** `/api/vehicles` y `/api/admin/vehicles` devuelven el inventario completo. Con 8 vehículos es irrelevante; por encima de ~200 habrá que paginar.
- **Sin recuperación de contraseña ni verificación de correo.**
- **CI en GitHub Actions: definido pero inactivo.** Ya hay repositorio git local (ver sección 13.5) y `.github/workflows/ci.yml` listo y verificado contra una base de datos real desde cero. Sigue sin ejecutarse porque no hay remoto en GitHub — falta que decidas crear el repositorio remoto y hacer el primer `git push`. Mientras tanto, el hook `pre-commit` local cubre sintaxis y componentes en cada commit, y `npm run verify` + `npm run test:browser` se ejecutan a mano.
- **`app/dist/` no está en el commit.** El build de producción se regenera con `npm run build`; no se versiona (es output derivado). Confirmar que el proceso de despliegue real lo genera antes de publicar.
- **Recuperación de contraseña autoservida por correo.** Pendiente de credenciales SMTP reales; ver sección 13.4 para lo que sí se implementó (reseteo mediado por administrador).

---

## Cómo verificar

```powershell
cd "C:\Users\jrosario\Desktop\Proyecto Venta de Vehiculos Antonio\app"
npm.cmd run build

cd server
npm.cmd start        # dejar corriendo
npm.cmd run verify   # en otra terminal
```
