---
target: AUTHENTIQ dealer + public storefront surfaces
total_score: 21
p0_count: 2
p1_count: 2
timestamp: 2026-08-19T16-24-49Z
slug: app-src-dealer-public-storefront-surfaces
---
Method: dual-agent (A: a84a15600f888b627 · B: a4d357e4f67d77a70)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Buen skeleton/toast/readiness-scoring; TaxonomyModule usa `prompt()` nativo sin feedback |
| 2 | Match System / Real World | 3 | Copy en español natural; jerga de plataforma ("Superpoderes", "MRR", "slug") se filtra a pantallas de dealer/comprador |
| 3 | User Control and Freedom | 2 | Modales con Esc/cerrar, pero rechazar/pausar un dealer o guardar CSS en vivo no tienen confirmación ni deshacer |
| 4 | Consistency and Standards | 2 | El wizard de registro usa `style={{}}` inline y `alert()/prompt()/confirm()` nativos mientras el resto del sistema usa clases y un toast propio |
| 5 | Error Prevention | 2 | Buen scoring de "listo para publicar"; acciones de plataforma más riesgosas (rechazar, pausar) son un solo clic sin confirmar |
| 6 | Recognition Rather Than Recall | 3 | Filtros, nav y pasos del wizard visibles; iconos siempre con texto |
| 7 | Flexibility and Efficiency | 2 | Sin atajos de teclado en ningún lado; sin acciones masivas en leads/inventario más allá del import CSV |
| 8 | Aesthetic and Minimalist Design | 1 | Home pública apila 16+ secciones de ancho completo antes de terminar; ficha de vehículo con 9 CTAs antes del scroll |
| 9 | Error Recovery | 2 | Errores inline pero genéricos ("No se pudo completar la cuenta") en la mayoría de los POST |
| 10 | Help and Documentation | 1 | Sin tooltips ni ayuda contextual en ningún flujo; términos como "Superpoderes"/"trialing" sin explicar |
| **Total** | | **21/40** | **Aceptable, tendiendo a Pobre — coincide con la percepción del usuario** |

## Anti-Patterns Verdict

**LLM (Assessment A):** Sí leería como hecho por IA, en dos niveles. Primer nivel: negro-crema-dorado premium-automotriz es la respuesta más predecible para este brief, y `--auth-bg: #f5f1e9` cae justo en la banda cálida-neutra que el propio skill marca como el default de IA de 2026. Segundo nivel (component tells): `.eyebrow` (etiqueta pequeña en mayúsculas trackeadas) aparece 60+ veces en App.jsx como patrón por defecto de cada sección, no como un kicker de marca deliberado; scaffolding numerado (01/02/03) en `DetailTrustStrip`, `ModelLineRail`, `CompareTable`, `PresentationMode` sin ser secuencias reales; borde lateral de color (`border-left: 3px solid var(--auth-gold)`) prohibido explícitamente, en `styles.css` y en línea en `QuoteModal`.

**Escaneo determinístico (Assessment B):** `detect.mjs` sobre `src/` → 16 hallazgos, todos "warning", exit code 2:
- `side-tab` (borde lateral de acento) — 6 apariciones: `App.jsx:401`, `styles.css:1546`, `:1649`, `:2163`, `:2581`, `:370` — **coincide directamente con lo que Assessment A encontró de forma independiente**, evidencia fuerte de que es un patrón real, no una opinión aislada.
- `overused-font` (Inter) — 3 apariciones.
- `bounce-easing` — 1 (`styles.css:1059`, `cubic-bezier(.34, 1.56, .64, 1)`) — nota: esto SÍ contradice parcialmente la fortaleza que Assessment A destacó sobre motion cuidado; es una curva puntual, no sistemática.
- `layout-transition` (animar width/padding, costoso) — 7 apariciones en `styles.css`.

**Evidencia visual (capturas reales, no maquetas):** confirmadas en las capturas de esta sesión — ver hallazgos P0 abajo.

## Overall Impression

El instinto del usuario es correcto: esto no está listo para el público. Pero la razón no es solo estética — la auditoría encontró **dos bugs funcionales reales** en la superficie más importante del producto (el catálogo público y la ficha de vehículo) que ningún usuario real debería encontrar, más un patrón real de "piloto automático visual" (negro-crema-dorado + eyebrows + numeración + bordes laterales) que un director de diseño identificaría de inmediato como generado, no diseñado. La ingeniería es ambiciosa (visor 3D, panorama 360, calculadora de financiamiento, wizard de 8 pasos) — el problema no es falta de esfuerzo, es que ese esfuerzo nunca se probó con datos reales ni se sometió a una pasada de dirección de arte unificada.

## What's Working

1. **El flujo registro → vista previa privada → publicación con aprobación** tiene la secuencia correcta para un SaaS: el dealer personaliza todo antes de salir en vivo, con un enlace claramente no-público. La ejecución visual falla en partes, pero la arquitectura del flujo es sólida.
2. **`prefers-reduced-motion` y `:focus-visible` están tratados como sistema, no como parche** — 45+ apariciones consistentes en `styles.css`.
3. **El scoring de "listo para publicar" en el wizard de vehículos** (`VehicleReadiness`, `publishBlockers`) es prevención de errores bien hecha: bloqueadores en lenguaje llano ("sin fotos", "sin precio"), no códigos de validación.

## Priority Issues

~~**[P0] El catálogo público no muestra el inventario real del dealer.**~~ **CORREGIDO tras verificación directa (2026-08-19): esto NO es un bug.** Assessment B confundió el conteo de vehículos del org `authentiq` (8 publicados) con el del org `dealer-demo` (que genuinemente solo tiene 1 vehículo publicado). Verificado directamente contra la base de datos y `/api/platform/overview`: `dealer-demo` y `velocity-demo` tienen 1 vehículo cada uno, `authentiq` tiene 8. El catálogo público está funcionando correctamente para los datos que existen.

~~**[P0] La calculadora de financiamiento calcula una cuota mensual absurda.**~~ **CORREGIDO tras verificación directa (2026-08-19): esto NO es un bug.** Assessment B leyó mal el número en su propia captura: el texto real renderizado es `"$3,183.882 USD"` (formato `en-US`: coma de miles, punto decimal) — es decir, ~$3,184/mes, que coincide con el cálculo manual de amortización correcto para $189,500 al 9.5% APR a 60 meses con 20% de inicial. Se leyó como "$3,183,882" (un entero de millones) en vez de "$3,183.882" (tres mil ciento ochenta y tres con centavos). La fórmula y el cálculo están bien.

**[P0] El texto dorado sobre fondo crema no pasa contraste, en el tema por defecto.** `--tenant-primary: rgb(200 162 75)` usado como color de texto (`.eyebrow`, CTAs, precios en hover, estados de foco de filtros) contra `--auth-bg: #f5f1e9` da ~2.1:1 — muy por debajo del mínimo de 3:1 para texto grande, y lejos del 4.5:1 para texto de cuerpo. Este es el tema claro por defecto que ve todo comprador. **Arreglo:** oscurecer el dorado ~15-20% de luminancia para contextos de texto sobre fondo claro (el dorado más brillante mide ~7.9:1 sobre negro y está bien ahí); en fondo claro, usarlo solo en bordes/fondos, nunca en texto. → `$impeccable colorize`.

**[P0] El estado vacío del catálogo engaña a un dealer nuevo que paga.** Un dealer recién registrado, sin ningún vehículo agregado todavía, ve: *"No encontramos vehículos con esos criterios / Prueba limpiando la búsqueda"* — no hay nada que limpiar, el catálogo está vacío porque nunca se agregó nada. Es el primer vistazo privado de un cliente pagante a lo que está comprando, y parece un error del sistema, no un estado vacío por diseño. **Arreglo:** distinguir `vehicles.length === 0` (vacío real → "Agrega tu primer vehículo →") de `filteredVehicles.length === 0 && vehicles.length > 0` (filtrado a cero). → `$impeccable onboard`.

**[P1] La fricción está invertida entre lo de alto riesgo y lo de bajo riesgo.** Rechazar la solicitud de un dealer, pausar un negocio en vivo, o guardar CSS arbitrario en el sitio público de un tenant son un clic sin confirmar en PlatformCenter. Mientras tanto, un comprador pidiendo una alerta de precio pasa por Turnstile + checkbox de consentimiento. **Arreglo:** agregar un paso de confirmación a rechazar/pausar/guardar-CSS. → `$impeccable harden`.

**[P1] Sobrecarga cognitiva en las dos superficies de mayor visibilidad para el comprador.** Barra de filtros con 10 controles sin agrupar (guía recomienda ≤4 por grupo); 9 CTAs paralelos en la ficha de vehículo antes del scroll; 16+ secciones de ancho completo apiladas en el home. Confirmado tanto en lectura de código como en las capturas reales. **Arreglo:** colapsar filtros a 3-4 visibles + "más filtros" (el toggle ya existe, solo oculta la mitad); elegir un CTA primario en la ficha de vehículo y mover el resto a un menú. → `$impeccable distill`.

## Persona Red Flags

**Jordan (comprador, primera vez en el showroom de un dealer específico):**
- El nav muestra "¿ERES DEALER?" y "BACKOFFICE →" con el mismo peso visual que "MI CUENTA" — Jordan, que solo quiere ver un carro, ve lenguaje de operador de plataforma en su primera pantalla. Esto rompe la promesa de marca blanca que el propio producto le hace al dealer ("tu marca, tu showroom, no una plantilla compartida").
- El footer repite esto con "¿Eres Dealer? Crea tu Showroom" junto a "Contacto" y "Privacidad" — en el sitio de un dealer específico, esto lee como un anuncio de una herramienta competidora.
- Ve "no hay resultados" en un catálogo con datos reales pero mal filtrados (P0 arriba) — el peor primer momento posible.

**Riley (stress tester, ambos lados):**
- Nombres de negocio largos rompen el titular gigante en cursiva del wizard de registro sin truncar (confirmado con un nombre de prueba de 33 caracteres).
- `TaxonomyModule.onUpdate` usa `window.confirm()` con semántica invertida: *"¿Quieres mantener este registro activo? Pulsa Cancelar para desactivarlo"* — OK = mantener activo, Cancelar = desactivar. Lo opuesto de cómo se lee normalmente un confirm, riesgo real de desactivar una marca por accidente.
- La cuota de financiamiento rota (P0 arriba) es exactamente el tipo de "función que parece funcionar pero da un resultado incorrecto" que este perfil está diseñado para atrapar.

**Sam (dependiente de accesibilidad, ambos lados):**
- El contraste dorado-sobre-crema (~2.1:1) falla directamente el mínimo de 4.5:1 en docenas de elementos recurrentes.
- El texto `.eyebrow` (10px, mayúsculas, tracking ancho) es el patrón de facto para etiquetar cada sección, docenas de veces por página — difícil de leer para baja visión incluso donde el contraste fuera correcto.

**Alex (power user, backoffice del dealer):**
- Sin atajos de teclado en una herramienta de uso diario para un equipo de ventas.
- Sin acciones masivas en Leads/Inventario más allá del import CSV.
- El wizard de 8 pasos es correcto para el primer vehículo, pero no hay un camino rápido de una sola página para el vehículo número 40.

## Minor Observations

- Las tarjetas de dealer en PlatformCenter muestran "Starter · $99 USD" justo encima de "trialing · $0 USD / mes" para el mismo dealer — correcto técnicamente, pero visualmente contradictorio en un vistazo rápido.
- `ShowroomTrustRail` y `DetailTrustStrip` repiten casi el mismo copy de confianza en dos pantallas de la misma sesión.
- La calculadora de financiamiento asume 9.5% APR / 60 meses sin ninguna base visible antes de que el comprador haya hablado con nadie.
- `window.print()` como mecanismo de "generar PDF" de cotización es funcional pero notablemente menos pulido que el resto del producto.
- Los gráficos del dashboard (Recharts) se renderizan con ejes vacíos cuando no hay datos, en vez de ocultarse.

## Questions to Consider

- Si el primer vistazo privado de un dealer nuevo a su propio catálogo dice "no se encontraron resultados" con el catálogo vacío, ¿cuántas otras superficies "pulidas" de este producto nunca se probaron con datos reales o vacíos, solo con datos de demo ya cargados?
- Con el catálogo mostrando 1 de 8 vehículos reales, ¿es posible que otros números que se ven bien en las capturas (leads, cotizaciones) tengan el mismo tipo de problema de scoping/filtrado sin haberse notado?
- El nav trata "¿Eres Dealer?" y "Mi Cuenta" con el mismo peso — ¿de quién se supone que es este sitio cuando un comprador está en él: del dealer, o de AUTHENTIQ?
- Con 9 CTAs en la ficha de vehículo y 10 filtros en el catálogo, ¿cuál es la única acción que este producto más quiere que un comprador tome — y se vería distinta la página si solo esa se destacara?
