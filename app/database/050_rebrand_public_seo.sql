-- Remove legacy platform branding from public SEO fields while preserving
-- dealer names, vehicle names, and editorial copy chosen by each organization.
UPDATE vehicles
SET seo_title = NULLIF(REPLACE(REPLACE(seo_title, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'), ''),
    seo_description = NULLIF(REPLACE(REPLACE(seo_description, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'), '')
WHERE seo_title ILIKE '%authentiq%' OR seo_description ILIKE '%authentiq%';

UPDATE blog_posts
SET seo_title = NULLIF(REPLACE(REPLACE(seo_title, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'), ''),
    seo_description = NULLIF(REPLACE(REPLACE(seo_description, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'), '')
WHERE seo_title ILIKE '%authentiq%' OR seo_description ILIKE '%authentiq%';
