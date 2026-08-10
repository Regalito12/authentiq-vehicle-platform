ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category VARCHAR(80);
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS blog_posts_category_idx ON blog_posts(category, status, published_at DESC);
