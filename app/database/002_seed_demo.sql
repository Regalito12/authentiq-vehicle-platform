INSERT INTO vehicle_brands (name) VALUES
  ('Porsche'),
  ('BMW'),
  ('Mercedes-AMG'),
  ('Audi')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vehicle_categories (name) VALUES
  ('sports'),
  ('suv'),
  ('sedan')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, '911 GT3', 2026, 'new', 189500, '4.0L H6 Naturally Aspirated', '502 hp', '7-Speed PDK', 'RWD', 0, 2, 'published', 10
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Porsche' AND c.name = 'sports'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = '911 GT3' AND v.year = 2026);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'Cayenne Turbo GT', 2026, 'new', 195700, '4.0L V8 Twin-Turbo', '631 hp', '8-Speed Tiptronic S', 'AWD', 0, 1, 'published', 10
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Porsche' AND c.name = 'suv'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'Cayenne Turbo GT' AND v.year = 2026);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'Taycan Turbo S', 2025, 'used', 129900, 'Dual PSM Electric', '751 hp', '2-Speed AT', 'AWD', 12450, 1, 'published', 15
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Porsche' AND c.name = 'sedan'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'Taycan Turbo S' AND v.year = 2025);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'M4 Competition xDrive', 2024, 'used', 84500, '3.0L I6 Twin-Turbo', '503 hp', '8-Speed M Steptronic', 'AWD', 8900, 1, 'published', 15
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'BMW' AND c.name = 'sports'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'M4 Competition xDrive' AND v.year = 2024);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'GT 63', 2025, 'new', 176800, '4.0L V8 Biturbo', '577 hp', '9-Speed AMG SPEEDSHIFT', 'AWD', 0, 3, 'published', 10
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Mercedes-AMG' AND c.name = 'sports'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'GT 63' AND v.year = 2025);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'RS e-tron GT', 2025, 'new', 148900, 'Dual Motor EV (93 kWh)', '637 hp', '2-Speed AT', 'AWD', 0, 2, 'published', 10
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Audi' AND c.name = 'sedan'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'RS e-tron GT' AND v.year = 2025);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'Macan GTS', 2026, 'new', 89400, '2.9L V6 Twin-Turbo', '434 hp', '7-Speed PDK', 'AWD', 0, 4, 'published', 10
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Porsche' AND c.name = 'suv'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'Macan GTS' AND v.year = 2026);

INSERT INTO vehicles (brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive, mileage_km, stock, status, max_discount_percent)
SELECT b.id, c.id, 'Panamera 4S', 2024, 'used', 98500, '2.9L V6 Twin-Turbo', '443 hp', '8-Speed PDK', 'AWD', 24800, 1, 'published', 15
FROM vehicle_brands b, vehicle_categories c
WHERE b.name = 'Porsche' AND c.name = 'sedan'
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model = 'Panamera 4S' AND v.year = 2024);

INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order)
SELECT v.id, x.image_url, x.alt_text, x.sort_order
FROM vehicles v
JOIN vehicle_brands b ON b.id = v.brand_id
JOIN (VALUES
  ('911 GT3', 'Porsche', '/assets/porsche-911-gt3.jpg', 'Porsche 911 GT3', 0),
  ('911 GT3', 'Porsche', '/assets/porsche-911-gt3-alt.jpg', 'Porsche 911 GT3 alternate view', 1),
  ('911 GT3', 'Porsche', '/assets/porsche-911-three-quarter.jpg', 'Porsche 911 GT3 three quarter view', 2),
  ('911 GT3', 'Porsche', '/assets/porsche-interior.jpg', 'Porsche 911 interior', 3),
  ('Cayenne Turbo GT', 'Porsche', '/assets/cayenne-turbo-gt.jpg', 'Porsche Cayenne Turbo GT', 0),
  ('Cayenne Turbo GT', 'Porsche', '/assets/cayenne-turbo-gt-2.jpg', 'Porsche Cayenne Turbo GT alternate view', 1),
  ('Taycan Turbo S', 'Porsche', '/assets/taycan-turbo-s.jpg', 'Porsche Taycan Turbo S', 0),
  ('Taycan Turbo S', 'Porsche', '/assets/taycan-turbo-s-2.jpg', 'Porsche Taycan Turbo S alternate view', 1),
  ('M4 Competition xDrive', 'BMW', '/assets/bmw-m4.jpg', 'BMW M4 Competition', 0),
  ('M4 Competition xDrive', 'BMW', '/assets/bmw-m4-2.jpg', 'BMW M4 Competition alternate view', 1),
  ('GT 63', 'Mercedes-AMG', '/assets/amg-gt.jpg', 'Mercedes AMG GT 63', 0),
  ('GT 63', 'Mercedes-AMG', '/assets/amg-gt-2.jpg', 'Mercedes AMG GT 63 alternate view', 1),
  ('RS e-tron GT', 'Audi', '/assets/audi-etron-gt.jpg', 'Audi RS e-tron GT', 0),
  ('Macan GTS', 'Porsche', '/assets/macan-gts.jpg', 'Porsche Macan GTS', 0),
  ('Panamera 4S', 'Porsche', '/assets/panamera.jpg', 'Porsche Panamera 4S', 0)
) AS x(model, brand, image_url, alt_text, sort_order)
  ON x.model = v.model AND x.brand = b.name
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_images vi
  WHERE vi.vehicle_id = v.id AND vi.image_url = x.image_url
);
