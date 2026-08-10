# Plan de investigación y mejora: AUTHENTIQ WOW

Fecha: 9 de agosto de 2026

## 1. Diagnóstico honesto

### Ya existe

- Animaciones de entrada y salida con `motion`.
- Hover, focus, transiciones y microinteracciones.
- Scroll suave y navegación con rutas legibles.
- Galería, lightbox y navegación de fotografías.
- `Studio / Depth View`: profundidad, inclinación y cambio de fotos.
- Modo presentación para mostrar el producto.
- Catálogo responsive y backoffice con transiciones.

### Todavía falta para el efecto premium máximo

- Video hero o video por vehículo.
- Modelo 3D real o visor 360°, no solo profundidad simulada.
- Sistema de media por vehículo para almacenar video, GLB/GLTF, 360° y poster.
- Hotspots o puntos informativos en modelos 3D.
- Scroll storytelling con escenas y ritmo cinematográfico.
- Compresión, lazy loading y fallback para dispositivos lentos.
- QA visual en móvil, tablet, escritorio y conexión limitada.

El documento funcional original trata 3D, 360° y video como capacidad opcional por vehículo. Por eso no se debe bloquear el catálogo si un vehículo no tiene esos assets; deben activarse únicamente cuando exista material compatible y aprobado.

## 2. Investigación técnica realizada

### Decisión inicial recomendada: `<model-viewer>`

Para el primer visor 3D real se recomienda `<model-viewer>` con archivos GLB/GLTF: ofrece interacción 3D y AR con una integración más pequeña y un fallback sencillo. Referencias oficiales: [modelviewer.dev](https://modelviewer.dev/), [documentación de model-viewer](https://modelviewer.dev/docs/index.html) y [FAQ de formatos](https://modelviewer.dev/docs/faq.html).

### Alternativa avanzada: React Three Fiber + Drei

Usar React Three Fiber y Drei solo si se necesitan escenas propias, hotspots complejos, iluminación controlada, configurador o interacción que `<model-viewer>` no cubra. La documentación de R3F destaca la necesidad de cuidar escalado, carga y memoria: [R3F performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).

### Movimiento de scroll

El proyecto ya usa Motion. Primero se debe ampliar ese sistema con escenas pequeñas y medibles. GSAP ScrollTrigger queda como opción si se necesita pinning, scrub o timelines de scroll más complejos; revisar [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) antes de instalarlo.

## 3. Fases de trabajo

### Fase A — Auditoría visual y assets

1. Revisar cada pantalla en desktop, tablet y móvil.
2. Medir qué animaciones existen y cuáles se sienten estáticas.
3. Inventariar fotos, videos, posters, modelos GLB/GLTF y material 360° disponible.
4. Definir un presupuesto de peso por página.
5. Separar assets de demo de assets reales del negocio.

Entregable: matriz visual con pantalla, problema, solución, asset requerido y prioridad.

### Fase B — Arquitectura de media por vehículo

Crear una entidad de media opcional asociada a cada vehículo:

- `media_type`: image, video, model_3d, panorama_360.
- `url`.
- `poster_url`.
- `alt_text`.
- `sort_order`.
- `is_primary`.
- `metadata` para cámara, hotspots o configuración.

El backoffice debe permitir subir, ordenar, previsualizar, activar y desactivar media sin afectar la publicación normal del vehículo.

### Fase C — Primer 3D real

1. Crear un componente aislado `Vehicle3DViewer`.
2. Activarlo solo si el vehículo tiene un GLB/GLTF válido.
3. Mantener el `Studio / Depth View` como fallback.
4. Añadir carga diferida, poster, estado de carga, error y botón para volver a fotos.
5. Probar interacción con mouse, touch y teclado.
6. Medir FPS, peso descargado y tiempo hasta interacción.

Criterio: el 3D no puede empeorar la ficha en teléfonos ni bloquear la conversión.

### Fase D — Video premium

1. Añadir video hero opcional con poster.
2. Añadir video corto por vehículo cuando exista.
3. Usar `muted`, `playsInline`, `preload="metadata"` y poster.
4. Desactivar o sustituir video con `prefers-reduced-motion` o conexión limitada.
5. Evitar autoplay con sonido.
6. Mantener imagen estática de respaldo.

### Fase E — Cinemática y smooth

- Entrada del hero por capas: imagen/video, overlay, copy y métricas.
- Transición catálogo → ficha con continuidad visual.
- Reveals de especificaciones al entrar al viewport.
- Parallax muy leve en imágenes, nunca en controles críticos.
- Timeline de galería y llamada a la acción final.
- Microinteracciones de botones, filtros, compare y formularios.
- Respetar `prefers-reduced-motion` en todos los efectos.

### Fase F — QA de experiencia

Validar:

- Chrome, Edge, Safari móvil y Android.
- 360 px, 768 px, 1024 px y escritorio amplio.
- Sin errores de consola.
- Sin layout shift importante.
- El catálogo y formularios funcionan sin 3D, sin video y con imágenes fallidas.
- Teclado, focus, contraste y labels.
- Carga inicial y navegación después de cache frío.

### Fase G — Presentación final

Crear un recorrido de demo de 3 minutos:

1. Hero cinematográfico.
2. Filtros y catálogo.
3. Ficha con galería.
4. Studio visual.
5. Vehículo con 3D real, si existe asset.
6. Solicitud de test drive.
7. Backoffice: inventario, lead, cotización y reportes.

## 4. Decisiones que todavía debe aprobar el negocio

- Qué vehículos tendrán video, 360° o 3D.
- Quién provee los modelos y si existe autorización de uso.
- Proveedor de almacenamiento para videos y modelos.
- Límite de peso por video y modelo.
- Si el hosting final soporta archivos grandes y streaming.
- Si se necesita AR o solo visualización 3D.
- Colores, logo, tipografías y dirección visual definitivos.
- Si el 3D es una demostración premium o una función operativa para todos los vehículos.

No se deben inventar esas decisiones ni comprar servicios antes de confirmarlas.

## 5. Orden recomendado

1. Auditoría visual y matriz de assets.
2. Arquitectura de media opcional.
3. Prototipo 3D con un solo vehículo.
4. Video hero con poster y fallback.
5. Cinemática de scroll y transiciones.
6. QA de rendimiento y accesibilidad.
7. Preparación de demo y servidor final.

## 6. Definición de terminado

El bloque WOW se considera terminado cuando:

- Existe al menos un vehículo con 3D real probado o una decisión documentada de usar solo 360°.
- El visor tiene fallback fotográfico y estados de carga/error.
- Video y 3D no bloquean móvil ni catálogo.
- Las animaciones se sienten intencionales, suaves y consistentes.
- El usuario puede completar contacto, oferta y cita aunque desactive movimiento o media avanzada.
- El backoffice administra los assets sin tocar código.
- Se ejecutan build, smoke test, role test y QA visual final.

## 7. Bloque implementado el 9 de agosto de 2026

- Se añadió `vehicle_media` como entidad opcional para video, modelo 3D y panorama 360°.
- El API devuelve media asociada al vehículo y la duplica al clonar inventario.
- El backoffice permite guardar las URLs de GLB/GLTF, video, poster y 360° sin tocar código.
- Se añadió `Vehicle3DViewer` con carga diferida de `<model-viewer>`, controles de cámara, auto-rotación, AR cuando el dispositivo lo permite, poster y estado de error.
- Se añadió el flujo `procedural://vehicle`: el inventario nuevo queda preparado para publicar una reconstrucción 3D procedural basada en su galería, sin exigir un GLB externo.
- El visor procedural ahora funciona para cualquier vehículo marcado con ese media, usa una escena ligera de showroom, adapta el color exterior y deja explícito que es una aproximación de una referencia parcial.
- Se añadió un reproductor de video opcional con poster y `preload="metadata"`.
- El Studio fotográfico se mantiene como fallback para todos los vehículos que todavía no tengan assets avanzados.
- Verificado: migración aplicada, build Vite, API health/catalog, smoke test y matriz de roles.

Pendiente para producción: sustituir la aproximación por un pipeline que procese varias vistas reales (frente, atrás y laterales), almacenar el resultado generado y permitir revisión/publicación por vehículo. Un GLB/GLTF autorizado sigue teniendo prioridad cuando el negocio lo provea.
