/*
# Product reviews and ratings

Shoppers can rate a product 1–5 and leave a short review. Ratings are the
strongest trust signal on a retail listing, so they're shown on the product
page and as stars on the cards.

  * One review per customer per product (they can edit their own).
  * Anyone may read reviews; only the author may edit or delete theirs, and
    super admins can remove anything inappropriate.
  * product_rating_summary aggregates average score and count per product, so
    listings don't have to pull every review row.
*/

CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text,
  body text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id);

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_public_select" ON product_reviews;
CREATE POLICY "reviews_public_select" ON product_reviews FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "reviews_own_insert" ON product_reviews;
CREATE POLICY "reviews_own_insert" ON product_reviews FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "reviews_own_update" ON product_reviews;
CREATE POLICY "reviews_own_update" ON product_reviews FOR UPDATE TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "reviews_own_delete" ON product_reviews;
CREATE POLICY "reviews_own_delete" ON product_reviews FOR DELETE TO authenticated
  USING (customer_id = auth.uid() OR get_user_role() = 'super_admin');

-- Average rating and review count per product, readable by everyone.
CREATE OR REPLACE VIEW product_rating_summary AS
  SELECT
    product_id,
    ROUND(AVG(rating)::numeric, 2) AS average_rating,
    COUNT(*)::int                  AS review_count
  FROM product_reviews
  GROUP BY product_id;

GRANT SELECT ON product_rating_summary TO anon, authenticated;

-- Keep updated_at honest when a shopper edits their review.
CREATE OR REPLACE FUNCTION touch_review_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_touch_review_updated_at ON product_reviews;
CREATE TRIGGER trg_touch_review_updated_at
  BEFORE UPDATE ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION touch_review_updated_at();
