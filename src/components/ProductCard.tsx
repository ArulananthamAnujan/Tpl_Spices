import { ShoppingCart, Heart, Plus, Minus, Check } from 'lucide-react';
import { Product, ProductVariation, Store, formatPrice } from '../lib/types';
import { useCart } from '../contexts/CartContext';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isPromoActive, promoPriceCents, promoLabel } from '../lib/pricing';
import { useLocalList } from '../lib/useLocalList';
import { Stars } from './ProductReviews';

interface Props {
  product: Product;
  store: Store | null;
  stock?: Record<string, number>;
  rating?: { average: number; count: number };
  onClick?: () => void;
}


export default function ProductCard({ product, store, stock, rating, onClick }: Props) {
  const { addItem } = useCart();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState(1);
  const wishlist = useLocalList('tpl_wishlist');

  const variations = product.variations ?? [];
  const defaultVariation: ProductVariation | undefined = variations[0];
  const price = defaultVariation?.price_cents;

  const trackedQty = defaultVariation && stock ? stock[defaultVariation.id] : undefined;
  const outOfStock = trackedQty !== undefined && trackedQty <= 0;
  const lowStock = trackedQty !== undefined && trackedQty > 0 && trackedQty <= 5;

  const promoOn = defaultVariation ? isPromoActive(defaultVariation) : false;
  const salePrice = defaultVariation ? promoPriceCents(defaultVariation) : undefined;
  const hasWholesale =
    defaultVariation?.wholesale_price_cents != null && defaultVariation?.wholesale_min_qty != null;
  const savingPct =
    promoOn && price && salePrice !== undefined && price > 0
      ? Math.round(((price - salePrice) / price) * 100)
      : 0;

  const maxQty = trackedQty !== undefined ? trackedQty : 99;

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!store) { navigate('/'); return; }
    if (!defaultVariation || outOfStock) return;
    setAdding(true);
    addItem({
      variation_id: defaultVariation.id,
      product_id: product.id,
      product_name: product.name,
      variation_name: defaultVariation.name,
      price_cents: defaultVariation.price_cents,
      quantity: qty,
      image_url: product.image_url,
      wholesale_price_cents: defaultVariation.wholesale_price_cents,
      wholesale_min_qty: defaultVariation.wholesale_min_qty,
      promo_type: defaultVariation.promo_type,
      promo_value: defaultVariation.promo_value,
      promo_start: defaultVariation.promo_start,
      promo_end: defaultVariation.promo_end,
    }, store);
    setTimeout(() => { setAdding(false); setQty(1); }, 1200);
  };

  const step = (e: React.MouseEvent, by: number) => {
    e.stopPropagation();
    setQty(q => Math.min(maxQty, Math.max(1, q + by)));
  };

  const initials = product.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const saved = wishlist.has(product.id);

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-card border border-tpl-dark/8 hover:border-tpl-dark/16 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 overflow-hidden cursor-pointer group flex flex-col"
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-tpl-warm border-b border-tpl-dark/6">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
            <span className="font-display text-3xl text-tpl-forest/25 tracking-tightest select-none">{initials}</span>
            {product.category && (
              <span className="text-[10px] uppercase tracking-[0.14em] text-tpl-forest/30 font-medium">
                {product.category.name}
              </span>
            )}
          </div>
        )}

        {/* Discount / category badges */}
        {promoOn && (
          <span className="absolute top-0 left-0 bg-red-600 text-white text-[11px] px-2 py-1 font-semibold tracking-wide rounded-br-card">
            {savingPct > 0 ? `${savingPct}% off` : promoLabel(defaultVariation!)}
          </span>
        )}

        {/* Wishlist */}
        <button
          onClick={e => { e.stopPropagation(); wishlist.toggle(product.id); }}
          title={saved ? 'Remove from saved' : 'Save for later'}
          className={`absolute top-2 right-2 h-7 w-7 rounded-full flex items-center justify-center transition-all ${
            saved
              ? 'bg-white text-red-600 opacity-100 shadow-card'
              : 'bg-white/90 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-600'
          }`}
        >
          <Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
        </button>

        {outOfStock && (
          <div className="absolute inset-0 bg-tpl-warm/80 flex items-center justify-center">
            <span className="text-tpl-dark/70 text-[11px] font-semibold uppercase tracking-[0.16em]">Out of stock</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5 flex flex-col flex-1">
        {product.brand && (
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.14em] mb-1">{product.brand}</p>
        )}
        <h3 className="font-medium text-tpl-dark text-[13px] leading-snug mb-1.5 line-clamp-2 decoration-tpl-dark/20 underline-offset-2 group-hover:underline">
          {product.name}
        </h3>
        {rating && rating.count > 0 && (
          <span className="flex items-center gap-1 mb-1">
            <Stars value={rating.average} />
            <span className="text-[11px] text-gray-400">({rating.count})</span>
          </span>
        )}
        {variations.length > 1 && (
          <p className="text-[11px] text-gray-400 mb-1">{variations.length} sizes</p>
        )}

        {/* Price */}
        <div className="mt-auto pt-2">
          {price !== undefined ? (
            promoOn && salePrice !== undefined ? (
              <span className="flex items-baseline gap-2 flex-wrap">
                <span className="font-display text-red-700 text-[22px] leading-none tracking-tightest">{formatPrice(salePrice)}</span>
                <span className="text-gray-400 text-xs line-through">{formatPrice(price)}</span>
              </span>
            ) : (
              <span className="font-display text-tpl-dark text-[22px] leading-none tracking-tightest">{formatPrice(price)}</span>
            )
          ) : (
            <span className="text-gray-400 text-sm">Price on request</span>
          )}
          {defaultVariation && (
            <p className="text-[11px] text-gray-400 mt-1">{defaultVariation.name}</p>
          )}
          {hasWholesale && defaultVariation && (
            <p className="text-[11px] text-tpl-mid font-medium mt-1">
              {formatPrice(defaultVariation.wholesale_price_cents as number)} each from {defaultVariation.wholesale_min_qty}
            </p>
          )}
          {lowStock && (
            <p className="text-[11px] text-tpl-amber font-medium mt-1">Only {trackedQty} left</p>
          )}

          {/* Quantity + add to cart */}
          {store && defaultVariation && !outOfStock && (
            <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-center border border-tpl-dark/12 rounded-md overflow-hidden flex-shrink-0">
                <button onClick={e => step(e, -1)} disabled={qty <= 1}
                  className="px-2 py-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors">
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-7 text-center text-sm font-semibold">{qty}</span>
                <button onClick={e => step(e, 1)} disabled={qty >= maxQty}
                  className="px-2 py-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <button
                onClick={handleAdd}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[12px] font-semibold tracking-wide transition-colors duration-200 ${
                  adding ? 'bg-tpl-pale text-tpl-forest' : 'bg-tpl-dark text-white hover:bg-tpl-forest'
                }`}
              >
                {adding ? <><Check className="h-3.5 w-3.5" /> Added</> : <><ShoppingCart className="h-3.5 w-3.5" /> Add</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
