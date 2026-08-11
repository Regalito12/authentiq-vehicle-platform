UPDATE vehicle_brands
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/4/48/Mercedes-Benz_logo.svg'
WHERE lower(name) IN ('mercedes-amg', 'mercedes-benz');
