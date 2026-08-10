UPDATE vehicles SET
  variant = '992 · PDK', fuel_type = 'Gasolina', exterior_color = 'Gris Agata', interior_color = 'Negro Race-Tex',
  doors = 2, seats = 2, location = 'Showroom principal', stock_number = 'AUT-911-GT3',
  warranty = '12 meses de garantia limitada', features = ARRAY['Eje trasero direccional', 'Escape deportivo', 'Asientos bucket', 'Paquete Sport Chrono']
WHERE model = '911 GT3';

UPDATE vehicles SET
  variant = 'Performance', fuel_type = 'Electrico', exterior_color = 'Negro Jet', interior_color = 'Burdeos',
  doors = 4, seats = 4, location = 'Showroom principal', stock_number = 'AUT-TAY-TS',
  warranty = 'Garantia de bateria sujeta a certificacion', features = ARRAY['Carga rapida DC', 'Suspension adaptativa', 'Sonido premium', 'Techo panoramico']
WHERE model = 'Taycan Turbo S';

UPDATE vehicles SET
  variant = 'Coupe', fuel_type = 'Gasolina', exterior_color = 'Azul Shark', interior_color = 'Negro',
  doors = 4, seats = 4, location = 'Showroom principal', stock_number = 'AUT-CAY-TGT',
  warranty = '12 meses de garantia limitada', features = ARRAY['Direccion trasera', 'Escape deportivo', 'Frenos ceramicos', 'Paquete carbono']
WHERE model = 'Cayenne Turbo GT';

UPDATE vehicles SET
  variant = 'Executive', fuel_type = 'Gasolina', exterior_color = 'Plata Dolomita', interior_color = 'Marron club',
  doors = 4, seats = 4, location = 'Showroom principal', stock_number = 'AUT-PAN-4S',
  warranty = '12 meses de garantia limitada', features = ARRAY['Suspension neumatica', 'Asientos confort', 'Audio premium', 'Camara 360']
WHERE model = 'Panamera 4S';

UPDATE vehicles SET
  variant = 'GTS', fuel_type = 'Gasolina', exterior_color = 'Rojo Carmesi', interior_color = 'Negro',
  doors = 4, seats = 5, location = 'Showroom principal', stock_number = 'AUT-MAC-GTS',
  warranty = '12 meses de garantia limitada', features = ARRAY['Paquete Sport Chrono', 'Escape deportivo', 'Techo panoramico', 'Asistente de carril']
WHERE model = 'Macan GTS';

UPDATE vehicles SET
  variant = 'quattro', fuel_type = 'Electrico', exterior_color = 'Gris Daytona', interior_color = 'Negro',
  doors = 4, seats = 5, location = 'Showroom principal', stock_number = 'AUT-AUD-RSET',
  warranty = 'Garantia de bateria sujeta a certificacion', features = ARRAY['Carga rapida DC', 'Direccion integral', 'Audio Bang & Olufsen', 'Camara 360']
WHERE model = 'RS e-tron GT';

UPDATE vehicles SET
  variant = '4MATIC+', fuel_type = 'Gasolina', exterior_color = 'Negro Obsidiana', interior_color = 'Negro Nappa',
  doors = 4, seats = 4, location = 'Showroom principal', stock_number = 'AUT-AMG-GT63',
  warranty = '12 meses de garantia limitada', features = ARRAY['AMG Ride Control', 'Direccion trasera', 'Sonido Burmester', 'Paquete aerodinamico']
WHERE model = 'GT 63';

UPDATE vehicles SET
  variant = 'Competition xDrive', fuel_type = 'Gasolina', exterior_color = 'Verde Isla de Man', interior_color = 'Negro Merino',
  doors = 2, seats = 4, location = 'Showroom principal', stock_number = 'AUT-BMW-M4C',
  warranty = '12 meses de garantia limitada', features = ARRAY['Asientos M Carbon', 'Head-up display', 'Camara 360', 'Escape M Sport']
WHERE model = 'M4 Competition xDrive';
