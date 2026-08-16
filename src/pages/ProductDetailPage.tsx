import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Tag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Product, ProductVariation, Store, formatPrice } from '../lib/types';
import { useCart } from '../contexts/CartContext';
import { isPromoActive, effectiveUnitCents, isWholesaleActive } from '../lib/pricing';
import LoadingSpinner from '../components/LoadingSpinner';
import ProductCard from '../components/ProductCard';
import ProductReviews from '../components/ProductReviews';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariation, setSelectedVariation] = useState<ProductVariation | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [related, setRelated] = useState<Product[]>([]);

  const store: Store | null = (location.state as any)?.store ?? null;

  useEffect(() => {
    if (!id) return;
    supabase
      .from('products')
      .select('*, category:categories(*), variations:product_variations(*)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        setProduct(data);
        if (data?.variations?.length) setSelectedVariation(data.variations[0]);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (!product?.category_id) { setRelated([]); return; }
    supabase
      .from('products')
      .select('*, category:categories(*), variations:product_variations(*)')
      .eq('category_id', product.category_id)
      .eq('active', true)
      .neq('id', product.id)
      .limit(8)
      .then(({ data }) => setRelated(data ?? []));
  }, [product?.category_id, product?.id]);

  useEffect(() => {
    if (!store || !product?.variations?.length) { setStockMap({}); return; }
    supabase
      .from('store_inventory')
      .select('variation_id, quantity')
      .eq('store_id', store.id)
      .in('variation_id', product.variations.map(v => v.id))
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach(r => { map[r.variation_id] = r.quantity; });
        setStockMap(map);
      });
  }, [store, product]);

  const selectedStock = selectedVariation ? stockMap[selectedVariation.id] : undefined;
  const outOfStock = selectedStock !== undefined && selectedStock <= 0;

  useEffect(() => {
    if (selectedStock !== undefined && qty > selectedStock) setQty(Math.max(1, selectedStock));
  }, [selectedStock]);

  const handleAdd = () => {
    if (!selectedVariation || !store || !product || outOfStock) return;
    addItem({
      variation_id: selectedVariation.id,
      product_id: product.id,
      product_name: product.name,
      variation_name: selectedVariation.name,
      price_cents: selectedVariation.price_cents,
      quantity: qty,
      image_url: product.image_url,
      wholesale_price_cents: selectedVariation.wholesale_price_cents,
      wholesale_min_qty: selectedVariation.wholesale_min_qty,
      promo_type: selectedVariation.promo_type,
      promo_value: selectedVariation.promo_value,
      promo_start: selectedVariation.promo_start,
      promo_end: selectedVariation.promo_end,
    }, store);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  if (loading) return <div className="min-h-screen bg-tpl-cream flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (!product) return <div className="min-h-screen bg-tpl-cream flex items-center justify-center"><p className="text-gray-500">Product not found.</p></div>;

  return (
    <div className="min-h-screen bg-tpl-cream">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-tpl-forest hover:text-tpl-mid text-sm font-medium mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Shop
        </button>

        <div className="bg-white rounded-card border border-tpl-dark/8 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Image */}
            <div className="aspect-square bg-tpl-cream flex items-center justify-center">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Tag className="h-24 w-24 text-tpl-mid/30" />
              )}
            </div>

            {/* Details */}
            <div className="p-8 flex flex-col">
              {product.category && (
                <span className="text-xs font-semibold text-tpl-mid bg-tpl-pale px-2 py-1 rounded-full self-start mb-3">
                  {product.category.name}
                </span>
              )}
              <h1 className="font-display text-2xl font-bold text-tpl-dark mb-3">{product.name}</h1>
              {product.description && (
                <p className="text-gray-600 text-sm leading-relaxed mb-6">{product.description}</p>
              )}

              {/* Variation Selector */}
              {product.variations && product.variations.length > 1 && (
                <div className="mb-5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Size / Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {product.variations.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVariation(v)}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${selectedVariation?.id === v.id ? 'border-tpl-forest bg-tpl-pale text-tpl-forest' : 'border-gray-200 text-gray-600 hover:border-tpl-mid'}`}
                      >
                        <div>{v.name}</div>
                        <div className="font-bold text-tpl-forest mt-0.5">{formatPrice(v.price_cents)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedVariation && (() => {
                const promoOn = isPromoActive(selectedVariation);
                const unit = effectiveUnitCents(selectedVariation, qty);
                const wholesaleOn = isWholesaleActive(selectedVariation, qty);
                return (
                  <div className="mb-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-3xl font-bold ${promoOn || wholesaleOn ? 'text-red-600' : 'text-tpl-forest'}`}>{formatPrice(unit)}</span>
                      {(promoOn || wholesaleOn) && (
                        <span className="text-base text-gray-400 line-through">{formatPrice(selectedVariation.price_cents)}</span>
                      )}
                      <span className="text-sm text-gray-400">AUD{qty > 1 ? ' ea.' : ''}</span>
                    </div>
                    {wholesaleOn ? (
                      <p className="text-xs font-semibold text-tpl-forest mt-1">Wholesale price applied ({selectedVariation.wholesale_min_qty}+ units)</p>
                    ) : selectedVariation.wholesale_price_cents != null && selectedVariation.wholesale_min_qty != null ? (
                      <p className="text-xs text-tpl-forest/70 mt-1">Buy {selectedVariation.wholesale_min_qty}+ for {formatPrice(selectedVariation.wholesale_price_cents)} each</p>
                    ) : promoOn ? (
                      <p className="text-xs font-semibold text-red-600 mt-1">On sale — was {formatPrice(selectedVariation.price_cents)}</p>
                    ) : null}
                    {qty > 1 && <p className="text-xs text-gray-400 mt-1">Line total: {formatPrice(unit * qty)}</p>}
                  </div>
                );
              })()}
              {outOfStock ? (
                <p className="text-sm font-semibold text-red-500 mb-6">Out of stock at this store</p>
              ) : selectedStock !== undefined && selectedStock <= 5 ? (
                <p className="text-sm font-medium text-tpl-amber mb-6">Only {selectedStock} left at this store</p>
              ) : (
                <div className="mb-6" />
              )}

              {/* Quantity + Add */}
              {store ? (
                <div className="flex items-center gap-4 mt-auto">
                  <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden">
                    <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={outOfStock} className="px-3 py-2 text-gray-500 hover:bg-gray-50 text-lg font-bold disabled:opacity-30">−</button>
                    <span className="px-4 py-2 text-sm font-semibold min-w-[2.5rem] text-center">{qty}</span>
                    <button
                      onClick={() => setQty(q => selectedStock !== undefined ? Math.min(selectedStock, q + 1) : q + 1)}
                      disabled={outOfStock || (selectedStock !== undefined && qty >= selectedStock)}
                      className="px-3 py-2 text-gray-500 hover:bg-gray-50 text-lg font-bold disabled:opacity-30"
                    >+</button>
                  </div>
                  <button
                    onClick={handleAdd}
                    disabled={!selectedVariation || outOfStock}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-semibold text-sm transition-all ${added ? 'bg-tpl-lime text-tpl-dark' : 'bg-tpl-forest text-white hover:bg-tpl-mid'} disabled:opacity-40`}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    {outOfStock ? 'Out of Stock' : added ? 'Added to Cart!' : 'Add to Cart'}
                  </button>
                </div>
              ) : (
                <div className="bg-tpl-pale/60 rounded-xl p-4 text-center mt-auto">
                  <p className="text-sm text-tpl-forest">Select a store on the <button onClick={() => navigate('/')} className="underline font-semibold">shop page</button> to add items.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Ratings & reviews */}
        {product && <ProductReviews productId={product.id} />}

        {/* Related products */}
        {related.length > 0 && (
          <div className="mt-10">
            <h2 className="font-display text-xl font-bold text-tpl-dark mb-4">You might also like</h2>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {related.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  store={store}
                  onClick={() => navigate(`/product/${p.id}`, { state: { store } })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
