# ZEVROA · SEO launch checklist

## Ya queda en el producto

- `/para-dealers` es una ruta pública, navegable y prerenderizada.
- El sitemap incluye la landing para dealers, vehículos publicados y artículos publicados.
- Catálogo y fichas generan HTML inicial, canonical, Open Graph y JSON-LD.
- Las fichas describen el vehículo como `Product` + `Car`, incluyen oferta y breadcrumb, sin reseñas inventadas.
- `/backoffice`, `/presentacion`, cotizaciones y recuperación permanecen fuera del índice.
- El servidor devuelve 404 real para rutas públicas inexistentes.

## Antes de publicar campañas

1. Verificar la propiedad de `https://zevroa.com/` en [Google Search Console](https://search.google.com/search-console) y enviar `https://zevroa.com/sitemap.xml`.
2. Verificar también el dominio en [Bing Webmaster Tools](https://www.bing.com/webmasters/about) y enviar el mismo sitemap.
3. Inspeccionar en Google la portada, `/para-dealers` y al menos tres fichas publicadas; solicitar indexación solo después de confirmar title, description, canonical y schema.
4. Repetir la inspección para cada subdominio de dealer que vaya a indexarse. No usar el sitemap de ZEVROA para mezclar dominios.
5. Publicar contenido real por dealer: nombre, ubicación, horario, teléfono, descripción propia, inventario y enlaces de contacto. No copiar la misma descripción en todos los showrooms.
6. Crear un [Google Business Profile](https://support.google.com/business/answer/13763036?hl=es) solo si el dealer es elegible por tener atención presencial; no crear fichas para negocios exclusivamente online.
7. Añadir redes sociales únicamente cuando las URLs sean reales y estén verificadas; no inventar `sameAs`.

## Validación local

Desde `app`:

```powershell
npm.cmd run build
npm.cmd run check:seo -- --url=http://127.0.0.1:5173
```

Para probar el prerender del servidor, usar el servidor local completo y ejecutar el mismo comando con su URL pública local. Confirmar además:

- `robots.txt` permite las rutas públicas y bloquea el panel.
- `sitemap.xml` devuelve XML válido y URLs del dominio correcto.
- El dominio principal no mezcla el inventario de un dealer.
- Un subdominio aprobado solo muestra sus propios vehículos y su propio `Organization`/`AutoDealer`.

## Política de subdominios

Un dealer debe indexarse únicamente cuando tenga identidad, contacto, inventario publicado y contenido suficiente para ser útil. Mientras esté vacío, en revisión o en onboarding, mantenerlo fuera del índice. La automatización de esa condición debe activarse después de validar el primer dealer real para no ocultar showrooms legítimos.
