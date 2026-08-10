-- Demo editorial content. Replace or remove before the public launch if the business has approved copy.
INSERT INTO blog_posts (title, slug, summary, content, cover_image_url, author_id, status, published_at, seo_title, seo_description)
SELECT
  'Lo que define una experiencia premium al volante',
  'experiencia-premium-al-volante',
  'No se trata solo de potencia: se trata de elegir con información, confianza y una atención a la altura del vehículo.',
  'Un vehículo premium empieza mucho antes de encender el motor. Empieza con la claridad de la información, la calidad de sus fotografías y la tranquilidad de saber que cada detalle fue revisado.\n\nEn AUTHENTIQ creemos que comprar debe sentirse como una decisión segura, no como una carrera contra el tiempo. Por eso presentamos cada modelo con sus datos esenciales, una historia clara y un equipo dispuesto a acompañar el siguiente paso.\n\nLa diferencia está en los detalles: una ficha completa, una conversación honesta y una experiencia que respeta el tiempo de quien está eligiendo.',
  '/assets/porsche-911-gt3.jpg',
  (SELECT id FROM admin_users ORDER BY created_at LIMIT 1),
  'published', NOW(),
  'Experiencia premium al volante · AUTHENTIQ',
  'Una mirada a los detalles que convierten la compra de un vehículo premium en una decisión segura.'
WHERE NOT EXISTS (SELECT 1 FROM blog_posts WHERE slug = 'experiencia-premium-al-volante');
