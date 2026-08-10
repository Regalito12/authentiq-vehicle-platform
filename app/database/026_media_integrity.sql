-- 026_media_integrity.sql
-- Idempotente. Corrige medios 3D que nunca pudieron mostrarse al comprador.
--
-- Contexto:
--  1) Un GLTF suelto (sin su scene.bin ni sus 32 texturas) quedó guardado como si
--     estuviera listo. model-viewer no puede cargarlo: la ficha mostraba el visor
--     en estado de carga permanente.
--  2) 'procedural://vehicle' fue un marcador de una versión anterior que nunca
--     apuntó a un archivo real; el frontend lo ignora en silencio, así que el
--     vehículo aparentaba tener 3D sin tenerlo.
--
-- A partir de ahora el API valida ambos casos al guardar (validateModel3dUrl),
-- pero los registros ya existentes deben limpiarse aquí.

BEGIN;

-- 1. Desactiva cualquier modelo 3D que apunte a un GLTF suelto en /uploads/
--    (los GLTF válidos viven siempre dentro de /uploads/packages/<id>/).
UPDATE vehicle_media
SET is_active = FALSE
WHERE media_type = 'model_3d'
  AND url LIKE '%/uploads/%'
  AND url NOT LIKE '%/uploads/packages/%'
  AND lower(split_part(split_part(url, '?', 1), '#', 1)) LIKE '%.gltf';

-- 2. Elimina los marcadores procedurales: no son archivos.
DELETE FROM vehicle_media
WHERE media_type = 'model_3d'
  AND url LIKE 'procedural://%';

COMMIT;

-- Verificación (debe devolver 0 filas):
--   SELECT id, url FROM vehicle_media
--   WHERE media_type = 'model_3d' AND is_active
--     AND (url LIKE 'procedural://%'
--          OR (url LIKE '%/uploads/%' AND url NOT LIKE '%/uploads/packages/%'
--              AND lower(url) LIKE '%.gltf'));
