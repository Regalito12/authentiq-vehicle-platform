-- Ejecutar una sola vez en Supabase SQL Editor.
-- La aplicación usa la service role key únicamente en el backend para subir archivos;
-- el bucket es público solo para que el catálogo pueda mostrar las imágenes/modelos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-media', 'vehicle-media', TRUE)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
