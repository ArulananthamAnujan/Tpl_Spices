export type UserRole = 'super_admin' | 'staff' | 'customer';
export type FulfillmentType = 'PICKUP' | 'DELIVERY';
export type OrderStatus = 'new' | 'in_progress' | 'ready' | 'completed' | 'cancelled';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  assigned_store_id: string | null;
  created_at: string;
}

export interface Store {
  id: string;
  square_location_id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  delivery_radius_km: number;
  delivery_fee_cents: number;
  is_payment_location: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  square_id: string;
  name: string;
  sort_order: number;
  is_brand: boolean;
  section: 'grocery' | 'clothing' | 'kitchen' | 'pooja';
}

export interface PromoSlide {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string | null;
  discount_label: string | null;
  cta_text: string | null;
  cta_link: string | null;
  active: boolean;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  square_item_id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  image_url: string | null;
  active: boolean;
  brand: string | null;
  category?: Category;
  variations?: ProductVariation[];
}

export interface ProductVariation {
  id: string;
  square_variation_id: string;
  product_id: string;
  name: string;
  price_cents: number;
  currency: string;
  wholesale_price_cents: number | null;
  wholesale_min_qty: number | null;
  promo_type: 'percent' | 'fixed' | 'price' | null;
  promo_value: number | null;
  promo_start: string | null;
  promo_end: string | null;
}

export interface StoreInventory {
  store_id: string;
  variation_id: string;
  quantity: number;
}

export interface DeliveryAddress {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface Order {
  id: string;
  customer_id: string;
  store_id: string;
  square_order_id: string | null;
  square_payment_id: string | null;
  fulfillment_type: FulfillmentType;
  status: OrderStatus;
  subtotal_cents: number;
  total_cents: number;
  delivery_address: DeliveryAddress | null;
  scheduled_time: string | null;
  notes: string | null;
  created_at: string;
  store?: Store;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  variation_id: string | null;
  name_snapshot: string;
  qty: number;
  unit_price_cents: number;
}

export interface CartItem {
  variation_id: string;
  product_id: string;
  product_name: string;
  variation_name: string;
  price_cents: number; // retail unit price
  quantity: number;
  image_url: string | null;
  // Pricing inputs carried so the cart can recompute the unit price as the
  // quantity changes (wholesale tier) and reflect active promotions.
  wholesale_price_cents?: number | null;
  wholesale_min_qty?: number | null;
  promo_type?: 'percent' | 'fixed' | 'price' | null;
  promo_value?: number | null;
  promo_start?: string | null;
  promo_end?: string | null;
}

export const formatPrice = (cents: number): string =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-tpl-amber/20 text-yellow-800',
  ready: 'bg-tpl-pale text-tpl-forest',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};
