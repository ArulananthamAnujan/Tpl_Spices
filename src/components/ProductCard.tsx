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

// Consistent colour per product based on name initial
const PLACEHOLDER_COLORS = [
  'from-emerald-100 to-tpl-pale',
  'from-amber-100 to-yellow-50',
  'from-sky-100 to-blue-50',
  'from-rose-100 to-pink-50',
  'from-violet-100 to-purple-50',
  'from-tpl-pale to-tpl-cream',
];

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

  const colorClass = PLACEHOLDER_COLORS[product.name.charCodeAt(0) % PLACEHOLDER_COLORS.length];
  const initials = product.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const saved = wishlist.has(product.id);

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl shadow-card hover:shadow-card-hover transition-all duration-300 overflow-hidden cursor-pointer group flex flex-col"
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-tpl-cream">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${colorClass} gap-2`}>
            <div className="w-14 h-14 rounded-2xl bg-white/60 backdrop-blur-sm flex items-center justify-center shadow-sm">
              <span className="text-xl font-bold text-tpl-forest/70 tracking-tight">{initials}</span>
            </div>
            {product.category && (
              <span className="text-xs text-tpl-forest/50 font-medium">{product.category.name}</span>
            )}
          </div>
        )}

        {/* Discount / category badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
          {promoOn && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold shadow-sm">
              {savingPct > 0 ? `-${savingPct}%` : promoLabel(defaultVariation!)}
            </span>
          )}
          {product.image_url && product.category && (
            <span className="bg-tpl-forest/90 text-white text-[11px] px-2 py-0.5 rounded-full font-medium">
              {product.category.name}
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={e => { e.stopPropagation(); wishlist.toggle(product.id); }}
          title={saved ? 'Remove from saved' : 'Save for later'}
          className={`absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${
            saved ? 'bg-red-500 text-white' : 'bg-white/80 text-gray-500 hover:text-red-500'
          }`}
        >
          <Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
        </button>

        {outOfStock && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="bg-tpl-dark text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">Out of Stock</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col flex-1">
        {product.brand && (
          <p className="text-xs font-semibold text-tpl-forest/70 uppercase tracking-wide mb-0.5">{product.brand}</p>
        )}
        <h3 className="font-semibold text-tpl-dark text-sm leading-snug mb-1 line-clamp-2 group-hover:text-tpl-forest transition-colors">
          {product.name}
        </h3>
        {rating && rating.count > 0 && (
          <span className="flex items-center gap-1 mb-1">
            <Stars value={rating.average} />
            <span className="text-[11px] text-gray-400">({rating.count})</span>
          </span>
        )}
        {variations.length > 1 && (
          <p className="text-xs text-gray-400 mb-1">{variations.length} options available</p>
        )}

        {/* Price */}
        <div className="mt-auto pt-2">
          {price !== undefined ? (
            promoOn && salePrice !== undefined ? (
              <span className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-red-600 font-bold text-lg">{formatPrice(salePrice)}</span>
                <span className="text-gray-400 text-xs line-through">{formatPrice(price)}</span>
              </span>
            ) : (
              <span className="text-tpl-forest font-bold text-lg">{formatPrice(price)}</span>
            )
          ) : (
            <span className="text-gray-400 text-sm">Price on request</span>
          )}
          {defaultVariation && (
            <p className="text-xs text-gray-400">{defaultVariation.name}</p>
          )}
          {hasWholesale && defaultVariation && (
            <p className="text-xs text-tpl-forest/80 font-medium mt-0.5">
              {formatPrice(defaultVariation.wholesale_price_cents as number)} ea. when you buy {defaultVariation.wholesale_min_qty}+
            </p>
          )}
          {lowStock && (
            <p className="text-xs text-tpl-amber font-medium mt-0.5">Only {trackedQty} left</p>
          )}

          {/* Quantity + add to cart */}
          {store && defaultVariation && !outOfStock && (
            <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
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
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all duration-300 ${
                  adding ? 'bg-tpl-lime text-tpl-dark' : 'bg-tpl-forest text-white hover:bg-tpl-mid'
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
