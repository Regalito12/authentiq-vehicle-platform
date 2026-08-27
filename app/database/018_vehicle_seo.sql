ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seo_title VARCHAR(180);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seo_description VARCHAR(320);

UPDATE vehicles
SET seo_title = CONCAT(brand_name.name, ' ', vehicles.model, ' ', vehicles.year, ' | ZEVROA')
FROM vehicle_brands brand_name
WHERE brand_name.id = vehicles.brand_id AND seo_title IS NULL;

UPDATE vehicles
SET seo_description = LEFT(COALESCE(description, CONCAT('Conoce el ', seo_title, ' en ZEVROA.')), 320)
WHERE seo_description IS NULL;
