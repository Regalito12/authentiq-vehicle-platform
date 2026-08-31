-- Showroom público curado e independiente del inventario editable de plataforma.
-- La migración es idempotente: crea el tenant una sola vez y conserva la foto
-- inicial aunque el inventario de ZEVROA cambie después.
-- Los medios conservan sus URLs públicas actuales; no se duplican objetos de
-- Storage desde SQL. El backup de Storage sigue siendo responsabilidad aparte.

DO $$
DECLARE
  source_org_id UUID;
  demo_org_id UUID;
BEGIN
  SELECT id INTO source_org_id
  FROM organizations
  WHERE slug = 'zevroa'
  LIMIT 1;

  IF source_org_id IS NULL THEN
    RAISE EXCEPTION 'No existe la organización fuente zevroa';
  END IF;

  INSERT INTO organizations (slug, name, logo_url, is_active, approval_status)
  VALUES ('zevroa-demo', 'ZEVROA Demo', NULL, TRUE, 'approved')
  ON CONFLICT (slug) DO UPDATE SET
    is_active = TRUE,
    approval_status = 'approved',
    updated_at = NOW()
  RETURNING id INTO demo_org_id;

  IF demo_org_id IS NULL THEN
    SELECT id INTO demo_org_id FROM organizations WHERE slug = 'zevroa-demo' LIMIT 1;
  END IF;

  INSERT INTO organization_settings (
    organization_id, business_name, logo_url, phone, whatsapp, email, address, hours,
    instagram_url, facebook_url, currency, privacy_text, terms_text,
    appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes,
    appointment_min_notice_hours, appointment_max_days_ahead, appointment_days, appointment_capacity,
    primary_color, accent_color, favicon_url, custom_css, hero_headline, hero_subheadline,
    hero_image_url, show_financing, show_brand_rail, show_model_line_rail, show_blog, faq_items, testimonials
  )
  SELECT
    demo_org_id, 'ZEVROA', s.logo_url, s.phone, s.whatsapp, s.email, s.address, s.hours,
    s.instagram_url, s.facebook_url, s.currency, s.privacy_text, s.terms_text,
    s.appointment_timezone, s.appointment_start, s.appointment_end, s.appointment_duration_minutes,
    s.appointment_min_notice_hours, s.appointment_max_days_ahead, s.appointment_days, s.appointment_capacity,
    s.primary_color, s.accent_color, s.favicon_url, NULL,
    NULL, NULL, '/assets/zevroa-hero-v1.webp', TRUE, TRUE, TRUE, TRUE, s.faq_items, s.testimonials
  FROM organization_settings s
  WHERE s.organization_id = source_org_id
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO vehicle_brands (organization_id, name, logo_url, is_active)
  SELECT DISTINCT demo_org_id, b.name, b.logo_url, TRUE
  FROM vehicles v
  JOIN vehicle_brands b ON b.id = v.brand_id
  WHERE v.organization_id = source_org_id AND v.status = 'published'
  ON CONFLICT (organization_id, name) DO UPDATE SET
    logo_url = COALESCE(EXCLUDED.logo_url, vehicle_brands.logo_url),
    is_active = TRUE;

  INSERT INTO vehicle_categories (organization_id, name, is_active)
  SELECT DISTINCT demo_org_id, c.name, TRUE
  FROM vehicles v
  JOIN vehicle_categories c ON c.id = v.category_id
  WHERE v.organization_id = source_org_id AND v.status = 'published'
  ON CONFLICT (organization_id, name) DO UPDATE SET is_active = TRUE;

  INSERT INTO vehicles (
    brand_id, category_id, model, year, condition, price_usd, engine, power, transmission, drive,
    mileage_km, description, stock, status, max_discount_percent, variant, fuel_type, exterior_color,
    interior_color, doors, seats, location, stock_number, warranty, features, seo_title, seo_description,
    organization_id, price_amount, price_currency
  )
  SELECT
    db.id,
    dc.id,
    v.model, v.year, v.condition, v.price_usd, v.engine, v.power, v.transmission, v.drive,
    v.mileage_km, v.description, v.stock, 'published', v.max_discount_percent, v.variant, v.fuel_type,
    v.exterior_color, v.interior_color, v.doors, v.seats, v.location,
    'DEMO-' || LEFT(v.id::text, 8), v.warranty, v.features, v.seo_title, v.seo_description,
    demo_org_id, v.price_amount, v.price_currency
  FROM vehicles v
  JOIN vehicle_brands sb ON sb.id = v.brand_id
  JOIN vehicle_brands db ON db.organization_id = demo_org_id AND LOWER(db.name) = LOWER(sb.name)
  LEFT JOIN vehicle_categories sc ON sc.id = v.category_id
  LEFT JOIN vehicle_categories dc ON dc.organization_id = demo_org_id AND LOWER(dc.name) = LOWER(sc.name)
  WHERE v.organization_id = source_org_id AND v.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM vehicles existing
      WHERE existing.organization_id = demo_org_id
        AND existing.stock_number = 'DEMO-' || LEFT(v.id::text, 8)
    );

  INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order)
  SELECT dv.id, image.image_url, image.alt_text, image.sort_order
  FROM vehicles sv
  JOIN vehicles dv ON dv.organization_id = demo_org_id AND dv.stock_number = 'DEMO-' || LEFT(sv.id::text, 8)
  JOIN vehicle_images image ON image.vehicle_id = sv.id
  WHERE sv.organization_id = source_org_id
    AND sv.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_images existing
      WHERE existing.vehicle_id = dv.id AND existing.image_url = image.image_url
    );

  INSERT INTO vehicle_media (vehicle_id, media_type, url, poster_url, alt_text, sort_order, is_active, metadata)
  SELECT dv.id, media.media_type, media.url, media.poster_url, media.alt_text, media.sort_order, media.is_active, media.metadata
  FROM vehicles sv
  JOIN vehicles dv ON dv.organization_id = demo_org_id AND dv.stock_number = 'DEMO-' || LEFT(sv.id::text, 8)
  JOIN vehicle_media media ON media.vehicle_id = sv.id
  WHERE sv.organization_id = source_org_id
    AND sv.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_media existing
      WHERE existing.vehicle_id = dv.id AND existing.media_type = media.media_type AND existing.url = media.url
    );

  INSERT INTO billing_subscriptions (organization_id, provider, mode, plan_code, status, monthly_amount, currency, current_period_end)
  SELECT demo_org_id, 'local', 'local_demo', 'starter', 'trialing', p.monthly_amount, 'USD', CURRENT_DATE + 3650
  FROM platform_plans p
  WHERE p.code = 'starter'
  ON CONFLICT (organization_id) DO NOTHING;
END $$;

