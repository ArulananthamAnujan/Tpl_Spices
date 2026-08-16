import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Percent, Loader2, PackageOpen } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import { isPromoActive } from '../lib/pricing';
import { useLocalList } from '../lib/useLocalList';

// Everything currently discounted, in one place: promotions first, then the
// wholesale/bulk-buy offers.
export default function DealsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const recent = useLocalList('tpl_recent', 12);

  useEffect(() => {
    (async () => {
      const [prodRes, storeRes] = await Promise.all([
        supabase
          .from('products')
          .select('*, category:categories(*), variations:product_variations(*)')
          .eq('active', true)
          .order('name'),
        supabase.from('stores').select('*').order('name'),
      ]);
      setProducts((prodRes.data as Product[]) ?? []);
      const stores = (storeRes.data as Store[]) ?? [];
      if (stores.length) setStore(stores[0]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!store || products.length === 0) return;
    const ids = products.flatMap(p => (p.variations ?? []).map(v => v.id));
    if (ids.length === 0) return;
    supabase
      .from('store_inventory')
      .select('variation_id, quantity')
      .eq('store_id', store.id)
      .in('variation_id', ids)
      .then(({ data }) => {
        const m: Record<string, number> = {};
        (data ?? []).forEach(r => { m[r.variation_id] = r.quantity; });
        setStockMap(m);
      });
  }, [store, products]);

  const onSale = products.filter(p => (p.variations ?? []).some(v => isPromoActive(v)));
  const bulkDeals = products.filter(
    p => !onSale.includes(p) &&
      (p.variations ?? []).some(v => v.wholesale_price_cents != null && v.wholesale_min_qty != null),
  );

  const open = (p: Product) => { recent.push(p.id); navigate(`/product/${p.id}`, { state: { store } }); };

  if (loading) {
    return <div className="min-h-screen bg-tpl-cream flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-tpl-forest" />
    </div>;
  }

  return (
    <div className="min-h-screen bg-tpl-cream">
      {/* Hero */}
      <div className="bg-gradient-to-r from-tpl-dark via-tpl-forest to-tpl-mid text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <span className="inline-flex items-center gap-1.5 bg-tpl-lime text-tpl-dark text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
            <Percent className="h-3 w-3" /> Savings
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-3">Today's Deals</h1>
          <p className="text-tpl-pale/80 mt-2 text-sm sm:text-base">
            Current promotions and bulk-buy prices across the store.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        {onSale.length === 0 && bulkDeals.length === 0 ? (
          <div className="bg-white rounded-card border border-tpl-dark/8 p-12 text-center">
            <PackageOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No deals running right now</h3>
            <p className="text-sm text-gray-500 mb-6">Check back soon — new offers are added regularly.</p>
            <button onClick={() => navigate('/')}
              className="px-5 py-2.5 bg-tpl-forest text-white rounded-xl text-sm font-semibold hover:bg-tpl-mid transition-colors">
              Browse all products
            </button>
          </div>
        ) : (
          <>
            {onSale.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-bold text-tpl-dark mb-1 flex items-center gap-2">
                  <Tag className="h-5 w-5 text-red-500" /> On sale now
                </h2>
                <p className="text-sm text-gray-500 mb-4">{onSale.length} product{onSale.length !== 1 ? 's' : ''} with an active discount.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {onSale.map(p => (
                    <ProductCard key={p.id} product={p} store={store} stock={stockMap} onClick={() => open(p)} />
                  ))}
                </div>
              </section>
            )}

            {bulkDeals.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-bold text-tpl-dark mb-1 flex items-center gap-2">
                  <PackageOpen className="h-5 w-5 text-tpl-forest" /> Buy more, save more
                </h2>
                <p className="text-sm text-gray-500 mb-4">Wholesale pricing kicks in automatically once you reach the minimum quantity.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {bulkDeals.map(p => (
                    <ProductCard key={p.id} product={p} store={store} stock={stockMap} onClick={() => open(p)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
