-- Corrige datos históricos donde el modelo ya terminaba con la misma variante
-- que la aplicación muestra por separado (por ejemplo: "Macan GTS" + "GTS").
-- Solo modifica coincidencias inequívocas con un separador antes de la variante.
BEGIN;

WITH candidates AS (
  SELECT
    id,
    btrim(left(btrim(model), length(btrim(model)) - length(btrim(variant)))) AS model_prefix,
    right(left(btrim(model), length(btrim(model)) - length(btrim(variant))), 1) AS separator
  FROM vehicles
  WHERE model IS NOT NULL
    AND variant IS NOT NULL
    AND btrim(model) <> ''
    AND btrim(variant) <> ''
    AND length(btrim(model)) > length(btrim(variant))
    AND lower(right(btrim(model), length(btrim(variant)))) = lower(btrim(variant))
), cleaned AS (
  SELECT
    id,
    btrim(regexp_replace(model_prefix, '[-·/[:space:]]+$', '')) AS model
  FROM candidates
  WHERE separator IN (' ', '-', '·', '/')
)
UPDATE vehicles AS v
SET model = cleaned.model,
    updated_at = NOW()
FROM cleaned
WHERE v.id = cleaned.id
  AND cleaned.model <> ''
  AND v.model IS DISTINCT FROM cleaned.model;

COMMIT;
