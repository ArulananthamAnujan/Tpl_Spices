import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ChevronDown, MapPin, Loader2, SlidersHorizontal, X, Salad, Shirt, Truck, ShieldCheck, Leaf, Store as StoreIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Store, Category, Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';
import PromoCarousel from '../components/PromoCarousel';

type Section = 'grocery' | 'clothing';

export default function StorefrontPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [section, setSection] = useState<Section>('grocery');
  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [storeDropOpen, setStoreDropOpen] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  // Sync state from URL params
  useEffect(() => {
    const cat = searchParams.get('category');
    const sec = searchParams.get('section') as Section | null;
    const search = searchParams.get('search');

    if (sec === 'grocery' || sec === 'clothing') setSection(sec);
    setSelectedCategory(cat ?? null);
    if (search) setSearchQuery(search);
  }, [searchParams]);

  useEffect(() => {
    supabase.from('stores').select('*').order('name').then(({ data }) => {
      setStores(data ?? []);
      if (data && data.length > 0) setSelectedStore(data[0]);
      setLoadingStores(false);
    });
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      setCategories(data ?? []);
    });
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    let query = supabase
      .from('products')
      .select('*, category:categories(*), variations:product_variations(*)')
      .eq('active', true)
      .order('name');

    if (selectedCategory) {
      query = query.eq('category_id', selectedCategory);
    } else {
      const sectionCatIds = categories
        .filter(c => c.section === section)
        .map(c => c.id);
      if (section === 'grocery') {
        // Grocery: all products in grocery categories OR with no category
        if (sectionCatIds.length > 0) {
          query = query.or(`category_id.in.(${sectionCatIds.join(',')}),category_id.is.null`);
        } else {
          query = query.is('category_id', null);
        }
      } else {
        // Clothing: only products explicitly in clothing categories
        if (sectionCatIds.length > 0) {
          query = query.in('category_id', sectionCatIds);
        } else {
          // No clothing categories yet — return nothing
          setProducts([]);
          setLoadingProducts(false);
          return;
        }
      }
    }

    if (searchQuery.trim()) query = query.ilike('name', `%${searchQuery.trim()}%`);
    if (selectedBrand) query = query.eq('brand', selectedBrand);

    const { data } = await query;
    setProducts(data ?? []);
    setLoadingProducts(false);
  }, [selectedCategory, selectedBrand, searchQuery, section, categories]);

  useEffect(() => {
    if (categories.length === 0 && !searchQuery) return;
    const t = setTimeout(fetchProducts, 300);
    return () => clearTimeout(t);
  }, [fetchProducts]);

  // Also fetch when categories load
  useEffect(() => {
    if (categories.length > 0) fetchProducts();
  }, [categories]);

  // Stock levels for the selected store, for whichever variations are on screen
  useEffect(() => {
    if (!selectedStore || products.length === 0) { setStockMap({}); return; }
    const variationIds = products.flatMap(p => (p.variations ?? []).map(v => v.id));
    if (variationIds.length === 0) { setStockMap({}); return; }
    supabase
      .from('store_inventory')
      .select('variation_id, quantity')
      .eq('store_id', selectedStore.id)
      .in('variation_id', variationIds)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach(r => { map[r.variation_id] = r.quantity; });
        setStockMap(map);
      });
  }, [selectedStore, products]);

  const switchSection = (s: Section) => {
    setSection(s);
    setSelectedCategory(null);
    setSelectedBrand(null);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('section', s);
      p.delete('category');
      return p;
    });
  };

  const selectCategory = (catId: string | null) => {
    setSelectedCategory(catId);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('section', section);
      if (catId) p.set('category', catId);
      else p.delete('category');
      return p;
    });
  };

  const sidebarCategories = categories.filter(c => c.section === section && !c.is_brand);

  const sectionLabel = section === 'grocery' ? 'Grocery & Spices' : 'Clothing';

  return (
    <div className="min-h-screen bg-tpl-cream">
      <PromoCarousel />

      {/* Trust / feature strip */}
      <div className="bg-tpl-forest text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10">
          {[
            { icon: Leaf, title: 'Fresh & Authentic', sub: 'Quality spices & groceries' },
            { icon: Truck, title: 'Delivery & Pickup', sub: 'Fast, flexible fulfilment' },
            { icon: ShieldCheck, title: 'Secure Checkout', sub: 'Safe, encrypted payments' },
            { icon: StoreIcon, title: 'Local Stores', sub: 'Serving your community' },
          ].map(f => (
            <div key={f.title} className="flex items-center gap-3 px-3 py-3.5">
              <f.icon className="h-5 w-5 text-tpl-lime flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold leading-tight truncate">{f.title}</p>
                <p className="text-[11px] text-tpl-pale/70 leading-tight truncate hidden sm:block">{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Store Selector */}
      <div className="bg-white border-b border-gray-100 py-2 px-4">
        <div className="max-w-7xl mx-auto">
          {loadingStores ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="h-4 w-4 animate-spin text-tpl-lime" />
              <span className="text-sm text-gray-500">Loading stores…</span>
            </div>
          ) : (
            <div className="relative inline-block">
              <button
                onClick={() => setStoreDropOpen(v => !v)}
                className="flex items-center gap-2 text-sm text-gray-700 hover:text-tpl-forest transition-colors py-1"
              >
                <MapPin className="h-4 w-4 text-tpl-lime flex-shrink-0" />
                <span className="font-medium">{selectedStore?.name ?? 'Select a store'}</span>
                {selectedStore && <span className="text-gray-400 text-xs hidden sm:inline">· {selectedStore.address}</span>}
                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${storeDropOpen ? 'rotate-180' : ''}`} />
              </button>
              {storeDropOpen && (
                <div className="absolute top-full mt-1 left-0 bg-white rounded-2xl shadow-card-hover border border-gray-100 z-30 overflow-hidden min-w-[280px]">
                  {stores.map(store => (
                    <button
                      key={store.id}
                      onClick={() => { setSelectedStore(store); setStoreDropOpen(false); }}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-tpl-cream transition-colors border-b last:border-b-0 border-gray-50 ${selectedStore?.id === store.id ? 'bg-tpl-pale/40' : ''}`}
                    >
                      <p className="font-semibold text-tpl-forest">{store.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{store.address}</p>
                      <div className="flex gap-2 mt-1">
                        {store.pickup_enabled && <span className="text-xs bg-tpl-pale text-tpl-forest px-1.5 py-0.5 rounded">Pickup</span>}
                        {store.delivery_enabled && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Delivery</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section Tabs */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 py-2">
            <button
              onClick={() => switchSection('grocery')}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                section === 'grocery'
                  ? 'bg-tpl-forest text-white shadow-sm'
                  : 'text-gray-500 hover:text-tpl-forest hover:bg-tpl-cream'
              }`}
            >
              <Salad className="h-4 w-4" />
              Grocery &amp; Spices
            </button>
            <button
              onClick={() => switchSection('clothing')}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                section === 'clothing'
                  ? 'bg-tpl-forest text-white shadow-sm'
                  : 'text-gray-500 hover:text-tpl-forest hover:bg-tpl-cream'
              }`}
            >
              <Shirt className="h-4 w-4" />
              Clothing
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search + Filter */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={`Search ${sectionLabel.toLowerCase()}…`}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-tpl-lime focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowMobileFilters(v => !v)}
            className="md:hidden p-2.5 bg-white border border-gray-200 rounded-xl text-gray-600"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className={`w-52 flex-shrink-0 ${showMobileFilters ? 'block' : 'hidden'} md:block`}>
            <div className="bg-white rounded-2xl shadow-card p-4 sticky top-28">
              <div className="flex items-center gap-2 mb-3">
                {section === 'grocery'
                  ? <Salad className="h-4 w-4 text-tpl-forest" />
                  : <Shirt className="h-4 w-4 text-tpl-forest" />}
                <h3 className="font-semibold text-tpl-dark text-sm">{sectionLabel}</h3>
              </div>
              <button
                onClick={() => selectCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${!selectedCategory ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
              >
                All Products
              </button>
              {sidebarCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => selectCategory(cat.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${selectedCategory === cat.id ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                >
                  {cat.name}
                </button>
              ))}
              {sidebarCategories.length === 0 && (
                <p className="text-xs text-gray-400 italic px-3 py-2">No categories yet.</p>
              )}

              {/* Brand filter */}
              {(() => {
                const brands = [...new Set(products.map(p => p.brand).filter(Boolean) as string[])].sort();
                if (brands.length === 0) return null;
                return (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-2">Brand</p>
                    <button
                      onClick={() => setSelectedBrand(null)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${!selectedBrand ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                    >
                      All Brands
                    </button>
                    {brands.map(brand => (
                      <button
                        key={brand}
                        onClick={() => setSelectedBrand(selectedBrand === brand ? null : brand)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${selectedBrand === brand ? 'bg-tpl-forest text-white font-medium' : 'text-gray-600 hover:bg-tpl-cream'}`}
                      >
                        {brand}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </aside>

          {/* Product Grid */}
          <div className="flex-1 min-w-0">
            {loadingProducts ? (
              <div className="flex items-center justify-center py-20">
                <LoadingSpinner size="lg" />
              </div>
            ) : products.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-card p-12 text-center">
                {section === 'grocery'
                  ? <Salad className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  : <Shirt className="h-12 w-12 text-gray-300 mx-auto mb-4" />}
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No products found</h3>
                <p className="text-sm text-gray-500">
                  {searchQuery
                    ? `No results for "${searchQuery}" in ${sectionLabel}.`
                    : `No ${sectionLabel.toLowerCase()} products yet.`}
                </p>
                {(searchQuery || selectedCategory || selectedBrand) && (
                  <button
                    onClick={() => { setSearchQuery(''); selectCategory(null); setSelectedBrand(null); }}
                    className="mt-4 px-4 py-2 bg-tpl-forest text-white text-sm rounded-lg hover:bg-tpl-mid transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="mb-5 pb-3 border-b border-gray-200">
                  <h2 className="font-display text-xl font-bold text-tpl-dark">
                    {selectedCategory && categories.find(c => c.id === selectedCategory)
                      ? categories.find(c => c.id === selectedCategory)?.name
                      : sectionLabel}
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {products.length} product{products.length !== 1 ? 's' : ''} available
                    {selectedBrand ? ` · ${selectedBrand}` : ''}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {products.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      store={selectedStore}
                      stock={stockMap}
                      onClick={() => navigate(`/product/${product.id}`, { state: { store: selectedStore } })}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
