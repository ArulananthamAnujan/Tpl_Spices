/*
# Seed modern clothing products under Women, Men, Kids categories

Adds everyday Western-style clothing (t-shirts, dresses, jeans, hoodies, etc.)
with variations and store inventory for both stores.
*/

DO $$
DECLARE
  women_cat uuid := 'f07bde41-dc47-4cfc-8b74-6b0724aff436';
  men_cat   uuid := '7af743d8-7c3d-4a30-bcac-c0f5b31a5bf2';
  kids_cat  uuid := 'e8d2d3bf-3fd3-45fc-9483-f4e1d01d5aca';
  dandenong uuid := '21a397e3-d2a4-4840-9ee8-2ece6df096ba';
  clayton   uuid := 'a8ca5782-f01f-470a-b213-b324b08ff4bf';

  wp1 uuid := gen_random_uuid(); wp2 uuid := gen_random_uuid();
  wp3 uuid := gen_random_uuid(); wp4 uuid := gen_random_uuid();
  wp5 uuid := gen_random_uuid(); wp6 uuid := gen_random_uuid();

  mp1 uuid := gen_random_uuid(); mp2 uuid := gen_random_uuid();
  mp3 uuid := gen_random_uuid(); mp4 uuid := gen_random_uuid();
  mp5 uuid := gen_random_uuid(); mp6 uuid := gen_random_uuid();

  kp1 uuid := gen_random_uuid(); kp2 uuid := gen_random_uuid();
  kp3 uuid := gen_random_uuid(); kp4 uuid := gen_random_uuid();
  kp5 uuid := gen_random_uuid(); kp6 uuid := gen_random_uuid();
BEGIN
  -- Ensure the clothing categories exist (originally expected from a Square
  -- sync). Idempotent so re-running the setup is safe.
  INSERT INTO categories (id, square_id, name, sort_order, section) VALUES
    (women_cat, 'LOCAL-CAT-WOMEN', 'Women', 20, 'clothing'),
    (men_cat,   'LOCAL-CAT-MEN',   'Men',   21, 'clothing'),
    (kids_cat,  'LOCAL-CAT-KIDS',  'Kids',  22, 'clothing')
  ON CONFLICT (id) DO NOTHING;

  -- Ensure the demo stores exist so inventory can attach. These are placeholder
  -- stores you can rename or delete in Admin → Stores.
  INSERT INTO stores (id, square_location_id, name, address, pickup_enabled, delivery_enabled) VALUES
    (dandenong, 'LOCAL-LOC-DANDENONG', 'TPL Spices Dandenong', 'Dandenong VIC 3175', true, true),
    (clayton,   'LOCAL-LOC-CLAYTON',   'TPL Spices Clayton',   'Clayton VIC 3168',   true, false)
  ON CONFLICT (id) DO NOTHING;

  -- WOMEN
  INSERT INTO products (id, square_item_id, category_id, name, description, image_url, active) VALUES
    (wp1, 'LOCAL-CLO-W-01', women_cat, 'Casual Cotton T-Shirt',
     'Soft breathable cotton tee in a relaxed fit. Perfect for everyday wear.',
     'https://images.pexels.com/photos/8146450/pexels-photo-8146450.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp2, 'LOCAL-CLO-W-02', women_cat, 'Summer Floral Dress',
     'Lightweight floral print dress ideal for warm days and casual outings.',
     'https://images.pexels.com/photos/4428388/pexels-photo-4428388.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp3, 'LOCAL-CLO-W-03', women_cat, 'Cotton Blend Blouse',
     'Elegant everyday blouse with a comfortable cotton blend. Easy to dress up or down.',
     'https://images.pexels.com/photos/3750640/pexels-photo-3750640.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp4, 'LOCAL-CLO-W-04', women_cat, 'Slim Fit Denim Jeans',
     'Classic five-pocket denim jeans with a flattering slim fit and stretch comfort.',
     'https://images.pexels.com/photos/18533668/pexels-photo-18533668.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp5, 'LOCAL-CLO-W-05', women_cat, 'Fleece Pullover Hoodie',
     'Cozy fleece-lined hoodie with kangaroo pocket. Great for layering in cooler weather.',
     'https://images.pexels.com/photos/8743972/pexels-photo-8743972.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (wp6, 'LOCAL-CLO-W-06', women_cat, 'High-Waist Leggings',
     'Stretchy high-waist leggings with a smooth waistband for all-day comfort.',
     'https://images.pexels.com/photos/28666282/pexels-photo-28666282.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  -- MEN
  INSERT INTO products (id, square_item_id, category_id, name, description, image_url, active) VALUES
    (mp1, 'LOCAL-CLO-M-01', men_cat, 'Crew Neck T-Shirt',
     'Classic crew neck tee in soft combed cotton. A versatile wardrobe essential.',
     'https://images.pexels.com/photos/10493094/pexels-photo-10493094.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp2, 'LOCAL-CLO-M-02', men_cat, 'Pique Polo Shirt',
     'Breathable pique-knit polo with ribbed collar. Smart-casual for any occasion.',
     'https://images.pexels.com/photos/928364/pexels-photo-928364.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp3, 'LOCAL-CLO-M-03', men_cat, 'Straight Leg Denim Jeans',
     'Durable straight-leg denim with a classic wash and reinforced stitching.',
     'https://images.pexels.com/photos/13094233/pexels-photo-13094233.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp4, 'LOCAL-CLO-M-04', men_cat, 'Drawstring Hoodie',
     'Mid-weight hoodie with adjustable drawstring hood and front pouch pocket.',
     'https://images.pexels.com/photos/6342786/pexels-photo-6342786.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp5, 'LOCAL-CLO-M-05', men_cat, 'Casual Button-Up Shirt',
     'Relaxed-fit button-up shirt in a lightweight weave. Great worn open or tucked.',
     'https://images.pexels.com/photos/966067/pexels-photo-966067.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (mp6, 'LOCAL-CLO-M-06', men_cat, 'Lightweight Bomber Jacket',
     'Slim-cut bomber jacket with ribbed cuffs and a smooth zip front. Layering made easy.',
     'https://images.pexels.com/photos/13094233/pexels-photo-13094233.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  -- KIDS
  INSERT INTO products (id, square_item_id, category_id, name, description, image_url, active) VALUES
    (kp1, 'LOCAL-CLO-K-01', kids_cat, 'Kids Graphic T-Shirt',
     'Fun printed graphic tee in soft cotton. Machine washable and kid-tough.',
     'https://images.pexels.com/photos/5693888/pexels-photo-5693888.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp2, 'LOCAL-CLO-K-02', kids_cat, 'Kids Denim Shorts',
     'Sturdy denim shorts with an elastic waistband for growing kids.',
     'https://images.pexels.com/photos/5693891/pexels-photo-5693891.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp3, 'LOCAL-CLO-K-03', kids_cat, 'Kids Summer Dress',
     'Cheerful polka-dot dress with a comfy cotton lining for warm-weather play.',
     'https://images.pexels.com/photos/13526559/pexels-photo-13526559.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp4, 'LOCAL-CLO-K-04', kids_cat, 'Kids Fleece Hoodie',
     'Warm fleece hoodie with a front pocket. Keeps little ones cozy on cool days.',
     'https://images.pexels.com/photos/21967197/pexels-photo-21967197.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp5, 'LOCAL-CLO-K-05', kids_cat, 'Kids Casual Top',
     'Soft everyday top that pairs easily with jeans or shorts for school or play.',
     'https://images.pexels.com/photos/9322333/pexels-photo-9322333.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true),
    (kp6, 'LOCAL-CLO-K-06', kids_cat, 'Kids Printed T-Shirt',
     'Brightly printed character tee in breathable cotton jersey.',
     'https://images.pexels.com/photos/15304383/pexels-photo-15304383.jpeg?auto=compress&cs=tinysrgb&h=650&w=940', true)
  ON CONFLICT (square_item_id) DO NOTHING;

  -- VARIATIONS (one per product, "Regular" size)
  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-01')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 4500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-02')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-03')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 5500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-04')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 4000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-05')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-W-06')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-01')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-02')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 5500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-03')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 4500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-04')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 3000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-05')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 6500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-M-06')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 1500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-01','LOCAL-CLO-K-06')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2000, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-02')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 2500, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-03','LOCAL-CLO-K-04')
  ON CONFLICT (square_variation_id) DO NOTHING;

  INSERT INTO product_variations (product_id, square_variation_id, name, price_cents, currency)
  SELECT id, 'LOCAL-VAR-' || square_item_id, 'Regular', 1800, 'AUD'
  FROM products WHERE square_item_id IN ('LOCAL-CLO-K-05')
  ON CONFLICT (square_variation_id) DO NOTHING;

  -- INVENTORY for both stores (50 units each)
  INSERT INTO store_inventory (store_id, variation_id, quantity)
  SELECT s.store_id, v.id, 50
  FROM (VALUES (dandenong), (clayton)) AS s(store_id)
  CROSS JOIN product_variations v
  WHERE v.square_variation_id LIKE 'LOCAL-VAR-LOCAL-CLO-%'
  ON CONFLICT (store_id, variation_id) DO NOTHING;
END $$;
