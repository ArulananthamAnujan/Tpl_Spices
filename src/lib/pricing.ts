// Central pricing logic: retail + promotion + wholesale (bulk) tier.
// This is the single source of truth on the client. The create-order edge
// function mirrors the same rules server-side (never trust client prices).

export type PromoType = 'percent' | 'fixed' | 'price';

export interface PricingFields {
  price_cents: number;               // retail price
  wholesale_price_cents?: number | null;
  wholesale_min_qty?: number | null;
  promo_type?: PromoType | string | null;
  promo_value?: number | null;
  promo_start?: string | null;
  promo_end?: string | null;
}

// Is a promotion configured and currently within its (optional) date window?
export function isPromoActive(v: PricingFields, now: Date = new Date()): boolean {
  if (!v.promo_type || v.promo_value == null) return false;
  if (v.promo_start && now < new Date(v.promo_start)) return false;
  if (v.promo_end && now > new Date(v.promo_end)) return false;
  return true;
}

// Retail price after any active promotion (does not consider wholesale).
export function promoPriceCents(v: PricingFields): number {
  const base = v.price_cents;
  if (!isPromoActive(v)) return base;
  const val = v.promo_value ?? 0;
  let out = base;
  if (v.promo_type === 'percent') out = Math.round((base * (100 - val)) / 100);
  else if (v.promo_type === 'fixed') out = base - val;
  else if (v.promo_type === 'price') out = val;
  return Math.max(0, out);
}

export function wholesaleApplies(v: PricingFields, qty: number): boolean {
  return (
    v.wholesale_price_cents != null &&
    v.wholesale_min_qty != null &&
    v.wholesale_min_qty > 0 &&
    qty >= v.wholesale_min_qty
  );
}

// The unit price a customer actually pays for `qty` of this item:
// best (lowest) of the promo-adjusted retail price and the wholesale tier.
export function effectiveUnitCents(v: PricingFields, qty: number): number {
  const candidates = [promoPriceCents(v)];
  if (wholesaleApplies(v, qty)) candidates.push(v.wholesale_price_cents as number);
  return Math.max(0, Math.min(...candidates));
}

// True when the wholesale tier is the cheapest option at this quantity.
export function isWholesaleActive(v: PricingFields, qty: number): boolean {
  return (
    wholesaleApplies(v, qty) &&
    (v.wholesale_price_cents as number) <= promoPriceCents(v)
  );
}

export function promoLabel(v: PricingFields): string | null {
  if (!isPromoActive(v)) return null;
  if (v.promo_type === 'percent') return `${v.promo_value}% OFF`;
  if (v.promo_type === 'fixed') return `SALE`;
  if (v.promo_type === 'price') return `SALE`;
  return 'SALE';
}
