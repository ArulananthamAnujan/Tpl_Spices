-- Removes duplicate active products (same name, multiple rows) found across
-- 15 groups: some are a leftover LOCAL-* seed placeholder next to the real
-- Square-synced item, others are genuine duplicate items inside Square's own
-- catalogue. For each group we keep one row — preferring a real Square item
-- over a LOCAL-* placeholder, then whichever has a photo, then the oldest —
-- and delete the rest. Variations/inventory cascade-delete with the product;
-- past orders keep their name_snapshot regardless (variation_id -> null).

-- Preserve a manually-set photo from a LOCAL-* placeholder onto the real
-- Square item it duplicates, if that real item doesn't already have one.
update products real_p
set image_url = local_p.image_url
from products local_p
where real_p.image_url is null
  and local_p.image_url is not null
  and local_p.square_item_id ilike 'local-%'
  and real_p.square_item_id not ilike 'local-%'
  and real_p.active = true and local_p.active = true
  and lower(trim(real_p.name)) = lower(trim(local_p.name));

with ranked as (
  select id,
         row_number() over (
           partition by lower(trim(name))
           order by
             (square_item_id ilike 'local-%'),  -- real Square items first
             (image_url is null),               -- then ones with a photo
             created_at                          -- then the oldest row
         ) as rn
  from products
  where active = true
)
delete from products
where id in (select id from ranked where rn > 1);
