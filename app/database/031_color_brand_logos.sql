UPDATE vehicle_brands
SET logo_url = CASE lower(name)
  WHEN 'audi' THEN 'https://cdn.freebiesupply.com/logos/large/2x/audi-14-logo-png-transparent.png'
  WHEN 'bmw' THEN 'https://cdn.freebiesupply.com/logos/large/2x/bmw-logo-png-transparent.png'
  WHEN 'porsche' THEN 'https://cdn.freebiesupply.com/logos/large/2x/porsche-logo-png-transparent.png'
  WHEN 'mercedes-amg' THEN 'https://cdn.freebiesupply.com/logos/large/2x/mercedes-benz-logo-png-transparent.png'
  WHEN 'mercedes-benz' THEN 'https://cdn.freebiesupply.com/logos/large/2x/mercedes-benz-logo-png-transparent.png'
  ELSE logo_url
END
WHERE lower(name) IN ('audi', 'bmw', 'porsche', 'mercedes-amg', 'mercedes-benz');
