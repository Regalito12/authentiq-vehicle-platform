ALTER TABLE vehicle_brands
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

UPDATE vehicle_brands
SET logo_url = CASE lower(name)
  WHEN 'audi' THEN 'https://cdn.simpleicons.org/audi/151515'
  WHEN 'bmw' THEN 'https://cdn.simpleicons.org/bmw/151515'
  WHEN 'porsche' THEN 'https://cdn.simpleicons.org/porsche/151515'
  WHEN 'mercedes-amg' THEN 'https://upload.wikimedia.org/wikipedia/commons/4/48/Mercedes-Benz_logo.svg'
  WHEN 'mercedes-benz' THEN 'https://upload.wikimedia.org/wikipedia/commons/4/48/Mercedes-Benz_logo.svg'
  ELSE logo_url
END
WHERE logo_url IS NULL;
